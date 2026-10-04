import * as THREE from 'three';

import type { SkyParams } from './realism';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
void main() {
  vec3 d = normalize(vDir);
  float up = d.y;
  vec3 sky = mix(uHorizon, uZenith, pow(clamp(up, 0.0, 1.0), 0.55));
  // Haze brightens towards the sun's side of the horizon.
  float toSun = max(dot(d, uSunDir), 0.0);
  sky += uSunColor * pow(toSun, 6.0) * 0.22 * (1.0 - clamp(up, 0.0, 1.0) * 0.6);
  vec3 col = up >= 0.0 ? sky : mix(uHorizon * 0.8, uGround, smoothstep(0.0, -0.35, up));
  col += uSunColor * pow(toSun, 900.0) * 6.0 + uSunColor * pow(toSun, 90.0) * 0.5;
  gl_FragColor = vec4(col, 1.0);
}`;

/** The sky captured into a cube texture (redrawn only when the sun moves), so
    it can be a scene background without adding a mesh to the scene — the
    outline and ambient-occlusion passes never see it. */
export class SkyBackdrop {
  private readonly target = new THREE.WebGLCubeRenderTarget(512, { generateMipmaps: false, type: THREE.HalfFloatType });
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.CubeCamera;
  private readonly material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGround: { value: new THREE.Color() },
        uSunColor: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      },
    });
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(5, 48, 24), this.material));
    this.camera = new THREE.CubeCamera(0.1, 20, this.target);
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  /** Draws the sky for `params` with `renderer` (the cube is rendered once). */
  update(renderer: THREE.WebGLRenderer, params: SkyParams) {
    const u = this.material.uniforms;
    u.uZenith.value.copy(params.zenith);
    u.uHorizon.value.copy(params.horizon);
    u.uGround.value.copy(params.ground);
    u.uSunColor.value.copy(params.sunColor);
    u.uSunDir.value.copy(params.sunDir);
    this.camera.update(renderer, this.scene);
  }

  dispose() {
    this.target.dispose();
    this.material.dispose();
  }
}
