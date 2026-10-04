import type { Activity } from './types';
import type { ColumnCtx, ColumnDef } from './columns';
import { getCalendar, workingDaysBetween } from './calendar';

/** How a column is summarised in the totals row and group subtotals. */
export type AggKind = 'none' | 'sum' | 'avg' | 'min' | 'max' | 'count' | 'earliest' | 'latest' | 'spanCal' | 'spanWork';

export const NUMBER_AGGS: { id: AggKind; label: string; short: string }[] = [
  { id: 'none', label: 'None', short: '' },
  { id: 'sum', label: 'Sum', short: 'Σ' },
  { id: 'avg', label: 'Average', short: 'avg' },
  { id: 'min', label: 'Minimum', short: 'min' },
  { id: 'max', label: 'Maximum', short: 'max' },
  { id: 'count', label: 'Count (with a value)', short: 'n' },
];

export const DATE_AGGS: { id: AggKind; label: string; short: string }[] = [
  { id: 'none', label: 'None', short: '' },
  { id: 'earliest', label: 'Earliest', short: 'min' },
  { id: 'latest', label: 'Latest', short: 'max' },
  { id: 'spanCal', label: 'Span (calendar days)', short: 'cal d' },
  { id: 'spanWork', label: 'Span (working days)', short: 'wk d' },
  { id: 'count', label: 'Count (with a date)', short: 'n' },
];

/** 'num' / 'date' for columns that can be summarised, else null. */
export function aggType(c: ColumnDef): 'num' | 'date' | null {
  return c.value ? 'num' : c.dateValue ? 'date' : null;
}

export function aggOptions(c: ColumnDef) {
  const t = aggType(c);
  return t === 'num' ? NUMBER_AGGS : t === 'date' ? DATE_AGGS : [];
}

/** Summable columns (units, cost) add up unless set otherwise. */
export function defaultAgg(c: ColumnDef): AggKind {
  return c.summable ? 'sum' : 'none';
}

const fmtNum = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });

/** The column summarised over `acts` with `kind`, formatted ('' for none). */
export function aggregate(c: ColumnDef, kind: AggKind, acts: Activity[], ctx: ColumnCtx): string {
  if (kind === 'none' || acts.length === 0) return '';
  if (c.value) {
    const vals = acts.map((a) => c.value!(a, ctx)).filter((v): v is number => v !== null && Number.isFinite(v));
    if (kind === 'count') return fmtNum(vals.length);
    if (!vals.length) return '';
    if (kind === 'sum') return fmtNum(vals.reduce((s, v) => s + v, 0));
    if (kind === 'avg') return fmtNum(vals.reduce((s, v) => s + v, 0) / vals.length);
    if (kind === 'min') return fmtNum(Math.min(...vals));
    if (kind === 'max') return fmtNum(Math.max(...vals));
    return '';
  }
  if (c.dateValue) {
    const dated = acts.map((a) => [a, c.dateValue!(a)] as const).filter((x): x is readonly [Activity, Date] => !!x[1]);
    if (kind === 'count') return fmtNum(dated.length);
    if (!dated.length) return '';
    let lo = dated[0][1];
    let hi = dated[0][1];
    for (const [, d] of dated) {
      if (d < lo) lo = d;
      if (d > hi) hi = d;
    }
    if (kind === 'earliest') return fmtDate(lo);
    if (kind === 'latest') return fmtDate(hi);
    if (kind === 'spanCal') return `${fmtNum(Math.round((hi.getTime() - lo.getTime()) / 86400000))} d`;
    if (kind === 'spanWork') {
      // The calendar most of the activities use.
      const tally = new Map<string | null, number>();
      for (const [a] of dated) tally.set(a.calendarId, (tally.get(a.calendarId) ?? 0) + 1);
      const calendarId = [...tally].sort((x, y) => y[1] - x[1])[0][0];
      const days = workingDaysBetween(lo, hi, getCalendar(calendarId, ctx.calendarsById ?? new Map()));
      return days === null ? '' : `${fmtNum(days)} wd`;
    }
  }
  return '';
}
