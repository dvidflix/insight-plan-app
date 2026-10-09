import type { Activity, ScheduleModel } from './types';
import { dayIndex, finishOf, midnight, startOf, type DateBasis } from './resourceLoading';

/** Concrete distribution: how much concrete (m3) a programme places each week, and the running total, so programmes
    of different projects (or scenarios of one) can be laid over each other week by week. The volume is the quantity of
    the concrete resource on each activity (the "Concrete (m3)" assignment of the generated programmes, or the concrete
    material resource of a P6 file), spread evenly over the days from the activity's start to its finish. */

export interface ConcreteResource {
  name: string;
  /** Total quantity across the activities (all the programmes asked about). */
  total: number;
  /** Whether it is taken as concrete unless the user says otherwise. */
  byDefault: boolean;
  /** Whether it looks like rebar (reinforcement), for the Rebar comparison. */
  rebar: boolean;
}

/** What is compared: the concrete (m3) or the rebar (t) the programmes place. */
export type Material = 'concrete' | 'rebar';
export const MATERIAL_UNIT: Record<Material, string> = { concrete: 'm³', rebar: 't' };
export const MATERIAL_LABEL: Record<Material, string> = { concrete: 'Concrete', rebar: 'Rebar' };

/** Rebar the material, not the fixers or the gang: "Rebar (t)", "MCW - Reinforcement(T)"... */
export const isRebarByName = (name: string) => /rebar|reinforc/i.test(name) && !/gang|crew|labou?r|fixer|hours?\b|install|supply|delivery/i.test(name);

/** Concrete the material, not the gang that places it or the pump: "Concrete (m3)", "Concrete C32/40"... */
export const isConcreteByName = (name: string) => /concret|\bconc\b|\bC\d\d\/\d\d\b/i.test(name) && !/gang|crew|labour|labor|pump|hours?\b|finish|curing/i.test(name);

/** The resources that look like concrete, and the others, with their quantities. */
export function concreteResources(models: ScheduleModel[]): ConcreteResource[] {
  const totals = new Map<string, number>();
  const labour = new Set<string>();
  for (const m of models) {
    for (const a of m.activities) {
      for (const r of a.resources) {
        if (r.resourceType === 'labor') labour.add(r.resourceName);
        totals.set(r.resourceName, (totals.get(r.resourceName) ?? 0) + (r.targetQty || 0));
      }
    }
  }
  return [...totals]
    .filter(([name, total]) => total > 0 && !labour.has(name))
    .map(([name, total]) => ({ name, total, byDefault: isConcreteByName(name), rebar: isRebarByName(name) }))
    .sort((a, b) => Number(b.byDefault || b.rebar) - Number(a.byDefault || a.rebar) || a.name.localeCompare(b.name));
}

/** Terms separated by commas, semicolons or new lines; an activity matches when its ID, name, WBS or any activity code contains one of them. */
export function scopeMatcher(text: string): (a: Activity) => boolean {
  const terms = text.split(/[\n,;]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (terms.length === 0) return () => true;
  return (a) => {
    const haystack = `${a.code} ${a.name} ${a.wbsPath} ${Object.values(a.activityCodes).join(' ')}`.toLowerCase();
    return terms.some((t) => haystack.includes(t));
  };
}

export interface Pour {
  activity: Activity;
  start: Date;
  finish: Date;
  qty: number;
}

export interface ConcreteOptions {
  /** Resource names counted as concrete. */
  resources: ReadonlySet<string>;
  basis: DateBasis;
  /** Scope (see scopeMatcher); empty = the whole programme. */
  scope: string;
  /** A further test on the activity (the field filters of the programme); absent = every activity. */
  accept?: (a: Activity) => boolean;
}

/** The activities that place concrete, with their quantity and dates. */
export function pours(model: ScheduleModel, opts: ConcreteOptions): Pour[] {
  const inScope = scopeMatcher(opts.scope);
  const out: Pour[] = [];
  for (const a of model.activities) {
    let qty = 0;
    for (const r of a.resources) if (opts.resources.has(r.resourceName)) qty += r.targetQty || 0;
    if (qty <= 0 || !inScope(a) || (opts.accept && !opts.accept(a))) continue;
    const start = startOf(a, opts.basis);
    const finish = finishOf(a, opts.basis) ?? start;
    if (!start || !finish) continue;
    out.push({ activity: a, start, finish: finish < start ? start : finish, qty });
  }
  return out;
}

/** Where week 1 starts. */
export type Align = 'first' | 'start' | 'calendar';

/** The date week 1 starts on for one programme (calendar: the shared `common` date). */
export function originOf(model: ScheduleModel, items: Pour[], align: Align, common: Date | null): Date | null {
  if (items.length === 0) return null;
  const first = new Date(Math.min(...items.map((p) => p.start.getTime())));
  if (align === 'calendar') return common ? midnight(common) : midnight(first);
  if (align === 'start') {
    const planned = model.project.planStart ?? model.project.dataDate;
    return midnight(planned && planned <= first ? planned : first);
  }
  return midnight(first);
}

/** How the volume is grouped: 7-day weeks from the origin, or calendar months, quarters (Jan-Mar...) and years. */
export type Period = 'week' | 'month' | 'quarter' | 'year';
export const PERIOD_LABEL: Record<Period, string> = { week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' };

/** Index of the period a day falls in, counted from the one that holds `origin` (0 = the first). */
function periodIndex(origin: Date, dayOffset: number, period: Period): number {
  if (period === 'week') return Math.floor(dayOffset / 7);
  const d = new Date(origin.getFullYear(), origin.getMonth(), origin.getDate() + dayOffset);
  const months = (y: number, m: number) => y * 12 + m;
  const at = months(d.getFullYear(), d.getMonth());
  const from = months(origin.getFullYear(), origin.getMonth());
  if (period === 'month') return at - from;
  if (period === 'quarter') return Math.floor(at / 3) - Math.floor(from / 3);
  return d.getFullYear() - origin.getFullYear();
}

/** The date a period starts on (the first one starts at `origin` itself). */
export function periodStart(origin: Date, period: Period, index: number): Date {
  if (index <= 0) return origin;
  if (period === 'week') return new Date(origin.getFullYear(), origin.getMonth(), origin.getDate() + index * 7);
  if (period === 'month') return new Date(origin.getFullYear(), origin.getMonth() + index, 1);
  if (period === 'quarter') return new Date(origin.getFullYear(), (Math.floor(origin.getMonth() / 3) + index) * 3, 1);
  return new Date(origin.getFullYear() + index, 0, 1);
}

/** m3 per period from `origin`, each pour spread evenly over its calendar days. */
export function periodVolumes(items: Pour[], origin: Date, period: Period = 'week'): number[] {
  const out: number[] = [];
  for (const p of items) {
    const from = Math.max(0, dayIndex(origin, p.start));
    let to = dayIndex(origin, p.finish);
    // A finish at exactly midnight ends the day before (unless it is also the start).
    if (p.finish.getHours() === 0 && p.finish.getMinutes() === 0 && to > from) to -= 1;
    to = Math.max(from, to);
    const perDay = p.qty / (to - from + 1);
    for (let d = from; d <= to; d++) {
      const i = periodIndex(origin, d, period);
      while (out.length <= i) out.push(0);
      out[i] += perDay;
    }
  }
  return out;
}

export const cumulative = (weekly: number[]): number[] => {
  let run = 0;
  return weekly.map((v) => (run += v));
};

export interface ConcreteSeries {
  key: string;
  label: string;
  color: string;
  /** m3 per period (see Period). */
  volume: number[];
  cumulative: number[];
  total: number;
  pours: number;
  first: Date | null;
  last: Date | null;
  /** Date week 1 starts on. */
  origin: Date | null;
}

export function buildSeries(model: ScheduleModel, key: string, label: string, color: string, opts: ConcreteOptions, align: Align, common: Date | null, period: Period = 'week'): ConcreteSeries {
  const items = pours(model, opts);
  const origin = originOf(model, items, align, common);
  const volume = origin ? periodVolumes(items, origin, period) : [];
  const dates = items.flatMap((p) => [p.start.getTime(), p.finish.getTime()]);
  return {
    key, label, color, volume, cumulative: cumulative(volume),
    total: items.reduce((t, p) => t + p.qty, 0), pours: items.length,
    first: dates.length ? new Date(Math.min(...dates)) : null, last: dates.length ? new Date(Math.max(...dates)) : null, origin,
  };
}

/** The Monday on or before a date: where week 1 starts when programmes are compared on the calendar. */
export function mondayOnOrBefore(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
}
