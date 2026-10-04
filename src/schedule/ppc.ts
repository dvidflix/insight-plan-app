import type { Activity } from './types';

/** Percent Plan Complete (Last Planner): for each week, the share of the
    activities planned to finish in it that were finished by its end. "Planned"
    is the baseline finish (the commitment), else the current planned finish. */

export interface PpcWeek {
  /** Monday of the week. */
  start: Date;
  planned: Activity[];
  done: Activity[];
  missed: Activity[];
  /** 0-100, or null when nothing was planned. */
  ppc: number | null;
  /** The week has not ended by the data date: it is a plan, not a result yet. */
  open: boolean;
}

const DAY = 86_400_000;

export const mondayOf = (d: Date) => {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
};

const plannedFinish = (a: Activity) => a.targetFinish ?? a.earlyFinish;

/** Weeks from the first planned finish to the one holding `asOf` (the data date, or today). */
export function ppcWeeks(activities: Activity[], asOf: Date): PpcWeek[] {
  const tasks = activities.filter((a) => a.type !== 'wbs-summary' && a.type !== 'loe' && plannedFinish(a));
  if (tasks.length === 0) return [];
  const byWeek = new Map<number, Activity[]>();
  for (const a of tasks) {
    const w = mondayOf(plannedFinish(a)!).getTime();
    (byWeek.get(w) ?? byWeek.set(w, []).get(w)!).push(a);
  }
  const first = Math.min(...byWeek.keys());
  const last = mondayOf(asOf).getTime();
  const weeks: PpcWeek[] = [];
  for (let w = first; w <= last; w += 7 * DAY) {
    const start = new Date(w);
    const end = w + 7 * DAY;
    const planned = byWeek.get(w) ?? [];
    const done = planned.filter((a) => a.actualFinish && a.actualFinish.getTime() < end);
    const doneIds = new Set(done.map((a) => a.id));
    const open = asOf.getTime() < end - 1;
    weeks.push({
      start,
      planned,
      done,
      missed: open ? [] : planned.filter((a) => !doneIds.has(a.id)),
      ppc: planned.length ? Math.round((done.length / planned.length) * 100) : null,
      open,
    });
  }
  return weeks;
}

export const REASONS = ['Predecessor late', 'Labour', 'Material / supply', 'Equipment', 'Design / RFI', 'Weather', 'Access / space', 'Permits / inspection', 'Rework', 'Other'] as const;
