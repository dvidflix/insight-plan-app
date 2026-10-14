import type { Recipe } from './recipes';

/** The graph of a recipe for its editor: the links between tasks (the ones written as edges, and the ones a task has by default: it follows the
    task before it, finished), and where the tasks sit when nobody has placed them (Auto Layout). */

export const START = '\u0000start';
export const END = '\u0000end';

export interface GraphEdge {
  from: string;
  to: string;
  /** Percent of `from` done when `to` starts (100: finished). */
  sharePct: number;
  /** A link the task has because it has no other: it follows the task before it. Shown dashed; connecting the task to something else replaces it. */
  implicit: boolean;
}

export const NODE_W = 190;
export const NODE_H = 78;
const COL_GAP = 80;
const ROW_GAP = 26;

const key = (s: string) => s.trim().toUpperCase();

/** The links the generator will build between the recipe's tasks, plus the links to and from the boundary nodes (START: the work before, END: the
    work after, for the tasks nothing follows). */
export function graphEdges(recipe: Pick<Recipe, 'tasks' | 'edges'>): GraphEdge[] {
  const names = new Map(recipe.tasks.map((t) => [key(t.phase), t.phase]));
  const out: GraphEdge[] = [];
  const hasIn = new Set<string>();
  for (const e of recipe.edges ?? []) {
    const from = names.get(key(e.from));
    const to = names.get(key(e.to));
    if (!from || !to || key(from) === key(to)) continue;
    out.push({ from, to, sharePct: e.sharePct ?? 100, implicit: false });
    hasIn.add(key(to));
  }
  recipe.tasks.forEach((t, i) => {
    if (hasIn.has(key(t.phase))) return;
    out.push({ from: i === 0 ? START : recipe.tasks[i - 1].phase, to: t.phase, sharePct: 100, implicit: true });
  });
  const hasOut = new Set(out.filter((e) => e.from !== START).map((e) => key(e.from)));
  for (const t of recipe.tasks) if (!hasOut.has(key(t.phase))) out.push({ from: t.phase, to: END, sharePct: 100, implicit: true });
  return out;
}

export interface Placed {
  x: number;
  y: number;
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
export function positions(recipe: Pick<Recipe, 'tasks' | 'edges'>): Map<string, Placed> {
  const auto = autoLayout(recipe);
  const out = new Map(auto);
  for (const t of recipe.tasks) if (t.x !== undefined && t.y !== undefined) out.set(t.phase, { x: t.x, y: t.y });
  return out;
}
