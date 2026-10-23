import { describe, expect, it } from 'vitest';
import { buildBreakdown, makesItems, normalizeBreakdown, type BreakdownDefinition, type BreakdownObject, type GroupingLevel } from '../../src/prs/workBreakdown';

const obj = (key: string, props: Record<string, unknown>): BreakdownObject => ({ key, guid: key, name: key, props });
const lvl = (id: string, property: string, role: GroupingLevel['role'], sort: GroupingLevel['sort'] = 'natural', extra: Partial<GroupingLevel> = {}): GroupingLevel => ({ id, name: id, source: { kind: 'property', property }, role, sort, ...extra });
const noSets = () => [];

const OBJECTS = [
  obj('a', { Hall: 'H2', Floor: 'L10', System: 'Cooling', Weight: 5 }),
  obj('b', { Hall: 'H1', Floor: 'L2', System: 'Power', Weight: 2.5 }),
  obj('c', { Hall: 'H1', Floor: 'L2', System: 'Cooling', Weight: '4' }),
  obj('d', { Hall: 'H1', Floor: 'L2', System: 'Cooling', Weight: 6 }),
  obj('e', { Hall: 'H1', Floor: 'L10', System: 'Cooling' }),
  obj('f', { Hall: 'H1', Floor: 'L2' }), // no system: left out
];

const def = (over: Partial<BreakdownDefinition> = {}): BreakdownDefinition => ({
  levels: [lvl('b', 'Hall', 'building'), lvl('l', 'Floor', 'level', 'number'), lvl('s', 'System', 'item')],
  ...over,
});

describe('the work breakdown as grouping levels', () => {
  it('makes a work item of each group at the last level, in the order of the levels', () => {
    const r = buildBreakdown({ definition: def(), objects: OBJECTS, sets: noSets });
    expect(r.leaves.map((l) => l.values)).toEqual([['H1', 'L2', 'Cooling'], ['H1', 'L2', 'Power'], ['H1', 'L10', 'Cooling'], ['H2', 'L10', 'Cooling']]);
    expect(r.leaves[0].item).toMatchObject({ group: 'Cooling', building: 'H1', level: 'L2', quantity: 2, quantities: { count: 2 } });
    expect(r.leaves[0].keys).toEqual(['c', 'd']);
    expect(r.sequence).toEqual(r.leaves.map((l, i) => ({ GUID: l.item.id, Index: i + 1 })));
    expect(new Set(r.leaves.map((l) => l.item.id)).size).toBe(4);
  });
  it('leaves out the objects that have no value at the level of the group, and says how many', () => {
    expect(buildBreakdown({ definition: def(), objects: OBJECTS, sets: noSets }).leftOut).toBe(1);
  });
  it('adds up a numeric property for the quantity, else counts the objects', () => {
    const r = buildBreakdown({ definition: def({ quantityProperty: 'Weight' }), objects: OBJECTS, sets: noSets });
    expect(r.leaves[0].item.quantity).toBe(10); // 4 (text) + 6
    expect(r.leaves[0].item.quantities).toEqual({ count: 2, Weight: 10 });
    expect(r.leaves[2].item.quantity).toBe(0); // no weight on the object: nothing to add
  });
  it('sorts a level by value, by the number in it, or as listed', () => {
    const natural = buildBreakdown({ definition: def({ levels: [lvl('l', 'Floor', 'level', 'natural'), lvl('s', 'System', 'item')] }), objects: OBJECTS, sets: noSets });
    expect(natural.leaves.map((l) => l.values[0])).toEqual(['L2', 'L2', 'L10']); // numbers in their order
    const listed = buildBreakdown({ definition: def({ levels: [lvl('s', 'System', 'item', 'listed', { order: ['Power', 'Cooling'] })] }), objects: OBJECTS, sets: noSets });
    expect(listed.leaves.map((l) => l.values[0])).toEqual(['Power', 'Cooling']);
  });
  it('gives an object the first set of a folder that holds it, in the folder\'s order', () => {
    const sets = (folder: string) => (folder === 'F' ? [{ name: 'Second' + '', keys: new Set(['b', 'c']) }, { name: 'First', keys: new Set(['c', 'd']) }] : []);
    const levels = [{ id: 's', name: 'Set', source: { kind: 'sets' as const, folder: 'F' }, role: 'item' as const, sort: 'set' as const }];
    const r = buildBreakdown({ definition: { levels }, objects: OBJECTS, sets });
    expect(r.leaves.map((l) => [l.values[0], l.keys])).toEqual([['Second', ['b', 'c']], ['First', ['d']]]);
    expect(r.leftOut).toBe(3); // a, e, f are in no set
  });
  it('joins the values of several levels that share a role, and skips levels that are off', () => {
    const levels = [lvl('s', 'System', 'item'), lvl('h', 'Hall', 'item', 'natural', { enabled: false }), lvl('f', 'Floor', 'item')];
    const r = buildBreakdown({ definition: { levels }, objects: OBJECTS, sets: noSets });
    expect(r.leaves[0].item.group).toBe('Cooling - L2');
    expect(r.leaves[0].values).toHaveLength(2);
  });
  it('makes no items without a level whose value is the group', () => {
    const d: BreakdownDefinition = { levels: [lvl('b', 'Hall', 'building')] };
    expect(makesItems(d)).toBe(false);
    expect(buildBreakdown({ definition: d, objects: OBJECTS, sets: noSets }).leaves).toEqual([]);
    expect(makesItems(def())).toBe(true);
    expect(makesItems({ levels: [lvl('s', '', 'item')] })).toBe(false);
  });
  it('cleans a saved definition', () => {
    expect(normalizeBreakdown(undefined)).toBeUndefined();
    expect(normalizeBreakdown({ levels: [] })).toBeUndefined();
    const n = normalizeBreakdown({ levels: [{ id: 'x', name: ' A ', source: { kind: 'sets', folder: ' F ' }, role: 'bogus', sort: 'listed', order: [' a ', ''], enabled: false }, { source: {} }], quantityProperty: ' Q ' })!;
    expect(n.quantityProperty).toBe('Q');
    expect(n.levels[0]).toEqual({ id: 'x', name: 'A', source: { kind: 'sets', folder: 'F' }, role: 'structure', sort: 'listed', order: ['a'], enabled: false });
    expect(n.levels[1]).toMatchObject({ id: 'L2', source: { kind: 'property', property: '' }, sort: 'natural' });
  });
});
