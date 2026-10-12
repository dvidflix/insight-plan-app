import type * as THREE from 'three';
import type { ViewerEngine } from './ViewerEngine';
import type { IdsByModel, ContactRow } from './relations';
import { runSearchSet } from './searchSets';
import { useSearchSetsStore } from '../state/searchSetsStore';
import { useModelsStore } from '../state/modelsStore';
import { pairKey, type ClashItemRef, type ClashResult, type ClashSide, type ClashTest } from '../state/clashTestsStore';

/** Objects a side of a test takes (per model id). */
export async function resolveSide(engine: ViewerEngine, side: ClashSide): Promise<IdsByModel> {
  const models = useModelsStore.getState().models;
  const hidden = useModelsStore.getState().hiddenModelIds;
  const live = models.filter((m) => !hidden.has(m.modelId));
  if (side.kind === 'all') return engine.relations.allIds(live.map((m) => m.modelId));
  if (side.kind === 'model') {
    const m = live.find((x) => x.name === side.model);
    return m ? engine.relations.allIds([m.modelId]) : {};
  }
  const set = useSearchSetsStore.getState().sets.find((s) => s.id === side.setId);
  if (!set) return {};
  const found = runSearchSet(engine.getIndexes(), set);
  const out: IdsByModel = {};
  for (const m of live) if (found[m.modelId]?.length) out[m.modelId] = found[m.modelId];
  return out;
}

const keepVisible = async (engine: ViewerEngine, ids: IdsByModel): Promise<IdsByModel> => {
  const out: IdsByModel = {};
  for (const [modelId, list] of Object.entries(ids)) out[modelId] = await engine.visibleOf(modelId, list);
  return out;
};

const near = (a: THREE.Box3, b: THREE.Box3, eps: number) =>
  Math.abs(a.min.x - b.min.x) <= eps && Math.abs(a.min.y - b.min.y) <= eps && Math.abs(a.min.z - b.min.z) <= eps &&
  Math.abs(a.max.x - b.max.x) <= eps && Math.abs(a.max.y - b.max.y) <= eps && Math.abs(a.max.z - b.max.z) <= eps;

export interface ClashRun {
  found: Omit<ClashResult, 'n' | 'status'>[];
  /** Pairs tested (candidates by box) — for the status line. */
  checked: number;
}

/** Runs a test: the contacts between its two selections (relations.findContacts: boxes, then the real triangles), kept
    or dropped by the rule — hard: passing through each other; clearance: closer than the distance without passing
    through; duplicates: passing through with the same box. */
export async function runClashTest(engine: ViewerEngine, test: ClashTest, opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void }): Promise<ClashRun> {
  let a = await resolveSide(engine, test.a);
  let b = await resolveSide(engine, test.b);
  if (test.onlyVisible) {
    a = await keepVisible(engine, a);
    b = await keepVisible(engine, b);
  }
  // A hard clash needs the meshes to meet; a tiny tolerance finds what only just touches too.
  const tolerance = test.kind === 'clearance' ? Math.max(0.001, test.clearance) : 0.001;
  const rows: ContactRow[] = await engine.relations.findContacts(a, b, { tolerance, exact: test.exact, signal: opts.signal, onProgress: opts.onProgress });
  const modelName = (id: string) => useModelsStore.getState().models.find((m) => m.modelId === id)?.name ?? id;
  const guidOf = (modelId: string, localId: number) => engine.getIndexes().get(modelId)?.elements.get(localId)?.guid || `${modelId}:${localId}`;
  const ref = (r: ContactRow['a']): ClashItemRef => ({ model: modelName(r.modelId), guid: guidOf(r.modelId, r.localId), name: r.name, category: r.category });

  const found: ClashRun['found'] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (test.skipSameClass && r.a.category === r.b.category) continue;
    if (test.kind === 'hard' && !r.overlap) continue;
    if (test.kind === 'clearance' && (r.overlap || r.distance > test.clearance + 1e-9)) continue;
    if (test.kind === 'duplicate') {
      if (!r.overlap || r.a.category !== r.b.category) continue;
      const boxA = (await engine.relations.boxesOf(r.a.modelId)).get(r.a.localId);
      const boxB = (await engine.relations.boxesOf(r.b.modelId)).get(r.b.localId);
      if (!boxA || !boxB || !near(boxA, boxB, 0.005)) continue;
    }
    const ra = ref(r.a);
    const rb = ref(r.b);
    const key = pairKey(ra.guid, rb.guid);
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ key, a: ra, b: rb, distance: r.overlap ? 0 : r.distance });
  }
  return { found, checked: rows.length };
}
