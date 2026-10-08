import type { Activity, ScheduleModel } from './types';
import type { ElementSummary } from '../viewer/types';

export interface LinkResult {
  activityToElements: Map<string, number[]>;
  elementToActivities: Map<number, string[]>;
  matchedElementCount: number;
  matchedActivityCount: number;
}

function normalize(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

/** Links activities to IFC elements by equality between an activity code
    value (e.g. a "Zone" or "Level" activity code) and a flattened IFC
    property value (e.g. "Pset_BuildingCommon.Zone" or "category"). */
export function computeLinks(
  activities: Activity[],
  elements: ElementSummary[],
  codeType: string,
  propKey: string,
): LinkResult {
  const elementsByValue = new Map<string, number[]>();
  for (const el of elements) {
    const raw = propKey === '_category' ? el.category : el.props[propKey];
    const value = normalize(raw);
    if (!value) continue;
    (elementsByValue.get(value) ?? elementsByValue.set(value, []).get(value)!).push(el.localId);
  }

  const activityToElements = new Map<string, number[]>();
  const elementToActivities = new Map<number, string[]>();
  for (const activity of activities) {
    const value = normalize(activity.activityCodes[codeType]);
    if (!value) continue;
    const localIds = elementsByValue.get(value);
    if (!localIds || localIds.length === 0) continue;
    activityToElements.set(activity.id, localIds);
    for (const id of localIds) {
      (elementToActivities.get(id) ?? elementToActivities.set(id, []).get(id)!).push(activity.id);
    }
  }

  return {
    activityToElements,
    elementToActivities,
    matchedElementCount: elementToActivities.size,
    matchedActivityCount: activityToElements.size,
  };
}

export type SequenceStatus = 'pending' | 'in-progress' | 'done';

/** The same start-date fallback chain statusAt/progressAt/scheduleRange
    each apply for a given basis — pulled out so anything that needs to
    compare two activities' timing (e.g. which of two activities linked to
    the same element is the "current" one) uses the exact same notion of
    "start" those already use. */
export function activityStartMs(activity: Activity, basis: 'planned' | 'actual'): number | null {
  return basisStart(activity, basis)?.getTime() ?? null;
}

export function activityFinishMs(activity: Activity, basis: 'planned' | 'actual'): number | null {
  return basisFinish(activity, basis)?.getTime() ?? null;
}

/** An activity's start / finish for a basis: Actual prefers the as-built dates, Planned the scheduled ones — and each
    falls back to the other family when its own is missing. A P6 export of a finished project often carries no early
    or target dates for completed work, only actual ones; without the fallback such an activity had no finish (so it
    stayed active for ever) or none at all (so it was left out of the timeline's range). */
export function basisStart(activity: Activity, basis: 'planned' | 'actual'): Date | null {
  return (basis === 'actual' ? activity.actualStart ?? activity.earlyStart ?? activity.targetStart : activity.earlyStart ?? activity.targetStart ?? activity.actualStart) ?? null;
}

export function basisFinish(activity: Activity, basis: 'planned' | 'actual'): Date | null {
  return (basis === 'actual' ? activity.actualFinish ?? activity.earlyFinish ?? activity.targetFinish : activity.earlyFinish ?? activity.targetFinish ?? activity.actualFinish) ?? null;
}

/** The share of activities that have an actual start: near 1 for a finished project's as-built programme. */
export function actualCoverage(model: ScheduleModel | null): number {
  const real = model?.activities.filter((a) => a.type !== 'wbs-summary') ?? [];
  return real.length ? real.filter((a) => a.actualStart).length / real.length : 0;
}

export function statusAt(activity: Activity, date: Date, basis: 'planned' | 'actual'): SequenceStatus {
  const start = activityStartMs(activity, basis);
  const finish = activityFinishMs(activity, basis);
  const dateMs = date.getTime();
  if (start === null) return 'pending';
  if (dateMs < start) return 'pending';
  if (finish !== null && dateMs >= finish) return 'done';
  return 'in-progress';
}

/** Status over a whole step period [periodStart, periodEnd) rather than at one
    instant — what "Yearly" / "Monthly" stepping needs. Not started before the
    period ends -> pending; finished before it began -> done; anything that
    overlaps it -> in-progress (i.e. active during that period). A cursor
    sitting on 1 Jan would otherwise only ever show what happens to be running
    at that exact midnight. */
export function statusInPeriod(activity: Activity, periodStartMs: number, periodEndMs: number, basis: 'planned' | 'actual'): SequenceStatus {
  const start = activityStartMs(activity, basis);
  const finish = activityFinishMs(activity, basis);
  if (start === null) return 'pending';
  if (start >= periodEndMs) return 'pending';
  if (finish !== null && finish <= periodStartMs) return 'done';
  return 'in-progress';
}

export interface DateRange {
  min: number;
  max: number;
}

/** The [earliest start, latest finish] window across every activity, in
    epoch ms — the 4D timeline's scrubbable range. Shared by the sequencing
    panel and the viewer's floating timeline overlay so both agree on it. */
export function scheduleRange(model: ScheduleModel | null, basis: 'planned' | 'actual'): DateRange | null {
  if (!model) return null;
  const starts = model.activities.map((a) => basisStart(a, basis)).filter((d): d is Date => !!d);
  const finishes = model.activities.map((a) => basisFinish(a, basis)).filter((d): d is Date => !!d);
  if (starts.length === 0 || finishes.length === 0) return null;
  return { min: Math.min(...starts.map((d) => d.getTime())), max: Math.max(...finishes.map((d) => d.getTime())) };
}

/** 0..1 fraction of the way through the activity's active window at `date`,
    for interpolating an appearance profile's active-start -> active-finish
    color/opacity. Clamped; 0 before start, 1 at/after finish. */
export function progressAt(activity: Activity, date: Date, basis: 'planned' | 'actual'): number {
  const start = basisStart(activity, basis);
  const finish = basisFinish(activity, basis);
  if (!start || !finish) return 0;
  const total = finish.getTime() - start.getTime();
  if (total <= 0) return 1;
  return Math.min(1, Math.max(0, (date.getTime() - start.getTime()) / total));
}
