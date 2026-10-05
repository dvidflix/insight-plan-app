import type { ScheduleModel } from '../schedule/types';
import { elementIdField } from '../schedule/activityObjects';
import { taskFieldValue } from '../schedule/linkGroups';
import { startOf } from '../schedule/columns';

/** A model's name without the "_FIXED" the property editor adds, so a scenario made on "X" works on "X_FIXED". */
export const baseStem = (stem: string) => stem.replace(/_FIXED$/i, '');

const norm = (v: string) => v.trim().toLowerCase().replace(/^0+(?=\d)/, '');
const day = (d: Date) => Math.floor(d.getTime() / 86_400_000);

/** The pour order a programme already has, for a scenario that has no saved
    order: every pour gets the Index of its start day (pours starting the same
    day start together), matched through the pour ID = the activities' Element
    ID. Returns the sheet rows with Index filled in, or null when the
    programme has no Element ID or matches no pour. */
export function indexFromProgramme(schedule: ScheduleModel, headers: string[], rows: string[][]): string[][] | null {
  const field = elementIdField(schedule);
  const indexCol = headers.indexOf('Index');
  const idCols = ['PlanningProposedPourID', 'Pour ID'].map((h) => headers.indexOf(h)).filter((i) => i >= 0);
  if (!field || indexCol < 0 || !idCols.length) return null;
  const startById = new Map<string, number>();
  for (const a of schedule.activities) {
    const id = norm(taskFieldValue(a, field));
    const start = startOf(a);
    if (!id || !start) continue;
    const t = start.getTime();
    const cur = startById.get(id);
    if (cur === undefined || t < cur) startById.set(id, t);
  }
  const startOfRow = (r: string[]) => {
    for (const c of idCols) {
      const t = startById.get(norm(r[c] ?? ''));
      if (t !== undefined) return t;
    }
    return undefined;
  };
  const days = [...new Set(rows.flatMap((r) => { const t = startOfRow(r); return t === undefined ? [] : [day(new Date(t))]; }))].sort((a, b) => a - b);
  if (!days.length) return null;
  const indexOfDay = new Map(days.map((d, i) => [d, i + 1]));
  return rows.map((r) => {
    const next = [...r];
    const t = startOfRow(r);
    next[indexCol] = t === undefined ? '' : String(indexOfDay.get(day(new Date(t))));
    return next;
  });
}
