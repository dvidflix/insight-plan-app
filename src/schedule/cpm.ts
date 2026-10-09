import { addWorkingDays, getCalendar, workingDaysBetween, type ScheduleCalendar } from './calendar';
import type { Activity, Relationship, ScheduleModel } from './types';

const HOURS_PER_DAY = 8;

/** Recomputes early/late dates, float and criticality from the relationship
    network when the source file didn't already carry P6-computed float
    (e.g. a schedule exported before running the scheduler). Calendar-aware
    (falls back to a standard Mon-Fri week per activity's calendar — see
    calendar.ts — when the source calendar carries no decodable weekly
    pattern, which is always true for XER and sometimes true for XML). */
export function recomputeCpm(model: ScheduleModel, opts: { keepOwnStarts?: boolean } = {}): ScheduleModel {
  const byId = new Map(model.activities.map((a) => [a.id, a]));
  const calendarsById = new Map<string, ScheduleCalendar>(model.calendars.map((c) => [c.id, c]));
  const preds = new Map<string, Relationship[]>();
  const succs = new Map<string, Relationship[]>();
  for (const rel of model.relationships) {
    if (!byId.has(rel.predId) || !byId.has(rel.succId)) continue;
    (preds.get(rel.succId) ?? preds.set(rel.succId, []).get(rel.succId)!).push(rel);
    (succs.get(rel.predId) ?? succs.set(rel.predId, []).get(rel.predId)!).push(rel);
  }

  const order = topoOrder(model.activities.map((a) => a.id), succs);
  const anchor = model.project.dataDate ?? model.project.planStart ?? new Date();

  const es = new Map<string, Date>();
  const ef = new Map<string, Date>();
  for (const id of order) {
    const activity = byId.get(id)!;
    const cal = getCalendar(activity.calendarId, calendarsById);
    const durationDays = Math.max(activity.remainingDurationHours || activity.durationHours, 0) / HOURS_PER_DAY;
    const incoming = preds.get(id) ?? [];
    let start: Date | null = null;
    for (const rel of incoming) {
      const predEs = es.get(rel.predId);
      const predEf = ef.get(rel.predId);
      if (!predEs || !predEf) continue;
      const lagDays = rel.lagHours / HOURS_PER_DAY;
      let candidate: Date;
      switch (rel.type) {
        case 'SS':
          candidate = addWorkingDays(predEs, lagDays, cal);
          break;
        case 'FF':
          candidate = addWorkingDays(addWorkingDays(predEf, lagDays, cal), -durationDays, cal);
          break;
        case 'SF':
          candidate = addWorkingDays(addWorkingDays(predEs, lagDays, cal), -durationDays, cal);
          break;
        case 'FS':
        default:
          candidate = addWorkingDays(predEf, lagDays, cal);
      }
      if (!start || candidate > start) start = candidate;
    }
    // With no link to drive it an activity starts at the data date; with `keepOwnStarts` (an edit layer over a programme that
    // already has dates) it keeps where it already starts.
    if (!start) start = (opts.keepOwnStarts && (activity.earlyStart ?? activity.targetStart ?? activity.actualStart)) || anchor;
    es.set(id, start);
    ef.set(id, addWorkingDays(start, durationDays, cal));
  }

  let projectEnd = anchor;
  for (const d of ef.values()) if (d > projectEnd) projectEnd = d;

  const ls = new Map<string, Date>();
  const lf = new Map<string, Date>();
  for (const id of [...order].reverse()) {
    const activity = byId.get(id)!;
    const cal = getCalendar(activity.calendarId, calendarsById);
    const durationDays = Math.max(activity.remainingDurationHours || activity.durationHours, 0) / HOURS_PER_DAY;
    const outgoing = succs.get(id) ?? [];
    let finish: Date | null = null;
    for (const rel of outgoing) {
      const succLs = ls.get(rel.succId);
      const succLf = lf.get(rel.succId);
      if (!succLs || !succLf) continue;
      const lagDays = rel.lagHours / HOURS_PER_DAY;
      let candidate: Date;
      switch (rel.type) {
        case 'SS':
          candidate = addWorkingDays(addWorkingDays(succLs, -lagDays, cal), durationDays, cal);
          break;
        case 'FF':
          candidate = addWorkingDays(succLf, -lagDays, cal);
          break;
        case 'SF':
          candidate = addWorkingDays(addWorkingDays(succLf, -lagDays, cal), durationDays, cal);
          break;
        case 'FS':
        default:
          candidate = addWorkingDays(succLs, -lagDays, cal);
      }
      if (!finish || candidate < finish) finish = candidate;
    }
    if (!finish) finish = projectEnd;
    lf.set(id, finish);
    ls.set(id, addWorkingDays(finish, -durationDays, cal));
  }

  const activities: Activity[] = model.activities.map((activity) => {
    const esD = es.get(activity.id);
    const efD = ef.get(activity.id);
    const lsD = ls.get(activity.id) ?? esD;
    const lfD = lf.get(activity.id) ?? efD;
    if (!esD || !efD || !lsD || !lfD) return activity; // LOE/WBS Summary: left untouched
    const cal = getCalendar(activity.calendarId, calendarsById);
    const totalFloatDays = workingDaysBetween(esD, lsD, cal) ?? 0;
    return {
      ...activity,
      earlyStart: esD,
      earlyFinish: efD,
      lateStart: lsD,
      lateFinish: lfD,
      totalFloatHours: totalFloatDays * HOURS_PER_DAY,
      isCritical: totalFloatDays <= 0,
    };
  });

  return { ...model, activities, computedFloat: true };
}

function topoOrder(ids: string[], succs: Map<string, Relationship[]>): string[] {
  const indegree = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const list of succs.values()) {
    for (const rel of list) {
      indegree.set(rel.succId, (indegree.get(rel.succId) ?? 0) + 1);
    }
  }
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  const order: string[] = [];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const rel of succs.get(id) ?? []) {
      const remaining = (indegree.get(rel.succId) ?? 0) - 1;
      indegree.set(rel.succId, remaining);
      if (remaining <= 0) queue.push(rel.succId);
    }
  }
  for (const id of ids) if (!seen.has(id)) order.push(id);
  return order;
}
