import { classNumber, classNumberForColour, type ClassChoice } from './materialClasses';
import * as THREE from 'three';

/** "Realistic" look for a 3D view: a fixed sun (bearing + height)
    with soft shadows on the model and ground, and a procedural concrete
    surface. The sun does not follow the 4D timeline, so shadows stay put. */

export interface RealismSettings {
  /** Realistic materials: the class chosen for a colour group of the models
      (#rrggbb -> class, or 'original'), over what its names suggest. */
  mapping: Record<string, ClassChoice>;
  /** Compass bearing the sun shines FROM, degrees clockwise from project
      north (−Z in the viewer): 180 = from the south. */
  sunAzimuth: number;
  /** Sun height above the horizon, degrees. */
  sunElevation: number;
  /** Concrete surface texture strength, 0 = off. */
  concrete: number;
  /** How far the model's own colours are turned concrete grey (0..1). 4D
      appearance colours are not affected. */
  concreteColor: number;
}

export const DEFAULT_REALISM: RealismSettings = { sunAzimuth: 210, sunElevation: 40, concrete: 0.8, concreteColor: 1, mapping: {} };

const RAD = Math.PI / 180;

/** Unit vector from the ground towards the sun, in viewer axes (Y up,
    project north = −Z, east = +X). */
export function sunDirection(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = azimuthDeg * RAD;
  const el = Math.max(2, Math.min(89, elevationDeg)) * RAD;
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}


// ---- sky ------------------------------------------------------------------------

/** The sky for a sun position: the backdrop, what shiny materials reflect and
    the hemisphere light's colours all come from this. */
export interface SkyParams {
  zenith: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  sunColor: THREE.Color;
  /** From the ground towards the sun, viewer axes (Y up, north −Z). */
  sunDir: THREE.Vector3;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const blend = (a: string, b: string, t: number) => new THREE.Color(a).lerp(new THREE.Color(b), t);

export function skyParamsFor(azimuth: number, elevation: number): SkyParams {
  const day = smooth(2, 25, elevation);
  return {
    zenith: blend('#25305f', '#3f78c4', day),
    // A low sun warms the horizon; a high one leaves it hazy white-blue.
    horizon: blend('#f0a070', '#c9dcf0', day),
    ground: blend('#3a3835', '#6b6a66', day),
    sunColor: blend('#ff9d5c', '#fff6e6', day),
    sunDir: sunDirection(azimuth, elevation),
  };
}

// ---- concrete surface ------------------------------------------------------

/** A view's concrete strength and grey tint, as shader uniforms: the main
    view's are shared by its materials; the split's second view has its own. */
export interface ConcreteUniforms {
  strength: { value: number };
  tint: { value: number };
  /** 1 when this view shows the material classes (brick, glass, ...). */
  mats: { value: number };
  /** 1 when shiny classes reflect the sky. */
  reflect: { value: number };
  zenith: { value: THREE.Color };
  horizon: { value: THREE.Color };
  ground: { value: THREE.Color };
  sunColor: { value: THREE.Color };
  sunDir: { value: THREE.Vector3 };
}

export const newConcreteUniforms = (): ConcreteUniforms => {
  const sky = skyParamsFor(DEFAULT_REALISM.sunAzimuth, DEFAULT_REALISM.sunElevation);
  return {
    strength: { value: 0 }, tint: { value: 0 }, mats: { value: 0 }, reflect: { value: 0 },
    zenith: { value: sky.zenith }, horizon: { value: sky.horizon }, ground: { value: sky.ground },
    sunColor: { value: sky.sunColor }, sunDir: { value: sky.sunDir },
  };
};
const shared: ConcreteUniforms = newConcreteUniforms();
const CONCRETE_GREY = 'vec3(0.56, 0.55, 0.52)';

const NOISE_GLSL = /* glsl */ `
varying vec3 vConcretePos;
varying vec3 vConcreteNrm;
uniform float uConcrete;
uniform float uConcreteTint;
uniform float uClass;
uniform float uMats;
uniform float uReflect;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGround;
uniform vec3 uSunCol;
uniform vec3 uSunDirW;
float cHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float cNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(cHash(i), cHash(i + vec3(1,0,0)), f.x), mix(cHash(i + vec3(0,1,0)), cHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(cHash(i + vec3(0,0,1)), cHash(i + vec3(1,0,1)), f.x), mix(cHash(i + vec3(0,1,1)), cHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float cFbm(vec3 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * cNoise(p); p *= 2.07; a *= 0.5; } return v; }
vec3 cHash3(vec3 p) { return vec3(cHash(p), cHash(p + 17.3), cHash(p + 41.7)); }

// Surface coordinates: along the wall and up it; on floors and roofs, the two horizontal axes.
vec2 cSurface(vec3 p, vec3 n) {
  if (abs(n.y) > 0.7) return p.xz;
  vec2 t = normalize(vec2(-n.z, n.x) + vec2(1e-5));
  return vec2(dot(p.xz, t), p.y);
}

// The look of each material class (numbers follow MATERIAL_CLASSES), in metres.
vec3 classLook(int c, vec3 base, vec3 p, vec3 n) {
  vec2 uv = cSurface(p, n);
  if (c == 2) return mix(base, vec3(0.45, 0.62, 0.70), 0.7) * (0.9 + 0.1 * cNoise(p * 3.0));
  if (c == 3) return base * (0.88 + 0.22 * cNoise(vec3(uv.x * 2.0, uv.y * 90.0, 0.0)));
  if (c == 4) return vec3(0.20, 0.42, 0.12) * (0.65 + 0.7 * cFbm(p * 6.0)) * (0.9 + 0.2 * cNoise(p * 70.0));
  if (c == 5) {
    float bh = 0.075; float bw = 0.215; float m = 0.009;
    float row = floor(uv.y / bh);
    float x = uv.x / bw + (mod(row, 2.0) < 0.5 ? 0.0 : 0.5);
    float cell = floor(x);
    vec2 f = vec2(fract(x) * bw, mod(uv.y, bh));
    float mortar = (f.x < m || f.y < m * 0.9) ? 1.0 : 0.0;
    vec3 t = cHash3(vec3(cell, row, 3.0));
    vec3 brick = vec3(0.55, 0.24, 0.17) * (0.78 + 0.4 * t.x) + (t.y - 0.5) * 0.05;
    brick *= 0.9 + 0.2 * cNoise(p * 40.0);
    return mix(brick, vec3(0.62, 0.60, 0.56), mortar);
  }
  if (c == 6) {
    float plank = floor(uv.x / 0.14);
    float ph = cHash(vec3(plank, 1.0, 2.0));
    float grain = sin((uv.y * 9.0 + cFbm(vec3(uv.x * 2.0, uv.y * 0.6, plank)) * 14.0) * 2.0) * 0.5 + 0.5;
    float seam = step(fract(uv.x / 0.14), 0.02);
    vec3 col = mix(vec3(0.46, 0.30, 0.16), vec3(0.62, 0.43, 0.24), grain * 0.6 + ph * 0.4);
    return col * (1.0 - 0.45 * seam);
  }
  if (c == 7) return vec3(0.13) * (0.7 + 0.6 * cFbm(p * 8.0)) + 0.05 * step(0.82, cNoise(p * 55.0));
  if (c == 8) {
    vec2 b = uv / vec2(0.6, 0.3);
    float row = floor(b.y);
    float x = b.x + 0.5 * mod(row, 2.0);
    vec2 f = vec2(fract(x), fract(b.y));
    float joint = (f.x < 0.012 || f.y < 0.02) ? 1.0 : 0.0;
    float h = cHash(vec3(floor(x), row, 5.0));
    return mix(base * (0.78 + 0.35 * cFbm(p * 5.0)) * (0.92 + 0.16 * h), vec3(0.35), joint * 0.8);
  }
  if (c == 9) { vec3 q = p * 28.0; return vec3(0.42, 0.40, 0.37) * (0.55 + 0.7 * cNoise(q)) * (0.85 + 0.3 * cNoise(q * 2.3 + 7.0)); }
  if (c == 10) return vec3(0.30, 0.21, 0.13) * (0.6 + 0.8 * cFbm(p * 9.0)) * (0.9 + 0.2 * cNoise(p * 60.0));
  if (c == 11) {
    vec2 g = uv / 0.3; vec2 f = fract(g);
    float grout = (f.x < 0.02 || f.y < 0.02) ? 1.0 : 0.0;
    return mix(base * (0.94 + 0.1 * cHash(vec3(floor(g), 9.0))), vec3(0.55), grout * 0.85);
  }
  if (c == 12) return base * (0.96 + 0.06 * cFbm(p * 3.0));
  if (c == 13) return base * (0.95 + 0.08 * cNoise(p * 30.0));
  return base;
}
// How mirror-like each class is.
float classReflect(int c) {
  if (c == 2) return 0.55;
  if (c == 3) return 0.42;
  if (c == 13) return 0.2;
  if (c == 11) return 0.08;
  if (c == 8) return 0.04;
  return 0.0;
}
`;

/** Adds a world-space concrete mottling to a Lambert material's colour —
    no UVs needed (fragments geometry has none) — and, when the view shows
    material classes, the class's own pattern and sky reflection. Strengths
    come from `u`; the class of each material from its own uClass uniform. */
function patchConcrete(material: THREE.Material, u: ConcreteUniforms) {
  if (!(material as THREE.MeshLambertMaterial).isMeshLambertMaterial || material.userData.concretePatched) return;
  material.userData.concretePatched = true;
  // Only the model's own materials (marked at load) turn concrete grey;
  // materials made later for 4D colours keep their colour.
  const tint = !!material.userData.concreteBase;
  const classU = (material.userData.classU = { value: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uConcrete = u.strength;
    shader.uniforms.uConcreteTint = u.tint;
    shader.uniforms.uClass = classU;
    shader.uniforms.uMats = u.mats;
    shader.uniforms.uReflect = u.reflect;
    shader.uniforms.uSkyZenith = u.zenith;
    shader.uniforms.uSkyHorizon = u.horizon;
    shader.uniforms.uSkyGround = u.ground;
    shader.uniforms.uSunCol = u.sunColor;
    shader.uniforms.uSunDirW = u.sunDir;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vConcretePos;\nvarying vec3 vConcreteNrm;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 cPos = vec4(transformed, 1.0);
        vec3 cNrm = objectNormal;
        #ifdef USE_INSTANCING
          cPos = instanceMatrix * cPos;
          cNrm = mat3(instanceMatrix) * cNrm;
        #endif
        vConcretePos = (modelMatrix * cPos).xyz;
        vConcreteNrm = normalize(mat3(modelMatrix) * cNrm);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${NOISE_GLSL}`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float cls = floor(uClass + 0.5) * step(0.5, uMats);
        float rfl = 0.0;
        float concreteOn = uConcrete;
        float concreteTint = uConcreteTint;
        if (cls > 1.5) {
          diffuseColor.rgb = classLook(int(cls + 0.5), diffuseColor.rgb, vConcretePos, normalize(vConcreteNrm));
          rfl = classReflect(int(cls + 0.5));
          concreteOn = 0.0;
          concreteTint = 0.0;
        } else if (cls > 0.5) {
          concreteOn = max(uConcrete, 0.8);
          concreteTint = max(uConcreteTint, 0.9);
        }
        ${tint ? `diffuseColor.rgb = mix(diffuseColor.rgb, ${CONCRETE_GREY}, concreteTint);` : ''}
        if (concreteOn > 0.0) {
          float mottle = cFbm(vConcretePos * 0.9);
          float stain = cFbm(vConcretePos * vec3(0.25, 1.4, 0.25));
          float grain = cNoise(vConcretePos * 45.0);
          float pits = step(0.9, cNoise(vConcretePos * 26.0));
          float f = 0.78 + 0.34 * mottle - 0.10 * (stain - 0.5) + 0.10 * (grain - 0.5) - 0.18 * pits;
          diffuseColor.rgb *= mix(1.0, f, concreteOn);
        }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `if (rfl > 0.0 && uReflect > 0.5) {
          vec3 vd = normalize(vViewPosition);
          vec3 rv = inverseTransformDirection(reflect(-vd, normal), viewMatrix);
          float up = rv.y;
          vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(clamp(up, 0.0, 1.0), 0.55));
          sky = up >= 0.0 ? sky : mix(uSkyHorizon * 0.8, uSkyGround, smoothstep(0.0, -0.35, up));
          float ts = max(dot(rv, uSunDirW), 0.0);
          sky += uSunCol * (pow(ts, 700.0) * 5.0 + pow(ts, 40.0) * 0.25);
          float fres = rfl + (1.0 - rfl) * pow(1.0 - clamp(dot(normal, vd), 0.0, 1.0), 4.0);
          outgoingLight = mix(outgoingLight, sky, clamp(fres, 0.0, 1.0));
        }
        #include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => (tint ? 'insight-realism-tint' : 'insight-realism');
  material.needsUpdate = true;
}

export function setConcreteStrength(strength: number, tint: number, u: ConcreteUniforms = shared) {
  u.strength.value = strength;
  u.tint.value = tint;
}

/** Shows (or hides) the material classes in a view: brick, glass, timber... */
export function setMaterialsEnabled(on: boolean, u: ConcreteUniforms = shared) {
  u.mats.value = on ? 1 : 0;
  u.reflect.value = on ? 1 : 0;
}

/** Points a view's sky colours and sun at a sun position. */
export function setSkyUniforms(sky: SkyParams, u: ConcreteUniforms = shared) {
  u.zenith.value.copy(sky.zenith);
  u.horizon.value.copy(sky.horizon);
  u.ground.value.copy(sky.ground);
  u.sunColor.value.copy(sky.sunColor);
  u.sunDir.value.copy(sky.sunDir);
}

/** Marks the model's own (as loaded) materials, so only they turn concrete grey. */
export function markBaseMaterials(materials: Iterable<THREE.Material>) {
  for (const m of materials) if (!m.userData.concretePatched) m.userData.concreteBase = true;
}

/** Applies the concrete patch to every current and future fragments material. */
export function patchAllConcrete(materials: Iterable<THREE.Material>, u: ConcreteUniforms = shared) {
  for (const m of materials) patchConcrete(m, u);
}

const GLASS_OPACITY = 0.4;

/** Gives each of the model's own materials the class its colour group maps to
    (or none, when the classes are off in this view). Glass becomes see-through
    and is drawn after the opaque surfaces; a material that stops being glass
    gets its own opacity back. */
export function refreshMaterialClasses(materials: Iterable<THREE.Material>, u: ConcreteUniforms = shared) {
  const on = u.mats.value > 0.5;
  for (const m of materials) {
    const classU = m.userData.classU as { value: number } | undefined;
    if (!classU || !m.userData.concreteBase) continue;
    const cls = on ? classNumberForColour((m as THREE.MeshLambertMaterial).color) : 0;
    classU.value = cls;
    const glass = cls === classNumber('glass');
    const saved = m.userData.glassOriginal as { transparent: boolean; opacity: number; depthWrite: boolean } | undefined;
    if (glass && !saved) {
      m.userData.glassOriginal = { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite };
      m.transparent = true;
      m.opacity = Math.min(m.opacity, GLASS_OPACITY);
      m.depthWrite = false;
      m.needsUpdate = true;
    } else if (!glass && saved) {
      m.transparent = saved.transparent;
      m.opacity = saved.opacity;
      m.depthWrite = saved.depthWrite;
      delete m.userData.glassOriginal;
      m.needsUpdate = true;
    }
  }
}

// ---- sun & shadows -----------------------------------------------------------

export interface SunLights {
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fill: THREE.DirectionalLight;
}

/** Puts a view's lights in the realistic sun's place (bearing and height
    from `realism`, shadow camera fitted around `box`), or back to the
    plain studio lighting when `realism` is null. Used by both 3D views. */
export function configureSun({ sun, hemi, fill }: SunLights, realism: RealismSettings | null, box: THREE.Box3 | null) {
  if (!realism) {
    sun.position.set(12, 20, 8);
    sun.target.position.set(0, 0, 0);
    sun.color.set('#ffffff');
    sun.intensity = 2.2;
    hemi.intensity = 1.1;
    hemi.color.set('#ffffff');
    hemi.groundColor.set('#c7cdd3');
    fill.intensity = 0.4;
    Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 0.5, far: 80 });
    sun.shadow.camera.updateProjectionMatrix();
    return;
  }
  const dir = sunDirection(realism.sunAzimuth, realism.sunElevation);
  const sphere = box ? box.getBoundingSphere(new THREE.Sphere()) : new THREE.Sphere(new THREE.Vector3(), 30);
  const r = Math.max(10, sphere.radius);
  sun.target.position.copy(sphere.center);
  sun.position.copy(sphere.center).addScaledVector(dir, r * 2);
  sun.updateMatrixWorld();
  sun.target.updateMatrixWorld();
  // Fit the shadow camera tightly around the models as the sun sees them
  // (their box corners in light space) — sharper than a loose sphere, and
  // fixed for a given sun position, so shadows don't wander.
  const view = new THREE.Matrix4().lookAt(sun.position, sun.target.position, new THREE.Vector3(0, 1, 0));
  view.setPosition(sun.position);
  const toLight = view.clone().invert();
  const lb = new THREE.Box3();
  if (box) {
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) lb.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(toLight));
    // The ground plane under the models catches shadows too: widen by a margin.
    lb.expandByScalar(r * 0.15);
  } else lb.set(new THREE.Vector3(-r, -r, -r * 3), new THREE.Vector3(r, r, 0));
  Object.assign(sun.shadow.camera, { left: lb.min.x, right: lb.max.x, top: lb.max.y, bottom: lb.min.y, near: Math.max(0.1, -lb.max.z), far: -lb.min.z + r });
  sun.shadow.camera.updateProjectionMatrix();
  const texel = Math.max(lb.max.x - lb.min.x, lb.max.y - lb.min.y) / sun.shadow.mapSize.x;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = Math.max(0.02, texel * 1.5);
  sun.shadow.needsUpdate = true;
  // A low sun is a little warmer and weaker.
  const day = Math.max(0, Math.min(1, realism.sunElevation / 15));
  sun.intensity = 0.55 + 0.85 * day;
  sun.color.setRGB(1, 0.82 + 0.16 * day, 0.62 + 0.33 * day);
  hemi.intensity = 0.38 + 0.14 * day;
  // The sky's own colours light the shaded sides: blue from above, the ground's tone from below.
  const sky = skyParamsFor(realism.sunAzimuth, realism.sunElevation);
  hemi.color.copy(sky.horizon).lerp(sky.zenith, 0.5).lerp(new THREE.Color('#ffffff'), 0.35);
  hemi.groundColor.copy(sky.ground).lerp(new THREE.Color('#c7cdd3'), 0.5);
  fill.intensity = 0.15;
}

