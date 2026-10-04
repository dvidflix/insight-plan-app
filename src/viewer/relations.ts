import * as THREE from 'three';
import type { ViewerEngine } from './ViewerEngine';
import { MeshContacts } from './meshContacts';

/** Local ids per model id (the selection store's shape). */
export type IdsByModel = Record<string, number[]>;

/** Where one element sits vertically relative to another (as the schedule
    generator's clash_position.py classifies pour clashes). */
export type VerticalPosition = 'below' | 'mostly-below' | 'side' | 'mostly-above' | 'above';

export interface ElementRef {
  modelId: string;
  localId: number;
  name: string;
  category: string;
}

export interface ContactRow {
  a: ElementRef;
  b: ElementRef;
  /** Closest distance between the two (m): mesh distance when exact, else box gap. */
  distance: number;
  /** They pass through each other rather than just touch. */
  overlap: boolean;
  /** Where B sits relative to A. */
  position: VerticalPosition;
}

export interface ContactOptions {
  /** Max gap (m) still counted as contact. */
  tolerance: number;
  /** Test the real triangles (three-mesh-bvh), not just bounding boxes. */
  exact: boolean;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** Vertical overlap, as a share of the shorter element's height, above which a
    pair counts as side by side (clash_position.CLASH_POSITION_SIDE_OVERLAP_THRESHOLD). */
const SIDE_OVERLAP = 0.5;
const YIELD_EVERY = 25;
/** Volumes and voids, not built elements: a room's box "touches" everything. */
const IGNORED = new Set(['IFCSPACE', 'IFCOPENINGELEMENT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', 'IFCZONE', 'IFCANNOTATION', 'IFCGRID']);

/** Relations between elements worked out from geometry, for models whose
    IFC carries no usable relation data — and across files, where IFC
    relations cannot reach at all:
    every touching / overlapping pair between two groups of elements (a
    clash run), each classified by vertical position. Clashes & contacts
    (useClashRunner) runs it per model and per pair of models.
    Candidates come from world-space bounding boxes (model offsets included,
    cached per model until the model moves); the exact option then tests the
    real meshes (MeshContacts). */
export class ElementRelations {
  private cache = new Map<string, { sig: string; boxes: Map<number, THREE.Box3> }>();
  private readonly meshes: MeshContacts;

  constructor(private readonly engine: ViewerEngine) {
    this.meshes = new MeshContacts(engine);
  }

  /** Drops cached boxes and meshes (e.g. after models were added or removed). */
  clear() {
    this.cache.clear();
    this.meshes.clear();
  }

  async boxesOf(modelId: string): Promise<Map<number, THREE.Box3>> {
    const model = this.engine.getFragmentsModel(modelId);
    const index = this.engine.getIndexes().get(modelId);
    if (!model || !index) return new Map();
    const sig = `${model.object.matrix.elements.join('|')}|${index.elements.size}`;
    const hit = this.cache.get(modelId);
    if (hit && hit.sig === sig) return hit.boxes;
    const ids = [...index.elements.keys()];
    const boxes = new Map<number, THREE.Box3>();
    const CHUNK = 5000;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const list = await model.getBoxes(chunk);
      chunk.forEach((id, k) => {
        const b = list[k];
        const category = (index.elements.get(id)?.category ?? '').toUpperCase();
        if (b && !b.isEmpty() && Number.isFinite(b.min.x) && !IGNORED.has(category)) boxes.set(id, b);
      });
    }
    this.cache.set(modelId, { sig, boxes });
    return boxes;
  }

  private info(modelId: string, localId: number) {
    const el = this.engine.getIndexes().get(modelId)?.elements.get(localId);
    return { name: el?.name || `#${localId}`, category: (el?.category ?? '').toUpperCase() };
  }

  /** Every element (with a box) of the given models, or of all loaded models. */
  async allIds(modelIds?: string[]): Promise<IdsByModel> {
    const out: IdsByModel = {};
    for (const m of modelIds ?? [...this.engine.getIndexes().keys()]) out[m] = [...(await this.boxesOf(m)).keys()];
    return out;
  }

  /** Every pair (one element from A, one from B) that touches or overlaps
      within the tolerance — a clash run. A and B may share elements (e.g. a
      model against itself); each pair is reported once, never an element
      with itself. */
  async findContacts(groupA: IdsByModel, groupB: IdsByModel, opts: ContactOptions): Promise<ContactRow[]> {
    const { tolerance, exact, onProgress, signal } = opts;
    type Entry = { modelId: string; localId: number; box: THREE.Box3; inA: boolean; inB: boolean };
    const entries = new Map<string, Entry>();
    const add = async (group: IdsByModel, side: 'inA' | 'inB') => {
      for (const [modelId, ids] of Object.entries(group)) {
        const boxes = await this.boxesOf(modelId);
        for (const localId of ids) {
          const box = boxes.get(localId);
          if (!box) continue;
          const key = `${modelId}:${localId}`;
          const e = entries.get(key) ?? { modelId, localId, box, inA: false, inB: false };
          e[side] = true;
          entries.set(key, e);
        }
      }
    };
    await add(groupA, 'inA');
    await add(groupB, 'inB');

    // Broad phase: sort and sweep along X, then a full box test within the tolerance.
    const list = [...entries.values()].sort((p, q) => p.box.min.x - q.box.min.x);
    const candidates: [Entry, Entry][] = [];
    const grown = new THREE.Box3();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      grown.copy(p.box).expandByScalar(tolerance);
      for (let j = i + 1; j < list.length && list[j].box.min.x <= grown.max.x; j++) {
        const q = list[j];
        if (!grown.intersectsBox(q.box)) continue;
        if (p.inA && q.inB) candidates.push([p, q]);
        else if (q.inA && p.inB) candidates.push([q, p]);
      }
    }
    if (signal?.aborted) return [];

    // Narrow phase: the real meshes, loaded in batches per model first.
    if (exact) {
      const need = new Map<string, number[]>();
      for (const pair of candidates) for (const e of pair) (need.get(e.modelId) ?? need.set(e.modelId, []).get(e.modelId)!).push(e.localId);
      for (const [modelId, ids] of need) {
        if (signal?.aborted) return [];
        await this.meshes.load(modelId, ids);
      }
    }

    const rows: ContactRow[] = [];
    for (let k = 0; k < candidates.length; k++) {
      if (k % YIELD_EVERY === 0) {
        if (signal?.aborted) return rows;
        onProgress?.(k, candidates.length);
        await new Promise((r) => setTimeout(r, 0));
      }
      const [p, q] = candidates[k];
      let distance: number;
      let overlap: boolean;
      if (exact) {
        const hit = await this.meshes.contact(p, q, tolerance);
        if (!hit) continue;
        ({ distance, overlap } = hit);
      } else {
        distance = boxGap(p.box, q.box);
        overlap = distance === 0 && p.box.intersectsBox(q.box);
      }
      rows.push({
        a: { modelId: p.modelId, localId: p.localId, ...this.info(p.modelId, p.localId) },
        b: { modelId: q.modelId, localId: q.localId, ...this.info(q.modelId, q.localId) },
        distance,
        overlap,
        position: verticalPosition(p.box, q.box),
      });
    }
    onProgress?.(candidates.length, candidates.length);
    return rows;
  }
}

/** Gap between two boxes (0 when they touch or overlap). */
function boxGap(a: THREE.Box3, b: THREE.Box3): number {
  const dx = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
  const dy = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
  const dz = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
  return Math.hypot(dx, dy, dz);
}

/** Where B sits vertically relative to A, from their height ranges: clear
    of each other is below / above; overlapping by at least half the shorter
    one's height is side by side; otherwise mostly below / above by centre.
    The viewer is Y-up (project Z is scene Y). */
export function verticalPosition(a: THREE.Box3, b: THREE.Box3): VerticalPosition {
  const overlap = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  if (overlap <= 0) return b.max.y <= a.min.y ? 'below' : 'above';
  const heights = [a.max.y - a.min.y, b.max.y - b.min.y].filter((h) => h > 0);
  const reference = heights.length ? Math.min(...heights) : 0;
  const share = reference > 0 ? Math.min(overlap / reference, 1) : 1;
  if (share >= SIDE_OVERLAP) return 'side';
  return (b.min.y + b.max.y) / 2 < (a.min.y + a.max.y) / 2 ? 'mostly-below' : 'mostly-above';
}
