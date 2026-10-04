import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ViewerEngine } from './ViewerEngine';

/** One element's triangles in world space (model offset applied), with a
    BVH for fast triangle-level tests. */
interface ElementMesh {
  geometry: THREE.BufferGeometry;
  bvh: MeshBVH;
}

export interface MeshContact {
  /** Closest distance between the two meshes (m); 0 when they overlap. */
  distance: number;
  /** The meshes pass through each other (not just touch). */
  overlap: boolean;
}

const FETCH_CHUNK = 200;
/** Cached meshes kept at most (oldest dropped first) — bounds memory on whole-model runs. */
const MAX_CACHED = 20_000;
const IDENTITY = new THREE.Matrix4();

/** Exact, triangle-level contact tests between model elements, after the
    ClashDetector sample (That Open + three-mesh-bvh): each element's mesh
    comes from the fragments model (getItemsGeometry), is placed in world
    space and gets a BVH. Two elements are in contact when their meshes
    intersect, or come within the tolerance of each other — the distance
    test is what catches faces that merely touch (a slab resting on a wall),
    which a pure intersection test can miss. */
export class MeshContacts {
  private meshes = new Map<string, ElementMesh | null>();
  /** Model position each model's cached meshes were built at. */
  private sigs = new Map<string, string>();

  constructor(private readonly engine: ViewerEngine) {}

  clear() {
    for (const m of this.meshes.values()) m?.geometry.dispose();
    this.meshes.clear();
    this.sigs.clear();
  }

  private sigOf(modelId: string) {
    const model = this.engine.getFragmentsModel(modelId);
    if (!model) return '';
    model.object.updateMatrixWorld(true);
    return model.object.matrixWorld.elements.join(',');
  }

  /** Drops a model's cached meshes if the model has moved since. */
  private checkModel(modelId: string) {
    const sig = this.sigOf(modelId);
    if (this.sigs.get(modelId) === sig) return;
    for (const [key, m] of this.meshes) {
      if (!key.startsWith(`${modelId}:`)) continue;
      m?.geometry.dispose();
      this.meshes.delete(key);
    }
    this.sigs.set(modelId, sig);
  }

  /** Loads (and caches) the meshes of these elements, in batches. */
  async load(modelId: string, localIds: number[]) {
    const model = this.engine.getFragmentsModel(modelId);
    if (!model) return;
    this.checkModel(modelId);
    const todo = [...new Set(localIds)].filter((id) => !this.meshes.has(`${modelId}:${id}`));
    const world = model.object.matrixWorld;
    for (let i = 0; i < todo.length; i += FETCH_CHUNK) {
      const chunk = todo.slice(i, i + FETCH_CHUNK);
      const data = await model.getItemsGeometry(chunk);
      chunk.forEach((id, k) => this.meshes.set(`${modelId}:${id}`, buildMesh(data[k] ?? [], world)));
    }
    this.trim();
  }

  private trim() {
    if (this.meshes.size <= MAX_CACHED) return;
    for (const [key, m] of this.meshes) {
      m?.geometry.dispose();
      this.meshes.delete(key);
      if (this.meshes.size <= MAX_CACHED * 0.8) break;
    }
  }

  private async meshOf(modelId: string, localId: number) {
    const key = `${modelId}:${localId}`;
    if (!this.meshes.has(key)) await this.load(modelId, [localId]);
    return this.meshes.get(key) ?? null;
  }

  /** Contact between two elements within `tolerance` metres, or null (no
      contact, or an element has no triangles). */
  async contact(a: { modelId: string; localId: number }, b: { modelId: string; localId: number }, tolerance: number): Promise<MeshContact | null> {
    const ma = await this.meshOf(a.modelId, a.localId);
    const mb = await this.meshOf(b.modelId, b.localId);
    if (!ma || !mb) return null;
    if (ma.bvh.intersectsGeometry(mb.geometry, IDENTITY)) return { distance: 0, overlap: true };
    const hit = ma.bvh.closestPointToGeometry(mb.geometry, IDENTITY, undefined, undefined, 0, tolerance);
    return hit && hit.distance <= tolerance ? { distance: hit.distance, overlap: false } : null;
  }
}

function buildMesh(parts: { positions?: Float32Array | Float64Array; indices?: Uint8Array | Uint16Array | Uint32Array; transform: THREE.Matrix4 }[], world: THREE.Matrix4): ElementMesh | null {
  const geometries: THREE.BufferGeometry[] = [];
  for (const { positions, indices, transform } of parts) {
    if (!positions?.length || !indices?.length) continue;
    const g = new THREE.BufferGeometry();
    // A copy: applyMatrix4 below rewrites the array in place.
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    g.setIndex(new THREE.BufferAttribute(indices instanceof Uint8Array ? new Uint16Array(indices) : indices, 1));
    g.applyMatrix4(transform);
    geometries.push(g);
  }
  if (!geometries.length) return null;
  const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
  if (geometries.length > 1) for (const g of geometries) g.dispose();
  if (!geometry) return null;
  geometry.applyMatrix4(world);
  const bvh = new MeshBVH(geometry);
  geometry.boundsTree = bvh;
  return { geometry, bvh };
}
