import type { PackageContents, PackageObject, WorkPackage } from './workPackages';

/** Generate 3's fine-tuned object order. A package normally becomes one work item; with an object order (`objectOrder`: GlobalId -> rank) each of
    its objects becomes a work item of its own, built in that order: a lower rank first, equal ranks together, objects without a rank after the
    ranked ones, one after another in the model's order. The packages keep their own order and links; the object order is the order inside a package.

    An order can be typed, or taken from another scenario (its order of objects), from search sets (the order of the sets, or of their folders), or
    from a list (pasted, or the first sheet of an Excel file: an ID, name or GlobalId per row, with an optional rank before it). */

export type ObjectOrder = Record<string, number>;

/** The objects in build order, as runs that start together (each run waits for the one before it to finish). */
export function orderRuns(objs: readonly PackageObject[], order: ObjectOrder | undefined): PackageObject[][] {
  const ranked = objs.map((o, i) => ({ o, i, r: o.guid && order && Number.isFinite(order[o.guid]) ? order[o.guid] : null }));
  const yes = ranked.filter((x) => x.r !== null).sort((a, b) => a.r! - b.r! || a.i - b.i);
  const runs: PackageObject[][] = [];
  let last: number | null = null;
  for (const x of yes) {
    if (x.r === last) runs[runs.length - 1].push(x.o);
    else { runs.push([x.o]); last = x.r; }
  }
  for (const x of ranked) if (x.r === null) runs.push([x.o]);
  return runs;
}

/** The objects in build order (flat). */
export const ordered = (objs: readonly PackageObject[], order: ObjectOrder | undefined) => orderRuns(objs, order).flat();

/** Ranks 1, 2, 3... in the same order (runs keep sharing a rank). Only the objects given are kept. */
export function compactOrder(objs: readonly PackageObject[], order: ObjectOrder | undefined): ObjectOrder {
  const out: ObjectOrder = {};
  orderRuns(objs, order).forEach((run, i) => { for (const o of run) if (o.guid) out[o.guid] = i + 1; });
  return out;
}

/** An order for these objects from ranks by GlobalId (another scenario's order, say). Objects it does not rank are left without one. */
export function orderFromRanks(objs: readonly PackageObject[], ranks: ReadonlyMap<string, number>): { order: ObjectOrder; found: number } {
  const order: ObjectOrder = {};
  let found = 0;
  for (const o of objs) { const r = o.guid ? ranks.get(o.guid) : undefined; if (r !== undefined && r > 0) { order[o.guid] = r; found++; } }
  return { order, found };
}

/** Ranks from search sets in their order: an object gets the place of the first set (or of the first set's folder, `byFolder`) that finds it. */
export function ranksFromSets(objs: readonly PackageObject[], sets: readonly { name: string; group: string }[], finds: (set: string, key: string) => boolean, byFolder = false): Map<string, number> {
  const place = new Map<string, number>();
  const folders: string[] = [];
  const rankOf = (s: { name: string; group: string }, i: number) => {
    if (!byFolder) return i + 1;
    if (!folders.includes(s.group)) folders.push(s.group);
    return folders.indexOf(s.group) + 1;
  };
  const ranks = sets.map(rankOf);
  for (const o of objs) {
    if (!o.guid) continue;
    const at = sets.findIndex((s) => finds(s.name, o.key));
    if (at >= 0) place.set(o.guid, ranks[at]);
  }
  return place;
}

/** Ranks from a list: one object per row, by GlobalId, name or "<model>:<id>" key, with an optional rank before it (else the row's place). A first
    row that names no object is taken for headings. */
export function ranksFromList(rows: readonly (readonly unknown[])[], objs: readonly PackageObject[]): { ranks: Map<string, number>; unmatched: string[] } {
  const byGuid = new Map(objs.filter((o) => o.guid).map((o) => [o.guid.toUpperCase(), o]));
  const byKey = new Map(objs.map((o) => [o.key.toUpperCase(), o]));
  const byName = new Map<string, PackageObject[]>();
  for (const o of objs) { const k = o.name.trim().toUpperCase(); if (k) (byName.get(k) ?? byName.set(k, []).get(k)!).push(o); }
  const ranks = new Map<string, number>();
  const unmatched: string[] = [];
  let place = 0;
  rows.forEach((raw, i) => {
    const cells = raw.map((c) => (c === null || c === undefined ? '' : String(c).trim())).filter((c) => c !== '');
    if (!cells.length) return;
    const numeric = cells.length > 1 && /^-?\d+(\.\d+)?$/.test(cells[0].replace(',', '.'));
    const id = numeric ? cells[1] : cells[0];
    const u = id.toUpperCase();
    const hits = byGuid.get(u) ? [byGuid.get(u)!] : byKey.get(u) ? [byKey.get(u)!] : byName.get(u) ?? [];
    if (!hits.length) { if (i > 0 || ranks.size) unmatched.push(id); return; }
    place++;
    const rank = numeric ? Number(cells[0].replace(',', '.')) : place;
    for (const o of hits) if (o.guid && !ranks.has(o.guid)) ranks.set(o.guid, rank);
  });
  return { ranks, unmatched };
}

/** Text with an object per line ("rank<TAB>id", "rank;id", "rank,id" or just "id") as rows. */
export const listRows = (text: string): string[][] => text.split(/\r?\n/).map((l) => (/\t/.test(l) ? l.split('\t') : /;/.test(l) ? l.split(';') : /^\s*-?\d+(\.\d+)?\s*,/.test(l) ? [l.slice(0, l.indexOf(',')), l.slice(l.indexOf(',') + 1)] : [l]));

/** Ranks from the object sequence table (Generate's step 4: rows of the scenario's order, keyed by GlobalId, with their step): the place of each
    row's step, rows of the same step sharing it; unsequenced rows (no step) are left out. */
export function ranksFromRows(rows: readonly { key: string; step: number | null }[]): Map<string, number> {
  const out = new Map<string, number>();
  let rank = 0;
  let last: number | null = null;
  for (const r of rows) {
    if (r.step === null) continue;
    if (r.step !== last) { rank++; last = r.step; }
    const guid = r.key.split('#')[0];
    if (guid && !out.has(guid)) out.set(guid, rank);
  }
  return out;
}

/** The packages with the object sequence applied: a package with no object order of its own takes one from `ranks` when any of its objects is
    ranked (a package's own fine-tuned order wins). */
export function withSequenceOrder(packages: readonly WorkPackage[], contents: PackageContents, ranks: ReadonlyMap<string, number>): WorkPackage[] {
  return packages.map((p) => {
    if (p.objectOrder && Object.keys(p.objectOrder).length) return p;
    const objs = contents.objects.get(p.id) ?? [];
    const { order, found } = orderFromRanks(objs, ranks);
    return found ? { ...p, objectOrder: compactOrder(objs, order) } : p;
  });
}
