import type { Activity, Relationship, ScheduleModel } from './types';

/** The driving path to an activity: the chain of predecessors that fixes its
    start, found by walking back through the relationships that are "driving"
    (the predecessor's date, plus the lag, lands on the successor's early date). */

const HOUR = 3_600_000;
/** How close, in hours, a predecessor's date must be to the successor's to drive it. */
export const DRIVING_TOLERANCE_HOURS = 24;
/** A predecessor with more free float than this (hours) is not driving. */
export const DRIVING_FLOAT_HOURS = 4;
/** Days of non-working gap (a weekend) still counted as driving. */
export const DRIVING_GAP_DAYS = 2;

const time = (d: Date | null | undefined) => (d ? d.getTime() : null);
const startOf = (a: Activity) => time(a.earlyStart ?? a.targetStart);
const finishOf = (a: Activity) => time(a.earlyFinish ?? a.targetFinish);

/** Whether `rel` drives its successor: the date the relationship asks for is the successor's own. */
export function drives(rel: Relationship, pred: Activity, succ: Activity): boolean {
  const lag = rel.lagHours * HOUR;
  const tol = DRIVING_TOLERANCE_HOURS * HOUR;
  const [from, to] =
    rel.type === 'FS' ? [finishOf(pred), startOf(succ)]
    : rel.type === 'SS' ? [startOf(pred), startOf(succ)]
    : rel.type === 'FF' ? [finishOf(pred), finishOf(succ)]
    : [startOf(pred), finishOf(succ)];
  if (from === null || to === null) return false;
  // A predecessor with free float is not holding anything back (when the programme says).
  if (pred.freeFloatHours !== null && pred.freeFloatHours > DRIVING_FLOAT_HOURS) return false;
  // Calendars skip weekends: a non-working gap of up to a weekend still counts.
  const gap = to - (from + lag);
  return gap >= -tol && gap <= tol + DRIVING_GAP_DAYS * 24 * HOUR;
}

export interface DrivingPath {
  /** The activity and every activity driving it, back to the start. */
  ids: Set<string>;
  /** The driving relationships, as "pred>succ" keys. */
  links: Set<string>;
}

/** Walks back from `targetId`. When several predecessors are tied, they all count. */
export function drivingPath(model: ScheduleModel, targetId: string): DrivingPath {
  const byId = new Map(model.activities.map((a) => [a.id, a]));
  const predsOf = new Map<string, Relationship[]>();
  for (const r of model.relationships) (predsOf.get(r.succId) ?? predsOf.set(r.succId, []).get(r.succId)!).push(r);

  const ids = new Set<string>();
  const links = new Set<string>();
  const stack = [targetId];
  while (stack.length) {
    const id = stack.pop()!;
    if (ids.has(id)) continue;
    ids.add(id);
    const succ = byId.get(id);
    if (!succ) continue;
    const candidates = (predsOf.get(id) ?? []).filter((r) => byId.has(r.predId) && drives(r, byId.get(r.predId)!, succ));
    if (candidates.length === 0) continue;
    // The relationships that fix the date: the latest-implied ones.
    for (const r of candidates) {
      links.add(`${r.predId}>${r.succId}`);
      stack.push(r.predId);
    }
  }
  return { ids, links };
}
