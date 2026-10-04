import { stepHours, type StepUnit } from '../state/sequenceTimelineStore';

/** Start-of-period boundary of `unit` at/before `ms` — the start of this
    n-hour block (counted from local midnight), this week's Monday, this
    month's 1st, this quarter's 1st, or 1 Jan this year. */
export function alignDown(ms: number, unit: StepUnit): number {
  const d = new Date(ms);
  const hours = stepHours(unit);
  if (hours) {
    d.setHours(Math.floor(d.getHours() / hours) * hours, 0, 0, 0);
    return d.getTime();
  }
  d.setHours(0, 0, 0, 0);
  if (unit === 'day') return d.getTime();
  if (unit === 'week') {
    const day = d.getDay();
    d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    return d.getTime();
  }
  if (unit === 'month') {
    d.setDate(1);
    return d.getTime();
  }
  if (unit === 'quarter') {
    d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1);
    return d.getTime();
  }
  d.setMonth(0, 1);
  return d.getTime();
}

export function addUnit(ms: number, unit: StepUnit, delta: number): number {
  const d = new Date(ms);
  const hours = stepHours(unit);
  if (hours) {
    d.setHours(d.getHours() + delta * hours);
    return d.getTime();
  }
  if (unit === 'day') d.setDate(d.getDate() + delta);
  else if (unit === 'week') d.setDate(d.getDate() + delta * 7);
  else if (unit === 'month') d.setMonth(d.getMonth() + delta, 1);
  else if (unit === 'quarter') d.setMonth(d.getMonth() + delta * 3, 1);
  else d.setFullYear(d.getFullYear() + delta, 0, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Next calendar boundary of `unit` strictly after `ms` — next Monday, 1st
    of next month, 1st of next quarter, or 1 Jan next year. Every activity
    whose window falls inside the current period lands on this same next
    tick, which is what groups them together at coarser granularities
    instead of trickling in day by day. */
export function nextBoundary(ms: number, unit: StepUnit): number {
  return addUnit(alignDown(ms, unit), unit, 1);
}

/** Previous calendar boundary of `unit` strictly before `ms`, for the
    step-back control — mirrors nextBoundary. */
export function prevBoundary(ms: number, unit: StepUnit): number {
  const down = alignDown(ms, unit);
  return down < ms ? down : addUnit(down, unit, -1);
}

