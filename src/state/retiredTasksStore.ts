import { create } from 'zustand';
import type { Relationship, ScheduleModel } from '../schedule/types';

/** The Task IDs retired in SeaTable (Retired table), as last pulled into the local copy the generator reads
    (see seatable/adjustments.ts). Those tasks are not in any programme the app shows: they leave the table, the Gantt
    and 4D the moment they are retired, and the generator no longer makes them. Read from the local file, so it works
    with SeaTable switched off. */
interface RetiredState {
  /** Upper-case Task IDs. */
  codes: Set<string>;
  load: () => Promise<void>;
}

export const useRetiredTasksStore = create<RetiredState>((set) => ({
  codes: new Set(),
  load: async () => {
    try {
      const res = await fetch('/api/seatable/adjustments/retired');
      if (!res.ok) return;
      const json = (await res.json()) as { retired?: string[] };
      set({ codes: new Set((json.retired ?? []).map((c) => String(c).trim().toUpperCase()).filter(Boolean)) });
    } catch {
      // no dev server / no file: nothing is retired
    }
  },
}));

// Read once at start-up.
if (typeof window !== 'undefined') void useRetiredTasksStore.getState().load();

/** The programme without the retired tasks. The links around a removed task are closed up (each predecessor is linked
    to each successor, finish-to-start, when it is not already), so the chain does not break until the programme is
    generated again. */
export function withoutRetired(m: ScheduleModel, codes: ReadonlySet<string>): ScheduleModel {
  if (codes.size === 0) return m;
  const gone = new Set(m.activities.filter((a) => codes.has(a.code.trim().toUpperCase())).map((a) => a.id));
  if (gone.size === 0) return m;

  let rels = m.relationships;
  const key = (p: string, s: string) => `${p}\u0001${s}`;
  for (const id of gone) {
    const preds = rels.filter((r) => r.succId === id).map((r) => r.predId);
    const succs = rels.filter((r) => r.predId === id).map((r) => r.succId);
    rels = rels.filter((r) => r.predId !== id && r.succId !== id);
    const have = new Set(rels.map((r) => key(r.predId, r.succId)));
    const added: Relationship[] = [];
    for (const p of preds) {
      for (const s of succs) {
        if (p === s || have.has(key(p, s))) continue;
        have.add(key(p, s));
        added.push({ predId: p, succId: s, type: 'FS', lagHours: 0 });
      }
    }
    if (added.length) rels = [...rels, ...added];
  }
  // (Links through several removed tasks in a row were closed up one removal at a time; none is left pointing at one.)
  return { ...m, activities: m.activities.filter((a) => !gone.has(a.id)), relationships: rels.filter((r) => !gone.has(r.predId) && !gone.has(r.succId)) };
}
