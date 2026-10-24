/** Two versions (scenarios) of Generate 3 side by side: the figures of their generated programmes and of their packages (with the change from the
    first to the second), and the packages whose method, days, objects, place in the order, object order or criticality differ. Packages are
    matched by ID, then by name (a version made with Save as new version keeps the IDs). */

export interface VersionSide {
  name: string;
  /** The generated programme's figures, or null when it is not generated or not loaded. */
  programme: {
    days: number; activities: number; criticalShare: number; start: Date | null; finish: Date | null;
    /** The packages with an activity on the critical path (their IDs), when the programme says which activity is whose. */
    criticalPackages?: string[];
  } | null;
  packages: {
    id: string; code: string; name: string; method: string; days: number; objects: number; volume: number; fineTuned: boolean;
    /** Stand for which objects it holds and for its object order: equal keys, same objects (in the same order). */
    objectsKey?: string; orderKey?: string;
  }[];
}

/** One figure of each version; `delta` is the second less the first ('' when they are the same or not numbers). */
export interface FigureRow { label: string; a: string; b: string; delta: string; differs: boolean }
export interface PackageDiff {
  name: string; codeA: string; codeB: string; methodA: string; methodB: string; daysA: number | null; daysB: number | null; what: string;
  /** Whether it is on the critical path in each version (null: not known there). */
  criticalA: boolean | null; criticalB: boolean | null;
}

const n = (v: number, d = 0) => v.toLocaleString(undefined, { maximumFractionDigits: d });
const date = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '');

export function compareVersions(a: VersionSide, b: VersionSide): { figures: FigureRow[]; packages: PackageDiff[] } {
  const live = (s: VersionSide) => s.packages.filter((p) => p.objects > 0);
  const sum = (s: VersionSide, f: (p: VersionSide['packages'][number]) => number) => live(s).reduce((k, p) => k + f(p), 0);
  const prog = (s: VersionSide, f: (p: NonNullable<VersionSide['programme']>) => string) => (s.programme ? f(s.programme) : 'not generated');
  const num = (s: VersionSide, f: (p: NonNullable<VersionSide['programme']>) => number) => (s.programme ? f(s.programme) : null);
  const critA = a.programme?.criticalPackages ? new Set(a.programme.criticalPackages) : null;
  const critB = b.programme?.criticalPackages ? new Set(b.programme.criticalPackages) : null;
  const onPath = (s: VersionSide, crit: Set<string>) => live(s).filter((p) => crit.has(p.id)).length;
  // A figure: its label, its text in each version, and (when it is a number) its value in each and the unit and digits of the change.
  type Row = [label: string, a: string, b: string, an: number | null, bn: number | null, unit: string, digits: number];
  const rows: Row[] = [
    ['Length', prog(a, (p) => `${n(p.days / 7, 1)} weeks`), prog(b, (p) => `${n(p.days / 7, 1)} weeks`), num(a, (p) => p.days / 7), num(b, (p) => p.days / 7), ' weeks', 1],
    ['Dates', prog(a, (p) => `${date(p.start)} to ${date(p.finish)}`), prog(b, (p) => `${date(p.start)} to ${date(p.finish)}`), null, null, '', 0],
    ['Activities', prog(a, (p) => n(p.activities)), prog(b, (p) => n(p.activities)), num(a, (p) => p.activities), num(b, (p) => p.activities), '', 0],
    ['Critical', prog(a, (p) => `${Math.round(p.criticalShare * 100)}%`), prog(b, (p) => `${Math.round(p.criticalShare * 100)}%`), num(a, (p) => Math.round(p.criticalShare * 100)), num(b, (p) => Math.round(p.criticalShare * 100)), ' points', 0],
    ...(critA && critB ? [['Packages on the critical path', n(onPath(a, critA)), n(onPath(b, critB)), onPath(a, critA), onPath(b, critB), '', 0] as Row] : []),
    ['Packages with objects', n(live(a).length), n(live(b).length), live(a).length, live(b).length, '', 0],
    ['Objects in packages', n(sum(a, (p) => p.objects)), n(sum(b, (p) => p.objects)), sum(a, (p) => p.objects), sum(b, (p) => p.objects), '', 0],
    ['Volume in packages', `${n(sum(a, (p) => p.volume))} m³`, `${n(sum(b, (p) => p.volume))} m³`, sum(a, (p) => p.volume), sum(b, (p) => p.volume), ' m³', 0],
    ['Packages built object by object', n(live(a).filter((p) => p.fineTuned).length), n(live(b).filter((p) => p.fineTuned).length), live(a).filter((p) => p.fineTuned).length, live(b).filter((p) => p.fineTuned).length, '', 0],
  ];
  const change = (x: number | null, y: number | null, unit: string, d: number) => {
    if (x === null || y === null) return '';
    const v = Number((y - x).toFixed(d));
    return v === 0 ? '' : `${v > 0 ? '+' : '−'}${n(Math.abs(v), d)}${unit}`;
  };
  const figures = rows.map(([label, x, y, xn, yn, unit, d]) => ({ label, a: x, b: y, delta: change(xn, yn, unit, d), differs: x !== y }));
  const isCrit = (set: Set<string> | null, id: string) => (set ? set.has(id) : null);
  const used = new Set<string>();
  const find = (p: VersionSide['packages'][number]) => {
    const hit = b.packages.find((q) => !used.has(q.id) && q.id === p.id && q.name.trim().toUpperCase() === p.name.trim().toUpperCase())
      ?? b.packages.find((q) => !used.has(q.id) && q.name.trim().toUpperCase() === p.name.trim().toUpperCase())
      ?? b.packages.find((q) => !used.has(q.id) && q.id === p.id);
    if (hit) used.add(hit.id);
    return hit;
  };
  const packages: PackageDiff[] = [];
  for (const p of a.packages) {
    const q = find(p);
    if (!q) { if (p.objects) packages.push({ name: p.name, codeA: p.code, codeB: '', methodA: p.method, methodB: '', daysA: p.days, daysB: null, what: `only in ${a.name}`, criticalA: isCrit(critA, p.id), criticalB: null }); continue; }
    const ca = isCrit(critA, p.id);
    const cb = isCrit(critB, q.id);
    const objectsDiffer = p.objects !== q.objects || (p.objectsKey !== undefined && q.objectsKey !== undefined && p.objectsKey !== q.objectsKey);
    const what = [
      p.method !== q.method ? 'method' : '',
      Math.abs(p.days - q.days) > 0.01 ? 'days' : '',
      objectsDiffer ? 'objects' : '',
      p.code !== q.code ? 'place in the order' : '',
      p.fineTuned !== q.fineTuned || (p.orderKey ?? '') !== (q.orderKey ?? '') ? 'object order' : '',
      ca !== null && cb !== null && ca !== cb ? `critical only in ${ca ? a.name : b.name}` : '',
    ].filter(Boolean);
    if (what.length) packages.push({ name: p.name, codeA: p.code, codeB: q.code, methodA: p.method, methodB: q.method, daysA: p.days, daysB: q.days, what: what.join(', '), criticalA: ca, criticalB: cb });
  }
  for (const q of b.packages) if (!used.has(q.id) && q.objects) packages.push({ name: q.name, codeA: '', codeB: q.code, methodA: '', methodB: q.method, daysA: null, daysB: q.days, what: `only in ${b.name}`, criticalA: null, criticalB: isCrit(critB, q.id) });
  return { figures, packages };
}
