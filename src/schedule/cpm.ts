import { addWorkingDays, getCalendar, workingDaysBetween, type ScheduleCalendar } from './calendar';
import { constrainLate, constrainStart, constraintKind } from './constraints';
import type { Activity, Relationship, ScheduleModel } from './types';

export interface CpmOptions {
  /** An activity no link drives keeps where it starts (an edit layer over a programme that already has dates). */
  keepOwnStarts?: boolean;
  /** How the work still to do of a started activity follows the links, as P6's schedule option "Retained logic" (default: it waits
      for its predecessors, though they finish after it started) or "Progress override" (it ignores them: it resumes at the data date). */
  logic?: 'retained' | 'override';
}

/** Recomputes early/late dates, float and criticality from the relationship
    network when the source file didn't already carry P6-computed float
    (e.g. a schedule exported before running the scheduler), or after an edit.
    Calendar-aware (falls back to a standard Mon-Fri week per activity's calendar
    — see calendar.ts — when the source calendar carries no decodable weekly
    pattern, which is always true for XER and sometimes true for XML).

    Progress follows the data date as P6 does: a completed activity keeps its actual dates, a started one keeps its actual start and
    its remaining duration runs from the data date (or later, by the logic), and one not started cannot start before the data date.
    Constraints: start / finish on or after, start / finish on, and mandatory start / finish move the early dates; on or before, on
    and mandatory also cap the late dates, so a date the logic cannot meet shows as negative float. "As late as possible" is not
    applied (the activity is scheduled as soon as possible). */
export function recomputeCpm(model: ScheduleModel, opts: CpmOptions = {}): ScheduleModel {
  const byId = new Map(model.activities.map((a) => [a.id, a]));
  // Level-of-effort and WBS-summary activities span the work they are tied to (P6 stretches them from its start to its finish): they
  // are not part of the network, or their own duration would be added after the latest link and push the end of the programme out.
  const spans = (id: string) => { const t = byId.get(id)?.type; return t === 'loe' || t === 'wbs-summary'; };
  const calendarsById = new Map<string, ScheduleCalendar>(model.calendars.map((c) => [c.id, c]));
  const preds = new Map<string, Relationship[]>();
  const succs = new Map<string, Relationship[]>();
  for (const rel of model.relationships) {
    if (!byId.has(rel.predId) || !byId.has(rel.succId) || spans(rel.predId) || spans(rel.succId)) continue;
    (preds.get(rel.succId) ?? preds.set(rel.succId, []).get(rel.succId)!).push(rel);
    (succs.get(rel.predId) ?? succs.set(rel.predId, []).get(rel.predId)!).push(rel);
  }

  const order = topoOrder(model.activities.filter((a) => !spans(a.id)).map((a) => a.id), succs);
  const dataDate = model.project.dataDate;
  const anchor = dataDate ?? model.project.planStart ?? new Date();
  const retained = opts.logic !== 'override';

  /** The working time the activity still has to run: what is left of one that started, else its duration. */
  const runDays = (a: Activity, hoursPerDay: number) =>
    Math.max(a.status === 'in-progress' ? a.remainingDurationHours : a.remainingDurationHours || a.durationHours, 0) / hoursPerDay;
  const constraints = (a: Activity) => [
    { kind: constraintKind(a.constraintType), date: a.constraintDate },
    { kind: constraintKind(a.secondaryConstraintType), date: a.secondaryConstraintDate ?? null },
  ];

  const es = new Map<string, Date>();
  const ef = new Map<string, Date>();
  /** Where the work still to do starts (the actual start of a started activity is `es`). */
  const restart = new Map<string, Date>();
  for (const id of order) {
    const activity = byId.get(id)!;
    const cal = getCalendar(activity.calendarId, calendarsById);
    if (activity.status === 'completed' && (activity.actualFinish || activity.actualStart)) {
      const start = activity.actualStart ?? activity.actualFinish!;
      es.set(id, start);
      ef.set(id, activity.actualFinish ?? start);
      continue;
    }
    const started = activity.status === 'in-progress';
    const durationDays = runDays(activity, cal.hoursPerDay);
    const incoming = preds.get(id) ?? [];
    let start: Date | null = null;
    for (const rel of incoming) {
      const predEs = es.get(rel.predId);
      const predEf = ef.get(rel.predId);
      if (!predEs || !predEf) continue;
      const lagDays = rel.lagHours / cal.hoursPerDay;
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
    if (started) {
      // The work still to do resumes at the data date, or when the logic lets it (retained logic).
      let resume = dataDate ?? start ?? anchor;
      if (retained && start && start > resume) resume = start;
      for (const c of constraints(activity)) resume = constrainStart(c.kind, c.date, resume, durationDays, cal);
      es.set(id, activity.actualStart ?? resume);
      restart.set(id, resume);
      ef.set(id, addWorkingDays(resume, durationDays, cal));
      continue;
    }
    // With no link to drive it an activity starts at the data date; with `keepOwnStarts` (an edit layer over a programme that
    // already has dates) it keeps where it already starts. Never before the data date.
    if (!start) start = (opts.keepOwnStarts && (activity.earlyStart ?? activity.targetStart ?? activity.actualStart)) || anchor;
    if (dataDate && start < dataDate) start = dataDate;
    for (const c of constraints(activity)) start = constrainStart(c.kind, c.date, start, durationDays, cal);
    es.set(id, start);
    restart.set(id, start);
    ef.set(id, addWorkingDays(start, durationDays, cal));
  }

  let projectEnd = anchor;
  for (const d of ef.values()) if (d > projectEnd) projectEnd = d;

  const ls = new Map<string, Date>();
  const lf = new Map<string, Date>();
  for (const id of [...order].reverse()) {
    const activity = byId.get(id)!;
    const cal = getCalendar(activity.calendarId, calendarsById);
    if (activity.status === 'completed' && es.has(id) && !restart.has(id)) {
      ls.set(id, es.get(id)!);
      lf.set(id, ef.get(id)!);
      continue;
    }
    const durationDays = runDays(activity, cal.hoursPerDay);
    const outgoing = succs.get(id) ?? [];
    let finish: Date | null = null;
    for (const rel of outgoing) {
      const succLs = ls.get(rel.succId);
      const succLf = lf.get(rel.succId);
      if (!succLs || !succLf) continue;
      const lagDays = rel.lagHours / cal.hoursPerDay;
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
    let late = { ls: addWorkingDays(finish, -durationDays, cal), lf: finish };
    for (const c of constraints(activity)) late = constrainLate(c.kind, c.date, late.ls, late.lf, durationDays, cal);
    lf.set(id, late.lf);
    ls.set(id, late.ls);
  }

  // What each spanning activity covers: from the earliest start of what starts it to the latest finish of what ends it.
  const spanOf = (id: string): { start: Date; finish: Date } | null => {
    let start: Date | null = null;
    let finish: Date | null = null;
    const lower = (d: Date | undefined) => { if (d && (!start || d < start)) start = d; };
    const upper = (d: Date | undefined) => { if (d && (!finish || d > finish)) finish = d; };
    for (const rel of model.relationships) {
      if (rel.succId === id && !spans(rel.predId)) {
        if (rel.type === 'SS') lower(es.get(rel.predId));
        else if (rel.type === 'FS') lower(ef.get(rel.predId));
        else if (rel.type === 'FF') upper(ef.get(rel.predId));
      } else if (rel.predId === id && !spans(rel.succId)) {
        if (rel.type === 'FF') upper(ef.get(rel.succId));
        else if (rel.type === 'FS') upper(es.get(rel.succId));
      }
    }
    return start && finish && finish >= start ? { start, finish } : null;
  };

  const activities: Activity[] = model.activities.map((activity) => {
    if (spans(activity.id)) {
      const span = spanOf(activity.id);
      if (!span) return activity;
      const cal = getCalendar(activity.calendarId, calendarsById);
      const days = workingDaysBetween(span.start, span.finish, cal);
      const hours = days === null ? activity.durationHours : days * cal.hoursPerDay;
      return { ...activity, earlyStart: span.start, earlyFinish: span.finish, lateStart: span.start, lateFinish: span.finish, durationHours: hours, remainingDurationHours: hours, totalFloatHours: 0, isCritical: false };
    }
    const esD = es.get(activity.id);
    const efD = ef.get(activity.id);
    const lsD = ls.get(activity.id) ?? esD;
    const lfD = lf.get(activity.id) ?? efD;
    if (!esD || !efD || !lsD || !lfD) return activity; // LOE/WBS Summary: left untouched
    const cal = getCalendar(activity.calendarId, calendarsById);
    // Done: nothing left to be late on. Started: late by its finish. Not started: late by its start.
    if (activity.status === 'completed' && !restart.has(activity.id)) {
      return { ...activity, earlyStart: esD, earlyFinish: efD, lateStart: lsD, lateFinish: lfD, totalFloatHours: null, isCritical: false };
    }
    const started = activity.status === 'in-progress';
    const totalFloatDays = (started ? workingDaysBetween(efD, lfD, cal) : workingDaysBetween(esD, lsD, cal)) ?? 0;
    const resume = restart.get(activity.id) ?? esD;
    return {
      ...activity,
      earlyStart: esD,
      earlyFinish: efD,
      lateStart: lsD,
      lateFinish: lfD,
      remainingStart: resume,
      remainingFinish: efD,
      totalFloatHours: totalFloatDays * cal.hoursPerDay,
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
