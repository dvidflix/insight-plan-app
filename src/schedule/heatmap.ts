import type { Activity } from './types';

export type HeatMode = 'active' | 'starting' | 'finishing' | 'blStarting' | 'blFinishing';

export const HEAT_MODES: { id: HeatMode; label: string; shows: string }[] = [
  { id: 'active', label: 'Active Activities', shows: 'activities starting or in progress' },
  { id: 'starting', label: 'Activities Starting', shows: 'activities starting' },
  { id: 'finishing', label: 'Activities Finishing', shows: 'activities finishing' },
  { id: 'blStarting', label: 'BL Starting', shows: 'target (baseline) starts' },
  { id: 'blFinishing', label: 'BL Finishing', shows: 'target (baseline) finishes' },
];

const DAY_MS = 86400000;

/** Whole-day number for a local calendar date (time of day ignored), so
    "same day" comparisons don't depend on the hour a date was stamped with. */
export function dayIndex(d: Date): number {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

export function dayToDate(day: number): Date {
  const u = new Date(day * DAY_MS);
  return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate());
}

/** First and last day (inclusive) an activity counts toward for `mode`, or
    null when it has no usable date. */
function daySpan(a: Activity, mode: HeatMode): [number, number] | null {
  const start = a.actualStart ?? a.earlyStart ?? a.targetStart;
  const finish = a.actualFinish ?? a.earlyFinish ?? a.targetFinish;
  switch (mode) {
    case 'starting': return start ? [dayIndex(start), dayIndex(start)] : null;
    case 'finishing': return finish ? [dayIndex(finish), dayIndex(finish)] : null;
    case 'blStarting': return a.targetStart ? [dayIndex(a.targetStart), dayIndex(a.targetStart)] : null;
    case 'blFinishing': return a.targetFinish ? [dayIndex(a.targetFinish), dayIndex(a.targetFinish)] : null;
    default: {
      if (!start) return null;
      const s = dayIndex(start);
      const f = finish ? Math.max(s, dayIndex(finish)) : s;
      return [s, f];
    }
  }
}

export function activityOnDay(a: Activity, mode: HeatMode, day: number): boolean {
  if (a.type === 'wbs-summary') return false;
  const span = daySpan(a, mode);
  return !!span && day >= span[0] && day <= span[1];
}

/** Activities per day for `mode`. Built as a difference array, so a schedule
    with thousands of long activities stays cheap. */
export function heatCounts(activities: Activity[], mode: HeatMode): Map<number, number> {
  const delta = new Map<number, number>();
  for (const a of activities) {
    if (a.type === 'wbs-summary') continue;
    const span = daySpan(a, mode);
    if (!span) continue;
    delta.set(span[0], (delta.get(span[0]) ?? 0) + 1);
    delta.set(span[1] + 1, (delta.get(span[1] + 1) ?? 0) - 1);
  }
  const days = [...delta.keys()].sort((x, y) => x - y);
  const counts = new Map<number, number>();
  let running = 0;
  for (let i = 0; i < days.length - 1; i++) {
    running += delta.get(days[i])!;
    if (running <= 0) continue;
    for (let d = days[i]; d < days[i + 1]; d++) counts.set(d, running);
  }
  return counts;
}
