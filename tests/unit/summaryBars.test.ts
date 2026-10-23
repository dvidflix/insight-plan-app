import { describe, expect, it } from 'vitest';
import { barSetNames, withBarGroups } from '../../src/prs/summaryBars';
import { duplicateSetNames } from '../../src/viewer/setTree';
import { NO_RULES, type ScenarioRules } from '../../src/prs/rules';
import type { SearchSet } from '../../src/viewer/searchSets';

const set = (name: string, group: string, kind: SearchSet['kind'] = 'search'): SearchSet => ({ id: name + group, name, group, kind, match: 'all', conditions: [] });
const sets = [set('A1', 'Build / A'), set('A2', 'Build / A'), set('B1', 'Build / B'), set('Pick', 'Build / A', 'selection')];
const rules = (tasks: ScenarioRules['levelTasks'], groups: ScenarioRules['groups'] = []): ScenarioRules => ({ ...NO_RULES, levelTasks: tasks, groups });

describe('summary bars for the set tree', () => {
  it('points a bar for a folder at a group of its sets, made per building and level', () => {
    const out = withBarGroups(rules([{ id: 'LT-1', name: 'Bar', group: 'Build' }]), sets);
    expect(out.levelTasks[0].group).toBe('Build (per level)');
    expect(out.groups).toEqual([{ id: 'Build (per level)', name: 'Build (per level)', forEach: ['building', 'level'], filters: [], include: ['A1', 'A2', 'B1'] }]);
  });
  it('does the same for one set, shares a group between bars, and keeps the scenario\'s target as typed', () => {
    const input = rules([{ id: 'LT-1', name: 'One', group: 'A1' }, { id: 'LT-2', name: 'Two', group: 'A1' }]);
    const out = withBarGroups(input, sets);
    expect(out.groups).toHaveLength(1);
    expect(out.levelTasks.map((t) => t.group)).toEqual(['A1 (per level)', 'A1 (per level)']);
    expect(input.levelTasks[0].group).toBe('A1');
  });
  it('leaves a rule group that is already made per something, and bars for nothing, alone', () => {
    const own = rules([{ id: 'LT-1', name: 'Own', group: 'G' }], [{ id: 'G', forEach: ['level'], filters: [] }]);
    expect(withBarGroups(own, sets)).toBe(own);
    const none = rules([{ id: 'LT-1', name: 'None', group: 'Nowhere' }]);
    expect(withBarGroups(none, sets)).toBe(none);
  });
  it('names the sets bars are for, and the sets that share a name', () => {
    expect(barSetNames([{ id: 'x', name: 'x', group: 'Build / B' }, { id: 'y', name: 'y', group: 'A1', enabled: false }], sets)).toEqual(['B1']);
    expect(duplicateSetNames([...sets, set('A1', 'Other')])).toEqual([{ name: 'A1', folders: ['Build / A', 'Other'] }]);
  });
});
