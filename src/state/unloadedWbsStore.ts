import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ScheduleModel } from '../schedule/types';

/** WBS branches left out ("unloaded") of a programme, to keep validation work small:
    their activities (and the relationships touching them) are not in the programme any
    view sees (tables, Gantt, 4D). Nothing is deleted: Programmes › WBS shows them
    greyed with an eye to load them again. Kept per programme (by its file / scenario
    name, so a regenerated scenario programme keeps them) and saved with the project
    (the "schedule." settings go into the project database). */
interface UnloadedWbsState {
  /** programme key -> WBS paths ("A / B / C", as an activity's wbsPath) left out. */
  byProgramme: Record<string, string[]>;
  toggle: (key: string, path: string) => void;
  clear: (key: string) => void;
}

export const useUnloadedWbsStore = create<UnloadedWbsState>()(
  persist(
    (set) => ({
      byProgramme: {},
      toggle: (key, path) =>
        set((s) => {
          const cur = s.byProgramme[key] ?? [];
          const next = cur.includes(path) ? cur.filter((p) => p !== path) : [...cur, path];
          const byProgramme = { ...s.byProgramme };
          if (next.length) byProgramme[key] = next;
          else delete byProgramme[key];
          return { byProgramme };
        }),
      clear: (key) =>
        set((s) => {
          const byProgramme = { ...s.byProgramme };
          delete byProgramme[key];
          return { byProgramme };
        }),
    }),
    { name: 'schedule.unloadedWbs' },
  ),
);

export const programmeKey = (m: ScheduleModel) => m.sourceFileName;

/** Whether a WBS path is one of the unloaded branches or inside one. */
export const inUnloadedWbs = (paths: readonly string[], wbsPath: string) => paths.some((p) => wbsPath === p || wbsPath.startsWith(`${p} / `));

/** The programme without the activities of the unloaded branches (and the links to them). */
export function withoutUnloaded(m: ScheduleModel, paths: readonly string[]): ScheduleModel {
  if (paths.length === 0) return m;
  const activities = m.activities.filter((a) => !inUnloadedWbs(paths, a.wbsPath));
  if (activities.length === m.activities.length) return m;
  const kept = new Set(activities.map((a) => a.id));
  return { ...m, activities, relationships: m.relationships.filter((r) => kept.has(r.predId) && kept.has(r.succId)) };
}
