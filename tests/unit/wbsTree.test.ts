import { describe, expect, it } from 'vitest';
import { NO_RULES, normalizeRules, type ScenarioRules } from '../../src/prs/rules';
import { findNode, nodeBars, normalizeWbsTree, pathTo, placeEntry, removeEntry, setsOf, treeOfRules, unwrapNode, withNodeBars, withStep, withTree, type WbsTree } from '../../src/prs/wbsTree';

const set = (group: string) => ({ kind: 'set' as const, group });
const node = (id: string, name: string, children: WbsTree['children'], bar?: boolean) => ({ kind: 'node' as const, id, name, children, ...(bar === false ? { bar } : {}) });

const tree: WbsTree = {
  children: [
    node('N1', 'First', [set('A'), set('B'), node('N2', 'Inner', [set('C')])]),
    set('D'),
  ],
};

const withSteps = (groups: { group: string; perLevel?: boolean; lagHours?: number }[], wbsTree?: WbsTree): ScenarioRules =>
  ({ ...NO_RULES, sequences: [{ id: 'STEPS', name: 'Steps', steps: groups }], ...(wbsTree ? { wbsTree } : {}) });

describe('wbs tree', () => {
  it('lists the sets depth first, in build order', () => {
    expect(setsOf(tree.children)).toEqual(['A', 'B', 'C', 'D']);
    expect(pathTo(tree.children, { set: 'c' })).toEqual(['N1', 'N2']);
    expect(pathTo(tree.children, { set: 'X' })).toBeNull();
    expect(findNode(tree.children, 'N2')?.name).toBe('Inner');
  });

  it('moves a set, counting the place it leaves', () => {
    // A to after B in the same list: index 2 among [A, B, N2] lands between B and N2.
    expect(setsOf(placeEntry(tree, set('A'), { parent: 'N1', index: 2 }).children)).toEqual(['B', 'A', 'C', 'D']);
    expect(setsOf(placeEntry(tree, set('D'), { parent: 'N2', index: 0 }).children)).toEqual(['A', 'B', 'D', 'C']);
    expect(setsOf(placeEntry(tree, set('E'), { parent: null, index: 0 }).children)).toEqual(['E', 'A', 'B', 'C', 'D']);
  });

  it('moves a node with what is in it, never into itself', () => {
    const inner = findNode(tree.children, 'N2')!;
    const moved = placeEntry(tree, inner, { parent: null, index: 2 });
    expect(setsOf(moved.children)).toEqual(['A', 'B', 'D', 'C']);
    const outer = findNode(tree.children, 'N1')!;
    expect(placeEntry(tree, outer, { parent: 'N2', index: 0 })).toBe(tree);
    expect(placeEntry(tree, outer, { parent: 'N1', index: 0 })).toBe(tree);
  });

  it('removes and unwraps', () => {
    expect(setsOf(removeEntry(tree, findNode(tree.children, 'N2')!).children)).toEqual(['A', 'B', 'D']);
    const flat = unwrapNode(tree, 'N1');
    expect(flat.children.map((e) => (e.kind === 'set' ? e.group : e.id))).toEqual(['A', 'B', 'N2', 'D']);
  });

  it('cleans a saved tree: a set once, unique node ids', () => {
    const raw = { children: [set('A'), set('a'), { kind: 'node', id: 'N1', name: ' X ', children: [set('B')] }, { kind: 'node', id: 'N1', name: 'Y', children: [] }, { kind: 'odd' }] };
    const clean = normalizeWbsTree(raw)!;
    expect(setsOf(clean.children)).toEqual(['A', 'B']);
    expect(clean.children.filter((e) => e.kind === 'node').map((e) => (e.kind === 'node' ? e.id : ''))).toEqual(['N1', 'N1-1']);
    expect(normalizeWbsTree({ children: [] })).toBeUndefined();
    expect(normalizeRules({ wbsTree: tree }).wbsTree).toEqual(tree);
  });
});

describe('the tree and the steps', () => {
  it('writes the steps in tree order, keeping each step’s options', () => {
    const rules = withSteps([{ group: 'D' }, { group: 'A', perLevel: true }, { group: 'B', lagHours: 8 }, { group: 'C' }]);
    const out = withTree(rules, tree);
    expect(out.sequences[0].steps).toEqual([{ group: 'A', perLevel: true }, { group: 'B', lagHours: 8 }, { group: 'C' }, { group: 'D' }]);
    expect(out.wbsTree).toBe(tree);
    expect(withTree(out, { children: [] }).sequences).toEqual([]);
  });

  it('matches a saved tree to steps changed elsewhere', () => {
    // B was taken off the list and E added; the order is otherwise the tree's.
    const r = treeOfRules(withSteps([{ group: 'A' }, { group: 'C' }, { group: 'D' }, { group: 'E' }], tree));
    expect(setsOf(r.tree.children)).toEqual(['A', 'C', 'D', 'E']);
    expect(r.inOrder).toBe(true);
    // Reordered on the list: the tree says it is not in the generator's order.
    expect(treeOfRules(withSteps([{ group: 'D' }, { group: 'A' }, { group: 'B' }, { group: 'C' }], tree)).inOrder).toBe(false);
    // No tree yet: the steps make a flat one.
    expect(treeOfRules(withSteps([{ group: 'X' }, { group: 'Y' }])).tree.children).toEqual([set('X'), set('Y')]);
  });

  it('changes one step', () => {
    const out = withStep(withSteps([{ group: 'A' }, { group: 'B' }]), 'b', { perLevel: true });
    expect(out.sequences[0].steps).toEqual([{ group: 'A' }, { group: 'B', perLevel: true }]);
  });
});

describe('summary bars from nodes', () => {
  it('makes one bar per node with sets, over every set inside it', () => {
    expect(nodeBars(tree)).toEqual([{ id: 'N1', name: 'First', sets: ['A', 'B', 'C'] }, { id: 'N2', name: 'Inner', sets: ['C'] }]);
    expect(nodeBars({ children: [node('N1', 'Off', [set('A')], false), node('N2', 'Empty', [])] })).toEqual([]);
  });

  it('gives the generator a level task and a per building and level group, and not the tree', () => {
    const out = withNodeBars(withSteps([{ group: 'A' }], { children: [node('N1', 'First', [set('A'), set('B')])] }));
    expect(out.wbsTree).toBeUndefined();
    expect(out.groups).toEqual([{ id: 'WBS N1: First', name: 'First', forEach: ['building', 'level'], filters: [], include: ['A', 'B'] }]);
    expect(out.levelTasks).toEqual([{ id: 'WBS-N1', name: 'First', group: 'WBS N1: First' }]);
    const plain = withSteps([{ group: 'A' }]);
    expect(withNodeBars(plain)).toBe(plain);
  });
});
