import type { Activity, Relationship, RelationType } from './types';
import type { WbsTreeNode } from './wbsTree';

export const DAY_MS = 86400000;
export const ROW_H = 28;

/** Dates are held as epoch-ms numbers, not Date objects — the chart reads
    them for every visible row on every scroll frame, and at program scale
    (100k+ activities) avoiding getTime() calls and allocations matters. */
export interface GanttRow {
  activity: Activity;
  s: number;
  f: number;
}

export function buildGanttRows(activities: Activity[]): GanttRow[] {
  const rows: GanttRow[] = [];
  for (const a of activities) {
    const start = a.earlyStart ?? a.targetStart;
    const finish = a.earlyFinish ?? a.targetFinish;
    if (!start || !finish) continue;
    rows.push({ activity: a, s: start.getTime(), f: finish.getTime() });
  }
  return rows.sort((a, b) => a.s - b.s);
}

/** Min/max via a loop — `Math.min(...arr)` throws a RangeError once the
    array passes ~120k entries, which a big programme easily does. */
export function extent(rows: GanttRow[], extra: (number | null | undefined)[] = []): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    if (r.s < min) min = r.s;
    if (r.f > max) max = r.f;
  }
  for (const e of extra) {
    if (e == null) continue;
    if (e < min) min = e;
    if (e > max) max = e;
  }
  return { min, max };
}

// ---------------------------------------------------------------- WBS rollup

/** What a WBS group's summary bar shows: the span of everything beneath it
    (OpenProject's "parent" bar), duration-weighted progress, and how many of
    its activities are critical. */
export interface GroupAgg {
  s: number;
  f: number;
  pct: number;
  critical: number;
}

export function computeGroupAggregates(nodes: WbsTreeNode<GanttRow>[]): Map<string, GroupAgg> {
  const out = new Map<string, GroupAgg>();
  // Returns raw sums so a parent can fold children in without re-walking rows.
  const visit = (n: WbsTreeNode<GanttRow>): { s: number; f: number; w: number; done: number; critical: number } => {
    let s = Infinity;
    let f = -Infinity;
    let w = 0;
    let done = 0;
    let critical = 0;
    for (const r of n.rows) {
      if (r.s < s) s = r.s;
      if (r.f > f) f = r.f;
      const dur = Math.max(r.activity.durationHours, 1);
      w += dur;
      done += (dur * r.activity.percentComplete) / 100;
      if (r.activity.isCritical) critical++;
    }
    for (const c of n.children) {
      const a = visit(c);
      if (a.s < s) s = a.s;
      if (a.f > f) f = a.f;
      w += a.w;
      done += a.done;
      critical += a.critical;
    }
    out.set(n.path, { s, f, pct: w > 0 ? (done / w) * 100 : 0, critical });
    return { s, f, w, done, critical };
  };
  for (const n of nodes) visit(n);
  return out;
}

// ------------------------------------------------------------- flat layout

export type GanttItem =
  | { kind: 'group'; path: string; label: string; depth: number; count: number }
  | { kind: 'row'; row: GanttRow };

export interface GanttLayout {
  items: GanttItem[];
  /** activity id -> index in `items` (only for rows currently visible). */
  indexById: Map<string, number>;
}

/** One flat top-to-bottom list of group headers + task rows. Windowing,
    link geometry, keyboard nav and scroll-to all index into this. */
export function flattenLayout(
  rows: GanttRow[],
  tree: WbsTreeNode<GanttRow>[],
  groupByWbs: boolean,
  collapsed: Set<string>,
): GanttLayout {
  const items: GanttItem[] = [];
  const indexById = new Map<string, number>();
  if (groupByWbs) {
    const walk = (nodes: WbsTreeNode<GanttRow>[]) => {
      for (const node of nodes) {
        items.push({ kind: 'group', path: node.path, label: node.label, depth: node.depth, count: node.descendantCount });
        if (collapsed.has(node.path)) continue;
        for (const r of node.rows) {
          indexById.set(r.activity.id, items.length);
          items.push({ kind: 'row', row: r });
        }
        walk(node.children);
      }
    };
    walk(tree);
  } else {
    for (const r of rows) {
      indexById.set(r.activity.id, items.length);
      items.push({ kind: 'row', row: r });
    }
  }
  return { items, indexById };
}

// -------------------------------------------------------------- time scale

export type TickKind = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface Tick {
  start: number;
  end: number;
  label: string;
  /** Day ticks only: falls on a Saturday or Sunday. */
  weekend?: boolean;
}

/** Two-tier header, chosen from the current px/day rather than a named zoom,
    so ctrl+wheel / fit zoom (which land between presets) still get sensible
    headers — same idea as OpenProject's day/week/month/quarter/year zooms. */
export function tiersForScale(pxPerDay: number): { top: TickKind | null; bottom: TickKind } {
  if (pxPerDay >= 240) return { top: 'day', bottom: 'hour' };
  if (pxPerDay >= 22) return { top: 'month', bottom: 'day' };
  if (pxPerDay >= 7) return { top: 'month', bottom: 'week' };
  if (pxPerDay >= 2) return { top: 'year', bottom: 'month' };
  if (pxPerDay >= 0.7) return { top: 'year', bottom: 'quarter' };
  return { top: null, bottom: 'year' };
}

function floorTo(kind: TickKind, ms: number): Date {
  const d = new Date(ms);
  if (kind === 'hour') d.setMinutes(0, 0, 0);
  else d.setHours(0, 0, 0, 0);
  if (kind === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  else if (kind === 'month') d.setDate(1);
  else if (kind === 'quarter') d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1);
  else if (kind === 'year') d.setMonth(0, 1);
  return d;
}

function advance(kind: TickKind, d: Date) {
  if (kind === 'hour') d.setHours(d.getHours() + 1);
  else if (kind === 'day') d.setDate(d.getDate() + 1);
  else if (kind === 'week') d.setDate(d.getDate() + 7);
  else if (kind === 'month') d.setMonth(d.getMonth() + 1);
  else if (kind === 'quarter') d.setMonth(d.getMonth() + 3);
  else d.setFullYear(d.getFullYear() + 1);
}

function tickLabel(kind: TickKind, d: Date, isTop: boolean): string {
  switch (kind) {
    case 'hour':
      return String(d.getHours()).padStart(2, '0');
    case 'day':
      return isTop ? d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : String(d.getDate());
    case 'week':
      return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    case 'month':
      return isTop
        ? d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        : d.toLocaleDateString(undefined, { month: 'short' });
    case 'quarter':
      return `Q${Math.floor(d.getMonth() / 3) + 1}`;
    case 'year':
      return String(d.getFullYear());
  }
}

/** Ticks of `kind` overlapping [fromMs, toMs] — only what's on screen, so
    a 20-year programme at day zoom never materialises 7,000 header cells. */
export function ticksBetween(kind: TickKind, fromMs: number, toMs: number, isTop: boolean): Tick[] {
  const out: Tick[] = [];
  const cursor = floorTo(kind, fromMs);
  let guard = 0;
  while (cursor.getTime() <= toMs && guard++ < 2500) {
    const start = cursor.getTime();
    advance(kind, cursor);
    const startDate = new Date(start);
    const dow = startDate.getDay();
    out.push({
      start, end: cursor.getTime(), label: tickLabel(kind, startDate, isTop),
      ...(kind === 'day' ? { weekend: dow === 0 || dow === 6 } : undefined),
    });
  }
  return out;
}

// ------------------------------------------------------------------- links

const STUB = 8;

/** Orthogonal connector between two bar edges. Takes the simple "elbow" when
    the successor lies clear to the right; otherwise routes through the gap
    between rows so backward/overlapping links don't run through bars. */
export function linkPath(x1: number, y1: number, x2: number, y2: number, fromRight: boolean, toLeft: boolean): string {
  const sx = x1 + (fromRight ? STUB : -STUB);
  const tx = x2 + (toLeft ? -STUB : STUB);
  if (fromRight && toLeft && tx >= sx) return `M ${x1} ${y1} H ${sx} V ${y2} H ${x2}`;
  const ym = y1 + (y2 >= y1 ? ROW_H / 2 : -ROW_H / 2);
  return `M ${x1} ${y1} H ${sx} V ${ym} H ${tx} V ${y2} H ${x2}`;
}

export function linkEnds(type: RelationType): { fromRight: boolean; toLeft: boolean } {
  return {
    fromRight: type === 'FS' || type === 'FF',
    toLeft: type === 'FS' || type === 'SS',
  };
}

/** id -> every relationship touching it (as predecessor or successor). Lets
    the chart find just the links of the visible rows instead of scanning
    the full relationship list per frame. */
export function buildLinkIndex(relationships: Relationship[]): Map<string, Relationship[]> {
  const m = new Map<string, Relationship[]>();
  const add = (id: string, r: Relationship) => {
    const list = m.get(id);
    if (list) list.push(r);
    else m.set(id, [r]);
  };
  for (const r of relationships) {
    add(r.predId, r);
    if (r.succId !== r.predId) add(r.succId, r);
  }
  return m;
}
