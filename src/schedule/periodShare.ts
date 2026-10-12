import type { Activity } from './types';
import type { ColumnCtx, ColumnDef } from './columns';
import { basisFinish, basisStart } from './linking';
import { getCalendar } from './calendar';
import { dateOfDay, midnight, workingDaysOf, DAY_MS } from './resourceLoading';

/** The share of an activity's quantities (resource units, cost) that falls in a period: its units are spread over its
    working days (on its calendar), and the period gets the days it covers — a day only partly inside counts for the part
    that is. An activity with no usable dates, or none of its days in the period, has its whole amount counted as 1 / 0. */
export function periodShare(a: Activity, period: { start: number; end: number }, ctx: ColumnCtx, basis: 'planned' | 'actual'): number {
  const start = basisStart(a, basis);
  const finish = basisFinish(a, basis);
  if (!start || !finish) return 1;
  const origin = midnight(start);
  const days = workingDaysOf(origin, start, finish, getCalendar(a.calendarId, ctx.calendarsById ?? new Map()));
  if (days.length === 0) return 1;
  let inside = 0;
  for (const d of days) {
    const from = dateOfDay(origin, d).getTime();
    const overlap = Math.min(period.end, from + DAY_MS) - Math.max(period.start, from);
    if (overlap > 0) inside += Math.min(1, overlap / DAY_MS);
  }
  return Math.min(1, inside / days.length);
}

/** Columns that hold quantities to spread over time (resource units and costs). */
export const isSpreadColumn = (id: string) => id.startsWith('res:') || /^(budgeted|actual|remaining)(Units|Cost)$/.test(id);

/** The columns with their quantities replaced by the period's share, for a list of what is active in that period
    (the 4D Tasks list): a task running over several weeks shows its units spread, not its total each week. */
export function spreadColumns(columns: ColumnDef[], period: { start: number; end: number } | null, basis: 'planned' | 'actual'): ColumnDef[] {
  if (!period) return columns;
  return columns.map((c) => {
    if (!isSpreadColumn(c.id) || !c.value) return c;
    const value = (a: Activity, ctx: ColumnCtx) => {
      const v = c.value!(a, ctx);
      return v === null ? null : v * periodShare(a, period, ctx, basis);
    };
    return {
      ...c,
      value,
      text: (a, ctx) => {
        const v = value(a, ctx);
        return v === null || v === 0 ? '' : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
      },
      sort: (a, ctx) => value(a, ctx) ?? Number.NEGATIVE_INFINITY,
    };
  });
}
