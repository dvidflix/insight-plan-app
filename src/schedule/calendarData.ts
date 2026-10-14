import { isoDayNumber, type CalendarDay, type CalendarSpan, type ScheduleCalendar } from './calendar';

/** A calendar as P6 writes it in the XER's clndr_data: the working runs of each day of the week (day 1 is Sunday) and the dated
    exceptions, in P6's bracket text, e.g. (0||CalendarData()((0||DaysOfWeek()((0||1()())(0||2()((0||0(s|08:00|f|16:00)()))) ...
    The reverse of normalize.ts's clndrWeek / clndrExceptions. */

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** P6 counts days from 1899-12-30. */
const P6_SERIAL_EPOCH = 25569;

const minutes = (hhmm: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const clock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** The runs of work of a day: its own, else the one its "08:00–16:00" range says. */
export function daySpans(day: CalendarDay | undefined): CalendarSpan[] {
  if (!day?.working) return [];
  if (day.spans?.length) return day.spans;
  const m = /^(\d{1,2}:\d{2})\s*[–-]\s*(\d{1,2}:\d{2})$/.exec((day.range ?? '').trim());
  return m ? [{ start: m[1].padStart(5, '0'), finish: m[2].padStart(5, '0') }] : [];
}

/** Hours of work in a day (0 when it is off or its runs cannot be read). */
export function dayHours(day: CalendarDay | undefined): number {
  return daySpans(day).reduce((sum, s) => {
    const a = minutes(s.start);
    const b = minutes(s.finish);
    return a !== null && b !== null && b > a ? sum + (b - a) / 60 : sum;
  }, 0);
}

/** A working day of the given length starting at 08:00, as one run. */
export function standardSpan(hours: number, start = '08:00'): CalendarSpan {
  const from = minutes(start) ?? 480;
  return { start: clock(from), finish: clock(Math.min(24 * 60, from + Math.round(hours * 60))) };
}

const spansText = (spans: CalendarSpan[]) => spans.map((s, i) => `(0||${i}(s|${s.start}|f|${s.finish})())`).join('');
const children = (spans: CalendarSpan[]) => (spans.length ? `(${spansText(spans)})` : '()');

/** The clndr_data text of a calendar. A day the calendar does not name is a working Monday-Friday day of its length, as the
    schedule calculation takes it; a working day with no readable run gets one of the calendar's hours per day. */
export function calendarData(cal: ScheduleCalendar): string {
  const named = Object.keys(cal.days).length > 0;
  const days = DAY_NAMES.map((name, i) => {
    const day = cal.days[name] ?? (named ? { working: false } : { working: i !== 0 && i !== 6 });
    let spans = daySpans(day);
    if (day.working && spans.length === 0) spans = [standardSpan(cal.hoursPerDay || 8)];
    return `(0||${i + 1}()${children(spans)})`;
  });
  const exceptions = [...(cal.exceptions ?? [])]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .flatMap((e, i) => {
      const n = isoDayNumber(e.date);
      if (n === null) return [];
      let spans = daySpans(e);
      if (e.working && spans.length === 0) spans = [standardSpan(cal.hoursPerDay || 8)];
      return [`(0||${i}(d|${n + P6_SERIAL_EPOCH})${children(spans)})`];
    });
  return `(0||CalendarData()((0||DaysOfWeek()(${days.join('')}))(0||Exceptions()(${exceptions.join('')}))))`;
}

/** Hours in a working week of the calendar. */
export function weekHours(cal: ScheduleCalendar): number {
  const named = Object.keys(cal.days).length > 0;
  return DAY_NAMES.reduce((sum, name, i) => {
    const day = cal.days[name] ?? (named ? undefined : { working: i !== 0 && i !== 6 });
    if (!day?.working) return sum;
    return sum + (dayHours(day) || cal.hoursPerDay || 8);
  }, 0);
}

/** The week with every working day made `hours` long: the last run of a day ends later (or earlier) by what is missing (or too much). */
export function weekWithDayLength(days: ScheduleCalendar['days'], hours: number): ScheduleCalendar['days'] {
  const out: ScheduleCalendar['days'] = {};
  for (const [name, day] of Object.entries(days)) {
    const spans = daySpans(day);
    if (!day.working || spans.length === 0) {
      out[name] = day;
      continue;
    }
    const delta = Math.round((hours - dayHours(day)) * 60);
    const last = spans[spans.length - 1];
    const end = Math.max((minutes(last.start) ?? 0) + 15, Math.min(24 * 60, (minutes(last.finish) ?? 0) + delta));
    const changed = [...spans.slice(0, -1), { start: last.start, finish: clock(end) }];
    out[name] = { ...day, range: `${changed[0].start}–${changed[changed.length - 1].finish}`, spans: changed };
  }
  return out;
}
