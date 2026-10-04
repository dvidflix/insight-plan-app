import type { DateRange } from './linking';

/** Overlay label templating — same mini-language as Navisworks TimeLiner's
    text overlay format, since that's the reference vocabulary this feature
    is styled after: literal text in "double quotes", {tokens} for computed
    values, \p for a line break, \t for a tab. Text outside quotes/tokens is
    still emitted literally so a template typed without quotes ("Week "
    {ProjectWeek} works fine, not just the strict quoted form. */

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

/** Longest alternatives first within each family so e.g. "dddd" doesn't get
    eaten by the "dd" case first. */
const DATE_TOKEN_RE = /dddd|ddd|dd|d(?!\w)|mmmm|mmm|mm|m(?!\w)|yyyy|yy/g;

function formatDatePattern(date: Date, pattern: string): string {
  return pattern.replace(DATE_TOKEN_RE, (match) => {
    switch (match) {
      case 'yyyy': return String(date.getFullYear());
      case 'yy': return pad2(date.getFullYear() % 100);
      case 'mmmm': return MONTH_LONG[date.getMonth()];
      case 'mmm': return MONTH_SHORT[date.getMonth()];
      case 'mm': return pad2(date.getMonth() + 1);
      case 'm': return String(date.getMonth() + 1);
      case 'dddd': return DAY_LONG[date.getDay()];
      case 'ddd': return DAY_SHORT[date.getDay()];
      case 'dd': return pad2(date.getDate());
      case 'd': return String(date.getDate());
      default: return match;
    }
  });
}

/** ISO-8601 week number (1-53) of the calendar year `date` falls in —
    what most people mean by "week 12", independent of the project. */
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

const DAY_MS = 86400000;

export interface LabelContext {
  date: Date;
  /** Whole schedule window — {ProjectWeek} counts weeks from its start,
      regardless of which basis/step-unit the scrubber is using. */
  range: DateRange;
  /** The playback step the cursor is in ([start, end)), for {PeriodStart} /
      {PeriodEnd} — e.g. the Monday and Sunday of the week when stepping weekly. */
  period?: { start: number; end: number };
}

function resolveToken(token: string, ctx: LabelContext): string {
  let trimmed = token.trim();
  // A trailing day offset shifts the date first: {dd/mm/yyyy -6d}, {PeriodEnd:dd mmm +1d}.
  let offsetDays = 0;
  const offset = /\s*([+-]\d+)\s*d$/i.exec(trimmed);
  if (offset) {
    offsetDays = Number(offset[1]);
    trimmed = trimmed.slice(0, offset.index).trim();
  }
  const shift = (d: Date) => (offsetDays ? new Date(d.getTime() + offsetDays * DAY_MS) : d);
  // {PeriodStart} / {PeriodEnd}[:pattern] — first / last day of the current step.
  const periodTok = /^period(start|end)(?::(.+))?$/i.exec(trimmed);
  if (periodTok) {
    const p = ctx.period ?? { start: ctx.date.getTime(), end: ctx.date.getTime() + 1 };
    const d = periodTok[1].toLowerCase() === 'start' ? new Date(p.start) : new Date(p.end - 1);
    return formatDatePattern(shift(d), periodTok[2]?.trim() || 'dd/mm/yyyy');
  }
  if (offsetDays) return formatDatePattern(shift(ctx.date), trimmed);
  if (/^projectweek$/i.test(trimmed)) {
    return String(Math.floor((ctx.date.getTime() - ctx.range.min) / (DAY_MS * 7)) + 1);
  }
  // Months since the schedule start: month 1 runs from the start date to the
  // same day of the next month (like {ProjectWeek} counts 7-day blocks).
  if (/^projectmonth$/i.test(trimmed)) {
    const start = new Date(ctx.range.min);
    const d = ctx.date;
    let months = (d.getFullYear() - start.getFullYear()) * 12 + (d.getMonth() - start.getMonth());
    if (d.getDate() < start.getDate()) months -= 1;
    return String(Math.max(0, months) + 1);
  }
  if (/^yearweek$/i.test(trimmed)) {
    return String(isoWeekNumber(ctx.date));
  }
  if (/^time$/i.test(trimmed)) {
    return `${pad2(ctx.date.getHours())}:${pad2(ctx.date.getMinutes())}`;
  }
  // Anything else is treated as a date-format pattern (dd mmm yyyy, dd/mm/yy, …).
  return formatDatePattern(ctx.date, trimmed);
}

/** Renders a template string against the current 4D cursor date. Available
    tokens: {ProjectWeek}, {ProjectMonth}, {YearWeek}, and any date pattern built from
    yyyy/yy, mmmm/mmm/mm/m, dddd/ddd/dd/d (e.g. {dd mmm yyyy}, {dd/mm/yy}).
    \p breaks to a new line, \t inserts a tab. */
export function renderLabelTemplate(template: string, ctx: LabelContext): string {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch === '"') {
      const end = template.indexOf('"', i + 1);
      out += end === -1 ? template.slice(i + 1) : template.slice(i + 1, end);
      i = end === -1 ? template.length : end + 1;
    } else if (ch === '{') {
      const end = template.indexOf('}', i + 1);
      if (end === -1) {
        out += ch;
        i++;
      } else {
        out += resolveToken(template.slice(i + 1, end), ctx);
        i = end + 1;
      }
    } else if (template.startsWith('\\p', i)) {
      out += '\n';
      i += 2;
    } else if (template.startsWith('\\t', i)) {
      out += '\t';
      i += 2;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

/** Ready-made date label templates (Label tab > Date label > Preset). */
export const LABEL_PRESETS: { label: string; template: string }[] = [
  { label: 'Project week + week commencing', template: '"Project Week: "{ProjectWeek}\\p"Week commencing: "{dd/mm/yyyy}' },
  { label: 'Project week + date', template: '"Project Week: "{ProjectWeek}\\p{dd/mm/yyyy}' },
  { label: 'Project month + project week', template: '"Project Month: "{yyyy}" - "{ProjectMonth}\\p"Project Week: "{ProjectWeek}' },
];

export const DEFAULT_LABEL_TEMPLATE = '"Week: "{ProjectWeek}\\p"Week commencing: "{PeriodStart:dd/mm/yy}';

export const LABEL_TOKEN_HELP: { token: string; description: string }[] = [
  { token: '{ProjectWeek}', description: 'Week number since the schedule start' },
  { token: '{ProjectMonth}', description: 'Month number since the schedule start' },
  { token: '{YearWeek}', description: 'ISO calendar week number' },
  { token: '{dd mmm yyyy}', description: 'e.g. 05 Mar 2026' },
  { token: '{dd/mm/yy}', description: 'e.g. 05/03/26' },
  { token: '{dddd}', description: 'Weekday name, e.g. Thursday' },
  { token: '{Time}', description: 'Time of day, e.g. 14:00 (for hourly steps)' },
  { token: '{PeriodStart:dd/mm/yyyy}', description: 'First day of the current step — the Monday when stepping weekly' },
  { token: '{PeriodEnd:dd/mm/yyyy}', description: 'Last day of the current step — the Sunday when stepping weekly' },
  { token: '{dd/mm/yyyy -6d}', description: 'Any date shifted by whole days (+ or −)' },
  { token: '\\p', description: 'Line break' },
];
