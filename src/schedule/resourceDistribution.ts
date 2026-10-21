import { aggregate, type Bucket, type LoadedResource, type Metric, type ResourceLoading } from './resourceLoading';

/** Resource distribution: the quantity of each resource in each period, as a
    table (the Gantt's time scale with numbers in place of bars). It is built
    on the same daily loading as the Resources graphs, so the two always
    agree. Labour is shown as man-hours, people on the busiest day, or people
    per weekday; equipment as the most in use at once; materials as the
    quantity used. */

export type LabourMeasure = 'hours' | 'peak' | 'avg';
export type ResourceKind = 'labour' | 'equipment' | 'materials';

export const KIND_LABEL: Record<ResourceKind, string> = { labour: 'Labour', equipment: 'Equipment', materials: 'Materials' };

/** The same split the Resources view makes: counted equipment and cranes have a pool in the programme, the rest is quantities. */
export const kindOf = (r: LoadedResource): ResourceKind => (r.type === 'labor' ? 'labour' : !r.virtual && r.fileCapacity !== null ? 'equipment' : 'materials');

export const metricOf = (kind: ResourceKind, labour: LabourMeasure): Metric => (kind === 'labour' ? labour : kind === 'equipment' ? 'peak' : 'sum');
/** Hours and quantities add up over time; people and "in use" do not (their total is the highest period). */
export const addsUp = (metric: Metric) => metric === 'hours' || metric === 'sum';

const unitOf = (name: string) => /\(([^)]+)\)\s*$/.exec(name)?.[1] ?? '';
export const shortName = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '');

export interface DistRow {
  key: string;
  label: string;
  /** 0 = a group (Labour…), 1 = a resource, 2 = a WBS level under a resource. */
  depth: 0 | 1 | 2;
  unit: string;
  /** One value per bucket. Empty for a group with nothing to add up. */
  values: number[];
  /** The figures add up over time (hours, quantities), so they can run cumulative; people and equipment in use are peaks and cannot. */
  adds: boolean;
  /** Over all periods: the sum, or the highest period when the figures are people / in use. */
  total: number;
  /** Rows under this one (the WBS levels of a resource, or the resources of a group). */
  children: DistRow[];
}

const sumOf = (v: number[]) => v.reduce((n, x) => n + x, 0);
const maxOf = (v: number[]) => v.reduce((n, x) => Math.max(n, x), 0);

/** The figures of one daily series, period by period. */
function periodValues(loading: ResourceLoading, series: Float64Array, buckets: Bucket[], metric: Metric, hoursPerDay: number): number[] {
  const alone: ResourceLoading = { origin: loading.origin, dayCount: loading.dayCount, resources: [], demand: new Map([['x', series]]), spans: [] };
  return aggregate(alone, ['x'], new Map(), buckets, metric, hoursPerDay).map((f) => f.values.get('x') ?? 0);
}

const wbsAt = (path: string, depth: number) => path.split(' / ').filter(Boolean).slice(0, depth).join(' / ') || '(no WBS)';
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** The groups (Labour, Equipment, Materials) with a row per resource and, when
    `wbsDepth` is above 0, a row per WBS level (cut at that depth) under each. */
export function buildDistribution(loading: ResourceLoading, buckets: Bucket[], labour: LabourMeasure, wbsDepth: number, hoursPerDay = 8): DistRow[] {
  const groups: DistRow[] = [];
  for (const kind of ['labour', 'equipment', 'materials'] as const) {
    const metric = metricOf(kind, labour);
    const total = (values: number[]) => (addsUp(metric) ? sumOf(values) : maxOf(values));
    const resources = loading.resources.filter((r) => kindOf(r) === kind);
    if (!resources.length) continue;

    const rows = resources.map((r): DistRow => {
      const series = loading.demand.get(r.name) ?? new Float64Array(loading.dayCount);
      const values = periodValues(loading, series, buckets, metric, hoursPerDay);
      const children: DistRow[] = [];
      if (wbsDepth > 0) {
        const byPath = new Map<string, Float64Array>();
        for (const span of loading.spans) {
          const amount = span.perDay.get(r.name);
          if (amount === undefined) continue;
          const path = wbsAt(span.activity.wbsPath, wbsDepth);
          let s = byPath.get(path);
          if (!s) byPath.set(path, (s = new Float64Array(loading.dayCount)));
          for (const d of span.days) s[d] += amount;
        }
        for (const path of [...byPath.keys()].sort(byName)) {
          const v = periodValues(loading, byPath.get(path)!, buckets, metric, hoursPerDay);
          children.push({ key: `${r.name}\u0001${path}`, label: path, depth: 2, unit: '', adds: addsUp(metric), values: v, total: total(v), children: [] });
        }
      }
      const unit = kind === 'labour' ? (labour === 'hours' ? 'man-hours' : 'people') : kind === 'equipment' ? 'in use' : unitOf(r.name);
      return { key: r.name, label: `${r.virtual ? '◇ ' : ''}${shortName(r.name)}`, depth: 1, unit, adds: addsUp(metric), values, total: total(values), children };
    });

    // Labour adds up across trades (people on the busiest day of each period, so the trades sum to it); the others are different things.
    const sums = kind === 'labour' ? aggregate(loading, resources.map((r) => r.name), new Map(), buckets, metric, hoursPerDay).map((f) => f.total) : [];
    groups.push({
      key: `group:${kind}`,
      label: KIND_LABEL[kind],
      depth: 0,
      unit: kind === 'labour' ? (labour === 'hours' ? 'man-hours' : 'people') : '',
      adds: addsUp(metric),
      values: sums,
      total: sums.length ? total(sums) : 0,
      children: rows,
    });
  }
  return groups;
}
