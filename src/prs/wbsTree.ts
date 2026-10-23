import type { LevelTask, RuleGroup, ScenarioRules, SequenceStep } from './rules';
import { STEPS_ID } from './recipesWorkbook';

/** Generate 2's work breakdown as a tree: search sets placed in nodes. Nesting is the WBS, the order of the tree is the build order, and each set (a
    leaf) is a work item. The tree only holds the structure: the sets in tree order are the scenario's Steps (rules.sequences "STEPS"), which keep each
    step's own options (per level, the link into it, its lag) and which the generator already reads. So the generator does not change, and the Work
    breakdown tab of Generate shows the same list. A node can also be a summary bar: one bar per building and level over the sets inside it (as a
    summary bar for a folder, prs/summaryBars.ts). Nothing here knows what the sets are called. */

export interface WbsSet { kind: 'set'; group: string }
export interface WbsNode { kind: 'node'; id: string; name: string; children: WbsEntry[]; /** Off: no summary bar for the node (default on). */ bar?: boolean }
export type WbsEntry = WbsSet | WbsNode;
export interface WbsTree { children: WbsEntry[] }

/** Where an entry goes: inside `parent` (null: the top of the tree), before the entry at `index`. */
export interface WbsPlace { parent: string | null; index: number }

const norm = (s: string) => s.trim().toUpperCase();
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export const EMPTY_TREE: WbsTree = Object.freeze({ children: [] }) as unknown as WbsTree;

/** Cleans a saved tree: known entries only, a set once, node ids unique. Undefined when there is nothing in it. */
export function normalizeWbsTree(raw: unknown): WbsTree | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const seen = new Set<string>();
  const ids = new Set<string>();
  const clean = (list: unknown): WbsEntry[] => (Array.isArray(list) ? list : []).flatMap((e): WbsEntry[] => {
    if (!e || typeof e !== 'object') return [];
    const x = e as { kind?: unknown; group?: unknown; id?: unknown; name?: unknown; children?: unknown; bar?: unknown };
    if (x.kind === 'set') {
      const g = text(x.group);
      if (!g || seen.has(norm(g))) return [];
      seen.add(norm(g));
      return [{ kind: 'set', group: g }];
    }
    if (x.kind !== 'node') return [];
    let id = text(x.id) || 'N1';
    for (let n = 1; ids.has(id); n++) id = `${text(x.id) || 'N'}-${n}`;
    ids.add(id);
    return [{ kind: 'node', id, name: text(x.name), children: clean(x.children), ...(x.bar === false ? { bar: false } : {}) }];
  });
  const children = clean((raw as Partial<WbsTree>).children);
  return children.length ? { children } : undefined;
}

/** The sets of the tree (or of an entry) in build order: depth first, top to bottom. */
export function setsOf(entries: readonly WbsEntry[]): string[] {
  return entries.flatMap((e) => (e.kind === 'set' ? [e.group] : setsOf(e.children)));
}

/** The node of an id, anywhere in the tree. */
export function findNode(entries: readonly WbsEntry[], id: string): WbsNode | null {
  for (const e of entries) {
    if (e.kind !== 'node') continue;
    if (e.id === id) return e;
    const inner = findNode(e.children, id);
    if (inner) return inner;
  }
  return null;
}

/** The ids of the nodes from the top down to the entry (a set by its name, a node by its id), not counting the entry; null when it is not in the tree. */
export function pathTo(entries: readonly WbsEntry[], target: { set: string } | { node: string }, above: string[] = []): string[] | null {
  for (const e of entries) {
    if ('set' in target ? e.kind === 'set' && norm(e.group) === norm(target.set) : e.kind === 'node' && e.id === target.node) return above;
    if (e.kind === 'node') {
      const inner = pathTo(e.children, target, [...above, e.id]);
      if (inner) return inner;
    }
  }
  return null;
}

/** A node id the tree does not have. */
export function freshNodeId(tree: WbsTree): string {
  const taken = new Set<string>();
  const walk = (list: readonly WbsEntry[]) => { for (const e of list) if (e.kind === 'node') { taken.add(e.id); walk(e.children); } };
  walk(tree.children);
  let n = taken.size + 1;
  while (taken.has(`N${n}`)) n++;
  return `N${n}`;
}

/** The tree with each list of children run through `fn` (the top list has parent null). */
function mapLists(tree: WbsTree, fn: (children: WbsEntry[], parent: string | null) => WbsEntry[]): WbsTree {
  const walk = (list: WbsEntry[], parent: string | null): WbsEntry[] =>
    fn(list, parent).map((e) => (e.kind === 'node' ? { ...e, children: walk(e.children, e.id) } : e));
  return { children: walk(tree.children, null) };
}

const sameEntry = (a: WbsEntry, b: WbsEntry) => (a.kind === 'set' ? b.kind === 'set' && norm(a.group) === norm(b.group) : b.kind === 'node' && a.id === b.id);

/** The tree without an entry (and, for a node, without what is inside it). */
export function removeEntry(tree: WbsTree, entry: WbsEntry): WbsTree {
  return mapLists(tree, (list) => list.filter((e) => !sameEntry(e, entry)));
}

/** The tree with an entry put at a place. A set that is in the tree already is moved there; a node cannot go inside itself. */
export function placeEntry(tree: WbsTree, entry: WbsEntry, place: WbsPlace): WbsTree {
  if (entry.kind === 'node' && place.parent !== null && (place.parent === entry.id || (pathTo(entry.children, { node: place.parent }) !== null))) return tree;
  // The index counts the entries as they are, so moving one down its own list must not count the place it leaves.
  const before = place.parent === null ? tree.children : findNode(tree.children, place.parent)?.children;
  if (!before) return tree;
  const from = before.findIndex((e) => sameEntry(e, entry));
  const index = from >= 0 && from < place.index ? place.index - 1 : place.index;
  const kept = removeEntry(tree, entry.kind === 'set' ? entry : { ...entry, children: [] });
  return mapLists(kept, (list, parent) => {
    if (parent !== place.parent) return list;
    const next = [...list];
    next.splice(Math.max(0, Math.min(index, next.length)), 0, entry);
    return next;
  });
}

/** The tree with a node changed. */
export function patchNode(tree: WbsTree, id: string, patch: Partial<Pick<WbsNode, 'name' | 'bar'>>): WbsTree {
  return mapLists(tree, (list) => list.map((e) => (e.kind === 'node' && e.id === id ? { ...e, ...patch } : e)));
}

/** The tree with a node taken out and what was inside it put in its place. */
export function unwrapNode(tree: WbsTree, id: string): WbsTree {
  return mapLists(tree, (list) => list.flatMap((e) => (e.kind === 'node' && e.id === id ? e.children : [e])));
}

/** The scenario's steps (the generator's sequence). */
export const stepsOfRules = (rules: Pick<ScenarioRules, 'sequences'>): SequenceStep[] => rules.sequences.find((s) => s.id.toUpperCase() === STEPS_ID)?.steps ?? [];

/** The tree as the scenario has it, matched to its steps: a set that is no step any more (taken off the Work breakdown list) is dropped, and a step the
    tree does not hold yet is added at the bottom. `inOrder` says whether the tree's order is the steps' order (it is not when the list was reordered
    elsewhere: the steps are what the generator builds). With no tree saved, the steps make a flat one. */
export function treeOfRules(rules: Pick<ScenarioRules, 'sequences' | 'wbsTree'>): { tree: WbsTree; inOrder: boolean } {
  const steps = stepsOfRules(rules).map((s) => s.group).filter((g) => g.trim() !== '');
  const wanted = new Set(steps.map(norm));
  const kept = mapLists(rules.wbsTree ?? EMPTY_TREE, (list) => list.filter((e) => e.kind === 'node' || wanted.has(norm(e.group))));
  const held = new Set(setsOf(kept.children).map(norm));
  const added = [...new Map(steps.filter((g) => !held.has(norm(g))).map((g) => [norm(g), g])).values()];
  const tree = added.length ? { children: [...kept.children, ...added.map((group): WbsSet => ({ kind: 'set', group }))] } : kept;
  const order = setsOf(tree.children).map(norm);
  const firsts = [...new Set(steps.map(norm))];
  return { tree, inOrder: order.length === firsts.length && order.every((g, i) => g === firsts[i]) };
}

/** The rules with a tree: the tree is kept, and the steps are its sets in tree order, each keeping its own options (by its set). The steps sequence
    keeps its other fields; it goes when the tree holds no set. */
export function withTree(rules: ScenarioRules, tree: WbsTree): ScenarioRules {
  const old = rules.sequences.find((s) => s.id.toUpperCase() === STEPS_ID);
  const options = new Map((old?.steps ?? []).map((s) => [norm(s.group), s] as const).reverse());
  const steps = setsOf(tree.children).map((group): SequenceStep => ({ ...(options.get(norm(group)) ?? {}), group }));
  const others = rules.sequences.filter((s) => s !== old);
  const sequences = steps.length ? [{ ...(old ?? { id: STEPS_ID, name: 'Steps' }), steps }, ...others] : others;
  const { wbsTree: _old, ...rest } = rules;
  return tree.children.length ? { ...rest, sequences, wbsTree: tree } : { ...rest, sequences };
}

/** The rules with one step's options changed (its set named by `group`). */
export function withStep(rules: ScenarioRules, group: string, patch: Partial<Omit<SequenceStep, 'group'>>): ScenarioRules {
  const sequences = rules.sequences.map((q) => (q.id.toUpperCase() !== STEPS_ID ? q : { ...q, steps: q.steps.map((s) => (norm(s.group) === norm(group) ? { ...s, ...patch } : s)) }));
  return { ...rules, sequences };
}

/** The summary bars the tree's nodes make: one per node that has sets inside it (at any depth) and whose bar is on. */
export function nodeBars(tree: WbsTree | undefined): { id: string; name: string; sets: string[] }[] {
  const out: { id: string; name: string; sets: string[] }[] = [];
  const walk = (list: readonly WbsEntry[]) => {
    for (const e of list) {
      if (e.kind !== 'node') continue;
      const sets = setsOf(e.children);
      if (e.bar !== false && sets.length) out.push({ id: e.id, name: e.name || 'Untitled', sets });
      walk(e.children);
    }
  };
  walk(tree?.children ?? []);
  return out;
}

export const NODE_BAR_PREFIX = 'WBS ';

/** The rules as the generator reads the tree: each node's summary bar is a level task pointing at a rule group of the node's sets made per building and
    level (the same shape as a summary bar for a folder). The tree itself is not sent. The same rules when there is no tree. */
export function withNodeBars(rules: ScenarioRules): ScenarioRules {
  if (!rules.wbsTree) return rules;
  const { wbsTree, ...rest } = rules;
  const bars = nodeBars(wbsTree);
  if (!bars.length) return rest;
  const groups: RuleGroup[] = bars.map((b) => ({ id: `${NODE_BAR_PREFIX}${b.id}: ${b.name}`, name: b.name, forEach: ['building', 'level'], filters: [], include: b.sets }));
  const tasks: LevelTask[] = bars.map((b, i) => ({ id: `WBS-${b.id}`, name: b.name, group: groups[i].id }));
  const ids = new Set(groups.map((g) => norm(g.id)));
  const taskIds = new Set(tasks.map((t) => norm(t.id)));
  return { ...rest, groups: [...rest.groups.filter((g) => !ids.has(norm(g.id))), ...groups], levelTasks: [...rest.levelTasks.filter((t) => !taskIds.has(norm(t.id))), ...tasks] };
}
