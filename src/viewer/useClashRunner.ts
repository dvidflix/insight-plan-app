import { useEffect, useRef } from 'react';
import { useViewerEngine } from './ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useModelPlacementStore } from '../state/modelPlacementStore';
import { useProjectDbStore } from '../state/projectDbStore';
import { useClashStore, type ClashJobResult } from '../state/clashStore';
import { modelFileByName, storedHashOf } from '../state/modelFiles';
import { fetchClashRuns, writeClashRun, type DbClashPair } from '../db/api';
import type { ContactRow, VerticalPosition } from './relations';
import type { ViewerEngine } from './ViewerEngine';
import type { LoadedModelInfo } from './types';

/** Keeps Clashes & contacts ready: each loaded model against itself and
    each pair of models against each other. A job's result depends on its
    models' files, (for a pair) their placement, and the tolerance / exact
    setting; it is looked up in the project database first, then worked out
    in the background and stored there, so it is ready next time. Mounted
    once, with the 3D view. */

interface Job {
  scope: string;
  key: string;
  a: LoadedModelInfo;
  b?: LoadedModelInfo;
}

/** Short stable hash of a string (cyrb53). */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

/** What identifies a model's content: its name, size in elements, and its file. */
function fingerprint(m: LoadedModelInfo): string {
  const f = modelFileByName(m.name);
  const base = `${m.name}|${m.elementCount}|${f?.size ?? ''}|${f?.lastModified ?? ''}`;
  const stored = f ? null : storedHashOf(m.name);
  return stored ? `${base}|${stored}` : base;
}

function jobsFor(models: LoadedModelInfo[], offsets: Record<string, { x: number; y: number; z: number; rot?: unknown }>, tolerance: number, exact: boolean): Job[] {
  const sorted = [...models].sort((a, b) => a.name.localeCompare(b.name));
  const off = (m: LoadedModelInfo) => {
    const o = offsets[m.name] ?? { x: 0, y: 0, z: 0 };
    return `${o.x},${o.y},${o.z},${JSON.stringify(o.rot ?? null)}`;
  };
  const jobs: Job[] = [];
  for (const a of sorted) jobs.push({ scope: `self:${a.name}`, key: hash(JSON.stringify(['self', fingerprint(a), tolerance, exact])), a });
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const [a, b] = [sorted[i], sorted[j]];
      jobs.push({ scope: `pair:${a.name}|${b.name}`, key: hash(JSON.stringify(['pair', fingerprint(a), off(a), fingerprint(b), off(b), tolerance, exact])), a, b });
    }
  }
  return jobs;
}


/** Stored pairs (by GlobalId) back into rows for the loaded models. */
function rowsFromDb(engine: ViewerEngine, job: Job, pairs: DbClashPair[]): ContactRow[] {
  const byGuid = (modelId: string) => {
    const map = new Map<string, number>();
    for (const e of engine.getIndexes().get(modelId)?.elements.values() ?? []) if (e.guid) map.set(e.guid, e.localId);
    return map;
  };
  const aMap = byGuid(job.a.modelId);
  const bMap = job.b ? byGuid(job.b.modelId) : aMap;
  const ref = (modelId: string, localId: number) => {
    const el = engine.getIndexes().get(modelId)?.elements.get(localId);
    return { modelId, localId, name: el?.name || `#${localId}`, category: (el?.category ?? '').toUpperCase() };
  };
  const out: ContactRow[] = [];
  const bId = job.b?.modelId ?? job.a.modelId;
  for (const [ga, gb, distance, overlap, position] of pairs) {
    const a = aMap.get(ga);
    const b = bMap.get(gb);
    if (a === undefined || b === undefined) continue;
    out.push({ a: ref(job.a.modelId, a), b: ref(bId, b), distance, overlap, position: position as VerticalPosition });
  }
  return out;
}

export function useClashRunner() {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const offsets = useModelPlacementStore((s) => s.offsets);
  const root = useProjectDbStore((s) => s.db?.root ?? null);
  const settings = useClashStore((s) => s.settings);
  const runRequest = useClashStore((s) => s.runRequest);
  const cancelRequest = useClashStore((s) => s.cancelRequest);
  const current = useRef<AbortController | null>(null);
  const handledRun = useRef(0);
  const loaded = useRef<string[]>([]);

  useEffect(() => {
    current.current?.abort();
  }, [cancelRequest]);

  useEffect(() => {
    const controller = new AbortController();
    const forced = runRequest !== handledRun.current;
    const timer = setTimeout(() => {
      current.current = controller;
      void sync(controller.signal, forced).finally(() => {
        if (current.current === controller) current.current = null;
        if (forced) handledRun.current = runRequest;
      });
    }, forced ? 0 : 1500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };

    async function sync(signal: AbortSignal, force: boolean) {
      // A model was removed: drop the cached geometry (no run is going now).
      const ids = models.map((m) => m.modelId);
      if (loaded.current.some((id) => !ids.includes(id))) engine.relations.clear();
      loaded.current = ids;
      const store = useClashStore.getState();
      const { tolerance, exact, auto } = store.settings;
      const jobs = jobsFor(models, offsets, tolerance, exact);
      const fresh = (job: Job, r: ClashJobResult | undefined) => r?.key === job.key && r.rows.every((row) => row.a.modelId === job.a.modelId && row.b.modelId === (job.b?.modelId ?? job.a.modelId));
      // Keep only what still applies.
      const results: Record<string, ClashJobResult> = {};
      for (const job of jobs) if (fresh(job, store.results[job.scope])) results[job.scope] = store.results[job.scope];
      useClashStore.setState({ results, error: null });
      let missing = jobs.filter((job) => !results[job.scope]);

      // Stored in the project?
      if (missing.length && root) {
        try {
          const runs = await fetchClashRuns(root, missing.map((j) => j.key));
          if (signal.aborted) return;
          const found = new Map(runs.map((r) => [r.key, r.pairs]));
          const next = { ...useClashStore.getState().results };
          for (const job of missing) {
            const pairs = found.get(job.key);
            if (pairs) next[job.scope] = { key: job.key, scope: job.scope, rows: rowsFromDb(engine, job, pairs), stored: true };
          }
          useClashStore.setState({ results: next });
          missing = missing.filter((job) => !found.has(job.key));
        } catch (e) {
          useClashStore.setState({ error: e instanceof Error ? e.message : String(e) });
        }
      }
      useClashStore.setState({ pending: missing.length });
      if (!missing.length || !(auto || force)) return;

      // Work out the rest, one job at a time.
      const guid = (modelId: string, localId: number) => engine.getIndexes().get(modelId)?.elements.get(localId)?.guid ?? '';
      const label = (job: Job) => (job.b ? `${short(job.a.name)} with ${short(job.b.name)}` : `${short(job.a.name)} with itself`);
      try {
        for (const [i, job] of missing.entries()) {
          if (signal.aborted) return;
          const prefix = missing.length > 1 ? `${i + 1}/${missing.length} · ` : '';
          useClashStore.setState({ running: { label: `${prefix}${label(job)}`, progress: 0 } });
          const a = await engine.relations.allIds([job.a.modelId]);
          const b = job.b ? await engine.relations.allIds([job.b.modelId]) : a;
          const rows = await engine.relations.findContacts(a, b, {
            tolerance,
            exact,
            signal,
            onProgress: (done, total) => useClashStore.setState({ running: { label: `${prefix}${label(job)}`, progress: total ? done / total : 0 } }),
          });
          if (signal.aborted) return;
          useClashStore.setState((s) => ({ results: { ...s.results, [job.scope]: { key: job.key, scope: job.scope, rows, stored: false } }, pending: Math.max(0, s.pending - 1) }));
          if (root) {
            const pairs: DbClashPair[] = rows.map((r) => [guid(r.a.modelId, r.a.localId), guid(r.b.modelId, r.b.localId), r.distance, r.overlap, r.position]);
            await writeClashRun(root, job.key, job.scope, pairs).catch((e) => useClashStore.setState({ error: `Not saved to the project: ${e instanceof Error ? e.message : String(e)}` }));
          }
        }
      } finally {
        useClashStore.setState({ running: null });
        if (signal.aborted) useClashStore.setState((s) => ({ pending: jobsFor(useModelsStore.getState().models, useModelPlacementStore.getState().offsets, tolerance, exact).filter((j) => !s.results[j.scope] || s.results[j.scope].key !== j.key).length }));
      }
    }
  }, [engine, models, offsets, root, settings, runRequest]);
}

const short = (name: string) => name.replace(/\.(ifc|frag)$/i, '');
