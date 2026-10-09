import * as THREE from 'three';
import type { ViewerEngine } from './ViewerEngine';

export type GrowthMode = 'drop' | 'slideIn' | 'grow' | 'liftUp' | 'slideAway';

/** One group of elements animating during the current step. */
export interface GrowthSpec {
  key: string;
  modelId: string;
  localIds: number[];
  mode: GrowthMode;
  distance: number;
  /** Stage colour / opacity to draw with; null = the element's own. */
  color: string | null;
  opacity: number | null;
  /** Movement progress (0..1) at the start and end of the step; the phase
      runs between them. */
  from: number;
  to: number;
  /** 'grow': unit direction (viewer axes, y up) the object grows along; default up. */
  direction?: { x: number; y: number; z: number };
  /** Draw edge lines on the stand-in (the viewer's edge pass); default yes. */
  edges?: boolean;
}

interface Proxy {
  spec: GrowthSpec;
  group: THREE.Group;
  /** World-space bottom (y) and horizontal centre, for scaling / sliding. */
  bottom: number;
  centre: THREE.Vector3;
  /** 'grow': the direction and where the object starts along it (smallest projection of its box). */
  dir: THREE.Vector3;
  start: number;
  /** Length of the box along dir, and the clipping plane the reveal moves. */
  extent: number;
  plane: THREE.Plane;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;
const easeIn = (t: number) => t ** 3;

type FragModel = {
  object: THREE.Object3D;
  getItemsGeometry: (ids: number[]) => Promise<{ transform: unknown; positions?: Float32Array | Float64Array; indices?: Uint8Array | Uint16Array | Uint32Array }[][]>;
  getItemsMaterialDefinition: (ids: number[]) => Promise<{ definition: { color: { r: number; g: number; b: number }; opacity: number }; localIds: number[] }[]>;
};

/** Worker results arrive as structured clones — plain objects, not THREE types. */
function toMatrix(raw: unknown): THREE.Matrix4 {
  const r = raw as { elements?: ArrayLike<number> } | ArrayLike<number>;
  const el = 'elements' in r && r.elements ? r.elements : (r as ArrayLike<number>);
  return new THREE.Matrix4().fromArray(Array.from(el));
}

/** Growth simulation for 4D playback (insight-plan's "Reveal and drop" etc.):
    the elements animating in the current step are hidden in the model and
    stood in for by copies of their geometry, which move / grow as the step's
    phase runs 0 -> 1. Live playback plays the phase after each step; the
    video export sets it frame by frame. */
export class GrowthAnimator {
  private readonly root = new THREE.Group();
  private proxies = new Map<string, Proxy>();
  /** Stand-ins no longer wanted, kept on screen (frozen) until the real elements
      are shown again — see flushStale. Removing them first left a blank frame. */
  private stale: Proxy[] = [];
  private phase = 1;
  private anim = 0;
  private generation = 0;
  /** Seconds a drop / slide / lift takes in live playback. */
  durationS = 0.9;
  /** Set by the video export: phase is driven frame by frame, not by time. */
  manual = false;

  constructor(private readonly engine: ViewerEngine) {
    this.root.name = 'growth-simulation';
    engine.world.scene.three.add(this.root);
  }

  /** Replaces what animates (one call per 4D step) and restarts the phase. */
  async set(specs: GrowthSpec[]) {
    const gen = ++this.generation;
    const wanted = new Map(specs.map((s) => [s.key, s]));
    for (const [key, p] of this.proxies) {
      if (wanted.has(key) && sameSpec(p.spec, wanted.get(key)!)) continue;
      this.stale.push(p);
      this.proxies.delete(key);
    }
    for (const spec of specs) {
      if (this.proxies.has(spec.key)) {
        this.proxies.get(spec.key)!.spec = spec;
        continue;
      }
      const proxy = await this.build(spec);
      if (gen !== this.generation) {
        if (proxy) this.dispose(proxy);
        return;
      }
      if (proxy) {
        this.proxies.set(spec.key, proxy);
        this.root.add(proxy.group);
      }
    }
    if (this.manual) this.apply();
    else this.play();
  }

  /** Video export: put every animation at phase t (0..1). */
  setPhase(t: number) {
    cancelAnimationFrame(this.anim);
    this.phase = Math.max(0, Math.min(1, t));
    this.apply();
  }

  /** Removes the stand-ins `set` replaced. Call once the real elements are
      visible again (after the viewer update), so the object never blinks out. */
  flushStale() {
    if (this.stale.length === 0) return;
    for (const p of this.stale) this.dispose(p);
    this.stale = [];
    this.render();
  }

  clear() {
    void this.set([]).then(() => this.flushStale());
  }

  private play() {
    cancelAnimationFrame(this.anim);
    if (this.proxies.size === 0) {
      this.phase = 1;
      this.render();
      return;
    }
    const t0 = performance.now();
    const tick = () => {
      this.phase = Math.min(1, (performance.now() - t0) / (this.durationS * 1000));
      this.apply();
      if (this.phase < 1) this.anim = requestAnimationFrame(tick);
    };
    this.phase = 0;
    this.apply();
    this.anim = requestAnimationFrame(tick);
  }

  private apply() {
    for (const p of this.proxies.values()) {
      const { spec } = p;
      const k = spec.from + (spec.to - spec.from) * this.phase;
      const m = new THREE.Matrix4();
      let visible = true;
      const radial = new THREE.Vector3(p.centre.x, 0, p.centre.z);
      if (radial.lengthSq() < 1e-6) radial.set(1, 0, 0);
      radial.normalize();
      switch (spec.mode) {
        case 'drop':
          m.makeTranslation(0, spec.distance * (1 - easeOut(k)), 0);
          break;
        case 'slideIn':
          m.makeTranslation(radial.x * spec.distance * (1 - easeOut(k)), 0, radial.z * spec.distance * (1 - easeOut(k)));
          break;
        case 'liftUp':
          m.makeTranslation(0, spec.distance * easeIn(k), 0);
          visible = k < 1;
          break;
        case 'slideAway':
          m.makeTranslation(radial.x * spec.distance * easeIn(k), 0, radial.z * spec.distance * easeIn(k));
          visible = k < 1;
          break;
        case 'grow': {
          // Revealed, not scaled: a clipping plane sweeps along the direction and cuts the geometry.
          p.plane.constant = p.start + Math.max(0, Math.min(1, k)) * p.extent;
          visible = k > 0.0005;
          break;
        }
      }
      p.group.matrix.copy(m);
      p.group.matrixWorldNeedsUpdate = true;
      p.group.visible = visible;
    }
    this.render();
  }

  private render() {
    const renderer = this.engine.world.renderer as unknown as { needsUpdate?: boolean } | undefined;
    if (renderer) renderer.needsUpdate = true;
  }

  private async build(spec: GrowthSpec): Promise<Proxy | null> {
    const model = this.engine.getSecondaryViewSource().getModel(spec.modelId) as unknown as FragModel | undefined;
    if (!model || spec.localIds.length === 0) return null;
    try {
      const [geoms, materials] = await Promise.all([model.getItemsGeometry(spec.localIds), spec.color ? Promise.resolve([]) : model.getItemsMaterialDefinition(spec.localIds)]);
      const colorOf = new Map<number, THREE.Color>();
      for (const m of materials) for (const id of m.localIds) colorOf.set(id, new THREE.Color(m.definition.color.r, m.definition.color.g, m.definition.color.b));
      model.object.updateMatrixWorld();
      const group = new THREE.Group();
      group.matrixAutoUpdate = false;
      const box = new THREE.Box3();
      const materialCache = new Map<string, THREE.Material>();
      // 'grow': keeps what lies on the near side of the plane (x·dir <= constant); its constant is moved in apply().
      const dir = spec.direction ? new THREE.Vector3(spec.direction.x, spec.direction.y, spec.direction.z).normalize() : new THREE.Vector3(0, 1, 0);
      const plane = new THREE.Plane(dir.clone().negate(), 0);
      const materialFor = (c: THREE.Color) => {
        const key = c.getHexString();
        let mat = materialCache.get(key);
        if (!mat) {
          const opacity = spec.opacity ?? 1;
          mat = new THREE.MeshLambertMaterial({ color: c, transparent: opacity < 1, opacity, side: THREE.DoubleSide });
          // Kept out of the edge pass (painted over it) when the profile turns edges off for the movement.
          if (spec.edges === false) this.engine.edgeFreeMaterials.add(mat);
          if (spec.mode === 'grow') mat.clippingPlanes = [plane];
          materialCache.set(key, mat);
        }
        return mat;
      };
      geoms.forEach((meshes, i) => {
        const id = spec.localIds[i];
        const color = spec.color ? new THREE.Color(spec.color) : colorOf.get(id) ?? new THREE.Color('#bfbfbf');
        for (const md of meshes) {
          if (!md.positions || md.positions.length === 0) continue;
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(md.positions), 3));
          if (md.indices) g.setIndex(new THREE.BufferAttribute(md.indices, 1));
          g.computeVertexNormals();
          const mesh = new THREE.Mesh(g, materialFor(color));
          mesh.matrixAutoUpdate = false;
          mesh.matrix.copy(toMatrix(md.transform).premultiply(model.object.matrixWorld));
          g.computeBoundingBox();
          if (g.boundingBox) box.union(g.boundingBox.clone().applyMatrix4(mesh.matrix));
          group.add(mesh);
        }
      });
      if (group.children.length === 0) return null;
      let start = Infinity;
      let end = -Infinity;
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const along = x * dir.x + y * dir.y + z * dir.z;
        start = Math.min(start, along);
        end = Math.max(end, along);
      }
      plane.constant = start;
      if (spec.mode === 'grow') (this.engine.world.renderer as unknown as { three: THREE.WebGLRenderer }).three.localClippingEnabled = true;
      if (spec.edges === false) {
        const flat = new THREE.MeshBasicMaterial({ color: 0x808080, side: THREE.DoubleSide });
        if (spec.mode === 'grow') flat.clippingPlanes = [plane];
        this.engine.edgeFreeObjects.set(group, flat);
        this.engine.refreshEdgeExclusion();
      }
      return { spec, group, bottom: box.min.y, centre: box.getCenter(new THREE.Vector3()), dir, start, extent: Math.max(1e-6, end - start), plane };
    } catch (e) {
      console.warn('GrowthAnimator: could not build', e);
      return null;
    }
  }

  private dispose(p: Proxy) {
    this.root.remove(p.group);
    this.engine.edgeFreeObjects.get(p.group)?.dispose();
    this.engine.edgeFreeObjects.delete(p.group);
    const mats = new Set<THREE.Material>();
    p.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        mats.add(mesh.material as THREE.Material);
      }
    });
    mats.forEach((m) => {
      this.engine.edgeFreeMaterials.delete(m);
      m.dispose();
    });
    this.engine.refreshEdgeExclusion();
  }
}

function sameSpec(a: GrowthSpec, b: GrowthSpec) {
  return a.modelId === b.modelId && a.mode === b.mode && a.edges === b.edges && a.direction?.x === b.direction?.x && a.direction?.y === b.direction?.y && a.direction?.z === b.direction?.z && a.color === b.color && a.opacity === b.opacity && a.localIds.length === b.localIds.length && a.localIds.every((id, i) => id === b.localIds[i]);
}
