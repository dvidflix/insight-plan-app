import { getCalendar, type ScheduleCalendar, type WorkingCalendar } from './calendar';
import type { Activity, ResourceAssignment, ResourceInfo } from './types';

/** Time-phased resource demand, the app's version of the "Loading" sheet in
    Labour_Resource_Assignment_and_Levelling.xlsx: each activity puts its
    crew on every working day from its start to its finish, and demand is
    summed per resource per day. Labour is counted in people (crew size);
    materials and equipment in their own units, spread evenly over the
    activity's working days. Resources are keyed by name, so the same trade
    in several loaded programmes adds up. */

export const DAY_MS = 86_400_000;

export interface LoadedResource {
  name: string;
  type: ResourceAssignment['resourceType'];
  /** People per day from the programme (labour), null if unknown. */
  fileCapacity: number | null;
  /** App-only resource: shown here, never exported. */
  virtual?: boolean;
}

/** One activity's share of the loading. */
export interface ActivitySpan {
  activity: Activity;
  /** Day indexes (from `origin`) the activity works on. */
  days: number[];
  /** Per resource name: people per day (labour) or quantity per day. */
  perDay: Map<string, number>;
}

export interface ResourceLoading {
  /** Local midnight of day index 0. */
  origin: Date;
  dayCount: number;
  resources: LoadedResource[];
  /** Per resource name, one value per day. */
  demand: Map<string, Float64Array>;
  spans: ActivitySpan[];
}

export type DateBasis = 'current' | 'planned';

export const startOf = (a: Activity, basis: DateBasis) =>
  a.actualStart ?? (basis === 'planned' ? a.targetStart ?? a.earlyStart : a.earlyStart ?? a.targetStart);
export const finishOf = (a: Activity, basis: DateBasis) =>
  a.actualFinish ?? (basis === 'planned' ? a.targetFinish ?? a.earlyFinish : a.earlyFinish ?? a.targetFinish);

export const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const dayIndex = (origin: Date, d: Date) => Math.round((midnight(d).getTime() - origin.getTime()) / DAY_MS);
export const dateOfDay = (origin: Date, day: number) => {
  const d = new Date(origin.getTime());
  d.setDate(d.getDate() + day);
  return d;
};

/** The working days (as day indexes) an activity occupies between its start
    and finish dates, on its calendar. A finish at exactly midnight doesn't
    count that day; an activity on no working day at all keeps its start day. */
export function workingDaysOf(origin: Date, start: Date, finish: Date, cal: WorkingCalendar): number[] {
  const first = dayIndex(origin, start);
  let last = dayIndex(origin, finish);
  if (last > first && finish.getHours() === 0 && finish.getMinutes() === 0) last--;
  const days: number[] = [];
  for (let d = first; d <= last; d++) if (cal.isWorkingDay(dateOfDay(origin, d))) days.push(d);
  return days.length ? days : [first];
}

/** People per day for a labour assignment: its crew size when the source
    gives one, else its hours ÷ (working days × hours per day). */
export function crewOf(r: ResourceAssignment, workingDays: number, hoursPerDay: number): number {
  if (r.unitsPerTime && r.unitsPerTime > 0) return r.unitsPerTime;
  return workingDays > 0 ? r.targetQty / (workingDays * hoursPerDay) : 0;
}

/** `origin`: day 0 to use (so two loadings — e.g. before and after
    levelling — share day indexes); defaults to the earliest start. */
export function buildLoading(activities: Activity[], catalog: ResourceInfo[], calendars: ScheduleCalendar[], basis: DateBasis, fixedOrigin?: Date): ResourceLoading {
  const calendarsById = new Map(calendars.map((c) => [c.id, c]));
  const dated = activities.filter((a) => startOf(a, basis) && finishOf(a, basis) && a.resources.length > 0);
  const origin = fixedOrigin ?? (dated.length ? midnight(new Date(Math.min(...dated.map((a) => startOf(a, basis)!.getTime())))) : midnight(new Date()));

  const resources = new Map<string, LoadedResource>();
  for (const r of catalog) if (!resources.has(r.name)) resources.set(r.name, { name: r.name, type: r.type, fileCapacity: r.capacity, virtual: r.virtual });

  const spans: ActivitySpan[] = [];
  let lastDay = 0;
  for (const activity of dated) {
    const cal = getCalendar(activity.calendarId, calendarsById);
    const days = workingDaysOf(origin, startOf(activity, basis)!, finishOf(activity, basis)!, cal).filter((d) => d >= 0);
    if (!days.length) continue;
    const perDay = new Map<string, number>();
    for (const r of activity.resources) {
      if (!resources.has(r.resourceName)) resources.set(r.resourceName, { name: r.resourceName, type: r.resourceType, fileCapacity: null, virtual: r.virtual });
      const amount = r.resourceType === 'labor' ? crewOf(r, days.length, cal.hoursPerDay) : r.targetQty / days.length;
      if (amount > 0 || r.virtual) perDay.set(r.resourceName, (perDay.get(r.resourceName) ?? 0) + amount);
    }
    if (!perDay.size) continue;
    spans.push({ activity, days, perDay });
    lastDay = Math.max(lastDay, days[days.length - 1]);
  }

  const dayCount = lastDay + 1;
  const demand = new Map<string, Float64Array>();
  for (const span of spans) {
    for (const [name, amount] of span.perDay) {
      let series = demand.get(name);
      if (!series) demand.set(name, (series = new Float64Array(dayCount)));
      for (const d of span.days) series[d] += amount;
    }
  }
  return { origin, dayCount, resources: [...resources.values()].filter((r) => demand.has(r.name)), demand, spans };
}

// ---- Periods and figures for the graphs ----

export type Period = 'day' | 'week' | 'month';
/** peak: people on the busiest day of the period (the day the stack is
    taken from, so trades add up to it); avg: people per weekday; hours:
    man-hours; sum: quantity (materials). */
export type Metric = 'peak' | 'avg' | 'hours' | 'sum';

export interface Bucket {
  /** First and last day index (inclusive). */
  from: number;
  to: number;
  label: string;
  long: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

/** Days (weeks from Monday, calendar months) covering the whole loading. */
export function bucketsOf(origin: Date, dayCount: number, period: Period): Bucket[] {
  const out: Bucket[] = [];
  let from = 0;
  if (period === 'week') from = -((origin.getDay() + 6) % 7);
  if (period === 'month') from = -(origin.getDate() - 1);
  while (from < dayCount) {
    const start = dateOfDay(origin, from);
    let to: number;
    if (period === 'day') to = from;
    else if (period === 'week') to = from + 6;
    else to = from + new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate() - 1;
    const label = period === 'month' ? `${MONTHS[start.getMonth()]} ${String(start.getFullYear()).slice(2)}` : `${start.getDate()} ${MONTHS[start.getMonth()]}`;
    const long = period === 'day' ? fmtDay(start) : period === 'week' ? `Week of ${fmtDay(start)}` : `${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
    out.push({ from, to, label, long });
    from = to + 1;
  }
  return out;
}

export interface BucketFigures {
  /** Per resource name. */
  values: Map<string, number>;
  total: number;
  /** Day with the highest total demand (peak metric's source). */
  peakDay: number;
  /** Capacity-limited trades over capacity on at least one day of the period. */
  overloaded: string[];
  overDays: number;
}

export function aggregate(loading: ResourceLoading, names: string[], capacity: Map<string, number>, buckets: Bucket[], metric: Metric, hoursPerDay = 8): BucketFigures[] {
  const series = names.map((n) => [n, loading.demand.get(n)] as const).filter((x): x is readonly [string, Float64Array] => !!x[1]);
  return buckets.map(({ from, to }) => {
    let peakDay = Math.max(from, 0);
    let peak = -1;
    let weekdays = 0;
    let overDays = 0;
    const sums = new Map<string, number>(series.map(([n]) => [n, 0]));
    const over = new Set<string>();
    for (let d = Math.max(from, 0); d <= Math.min(to, loading.dayCount - 1); d++) {
      const dow = dateOfDay(loading.origin, d).getDay();
      if (dow !== 0 && dow !== 6) weekdays++;
      let total = 0;
      let dayOver = false;
      for (const [n, s] of series) {
        const v = d < s.length ? s[d] : 0;
        total += v;
        sums.set(n, sums.get(n)! + v);
        const cap = capacity.get(n);
        if (cap && v > cap + 1e-9) {
          over.add(n);
          dayOver = true;
        }
      }
      if (dayOver) overDays++;
      if (total > peak) {
        peak = total;
        peakDay = d;
      }
    }
    const values = new Map<string, number>();
    for (const [n, s] of series) {
      const sum = sums.get(n)!;
      const v = metric === 'peak' ? (peakDay < s.length ? s[peakDay] : 0) : metric === 'avg' ? sum / Math.max(weekdays, 1) : metric === 'hours' ? sum * hoursPerDay : sum;
      values.set(n, v);
    }
    const total = [...values.values()].reduce((a, b) => a + b, 0);
    return { values, total, peakDay, overloaded: names.filter((n) => over.has(n)), overDays };
  });
}

export interface LoadingKpis {
  peak: number;
  peakDate: Date | null;
  capacity: number;
  overDays: number;
  /** Largest daily excess over capacity (people, summed over trades). */
  peakOverload: number;
  /** Highest demand ÷ capacity of any trade on any day. */
  peakUtilisation: number;
  manHours: number;
  manDays: number;
}

export function kpisOf(loading: ResourceLoading, names: string[], capacity: Map<string, number>, hoursPerDay = 8): LoadingKpis {
  const series = names.map((n) => [n, loading.demand.get(n)] as const).filter((x): x is readonly [string, Float64Array] => !!x[1]);
  let peak = 0;
  let peakDay = -1;
  let overDays = 0;
  let peakOverload = 0;
  let peakUtilisation = 0;
  let manDays = 0;
  for (let d = 0; d < loading.dayCount; d++) {
    let total = 0;
    let excess = 0;
    for (const [n, s] of series) {
      const v = d < s.length ? s[d] : 0;
      total += v;
      const cap = capacity.get(n);
      if (cap) {
        excess += Math.max(0, v - cap);
        peakUtilisation = Math.max(peakUtilisation, v / cap);
      }
    }
    manDays += total;
    if (excess > 1e-9) overDays++;
    peakOverload = Math.max(peakOverload, excess);
    if (total > peak) {
      peak = total;
      peakDay = d;
    }
  }
  return {
    peak,
    peakDate: peakDay >= 0 ? dateOfDay(loading.origin, peakDay) : null,
    capacity: names.reduce((sum, n) => sum + (capacity.get(n) ?? 0), 0),
    overDays,
    peakOverload,
    peakUtilisation,
    manHours: manDays * hoursPerDay,
    manDays,
  };
}

// ---- Concrete pours ----

export interface PourFigures {
  /** Pours whose first working day falls in the period. */
  count: number;
  /** Their concrete quantity (the resource's own unit, m³). */
  volume: number;
}

/** Concrete pours per period: every activity carrying one of the `names`
    resources is a pour, counted in the period its first working day falls in. */
export function pourCounts(loading: ResourceLoading, names: string[], buckets: Bucket[]): PourFigures[] {
  const out: PourFigures[] = buckets.map(() => ({ count: 0, volume: 0 }));
  if (!out.length) return out;
  const wanted = new Set(names);
  for (const span of loading.spans) {
    let qty = 0;
    let hit = false;
    for (const [n, perDay] of span.perDay) {
      if (!wanted.has(n)) continue;
      hit = true;
      qty += perDay * span.days.length;
    }
    if (!hit) continue;
    const day = span.days[0];
    const i = buckets.findIndex((b) => day >= b.from && day <= b.to);
    if (i < 0) continue;
    out[i].count += 1;
    out[i].volume += qty;
  }
  return out;
}

// ---- Totals per WBS ----

/** Amount of each resource an activity uses over its whole duration:
    man-hours for labour, the resource's own unit otherwise. */
export function totalsOfSpan(span: ActivitySpan, labour: Set<string>, hoursPerDay = 8): Map<string, number> {
  const out = new Map<string, number>();
  for (const [n, perDay] of span.perDay) out.set(n, perDay * span.days.length * (labour.has(n) ? hoursPerDay : 1));
  return out;
}
