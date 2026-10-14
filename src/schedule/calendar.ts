/** One run of work in a day ("08:00" to "12:00"). */
export interface CalendarSpan {
  start: string;
  finish: string;
}

export interface CalendarDay {
  working: boolean;
  /** First start to last finish, for showing. */
  range?: string;
  /** Every run of work of the day (a lunch break splits it in two). Absent on a calendar saved before they were read. */
  spans?: CalendarSpan[];
}

/** A dated override of the weekly pattern: a holiday (working: false) or
    an extra working day (working: true, with its hours in range). */
export interface CalendarException {
  date: string; // YYYY-MM-DD
  working: boolean;
  range?: string;
  spans?: CalendarSpan[];
}

export interface ScheduleCalendar {
  id: string;
  name: string;
  hoursPerDay: number | null;
  /** Keyed by full day name ("Monday", ...). Empty when the source didn't
      carry a decodable weekly pattern, in which case a standard Mon-Fri
      week is assumed. */
  days: Record<string, CalendarDay>;
  /** Sorted by date. Absent on programmes saved before exceptions were read. */
  exceptions?: CalendarException[];
}

export interface WorkingCalendar {
  hoursPerDay: number;
  dowWorking: boolean[]; // index 0 = Sunday
  workingDaysPerWeek: number;
  /** Day numbers (see dayNumber) the exceptions make working / non-working,
      sorted; only days where they differ from the weekly pattern. */
  extraWorking: number[];
  extraOff: number[];
  isWorkingDay(date: Date): boolean;
}

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_HOURS_PER_DAY = 8;

/** Whole days since 1970-01-01 of the date's local calendar day. */
function dayNumber(date: Date): number {
  return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY);
}

/** Day of week (0 = Sunday) of a day number; 1970-01-01 was a Thursday. */
function dowOf(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

/** "YYYY-MM-DD" → day number, or null. */
export function isoDayNumber(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY) : null;
}

/** Day number → "YYYY-MM-DD". */
export function dayNumberIso(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Count of sorted values in [a, b). */
function countIn(sorted: number[], a: number, b: number): number {
  if (sorted.length === 0 || b <= a) return 0;
  return lowerBound(sorted, b) - lowerBound(sorted, a);
}

function lowerBound(sorted: number[], v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const cache = new WeakMap<ScheduleCalendar, WorkingCalendar>();
let standardWeek: WorkingCalendar | null = null;

/** Resolves a calendar id to a working-day predicate + hours/day, falling
    back to a standard Mon-Fri week when the calendar has no usable weekly
    pattern. Holidays and extra working days from its exceptions apply on
    top. Ported from insight-plan-web's cpmEngine.js. */
export function getCalendar(calendarId: string | null, calendarsById: Map<string, ScheduleCalendar>): WorkingCalendar {
  const cal = calendarId ? calendarsById.get(calendarId) : undefined;
  if (!cal) return (standardWeek ??= buildCalendar(undefined));
  let built = cache.get(cal);
  if (!built) cache.set(cal, (built = buildCalendar(cal)));
  return built;
}

function buildCalendar(cal: ScheduleCalendar | undefined): WorkingCalendar {
  const hoursPerDay = cal?.hoursPerDay || DEFAULT_HOURS_PER_DAY;
  const days = cal?.days && Object.keys(cal.days).length > 0 ? cal.days : null;
  const dowWorking = DOW_NAMES.map((name, dow) => {
    if (!days) return dow !== 0 && dow !== 6;
    const entry = days[name];
    return entry ? entry.working !== false : dow !== 0 && dow !== 6;
  });
  const workingDaysPerWeek = dowWorking.reduce((n, w) => n + (w ? 1 : 0), 0) || 1;
  // One entry per day (a repeated date: the last wins).
  const byDay = new Map<number, boolean>();
  for (const ex of cal?.exceptions ?? []) {
    const day = isoDayNumber(ex.date);
    if (day !== null) byDay.set(day, ex.working);
  }
  const extraWorking: number[] = [];
  const extraOff: number[] = [];
  for (const [day, working] of byDay) {
    if (working !== dowWorking[dowOf(day)]) (working ? extraWorking : extraOff).push(day);
  }
  extraWorking.sort((a, b) => a - b);
  extraOff.sort((a, b) => a - b);
  const on = new Set(extraWorking);
  const off = new Set(extraOff);
  return {
    hoursPerDay,
    dowWorking,
    workingDaysPerWeek,
    extraWorking,
    extraOff,
    isWorkingDay(date: Date) {
      const day = dayNumber(date);
      if (on.has(day)) return true;
      if (off.has(day)) return false;
      return dowWorking[dowOf(day)];
    },
  };
}

function addCalendarDays(date: Date, k: number): Date {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + k);
  return d;
}

function isWorkingDayNumber(day: number, calendar: WorkingCalendar): boolean {
  if (countIn(calendar.extraWorking, day, day + 1)) return true;
  if (countIn(calendar.extraOff, day, day + 1)) return false;
  return calendar.dowWorking[dowOf(day)];
}

/** Days from `day` to the n-th working day of the weekly pattern (n >= 1)
    stepping in `step` direction, ignoring exceptions. A fixed ~7-iteration
    scan however large n is. */
function weeklyOffset(day: number, n: number, step: 1 | -1, calendar: WorkingCalendar): number {
  const dow0 = dowOf(day);
  const perCycle = calendar.workingDaysPerWeek;
  const fullCycles = Math.floor((n - 1) / perCycle);
  const remainderCount = n - fullCycles * perCycle;
  let seen = 0;
  let offsetInCycle = 7;
  for (let i = 1; i <= 7; i++) {
    if (calendar.dowWorking[(((dow0 + step * i) % 7) + 7) % 7]) {
      seen++;
      if (seen === remainderCount) {
        offsetInCycle = i;
        break;
      }
    }
  }
  return fullCycles * 7 + offsetInCycle;
}

/** Working days in the day-number range [a, b), exceptions included. */
function countWorking(a: number, b: number, calendar: WorkingCalendar): number {
  const totalDays = b - a;
  if (totalDays <= 0) return 0;
  const fullWeeks = Math.floor(totalDays / 7);
  // Not workingDaysPerWeek: that is at least 1 even for a week with none.
  let count = fullWeeks * calendar.dowWorking.filter(Boolean).length;
  const dow0 = dowOf(a);
  for (let i = 0; i < totalDays - fullWeeks * 7; i++) {
    if (calendar.dowWorking[(dow0 + i) % 7]) count++;
  }
  return count + countIn(calendar.extraWorking, a, b) - countIn(calendar.extraOff, a, b);
}

/** Adds n working days to `date` (n may be fractional), landing on the
    n-th working day after (or before) it. Jumps whole weeks of the weekly
    pattern, then corrects for the exceptions in the span jumped. */
export function addWorkingDays(date: Date, n: number, calendar: WorkingCalendar): Date {
  const whole = Math.trunc(n);
  const frac = n - whole;
  if (whole === 0) return frac !== 0 ? new Date(date.getTime() + frac * MS_PER_DAY) : new Date(date.getTime());

  const step = whole > 0 ? 1 : -1;
  const start = dayNumber(date);
  let cur = start;
  let remaining = Math.abs(whole);
  // Each round moves at least a day; the cap only guards a calendar with
  // no working days at all.
  for (let round = 0; remaining > 0 && round < 10000; round++) {
    const jump = cur + step * weeklyOffset(cur, remaining, step, calendar);
    const actual = step === 1 ? countWorking(cur + 1, jump + 1, calendar) : countWorking(jump, cur, calendar);
    if (actual < remaining) {
      remaining -= actual;
      cur = jump;
      continue;
    }
    // Extra working days put the target at or before `jump`: walk back.
    let d = jump;
    let c = actual;
    while (d !== cur && !(c === remaining && isWorkingDayNumber(d, calendar))) {
      if (isWorkingDayNumber(d, calendar)) c--;
      d -= step;
    }
    cur = d;
    remaining = 0;
  }
  let result = addCalendarDays(date, cur - start);
  if (frac !== 0) result = new Date(result.getTime() + frac * MS_PER_DAY);
  return result;
}

/** Counts working days in the half-open range [from, to) (negative if end < start). */
export function workingDaysBetween(startDate: Date | null, endDate: Date | null, calendar: WorkingCalendar): number | null {
  if (!startDate || !endDate) return null;
  const sign = endDate >= startDate ? 1 : -1;
  const [from, to] = sign === 1 ? [startDate, endDate] : [endDate, startDate];
  return countWorking(dayNumber(from), dayNumber(to), calendar) * sign;
}
