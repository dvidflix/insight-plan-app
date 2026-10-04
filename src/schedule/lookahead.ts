import type { Activity } from './types';

/** Lookahead: what a short window of the programme asks for — work starting,
    finishing or running through it, plus work that is already late. */

export type LookaheadWhy = 'late' | 'starts' | 'finishes' | 'runs';

export const WHY_LABEL: Record<LookaheadWhy, string> = {
  late: 'Late',
  starts: 'Starts',
  finishes: 'Finishes',
  runs: 'Runs through',
};

export interface LookaheadRow {
  activity: Activity;
  /** Why it is in the window; an activity can be several (starts and finishes inside it). */
  why: LookaheadWhy[];
  start: Date | null;
  finish: Date | null;
}

const DAY = 86_400_000;

export const startOf = (a: Activity) => a.actualStart ?? a.earlyStart ?? a.targetStart;
export const finishOf = (a: Activity) => a.actualFinish ?? a.earlyFinish ?? a.targetFinish;

/** The window starts at `from` (midnight) and lasts `weeks` weeks. Milestones count, summaries and LOE do not. */
export function lookahead(activities: Activity[], from: Date, weeks: number): LookaheadRow[] {
  const t0 = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const t1 = t0 + weeks * 7 * DAY;
  const rows: LookaheadRow[] = [];
  for (const a of activities) {
    if (a.type === 'wbs-summary' || a.type === 'loe') continue;
    const done = a.status === 'completed' || !!a.actualFinish;
    if (done) continue;
    const s = startOf(a);
    const f = finishOf(a);
    const st = s ? s.getTime() : null;
    const ft = f ? f.getTime() : null;
    const why: LookaheadWhy[] = [];
    const notStarted = a.status === 'not-started' && !a.actualStart;
    // Late: it should be finished by now, or should have started and has not.
    if ((ft !== null && ft < t0) || (notStarted && st !== null && st < t0)) why.push('late');
    if (st !== null && st >= t0 && st < t1) why.push('starts');
    if (ft !== null && ft >= t0 && ft < t1) why.push('finishes');
    if (why.length === 0 && st !== null && ft !== null && st < t0 && ft >= t1) why.push('runs');
    if (why.length) rows.push({ activity: a, why, start: s, finish: f });
  }
  return rows.sort((x, y) => (x.start?.getTime() ?? 0) - (y.start?.getTime() ?? 0) || x.activity.code.localeCompare(y.activity.code));
}
