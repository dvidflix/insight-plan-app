import type { Recipe, RecipeEdge } from './recipes';

/** The graph of a recipe for its editor: the links between tasks (the ones written as edges, and the ones a task has by default: it follows the
    task before it, finished), where the tasks sit when nobody has placed them (Auto Layout), and the geometry of the arrows. */

export const START = '\u0000start';
export const END = '\u0000end';

export interface GraphEdge {
  from: string;
  to: string;
  /** Percent of `from` done when `to` starts (100: finished). */
  sharePct: number;
  /** An explicit type, with its lag in hours (negative: an overlap). */
  type?: RecipeEdge['type'];
  lagHours: number;
  /** A link the task has because it has no other: it follows the task before it. Shown dashed; connecting the task to something else replaces it. */
  implicit: boolean;
  /** Its place in the recipe's `edges` (-1 for a link that is not written). */
  index: number;
}

export const NODE_W = 170;
export const NODE_H = 64;
const COL_GAP = 70;
const ROW_GAP = 24;

const key = (s: string) => s.trim().toUpperCase();

/** The links the generator will build between the recipe's tasks, plus the links to and from the boundary nodes (START: the work before, END: the
    work after, for the tasks nothing follows). Several links may join the same two tasks (SS and FF). */
export function graphEdges(recipe: Pick<Recipe, 'tasks' | 'edges'>): GraphEdge[] {
  const names = new Map(recipe.tasks.map((t) => [key(t.phase), t.phase]));
  const out: GraphEdge[] = [];
  const hasIn = new Set<string>();
  (recipe.edges ?? []).forEach((e, index) => {
    const from = names.get(key(e.from));
    const to = names.get(key(e.to));
    if (!from || !to || key(from) === key(to)) return;
    out.push({ from, to, sharePct: e.sharePct ?? 100, ...(e.type ? { type: e.type } : {}), lagHours: e.lagHours ?? 0, implicit: false, index });
    hasIn.add(key(to));
  });
  recipe.tasks.forEach((t, i) => {
    if (hasIn.has(key(t.phase))) return;
    out.push({ from: i === 0 ? START : recipe.tasks[i - 1].phase, to: t.phase, sharePct: 100, lagHours: 0, implicit: true, index: -1 });
  });
  const hasOut = new Set(out.filter((e) => e.from !== START).map((e) => key(e.from)));
  for (const t of recipe.tasks) if (!hasOut.has(key(t.phase))) out.push({ from: t.phase, to: END, sharePct: 100, lagHours: 0, implicit: true, index: -1 });
  return out;
}

/** What the box on an arrow says: the type and its lag, as ALICE's "FS | 0": "SS | 16h", "FS | -8h", "SS | 80%" (start when 80 % is done). */
export function edgeChip(e: Pick<GraphEdge, 'sharePct' | 'type' | 'lagHours'>): [string, string] {
  if ((e.type && e.type !== 'FS') || e.lagHours) return [e.type ?? 'FS', e.lagHours ? `${e.lagHours}h` : '0'];
  if (e.sharePct < 100) return ['SS', `${e.sharePct}%`];
  return ['FS', '0'];
}

export interface Placed {
  x: number;
  y: number;
}

export interface Rect extends Placed {
  w: number;
  h: number;
}

/** Where the line from the centre of `from` to the centre of `to` leaves `from`'s border (and so where an arrow from it starts). */
export function borderPoint(from: Rect, to: Rect): Placed {
  const cx = from.x + from.w / 2;
  const cy = from.y + from.h / 2;
  const dx = to.x + to.w / 2 - cx;
  const dy = to.y + to.h / 2 - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(from.w / 2 / Math.abs(dx || 1e-9), from.h / 2 / Math.abs(dy || 1e-9));
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/** Layers by the longest chain of links into each task, rows in the order of the tasks. START is the layer before the first, END the one after the last. */
export function autoLayout(recipe: Pick<Recipe, 'tasks' | 'edges'>): Map<string, Placed> {
  const edges = graphEdges(recipe).filter((e) => e.to !== END);
  const layer = new Map<string, number>([[START, 0]]);
  for (const t of recipe.tasks) layer.set(key(t.phase), 1);
  // (n passes settle any chain; a cycle just stops growing)
  for (let pass = 0; pass < recipe.tasks.length + 1; pass++) {
    let moved = false;
    for (const e of edges) {
      const from = e.from === START ? 0 : layer.get(key(e.from)) ?? 0;
      if ((layer.get(key(e.to)) ?? 1) < from + 1 && from + 1 <= recipe.tasks.length) {
        layer.set(key(e.to), from + 1);
        moved = true;
      }
    }
    if (!moved) break;
  }
  const rowOf = new Map<number, number>();
  const out = new Map<string, Placed>();
  let last = 0;
  for (const t of recipe.tasks) {
    const l = layer.get(key(t.phase)) ?? 1;
    const row = rowOf.get(l) ?? 0;
    rowOf.set(l, row + 1);
    out.set(t.phase, { x: l * (NODE_W + COL_GAP), y: row * (NODE_H + ROW_GAP) });
    last = Math.max(last, l);
  }
  out.set(START, { x: 0, y: 0 });
  out.set(END, { x: (last + 1) * (NODE_W + COL_GAP), y: 0 });
  return out;
}

/** Where each task is: where it was put, else where Auto Layout puts it. */
export function positions(recipe: Pick<Recipe, 'tasks' | 'edges'> & Partial<Pick<Recipe, 'startAt' | 'endAt'>>): Map<string, Placed> {
  const auto = autoLayout(recipe);
  const out = new Map(auto);
  if (recipe.startAt) out.set(START, recipe.startAt);
  if (recipe.endAt) out.set(END, recipe.endAt);
  for (const t of recipe.tasks) if (t.x !== undefined && t.y !== undefined) out.set(t.phase, { x: t.x, y: t.y });
  return out;
}

export interface PreviewBar {
  phase: string;
  start: number;
  days: number;
  /** The days are a guess (the task has no fixed days: its rate depends on the quantities of the objects). */
  approx: boolean;
}

/** A rough programme of one recipe, in working days, for the preview under the graph: each task as long as its fixed days (or its rate's days),
    placed by its links (FS after the finish, SS at a share done, FF and SF by the end). Quantity-based rates count as a day, shown as approximate. */
export function previewBars(recipe: Pick<Recipe, 'tasks' | 'edges'>, rates: { id: string; type: string; days?: number }[]): PreviewBar[] {
  const tasks = recipe.tasks.filter((t) => t.enabled !== false);
  const dur = new Map<string, { days: number; approx: boolean }>();
  for (const t of tasks) {
    const rate = t.rate ? rates.find((r) => key(r.id) === key(t.rate!)) : undefined;
    const fixed = t.days ?? (rate?.type === 'days' ? rate.days : undefined);
    dur.set(key(t.phase), { days: Math.max(0.25, fixed ?? 1), approx: fixed === undefined });
  }
  const links = graphEdges(recipe).filter((e) => e.from !== START && e.to !== END && dur.has(key(e.from)) && dur.has(key(e.to)));
  const start = new Map(tasks.map((t) => [key(t.phase), 0]));
  for (let pass = 0; pass < tasks.length + 1; pass++) {
    let moved = false;
    for (const e of links) {
      const a = key(e.from);
      const b = key(e.to);
      const da = dur.get(a)!.days;
      const db = dur.get(b)!.days;
      const lag = e.lagHours / 8;
      const s = start.get(a)!;
      const at = e.type === 'SS' ? s + lag
        : e.type === 'FF' ? s + da + lag - db
        : e.type === 'SF' ? s + lag - db
        : e.sharePct < 100 ? s + (da * e.sharePct) / 100 + lag
        : s + da + lag;
      if (at > start.get(b)! + 1e-9) { start.set(b, at); moved = true; }
    }
    if (!moved) break;
  }
  return tasks.map((t) => ({ phase: t.phase, start: Math.max(0, start.get(key(t.phase))!), ...dur.get(key(t.phase))! }));
}
