import type { ModelIndex } from './ViewerEngine';
import type { ElementSummary } from './types';

/** Comparing two versions of a model (old → new): objects are paired by
    GlobalId first; what is left is paired by what the object is — class,
    level, name, its properties and its volume — and every pairing is scored
    so the doubtful ones can be checked. Pairs are then read for property
    differences, and the pairs' Pour IDs make the old → new Pour ID map the
    programme can be renumbered with. */

export type MatchKind = 'guid' | 'properties';

export interface PropDiff {
  key: string;
  from: string;
  to: string;
}

export interface MatchedPair {
  a: ElementSummary;
  b: ElementSummary;
  kind: MatchKind;
  /** 1 for a GlobalId match; for a properties match 0…1 (how alike they are). */
  score: number;
  diffs: PropDiff[];
}

export interface CompareResult {
  pairs: MatchedPair[];
  /** In the old model only. */
  removed: ElementSummary[];
  /** In the new model only. */
  added: ElementSummary[];
}

export const compareStats = (r: CompareResult) => ({
  byGuid: r.pairs.filter((p) => p.kind === 'guid').length,
  byProperties: r.pairs.filter((p) => p.kind === 'properties').length,
  doubtful: r.pairs.filter((p) => p.kind === 'properties' && p.score < DOUBTFUL_BELOW).length,
  changed: r.pairs.filter((p) => p.diffs.length > 0).length,
  unchanged: r.pairs.filter((p) => p.diffs.length === 0).length,
  removed: r.removed.length,
  added: r.added.length,
});

/** A properties match scoring under this is listed as doubtful. */
export const DOUBTFUL_BELOW = 0.9;
const ACCEPT_FROM = 0.75;
const MAX_CANDIDATES = 300;

const text = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** The element's volume, from its quantity properties (0 when it has none). */
export function volumeOf(e: ElementSummary): number {
  let best = 0;
  for (const [k, v] of Object.entries(e.props)) {
    if (!/volume$/i.test(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best;
}

const levelOf = (e: ElementSummary): string => {
  for (const [k, v] of Object.entries(e.props)) if (/(^|\.)(level|storey|floor)$/i.test(k) && text(v)) return text(v).trim().toLowerCase();
  return '';
};

/** Property keys that hold a Pour ID, most used first. */
export function pourKeysOf(index: ModelIndex): string[] {
  const counts = new Map<string, number>();
  for (const e of index.elements.values()) for (const k of Object.keys(e.props)) if (/pour.*id|^pour$/i.test(k) && text(e.props[k]) !== '') counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].sort((x, y) => y[1] - x[1]).map(([k]) => k);
}

/** The object's own fields, which can serve as the ID like any property ("@" keys). */
export const ATTRIBUTE_KEYS: Record<string, string> = { '@name': 'Name (label)', '@category': 'Class', '@guid': 'GlobalId' };
const attributeOf = (e: ElementSummary, key: string) => (key === '@name' ? e.name : key === '@category' ? e.category : e.guid);

/** Every key that can hold the ID: the Pour-like properties first (most used first), then the other properties, then the object's own fields. */
export function idKeysOf(index: ModelIndex): string[] {
  const counts = new Map<string, number>();
  for (const e of index.elements.values()) for (const [k, v] of Object.entries(e.props)) if (text(v) !== '') counts.set(k, (counts.get(k) ?? 0) + 1);
  const pour = pourKeysOf(index);
  const rest = [...counts.keys()].filter((k) => !pour.includes(k)).sort((x, y) => x.localeCompare(y));
  return [...pour, ...rest, ...Object.keys(ATTRIBUTE_KEYS)];
}

/** A Pour ID as the programme writes it: numbers padded to four digits. */
export function normalisePour(v: unknown): string {
  const s = text(v).trim();
  return /^\d+$/.test(s) ? s.padStart(4, '0') : s;
}

/** The ID of an object under `key` (a property, or one of the object's own fields): numbers are padded for a Pour ID property only. */
export const pourOf = (e: ElementSummary, key: string | null) => {
  if (!key) return '';
  if (key in ATTRIBUTE_KEYS) return text(attributeOf(e, key)).trim();
  return /pour/i.test(key) ? normalisePour(e.props[key]) : text(e.props[key]).trim();
};

/** How alike two objects are, 0…1, ignoring the identity properties (the
    GlobalId, anything holding a Pour ID) that are expected to change. */
function similarity(a: ElementSummary, b: ElementSummary, skip: (k: string) => boolean, skipName = false): number {
  let same = 0;
  let total = 0;
  for (const [k, v] of Object.entries(a.props)) {
    if (skip(k) || text(v) === '') continue;
    total++;
    if (text(b.props[k]) === text(v)) same++;
  }
  const props = total ? same / total : 0.5;
  const va = volumeOf(a);
  const vb = volumeOf(b);
  let volume = 0.5;
  if (va > 0 || vb > 0) {
    const rel = Math.abs(va - vb) / Math.max(va, vb);
    volume = rel <= 0.005 ? 1 : rel <= 0.02 ? 0.85 : rel <= 0.05 ? 0.55 : 0;
  }
  // A name that is the ID is expected to change: neutral.
  const name = skipName ? 0.5 : a.name && a.name === b.name ? 1 : 0;
  return 0.5 * props + 0.35 * volume + 0.15 * name;
}

export function diffsOf(a: ElementSummary, b: ElementSummary): PropDiff[] {
  const out: PropDiff[] = [];
  if (a.category !== b.category) out.push({ key: 'Class', from: a.category, to: b.category });
  if (a.name !== b.name) out.push({ key: 'Name', from: a.name, to: b.name });
  const keys = new Set([...Object.keys(a.props), ...Object.keys(b.props)]);
  for (const k of keys) {
    const from = text(a.props[k]);
    const to = text(b.props[k]);
    if (from !== to) out.push({ key: k, from, to });
  }
  return out;
}

export function compareModels(oldIndex: ModelIndex, newIndex: ModelIndex, opts: { pourKey: string | null; fallback: boolean }): CompareResult {
  const pairs: MatchedPair[] = [];
  const guidOfNew = new Map<string, ElementSummary>();
  for (const e of newIndex.elements.values()) if (e.guid) guidOfNew.set(e.guid, e);

  const usedNew = new Set<ElementSummary>();
  const leftOld: ElementSummary[] = [];
  for (const a of oldIndex.elements.values()) {
    const b = a.guid ? guidOfNew.get(a.guid) : undefined;
    if (b && !usedNew.has(b)) {
      usedNew.add(b);
      pairs.push({ a, b, kind: 'guid', score: 1, diffs: diffsOf(a, b) });
    } else leftOld.push(a);
  }
  let leftNew = [...newIndex.elements.values()].filter((e) => !usedNew.has(e));

  if (opts.fallback && leftOld.length && leftNew.length) {
    const skip = (k: string) => k === opts.pourKey || /(^|\.)(globalid|guid)$/i.test(k) || /pour.*id/i.test(k);
    // Bucket by class and level, and within a bucket look only at objects of a similar volume.
    const bucketKey = (e: ElementSummary) => `${e.category}|${levelOf(e)}`;
    const buckets = new Map<string, ElementSummary[]>();
    for (const e of leftNew) (buckets.get(bucketKey(e)) ?? buckets.set(bucketKey(e), []).get(bucketKey(e))!).push(e);
    for (const list of buckets.values()) list.sort((x, y) => volumeOf(x) - volumeOf(y));

    interface Cand {
      a: ElementSummary;
      b: ElementSummary;
      score: number;
    }
    const cands: Cand[] = [];
    for (const a of leftOld) {
      const list = buckets.get(bucketKey(a));
      if (!list?.length) continue;
      const va = volumeOf(a);
      // First candidate at or above 90 % of the volume, then up to 110 %.
      let lo = 0;
      let hi = list.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (volumeOf(list[mid]) < va * 0.9) lo = mid + 1;
        else hi = mid;
      }
      let looked = 0;
      for (let i = lo; i < list.length && looked < MAX_CANDIDATES; i++, looked++) {
        const b = list[i];
        if (va > 0 && volumeOf(b) > va * 1.1) break;
        const score = similarity(a, b, skip, opts.pourKey === '@name');
        if (score >= ACCEPT_FROM) cands.push({ a, b, score });
      }
    }
    cands.sort((x, y) => y.score - x.score);
    const usedOld = new Set<ElementSummary>();
    for (const c of cands) {
      if (usedOld.has(c.a) || usedNew.has(c.b)) continue;
      usedOld.add(c.a);
      usedNew.add(c.b);
      pairs.push({ a: c.a, b: c.b, kind: 'properties', score: c.score, diffs: diffsOf(c.a, c.b) });
    }
    leftNew = leftNew.filter((e) => !usedNew.has(e));
    return { pairs, removed: leftOld.filter((e) => !usedOld.has(e)), added: leftNew };
  }
  return { pairs, removed: leftOld, added: leftNew };
}

// ---- Pour ID map ----

export interface PourMapRow {
  /** The Pour ID in the old model ('' for a pour only the new model has). */
  oldPour: string;
  newPour: string;
  /** Objects behind the row. */
  count: number;
  status: 'same' | 'renumbered' | 'conflict' | 'removed' | 'new';
  /** For a conflict: every new Pour ID the old pour's objects went to, with how many each. */
  alternatives?: { pour: string; count: number }[];
}

/** Old Pour ID → new Pour ID from the paired objects: each old pour takes
    the new Pour ID most of its objects went to; if its objects split, that
    is a conflict to settle by hand. Also the pours that only one model has. */
export function pourMapOf(result: CompareResult, key: string): PourMapRow[] {
  const votes = new Map<string, Map<string, number>>();
  for (const p of result.pairs) {
    const o = pourOf(p.a, key);
    const n = pourOf(p.b, key);
    if (!o) continue;
    const m = votes.get(o) ?? votes.set(o, new Map()).get(o)!;
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  const rows: PourMapRow[] = [];
  const oldWithObjects = new Set<string>();
  for (const e of result.removed) {
    const o = pourOf(e, key);
    if (o) oldWithObjects.add(o);
  }
  for (const [o, m] of votes) {
    const alts = [...m].map(([pour, count]) => ({ pour, count })).sort((x, y) => y.count - x.count);
    const total = alts.reduce((n, a) => n + a.count, 0);
    const top = alts[0];
    const named = alts.filter((a) => a.pour);
    if (named.length > 1) rows.push({ oldPour: o, newPour: top.pour, count: total, status: 'conflict', alternatives: alts });
    else if (!top.pour) rows.push({ oldPour: o, newPour: '', count: total, status: 'removed' });
    else rows.push({ oldPour: o, newPour: top.pour, count: total, status: top.pour === o ? 'same' : 'renumbered' });
  }
  const seenOld = new Set(rows.map((r) => r.oldPour));
  for (const o of oldWithObjects) if (!seenOld.has(o)) rows.push({ oldPour: o, newPour: '', count: result.removed.filter((e) => pourOf(e, key) === o).length, status: 'removed' });
  const newTargets = new Set(rows.map((r) => r.newPour).filter(Boolean));
  const addedBy = new Map<string, number>();
  for (const e of result.added) {
    const n = pourOf(e, key);
    if (n && !newTargets.has(n)) addedBy.set(n, (addedBy.get(n) ?? 0) + 1);
  }
  for (const [n, count] of addedBy) rows.push({ oldPour: '', newPour: n, count, status: 'new' });
  return rows.sort((x, y) => (x.oldPour || x.newPour).localeCompare(y.oldPour || y.newPour, undefined, { numeric: true }));
}
