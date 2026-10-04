import type { ContactRow, VerticalPosition } from '../viewer/relations';

/** How the objects of one activity sit against the objects of a linked activity (its
    predecessor or successor), worked out from the Clashes & contacts results: for every
    contacting pair of objects, where the other activity's object is relative to this one's. */

export type ObjectsByModel = Map<string, Set<number>>;

export const POSITION_LABEL: Record<VerticalPosition, string> = {
  above: 'Above',
  'mostly-above': 'Mostly above',
  side: 'Beside',
  'mostly-below': 'Mostly below',
  below: 'Below',
};

const ORDER: VerticalPosition[] = ['above', 'mostly-above', 'side', 'mostly-below', 'below'];

const INVERSE: Record<VerticalPosition, VerticalPosition> = {
  above: 'below',
  'mostly-above': 'mostly-below',
  side: 'side',
  'mostly-below': 'mostly-above',
  below: 'above',
};

export interface RelationSummary {
  /** Contacting pairs between the two activities' objects. */
  pairs: number;
  /** Of those, how many pass through each other rather than touch. */
  overlaps: number;
  /** The closest gap (m); 0 when they touch or overlap. */
  closest: number;
  /** The other activity's objects, by where they sit relative to this one's. */
  byPosition: Record<VerticalPosition, number>;
  /** The position most pairs have. */
  dominant: VerticalPosition;
  /** More than one position occurs. */
  mixed: boolean;
}

/** Contact rows by each end ("modelId:localId"), so an activity's objects find theirs quickly. */
export function indexContacts(results: Record<string, { rows: ContactRow[] }>): Map<string, ContactRow[]> {
  const index = new Map<string, ContactRow[]>();
  const add = (key: string, row: ContactRow) => (index.get(key) ?? index.set(key, []).get(key)!).push(row);
  for (const job of Object.values(results)) {
    for (const row of job.rows) {
      add(`${row.a.modelId}:${row.a.localId}`, row);
      add(`${row.b.modelId}:${row.b.localId}`, row);
    }
  }
  return index;
}

let lastIndex: { results: Record<string, { rows: ContactRow[] }>; index: Map<string, ContactRow[]> } | null = null;
/** indexContacts, kept for the same results so the panes showing it share one run. */
export function sharedContactIndex(results: Record<string, { rows: ContactRow[] }>): Map<string, ContactRow[]> {
  if (lastIndex && lastIndex.results === results) return lastIndex.index;
  const index = indexContacts(results);
  lastIndex = { results, index };
  return index;
}

/** The relation of `other`'s objects to `mine`, or null when no contact between them is known. */
export function summariseRelation(index: Map<string, ContactRow[]>, mine: ObjectsByModel, other: ObjectsByModel): RelationSummary | null {
  const counted = new Set<ContactRow>();
  const byPosition: Record<VerticalPosition, number> = { above: 0, 'mostly-above': 0, side: 0, 'mostly-below': 0, below: 0 };
  let overlaps = 0;
  let closest = Infinity;
  const has = (side: ObjectsByModel, modelId: string, localId: number) => side.get(modelId)?.has(localId) ?? false;
  for (const [modelId, ids] of mine) {
    for (const id of ids) {
      for (const row of index.get(`${modelId}:${id}`) ?? []) {
        if (counted.has(row)) continue;
        const aMine = row.a.modelId === modelId && row.a.localId === id;
        const bMine = row.b.modelId === modelId && row.b.localId === id;
        // This end is mine, the far end must be the other activity's.
        const farIsOther = aMine ? has(other, row.b.modelId, row.b.localId) : bMine ? has(other, row.a.modelId, row.a.localId) : false;
        if (!farIsOther) continue;
        counted.add(row);
        // position: where B sits relative to A. From my side: as is when I am A, flipped when I am B.
        byPosition[aMine ? row.position : INVERSE[row.position]]++;
        if (row.overlap) overlaps++;
        if (row.distance < closest) closest = row.distance;
      }
    }
  }
  if (counted.size === 0) return null;
  let dominant: VerticalPosition = 'side';
  let best = -1;
  for (const p of ORDER) {
    if (byPosition[p] > best) {
      best = byPosition[p];
      dominant = p;
    }
  }
  return { pairs: counted.size, overlaps, closest: Math.max(0, closest), byPosition, dominant, mixed: ORDER.filter((p) => byPosition[p] > 0).length > 1 };
}

/** The activities (by `owners`: "modelId:localId" -> activity ids) with an object in contact with one of `mine`. */
export function neighbourActivities(index: Map<string, ContactRow[]>, mine: ObjectsByModel, owners: Map<string, string[]>): Set<string> {
  const found = new Set<string>();
  for (const [modelId, ids] of mine) {
    for (const id of ids) {
      for (const row of index.get(`${modelId}:${id}`) ?? []) {
        const aMine = row.a.modelId === modelId && row.a.localId === id;
        const far = aMine ? row.b : row.a;
        for (const owner of owners.get(`${far.modelId}:${far.localId}`) ?? []) found.add(owner);
      }
    }
  }
  return found;
}

/** How far, in touching objects, a relation is followed when the two activities' objects do not touch. */
export const MAX_VIA_HOPS = 4;

export interface ViaNode {
  /** Touching steps from one of this activity's objects. */
  hops: number;
  /** Steps ending below minus steps ending above along the way: below when negative, above when positive. */
  net: number;
  /** The first object met on the way (the one touching this activity's own). */
  via: string;
}

/** Everything reachable from `mine` through chains of touching objects, up to MAX_VIA_HOPS steps. */
export function reachByContacts(index: Map<string, ContactRow[]>, mine: ObjectsByModel): Map<string, ViaNode> {
  const seen = new Map<string, ViaNode>();
  const queue: string[] = [];
  for (const [modelId, ids] of mine) {
    for (const id of ids) {
      seen.set(`${modelId}:${id}`, { hops: 0, net: 0, via: '' });
      queue.push(`${modelId}:${id}`);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const here = queue[q];
    const node = seen.get(here)!;
    if (node.hops >= MAX_VIA_HOPS) continue;
    for (const row of index.get(here) ?? []) {
      const aHere = `${row.a.modelId}:${row.a.localId}` === here;
      const far = aHere ? row.b : row.a;
      const farKey = `${far.modelId}:${far.localId}`;
      if (seen.has(farKey)) continue;
      const position = aHere ? row.position : INVERSE[row.position]; // the far object, against this one
      const step = position === 'below' || position === 'mostly-below' ? -1 : position === 'above' || position === 'mostly-above' ? 1 : 0;
      seen.set(farKey, { hops: node.hops + 1, net: node.net + step, via: node.hops === 0 ? far.name : node.via });
      queue.push(farKey);
    }
  }
  return seen;
}

export interface ViaRelation {
  hops: number;
  position: 'above' | 'side' | 'below';
  via: string;
}

/** The nearest chain of touching objects from this activity's objects to `other`'s, if any. */
export function viaRelation(reach: Map<string, ViaNode>, other: ObjectsByModel): ViaRelation | null {
  let best: ViaNode | null = null;
  for (const [modelId, ids] of other) {
    for (const id of ids) {
      const node = reach.get(`${modelId}:${id}`);
      if (node && node.hops > 0 && (!best || node.hops < best.hops)) best = node;
    }
  }
  return best && { hops: best.hops, position: best.net < 0 ? 'below' : best.net > 0 ? 'above' : 'side', via: best.via };
}

/** A short cell text: "Above · 12". */
export function relationText(r: RelationSummary): string {
  return `${POSITION_LABEL[r.dominant]} · ${r.pairs}${r.mixed ? ' · mixed' : ''}`;
}

/** The full breakdown for a tooltip. */
export function relationDetail(r: RelationSummary, other: 'predecessor' | 'successor'): string {
  const parts = ORDER.filter((p) => r.byPosition[p] > 0).map((p) => `${POSITION_LABEL[p].toLowerCase()} ${r.byPosition[p]}`);
  return [
    `The ${other}'s objects, against this activity's: ${parts.join(', ')}.`,
    `${r.pairs} contacting ${r.pairs === 1 ? 'pair' : 'pairs'} of objects (${r.overlaps} passing through each other, ${r.pairs - r.overlaps} touching).`,
    `Closest gap ${r.closest.toFixed(3)} m. From the Clashes & contacts results.`,
  ].join('\n');
}
