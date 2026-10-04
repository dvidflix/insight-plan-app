import * as THREE from 'three';
import type { ViewerEngine } from './ViewerEngine';

/** Twins: the same object in two models that share geometry but no common
    property, paired by where it is — the two boxes agree (every side within
    the tolerance), the same IFC class preferred when several would do. */

/** Several objects of the twin model fit equally well. */
export const SEVERAL = -1;

/** Local id of each object of model A -> its twin's local id in model B
    (SEVERAL when the choice is not clear); objects without a twin are absent. */
export type TwinMap = Map<number, number>;

/** How far apart two boxes are: the largest difference over their six sides. */
const gap = (a: THREE.Box3, b: THREE.Box3) =>
  Math.max(
    Math.abs(a.min.x - b.min.x), Math.abs(a.min.y - b.min.y), Math.abs(a.min.z - b.min.z),
    Math.abs(a.max.x - b.max.x), Math.abs(a.max.y - b.max.y), Math.abs(a.max.z - b.max.z),
  );

export function pairBoxes(
  aBoxes: Map<number, THREE.Box3>,
  bBoxes: Map<number, THREE.Box3>,
  tolerance: number,
  categoryOf: (side: 'a' | 'b', id: number) => string,
): TwinMap {
  // B's boxes in a grid by their centre, so each A only looks at its neighbours.
  const cell = Math.max(1, tolerance * 4);
  const key = (x: number, y: number, z: number) => `${x}|${y}|${z}`;
  const grid = new Map<string, number[]>();
  const centre = new THREE.Vector3();
  for (const [id, box] of bBoxes) {
    box.getCenter(centre);
    const k = key(Math.floor(centre.x / cell), Math.floor(centre.y / cell), Math.floor(centre.z / cell));
    const list = grid.get(k);
    if (list) list.push(id); else grid.set(k, [id]);
  }
  const out: TwinMap = new Map();
  // A box's centre can sit a few cells from its twin's only when the sizes differ by more than the tolerance.
  for (const [id, box] of aBoxes) {
    box.getCenter(centre);
    const cx = Math.floor(centre.x / cell);
    const cy = Math.floor(centre.y / cell);
    const cz = Math.floor(centre.z / cell);
    const found: { id: number; d: number }[] = [];
    for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (let z = cz - 1; z <= cz + 1; z++) {
      for (const bId of grid.get(key(x, y, z)) ?? []) {
        const d = gap(box, bBoxes.get(bId)!);
        if (d <= tolerance) found.push({ id: bId, d });
      }
    }
    if (found.length === 0) continue;
    if (found.length === 1) { out.set(id, found[0].id); continue; }
    const category = categoryOf('a', id);
    const sameClass = found.filter((f) => categoryOf('b', f.id) === category);
    const pool = sameClass.length ? sameClass : found;
    pool.sort((p, q) => p.d - q.d);
    out.set(id, pool.length > 1 && pool[1].d - pool[0].d < tolerance / 20 ? SEVERAL : pool[0].id);
  }
  return out;
}

const cache = new Map<string, Promise<TwinMap>>();

/** Pairs model A's objects with model B's (cached until a model moves or reloads). */
export function matchTwins(engine: ViewerEngine, aModelId: string, bModelId: string, tolerance: number): Promise<TwinMap> {
  const indexes = engine.getIndexes();
  const a = indexes.get(aModelId);
  const b = indexes.get(bModelId);
  const modelSig = (id: string) => engine.getFragmentsModel(id)?.object.matrix.elements.join(',') ?? '';
  const key = `${aModelId}|${bModelId}|${tolerance}|${a?.elements.size}|${b?.elements.size}|${modelSig(aModelId)}|${modelSig(bModelId)}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      const [aBoxes, bBoxes] = await Promise.all([engine.relations.boxesOf(aModelId), engine.relations.boxesOf(bModelId)]);
      return pairBoxes(aBoxes, bBoxes, tolerance, (side, id) => ((side === 'a' ? a : b)?.elements.get(id)?.category ?? '').toUpperCase());
    })();
    cache.set(key, hit);
    if (cache.size > 8) cache.delete(cache.keys().next().value as string);
  }
  return hit;
}
