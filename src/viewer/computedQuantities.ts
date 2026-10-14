import * as THREE from 'three';
import type { ViewerEngine } from './ViewerEngine';

/** Quantities worked out from an object's geometry (m² / m³, the model in metres, Y up), as the scenario engine measures them
    (core/element_features.py): the footprint is the upward faces projected to plan, the side faces the vertical ones. */
export interface ComputedQuantities {
  footprint: number;
  top: number;
  soffit: number;
  sides: number;
  volume: number;
}

export const COMPUTED_SET = 'Computed quantities';

/** Same thresholds as the engine: a face is "up" / "down" past this slope, "vertical" under the other. */
const FACE_NY = 0.8;
const SIDE_NY = 0.3;
const CHUNK = 100;

const EMPTY = (): ComputedQuantities => ({ footprint: 0, top: 0, soffit: 0, sides: 0, volume: 0 });

/** The computed quantities of these objects of one model (one entry per id; undefined when it has no geometry). */
export async function computeQuantities(engine: ViewerEngine, modelId: string, localIds: number[]): Promise<Map<number, ComputedQuantities>> {
  const out = new Map<number, ComputedQuantities>();
  const model = engine.getFragmentsModel(modelId);
  if (!model) return out;
  model.object.updateMatrixWorld(true);
  const placed = model.object.matrixWorld;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const e = new THREE.Vector3();
  for (let i = 0; i < localIds.length; i += CHUNK) {
    const chunk = localIds.slice(i, i + CHUNK);
    const data = await model.getItemsGeometry(chunk);
    chunk.forEach((id, k) => {
      const q = EMPTY();
      let any = false;
      for (const part of data[k] ?? []) {
        const { positions, indices } = part;
        if (!positions?.length || !indices?.length) continue;
        // The transform comes back from the fragments worker as a plain object, not a THREE.Matrix4.
        const raw = part.transform as unknown as { elements?: ArrayLike<number> } | ArrayLike<number>;
        const m = new THREE.Matrix4().fromArray(Array.from('elements' in raw && raw.elements ? raw.elements : (raw as ArrayLike<number>))).premultiply(placed);
        const at = (v: THREE.Vector3, index: number) => v.set(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]).applyMatrix4(m);
        for (let t = 0; t + 2 < indices.length; t += 3) {
          at(a, indices[t]);
          at(b, indices[t + 1]);
          at(c, indices[t + 2]);
          n.crossVectors(e.subVectors(b, a), n.subVectors(c, a));
          const area2 = n.length();
          if (area2 < 1e-12) continue;
          any = true;
          q.volume += a.dot(n.crossVectors(b, c)) / 6;
          const ny = n.crossVectors(e.subVectors(b, a), n.subVectors(c, a)).y / area2;
          const area = area2 / 2;
          if (ny > FACE_NY) {
            q.top += area;
            q.footprint += area * ny;
          } else if (ny < -FACE_NY) q.soffit += area;
          else if (Math.abs(ny) < SIDE_NY) q.sides += area;
        }
      }
      q.volume = Math.abs(q.volume);
      if (any) out.set(id, q);
    });
  }
  return out;
}

/** The rows of the "Computed quantities" property set, summed over the objects (label, value in the unit's text). */
export function computedRows(list: ComputedQuantities[]): { name: string; value: string }[] {
  const sum = (pick: (q: ComputedQuantities) => number) => list.reduce((s, q) => s + pick(q), 0);
  const fmt = (v: number, unit: string) => `${Math.round(v * 100) / 100} ${unit}`;
  return [
    { name: 'Footprint area', value: fmt(sum((q) => q.footprint), 'm²') },
    { name: 'Side faces area', value: fmt(sum((q) => q.sides), 'm²') },
    { name: 'Soffit area', value: fmt(sum((q) => q.soffit), 'm²') },
    { name: 'Top faces area', value: fmt(sum((q) => q.top), 'm²') },
    { name: 'Geometry volume', value: fmt(sum((q) => q.volume), 'm³') },
  ];
}
