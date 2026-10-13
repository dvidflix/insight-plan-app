import type { CalendarRow } from './rules';

/** Calendars read from a Primavera P6 XML file (the schedule's <Calendar> elements: its standard work week). A calendar here is the same
    window on every working day, so a calendar whose days differ is read as its most common day, and a day with a break (08:00-12:00 and
    13:00-17:00) is read as its first start and the hours worked, not the break. */

const DAY_INDEX: Record<string, number> = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };

interface Node {
  localName: string;
  textContent: string | null;
  children: ArrayLike<Node> & Iterable<Node>;
}
interface Root {
  getElementsByTagName(name: string): ArrayLike<Node> & Iterable<Node>;
}

const kids = (el: Node, name: string): Node[] => [...el.children].filter((c) => c.localName === name);
const text = (el: Node | undefined) => (el?.textContent ?? '').trim();
const seconds = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) : null;
};
const clock = (s: number) => `${String(Math.floor(s / 3600) % 24).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;

export function calendarsFromP6(doc: Root): CalendarRow[] {
  const out: CalendarRow[] = [];
  const taken = new Set<string>();
  for (const cal of doc.getElementsByTagName('Calendar')) {
    const name = text(kids(cal, 'Name')[0]);
    const week = kids(cal, 'StandardWorkWeek')[0];
    if (!name || !week) continue;
    const days: { day: number; start: number; hours: number }[] = [];
    for (const wh of kids(week, 'StandardWorkHours')) {
      const day = DAY_INDEX[text(kids(wh, 'DayOfWeek')[0]).toLowerCase()];
      if (day === undefined) continue;
      let start: number | null = null;
      let worked = 0;
      for (const wt of kids(wh, 'WorkTime')) {
        const s = seconds(text(kids(wt, 'Start')[0]));
        const f = seconds(text(kids(wt, 'Finish')[0]));
        if (s === null || f === null) continue;
        start = start === null ? s : Math.min(start, s);
        worked += (f > s ? f - s : f + 86400 - s) / 3600;
      }
      if (start !== null && worked > 0) days.push({ day, start, hours: Math.round(worked * 100) / 100 });
    }
    if (!days.length) continue;
    // the most common window stands for the calendar
    const tally = new Map<string, number>();
    for (const d of days) tally.set(`${d.start}|${d.hours}`, (tally.get(`${d.start}|${d.hours}`) ?? 0) + 1);
    const [best] = [...tally.entries()].sort((x, y) => y[1] - x[1])[0];
    const [start, hours] = best.split('|').map(Number);
    let id = name.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'CAL';
    for (let n = 2; taken.has(id); n++) id = `${id.replace(/-\d+$/, '')}-${n}`;
    taken.add(id);
    out.push({ id, name, workDays: days.filter((d) => d.start === start && d.hours === hours).map((d) => d.day).sort(), start: clock(start), hoursPerDay: hours });
  }
  return out;
}
