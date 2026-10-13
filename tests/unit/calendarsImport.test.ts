import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import { calendarsFromP6 } from '../../src/prs/calendarsImport';
import { validateRules } from '../../src/prs/match';
import { normalizeRules } from '../../src/prs/rules';

/** A tiny DOM over fast-xml-parser: element names, children and text, which is all the P6 reader uses. */
class El {
  children: El[] = [];
  text = '';
  constructor(public localName: string) {}
  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(''); }
  getElementsByTagName(name: string): El[] { return this.children.flatMap((c) => [...(c.localName === name ? [c] : []), ...c.getElementsByTagName(name)]); }
}
function build(node: Record<string, unknown>): El | null {
  const tag = Object.keys(node).find((k) => k !== ':@' && !k.startsWith('?'));
  if (!tag) return null;
  const el = new El(tag);
  if (tag === '#text') { el.text = String(node['#text']); return el; }
  for (const c of node[tag] as Record<string, unknown>[]) {
    const child = build(c);
    if (!child) continue;
    if (child.localName === '#text') el.text += child.text;
    else el.children.push(child);
  }
  return el;
}
const read = (xml: string) => {
  const root = (new XMLParser({ preserveOrder: true }).parse(xml) as Record<string, unknown>[]).map(build).find((e) => e && e.localName !== '#text')!;
  return { getElementsByTagName: (n: string) => root.getElementsByTagName(n) };
};

const day = (name: string, windows: [string, string][]) =>
  `<StandardWorkHours><DayOfWeek>${name}</DayOfWeek>${windows.length ? windows.map(([s, f]) => `<WorkTime><Start>${s}</Start><Finish>${f}</Finish></WorkTime>`).join('') : '<WorkTime/>'}</StandardWorkHours>`;
const calendar = (name: string, days: string) => `<Calendar><Name>${name}</Name><ObjectId>1</ObjectId><Type>Global</Type><StandardWorkWeek>${days}</StandardWorkWeek></Calendar>`;

describe('calendars read from a P6 schedule', () => {
  it('reads the work week: days, start, and the hours worked', () => {
    const week = ['Sunday', 'Saturday'].map((d) => day(d, [])).join('') + ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((d) => day(d, [['08:00:00', '12:00:00'], ['13:00:00', '17:30:00']])).join('');
    const xml = `<APIBusinessObjects>${calendar('Site 5 day', week)}${calendar('Site 5 day', day('Monday', [['09:00:00', '17:00:00']]) + day('Sunday', [['09:00:00', '17:00:00']]))}${calendar('No week', '')}</APIBusinessObjects>`;
    const found = calendarsFromP6(read(xml));
    expect(found).toHaveLength(2);
    expect(found[0]).toEqual({ id: 'SITE-5-DAY', name: 'Site 5 day', workDays: [0, 1, 2, 3, 4], start: '08:00', hoursPerDay: 8.5 });
    expect(found[1].id).toBe('SITE-5-DAY-2'); // a repeated name still gets its own id
    expect(found[1].workDays).toEqual([0, 6]);
  });

  it('keeps the most common window when the days differ', () => {
    const days = ['Monday', 'Tuesday', 'Wednesday'].map((d) => day(d, [['07:00:00', '17:00:00']])).join('') + day('Friday', [['09:00:00', '13:00:00']]);
    expect(calendarsFromP6(read(`<R>${calendar('Mixed', days)}</R>`))[0]).toMatchObject({ workDays: [0, 1, 2], start: '07:00', hoursPerDay: 10 });
  });
});

describe('problems with calendars and trades', () => {
  it('names a calendar rule whose calendar is missing, a calendar with no days, and repeated ids', () => {
    const rules = normalizeRules({
      version: 1,
      calendars: [{ id: 'A', name: 'A', workDays: [], start: '09:00', hoursPerDay: 8 }, { id: 'a', name: 'B', workDays: [0], start: '09:00', hoursPerDay: 30 }],
      calendarRules: [{ id: 'R', when: {}, calendar: 'Z' }],
      trades: [{ id: 'SF', name: 'x', capacity: 1 }, { id: 'sf', name: 'y', capacity: 1 }],
    });
    const text = validateRules(rules, []).map((p) => `${p.section}: ${p.text}`).join('\n');
    expect(text).toContain('calendars: Has no working days');
    expect(text).toContain('calendars: Hours per day must be between 0 and 24');
    expect(text).toContain('calendars: The id a is used twice');
    expect(text).toContain('calendarRules: The calendar "Z" is not defined');
    expect(text).toContain('trades: The id sf is used twice');
  });
});
