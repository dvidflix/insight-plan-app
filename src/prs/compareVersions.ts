/** Two versions (scenarios) of Generate 3 side by side: the figures of their generated programmes and of their packages, and the packages whose
    method or days differ. Packages are matched by ID, then by name (a version made with Save as new version keeps the IDs). */

export interface VersionSide {
  name: string;
  /** The generated programme's figures, or null when it is not generated or not loaded. */
  programme: { days: number; activities: number; criticalShare: number; start: Date | null; finish: Date | null } | null;
  packages: { id: string; code: string; name: string; method: string; days: number; objects: number; volume: number; fineTuned: boolean }[];
}

export interface FigureRow { label: string; a: string; b: string; differs: boolean }
export interface PackageDiff { name: string; codeA: string; codeB: string; methodA: string; methodB: string; daysA: number | null; daysB: number | null; what: string }

const n = (v: number, d = 0) => v.toLocaleString(undefined, { maximumFractionDigits: d });
const date = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '');

export function compareVersions(a: VersionSide, b: VersionSide): { figures: FigureRow[]; packages: PackageDiff[] } {
  const live = (s: VersionSide) => s.packages.filter((p) => p.objects > 0);
  const sum = (s: VersionSide, f: (p: VersionSide['packages'][number]) => number) => live(s).reduce((k, p) => k + f(p), 0);
  const prog = (s: VersionSide, f: (p: NonNullable<VersionSide['programme']>) => string) => (s.programme ? f(s.programme) : 'not generated');
  const rows: [string, string, string][] = [
    ['Length', prog(a, (p) => `${n(p.days / 7, 1)} weeks`), prog(b, (p) => `${n(p.days / 7, 1)} weeks`)],
    ['Dates', prog(a, (p) => `${date(p.start)} to ${date(p.finish)}`), prog(b, (p) => `${date(p.start)} to ${date(p.finish)}`)],
    ['Activities', prog(a, (p) => n(p.activities)), prog(b, (p) => n(p.activities))],
    ['Critical', prog(a, (p) => `${Math.round(p.criticalShare * 100)}%`), prog(b, (p) => `${Math.round(p.criticalShare * 100)}%`)],
    ['Packages with objects', n(live(a).length), n(live(b).length)],
    ['Objects in packages', n(sum(a, (p) => p.objects)), n(sum(b, (p) => p.objects))],
    ['Volume in packages', `${n(sum(a, (p) => p.volume))} m³`, `${n(sum(b, (p) => p.volume))} m³`],
    ['Packages built object by object', n(live(a).filter((p) => p.fineTuned).length), n(live(b).filter((p) => p.fineTuned).length)],
  ];
  const figures = rows.map(([label, x, y]) => ({ label, a: x, b: y, differs: x !== y }));
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
    if (!q) { if (p.objects) packages.push({ name: p.name, codeA: p.code, codeB: '', methodA: p.method, methodB: '', daysA: p.days, daysB: null, what: `only in ${a.name}` }); continue; }
    const what = [p.method !== q.method ? 'method' : '', Math.abs(p.days - q.days) > 0.01 ? 'days' : '', p.objects !== q.objects ? 'objects' : '', p.code !== q.code ? 'place in the order' : ''].filter(Boolean);
    if (what.length) packages.push({ name: p.name, codeA: p.code, codeB: q.code, methodA: p.method, methodB: q.method, daysA: p.days, daysB: q.days, what: what.join(', ') });
  }
  for (const q of b.packages) if (!used.has(q.id) && q.objects) packages.push({ name: q.name, codeA: '', codeB: q.code, methodA: '', methodB: q.method, daysA: null, daysB: q.days, what: `only in ${b.name}` });
  return { figures, packages };
}
