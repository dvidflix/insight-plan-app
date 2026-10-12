import type { ScheduleModel } from './types';
import { getCalendar } from './calendar';
import { nextBoundary, prevBoundary } from './period';
import { stepHours, type SkipSettings, type StepUnit } from '../state/sequenceTimelineStore';

/** Whether a day is stepped over by the playback, or null when none is. A day-sized or hourly step only: coarser
    steps (weeks, months...) land on calendar boundaries, which are not days to leave out. */
export function skipPredicate(skip: SkipSettings, model: ScheduleModel | null): ((ms: number) => boolean) | null {
  if (skip.mode === 'custom') {
    if (skip.days.length === 0) return null;
    const days = new Set(skip.days);
    return (ms) => days.has(new Date(ms).getDay());
  }
  if (skip.mode === 'nonworking' && model) {
    // The calendar most activities use stands for the programme.
    const uses = new Map<string | null, number>();
    for (const a of model.activities) uses.set(a.calendarId, (uses.get(a.calendarId) ?? 0) + 1);
    const id = [...uses].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const cal = getCalendar(id, new Map(model.calendars.map((c) => [c.id, c])));
    return (ms) => !cal.isWorkingDay(new Date(ms));
  }
  return null;
}

/** `ms` moved on (dir 1) or back (dir -1) by whole steps until it is not on a skipped day. */
export function skipOver(ms: number, unit: StepUnit, dir: 1 | -1, skipped: ((ms: number) => boolean) | null): number {
  if (!skipped || !(unit === 'day' || stepHours(unit))) return ms;
  let m = ms;
  for (let i = 0; i < 1000 && skipped(m); i++) m = dir > 0 ? nextBoundary(m, unit) : prevBoundary(m, unit);
  return m;
}

/** The next / previous step from `ms`, over skipped days. */
export function stepFrom(ms: number, unit: StepUnit, dir: 1 | -1, skipped: ((ms: number) => boolean) | null): number {
  return skipOver(dir > 0 ? nextBoundary(ms, unit) : prevBoundary(ms, unit), unit, dir, skipped);
}
