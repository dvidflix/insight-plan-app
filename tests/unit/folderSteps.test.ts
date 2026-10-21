import { describe, expect, it } from 'vitest';
import { folderStepSets, withFolderSteps } from '../../src/prs/folderSteps';
import { groupFromSet } from '../../src/prs/groupSets';
import { NO_RULES, normalizeRules } from '../../src/prs/rules';
import type { SearchSet } from '../../src/viewer/searchSets';

const set = (name: string, group = 'Steps', over: Partial<SearchSet> = {}): SearchSet => ({ id: name, name, group, kind: 'search', match: 'all', conditions: [], ...over });

describe('sequence steps from a folder of sets', () => {
  it('takes the sets in numbered order, leaving out selection sets and other folders', () => {
    const sets = [set('10 Roof'), set('2 Walls'), set('1 Rafts'), set('9 Fixed', 'Steps', { kind: 'selection' }), set('Other', 'Else')];
    expect(folderStepSets(sets, 'Steps').map((s) => s.name)).toEqual(['1 Rafts', '2 Walls', '10 Roof']);
  });
  it('makes the steps, keeping a step\'s own options, and is the same rules when nothing changes', () => {
    const sets = [set('B'), set('A')];
    const rules = normalizeRules({ ...NO_RULES, sequences: [{ id: 's', stepsFolder: 'Steps', steps: [{ group: 'A', perLevel: true }] }] });
    const next = withFolderSteps(rules, sets);
    expect(next.sequences[0].steps).toEqual([{ group: 'B' }, { group: 'A', perLevel: true }]);
    expect(withFolderSteps(next, sets)).toBe(next);
  });
});

describe('a set on a model property as a group', () => {
  it('is tested as the property of the pour', () => {
    const { group, lost } = groupFromSet(set('Main Slab', 'X', { conditions: [{ id: 'c', field: 'Pset_Logic.LogicGroup', op: 'equals', value: 'Main Slab' }] }), () => 'x');
    expect(lost).toEqual([]);
    expect(group.filters.map((f) => [f.field, f.op, f.value])).toEqual([['prop:Pset_Logic/LogicGroup', 'equals', 'Main Slab']]);
  });
});
