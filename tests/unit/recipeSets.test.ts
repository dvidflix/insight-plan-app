import { describe, expect, it } from 'vitest';
import { groupToSearchSet, isExact, RECIPE_SETS_FOLDER } from '../../src/prs/groupSets';
import { recipeNeeds } from '../../src/prs/recipeNeeds';
import { normalizeRules, type RuleGroup } from '../../src/prs/rules';

const group = (over: Partial<RuleGroup>): RuleGroup => ({ id: 'WALLS', forEach: [], filters: [], ...over });
const f = (field: string, op: string, value: string, conj: 'and' | 'or' = 'and') => ({ id: field + op, field, op: op as never, value, conj });

describe('rule groups as search sets', () => {
  it('turns conditions into CWA Pour conditions', () => {
    const { set, notes } = groupToSearchSet(group({ filters: [f('type', 'equals', 'MAIN_SLAB|SLAB'), f('volume', 'atLeast', '2'), f('prop:CWA Pour/Zone Name', 'contains', 'A')] }));
    expect(set.group).toBe(RECIPE_SETS_FOLDER);
    expect(set.name).toBe('WALLS');
    expect(set.conditions.map((c) => [c.field, c.op])).toEqual([['CWA Pour.Pour Type', 'regex'], ['CWA Pour.Pour Volume m3', 'gte'], ['CWA Pour.Zone Name', 'contains']]);
    expect(new RegExp(set.conditions[0].value, 'i').test('Main Slab')).toBe(true);
    expect(new RegExp(set.conditions[0].value, 'i').test('Wall')).toBe(false);
    expect(notes).toEqual([]);
  });

  it('says what it cannot take over', () => {
    const { set, notes } = groupToSearchSet(group({ forEach: ['level'], include: ['a'], filters: [f('family', 'equals', 'wall'), f('level', 'equals', 'L1', 'or')] }));
    expect(notes.join('|')).toMatch(/named one by one/);
    expect(isExact(group({ filters: [f('family', 'equals', 'wall')] }))).toBe(false); // a family is read from type and stage: close, not exact
    expect(isExact(group({ filters: [f('type', 'equals', 'WALL')] }))).toBe(true);
    expect(groupToSearchSet(group({ forEach: ['level'], filters: [f('type', 'equals', 'WALL')] })).approx.join('|')).toMatch(/per level/);
    expect(groupToSearchSet(group({ filters: [f('external', 'equals', 'true')] })).notes.join('|')).toMatch(/external/);
    expect(set.conditions.length).toBeGreaterThan(0);
  });
});

describe('what a recipe needs', () => {
  it('adds days, takes the largest crew and the most of each resource', () => {
    const rules = normalizeRules({ crewTemplates: [{ id: 'C1', trades: [{ trade: 'SF', size: 6 }, { trade: 'CP', size: 4 }] }] });
    const n = recipeNeeds({ id: 'R', group: 'WALLS', tasks: [{ phase: 'Rebar', days: 3, crew: 'C1', cranes: [{ type: 'TC1' }] }, { phase: 'Concrete', days: 1, cranes: [{ type: 'tc1', count: 2 }], equipment: [{ type: 'PUMP' }] }] }, rules);
    expect(n.days).toBe(4);
    expect(n.people).toBe(10);
    expect(n.cranes).toEqual([{ type: 'TC1', count: 2 }]);
    expect(n.equipment).toEqual([{ type: 'PUMP', count: 1 }]);
  });
});

import { groupFromSet, groupsWithSets } from '../../src/prs/groupSets';

describe('a set as the generator\'s group', () => {
  it('comes back as the conditions it was made from', () => {
    const { set } = groupToSearchSet(group({ filters: [f('type', 'equals', 'MAIN_SLAB|SLAB'), f('volume', 'atLeast', '2'), f('level', 'notEquals', 'L1')] }));
    const back = groupFromSet(set);
    expect(back.lost).toEqual([]);
    expect(back.group.id).toBe('WALLS');
    expect(back.group.filters.map((x) => [x.field, x.op, x.value])).toEqual([['type', 'equals', 'MAIN_SLAB|SLAB'], ['volume', 'atLeast', '2'], ['level', 'notEquals', 'L1']]);
  });

  it('replaces the group of its name and leaves the others', () => {
    const { set } = groupToSearchSet(group({ id: 'SLABS', filters: [f('type', 'equals', 'SLAB')] }));
    const groups = groupsWithSets([group({ id: 'SLABS', filters: [f('type', 'equals', 'OLD')] }), group({ id: 'OTHER', filters: [f('type', 'equals', 'X')] })], [set]);
    expect(groups.map((g) => g.id).sort()).toEqual(['OTHER', 'SLABS']);
    expect(groups.find((g) => g.id === 'SLABS')!.filters[0].value).toBe('SLAB');
    const again = groupsWithSets(groups, [set]);
    expect(again).toBe(groups); // nothing to change: the same list
  });
});

import { duplicateSets, uniqueGroups } from '../../src/prs/groupSets';
import { forGenerator } from '../../src/prs/recipeRules';

describe('no activity twice', () => {
  it('leaves the chains and assignments out when there are recipes, and keeps them when there are none', () => {
    const withRecipes = normalizeRules({ chains: [{ id: 'A|REBAR', group: 'A', order: 1, phase: 'Rebar' }], assignments: [{ id: 'A|REBAR', group: 'A', phase: 'Rebar', days: 2 }], recipes: [{ id: 'A', group: 'A', tasks: [{ phase: 'Rebar' }] }] });
    expect(forGenerator(withRecipes).chains).toEqual([]);
    expect(forGenerator(withRecipes).assignments).toEqual([]);
    const none = normalizeRules({ chains: [{ id: 'A|REBAR', group: 'A', order: 1, phase: 'Rebar' }] });
    expect(forGenerator(none)).toBe(none);
  });

  it('keeps a group ID and a set name once', () => {
    const g = [group({ id: 'ANY' }), group({ id: 'X' }), group({ id: 'any' })];
    expect(uniqueGroups(g).map((x) => x.id)).toEqual(['X', 'any']);
    const a = groupToSearchSet(group({ id: 'SLAB', filters: [f('type', 'equals', 'SLAB')] })).set;
    const b = { ...a, id: 'other' };
    expect(duplicateSets([a, b]).map((x) => x.id)).toEqual(['other']);
  });
});
