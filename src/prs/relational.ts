import type { Assignment, ChainRow, CrewTemplate, RateRow, TradeRow } from './rules';
import { assignmentKey } from './rules';

/** The relational tables of the rules (Rates, Crews, Assignments) as text for a spreadsheet and back: the same columns both ways, a first row of
    headings skipped when pasting. A cell the table does not need is left empty. */

const num = (v: string): number | undefined => {
  const t = v.trim().replace(',', '.');
  return t === '' || !Number.isFinite(Number(t)) ? undefined : Number(t);
};
const cells = (line: string) => line.split(/\t|;/).map((x) => x.trim());
const lines = (text: string) => text.split(/\r?\n/).filter((l) => l.trim() !== '');
const out = (v: unknown) => (v === undefined || v === null ? '' : String(v));

// ---------------------------------------------------------------- crews: "SF 6, CP 4"

export const crewText = (c: Pick<CrewTemplate, 'trades'>) => c.trades.map((t) => `${t.trade} ${t.size}`).join(', ');

/** "SF 6, CP 4" (or "SF=6; CP=4") as trades; an entry with no number is one person. */
export function parseCrewText(text: string): { trade: string; size: number }[] {
  return text
    .split(/[,+]|;(?=\s*[A-Za-z])/)
    .map((p) => /^\s*([A-Za-z0-9_-]+)\s*[= x*:]?\s*(\d+(?:[.,]\d+)?)?\s*$/.exec(p))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => ({ trade: m[1].toUpperCase(), size: m[2] ? Number(m[2].replace(',', '.')) : 1 }));
}

export const CREW_HEAD = ['ID', 'Crew'];
export const crewsToTsv = (rows: CrewTemplate[]) => [CREW_HEAD.join('\t'), ...rows.map((r) => [r.id, crewText(r)].join('\t'))].join('\n');
export function parseCrewsPaste(text: string): CrewTemplate[] {
  return lines(text).map(cells).filter((c) => c[0] && !/^(id|name)$/i.test(c[0])).map((c) => ({ id: c[0], trades: parseCrewText(c.slice(1).join(', ')) }));
}

// ---------------------------------------------------------------- trades

export const TRADE_HEAD = ['Code', 'Name', 'People per day'];

export const tradesToTsv = (rows: TradeRow[]) => [TRADE_HEAD.join('\t'), ...rows.map((t) => [t.id, t.name, String(t.capacity)].join('\t'))].join('\n');

export function parseTradesPaste(text: string): TradeRow[] {
  return lines(text).map(cells).filter((c) => c[0] && !/^(code|id)$/i.test(c[0])).map((c): TradeRow => ({ id: c[0].toUpperCase(), name: c[1] ?? '', capacity: Number.isFinite(Number(c[2])) && c[2] !== '' ? Number(c[2]) : 0 }));
}

// ---------------------------------------------------------------- rates

export const RATE_HEAD = ['ID', 'Type', 'Days', 'Tonnes per m3', 'Basis', 'Property set', 'Property', 'Multiply by', 'If none', 'Man-hours per unit', 'People', 'Shifts', 'Hours per shift', 'Round', 'At least (days)'];

const typeOf = (t: string): RateRow['type'] => (/^prod/i.test(t) ? 'productivity' : /^rebar|density/i.test(t) ? 'rebar' : 'days');
const basisOf = (t: string): RateRow['basis'] | undefined => (/^prop/i.test(t) ? 'property' : /^conc/i.test(t) ? 'concrete' : /^foot|^plan|^deck/i.test(t) ? 'footprint' : /^side|^wall/i.test(t) ? 'sides' : /^reb/i.test(t) ? 'rebar' : undefined);
const fallbackOf = (t: string): RateRow['fallback'] | undefined => (/^none|^leave/i.test(t) ? 'none' : /^conc/i.test(t) ? 'concrete' : /^reb/i.test(t) ? 'rebar' : undefined);
const roundOf = (t: string): RateRow['rounding'] | undefined => (/^up|^ceil/i.test(t) ? 'ceil' : /^near|^round/i.test(t) ? 'round' : /^no/i.test(t) ? 'none' : undefined);

export const ratesToTsv = (rows: RateRow[]) =>
  [
    RATE_HEAD.join('\t'),
    ...rows.map((r) => [r.id, r.type, out(r.days), out(r.tonnesPerM3), out(r.type === 'productivity' ? r.basis ?? 'rebar' : ''), out(r.pset), out(r.property), out(r.factor), out(r.fallback), out(r.manhoursPerUnit), out(r.people), out(r.shifts), out(r.hoursPerShift), out(r.type === 'productivity' ? r.rounding ?? 'ceil' : ''), out(r.minDays)].join('\t')),
  ].join('\n');

export function parseRatesPaste(text: string): RateRow[] {
  return lines(text)
    .map(cells)
    .filter((c) => c[0] && !/^id$/i.test(c[0]))
    .map((c): RateRow => {
      const type = typeOf(c[1] ?? '');
      const row: RateRow = { id: c[0], type };
      if (type === 'days') {
        const days = num(c[2] ?? '');
        if (days !== undefined) row.days = days;
      } else if (type === 'rebar') {
        const t = num(c[3] ?? '');
        if (t !== undefined) row.tonnesPerM3 = t;
      } else {
        row.basis = basisOf(c[4] ?? '') ?? 'rebar';
        if (c[5]) row.pset = c[5];
        if (c[6]) row.property = c[6];
        if (num(c[7] ?? '') !== undefined) row.factor = num(c[7]!);
        if (fallbackOf(c[8] ?? '')) row.fallback = fallbackOf(c[8]!);
        row.manhoursPerUnit = num(c[9] ?? '') ?? 0;
        row.people = num(c[10] ?? '') ?? 0;
        row.shifts = num(c[11] ?? '') ?? 1;
        row.hoursPerShift = num(c[12] ?? '') ?? 8;
        row.rounding = roundOf(c[13] ?? '') ?? 'ceil';
        row.minDays = num(c[14] ?? '') ?? 0;
      }
      return row;
    });
}

// ---------------------------------------------------------------- assignments

export const ASSIGNMENT_HEAD = ['Group', 'Phase', 'Rate', 'Days', 'Crew', 'Calendar', 'Priority', 'Rebar rate'];

export const assignmentsToTsv = (rows: Assignment[]) =>
  [ASSIGNMENT_HEAD.join('\t'), ...rows.map((r) => [r.group, r.phase, out(r.rate), out(r.days), out(r.crew), out(r.calendar), out(r.priority), out(r.density)].join('\t'))].join('\n');

export function parseAssignmentsPaste(text: string): Assignment[] {
  return lines(text)
    .map(cells)
    .filter((c) => !/^group$/i.test(c[0] ?? '') && (c[0] || c[1]))
    .map((c): Assignment => {
      const row: Assignment = { id: '', group: c[0] ?? '', phase: c[1] ?? '' };
      row.id = assignmentKey(row);
      if (c[2]) row.rate = c[2];
      if (num(c[3] ?? '') !== undefined) row.days = num(c[3]!);
      if (c[4]) row.crew = c[4];
      if (c[5]) row.calendar = c[5];
      if (num(c[6] ?? '') !== undefined) row.priority = num(c[6]!);
      if (c[7]) row.density = c[7];
      return row;
    });
}

// ---------------------------------------------------------------- chains

export const CHAIN_HEAD = ['Group', 'Order', 'Phase', 'Suffix', 'Name', 'Material', 'Follows', 'Finish after', 'Gates', 'Priority'];

export const chainsToTsv = (rows: ChainRow[]) =>
  [CHAIN_HEAD.join('\t'), ...rows.map((r) => [r.group, r.order, r.phase, out(r.suffix), out(r.label), out(r.material), out(r.follows), r.finishAfter ? 'yes' : '', r.gates ? 'yes' : '', out(r.priority)].join('\t'))].join('\n');

export function parseChainsPaste(text: string): ChainRow[] {
  return lines(text)
    .map(cells)
    .filter((c) => !/^group$/i.test(c[0] ?? '') && c[2])
    .map((c, i): ChainRow => {
      const row: ChainRow = { id: `${c[0] ?? ''}|${c[2]}`.toUpperCase(), group: c[0] ?? '', order: num(c[1] ?? '') ?? i + 1, phase: c[2] };
      if (c[3]) row.suffix = c[3];
      if (c[4]) row.label = c[4];
      if (/^reb/i.test(c[5] ?? '')) row.material = 'rebar';
      else if (/^conc/i.test(c[5] ?? '')) row.material = 'concrete';
      if (c[6]) row.follows = c[6];
      if (/^(y|true|1|x)/i.test(c[7] ?? '')) row.finishAfter = true;
      if (/^(y|true|1|x)/i.test(c[8] ?? '')) row.gates = true;
      if (num(c[9] ?? '') !== undefined) row.priority = num(c[9]!);
      return row;
    });
}

/** What an assignment names that the tables do not have: its group, rate, crew or calendar. */
export function assignmentProblems(a: Assignment, known: { groups: Set<string>; rates: Set<string>; crews: Set<string>; calendars: Set<string> }): string[] {
  const p: string[] = [];
  const has = (set: Set<string>, v: string | undefined) => !v || set.has(v.trim().toUpperCase());
  if (!a.phase.trim() && !(a.calendar && !a.rate && !a.density && a.days === undefined && !a.crew)) p.push('A phase is needed'); // (only a calendar: every phase of the group)
  if (a.group.trim() && !has(known.groups, a.group)) p.push(`The group "${a.group}" does not exist`);
  if (!has(known.rates, a.rate)) p.push(`The rate "${a.rate}" does not exist`);
  if (!has(known.rates, a.density)) p.push(`The rebar rate "${a.density}" does not exist`);
  if (!has(known.crews, a.crew)) p.push(`The crew "${a.crew}" does not exist`);
  if (a.calendar && known.calendars.size && !has(known.calendars, a.calendar)) p.push(`The calendar "${a.calendar}" does not exist`);
  if (!a.rate && !a.density && a.days === undefined && !a.crew && !a.calendar) p.push('Gives nothing: set a rate, days, a crew or a calendar');
  return p;
}
