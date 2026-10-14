import type { ScheduleCalendar } from '../schedule/calendar';
import type { CalendarRow } from './rules';

/** The generator's calendars from the calendars of the loaded programmes (Programmes > Calendars): a working week (the days, the start, the hours a
    day) with the name of the programme's calendar. Holidays are not modelled by the generator, so they are not carried over. */

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const minutes = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

export function calendarRowOf(cal: ScheduleCalendar): CalendarRow {
  const given = Object.keys(cal.days).length > 0;
  const workDays = DAYS.flatMap((d, i) => (given ? (cal.days[d]?.working ? [i] : []) : i < 5 ? [i] : []));
  const first = DAYS.map((d) => cal.days[d]).find((d) => d?.working && d.spans?.length);
  const start = first?.spans?.[0]?.start.slice(0, 5) ?? '09:00';
  const worked = first?.spans?.reduce((n, s) => n + Math.max(0, (minutes(s.finish) ?? 0) - (minutes(s.start) ?? 0)), 0) ?? 0;
  const hoursPerDay = cal.hoursPerDay && cal.hoursPerDay > 0 ? cal.hoursPerDay : worked > 0 ? worked / 60 : 8;
  // A recipe names a calendar by the programme's name for it (what Programmes > Calendars shows).
  return { id: cal.name || cal.id, name: cal.name || cal.id, workDays, start, hoursPerDay };
}

/** The calendars of the programmes by name (the first of a name is kept), each with an ID the recipes can name: the calendar's own ID. */
export function calendarsFromProgrammes(calendars: ScheduleCalendar[]): CalendarRow[] {
  const seen = new Set<string>();
  const out: CalendarRow[] = [];
  for (const c of calendars) {
    const key = (c.name || c.id).trim().toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(calendarRowOf(c));
  }
  return out;
}

/** The calendars the generator uses: those of the loaded programmes, and only those (there is one place for calendars, Programmes > Calendars).
    A programme calendar keeps the ID of the rules' calendar of the same name, so recipes and assignments that name it still find it; the default
    mark stays on its calendar, or goes to the first. With no programme calendar loaded the rules' own are kept. */
export function syncCalendars(existing: CalendarRow[], fromProgrammes: CalendarRow[]): CalendarRow[] {
  if (!fromProgrammes.length) return existing;
  const next = fromProgrammes.map((c) => {
    const had = existing.find((e) => e.name.trim().toUpperCase() === c.name.trim().toUpperCase()) ?? existing.find((e) => e.id.trim().toUpperCase() === c.id.trim().toUpperCase());
    return { ...c, id: had?.id ?? c.id, default: had?.default };
  });
  if (!next.some((c) => c.default)) next[0] = { ...next[0], default: true };
  return JSON.stringify(next) === JSON.stringify(existing) ? existing : next;
}
