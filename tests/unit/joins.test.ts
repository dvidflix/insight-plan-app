import { describe, expect, it } from 'vitest';
import { joinObjects, joinMap, unjoinObjects, withJoins } from '../../src/prs/joins';
import { NO_RULES, mergeRules, normalizeRules, totalRules } from '../../src/prs/rules';
import { PRESET_1HDAB_TOC, normalizePresets, withoutJoins } from '../../src/prs/presets';

describe('joining objects', () => {
  it('makes the first picked the main object', () => {
    const r = joinObjects(NO_RULES, ['B', 'A', 'C']);
    expect(r.joins).toEqual([{ id: 'JOIN', main: 'B', members: ['A', 'C'] }]);
    expect(joinObjects(NO_RULES, ['A'])).toBe(NO_RULES);
  });

  it('keeps an object in one join: picking a main brings its members, a member leaves its old join', () => {
    const first = joinObjects(NO_RULES, ['A', 'B', 'C']);
    const second = joinObjects(first, ['D', 'A']);
    expect(second.joins).toEqual([{ id: 'JOIN', main: 'D', members: ['A', 'B', 'C'] }]);
    const third = joinObjects(first, ['D', 'C']);
    expect(third.joins).toEqual([{ id: 'JOIN', main: 'A', members: ['B'] }, { id: 'JOIN-2', main: 'D', members: ['C'] }]);
  });

  it('splits objects out again', () => {
    const r = joinObjects(NO_RULES, ['A', 'B', 'C']);
    expect(unjoinObjects(r, ['B']).joins[0].members).toEqual(['C']);
    expect(unjoinObjects(r, ['A']).joins).toEqual([]);
    expect(unjoinObjects(r, ['Z'])).toBe(r);
    expect(joinMap(r.joins).get('C')).toBe('A');
  });

  it('is saved with the rules', () => {
    const r = joinObjects(NO_RULES, ['A', 'B']);
    expect(normalizeRules(JSON.parse(JSON.stringify(r))).joins).toEqual(r.joins);
    expect(totalRules(r)).toBe(1);
    expect(normalizeRules({ joins: [{ id: 'X', main: 'A', members: ['A', 'B'] }] }).joins[0].members).toEqual(['B']);
  });

  it('stays when a preset is added to the scenario', () => {
    const joined = joinObjects(NO_RULES, ['A', 'B']);
    const merged = mergeRules(joined, PRESET_1HDAB_TOC.content.rules);
    expect(merged.joins).toEqual(joined.joins);
    expect(merged.groups.length).toBeGreaterThan(0);
  });

  it('belong to the scenario, not to a preset: loading one keeps them, saving one leaves them out', () => {
    const joined = joinObjects(NO_RULES, ['A', 'B']);
    // Load: the preset's rules, the scenario's own joins
    const loaded = withJoins(PRESET_1HDAB_TOC.content.rules, joined.joins);
    expect(loaded.joins).toEqual(joined.joins);
    expect(loaded.groups).toEqual(PRESET_1HDAB_TOC.content.rules.groups);
    // Save as a preset: no joins
    expect(withoutJoins(joined).joins).toEqual([]);
    const saved = normalizePresets([{ id: 'X', name: 'X', savedAt: '', content: { rules: { ...PRESET_1HDAB_TOC.content.rules, joins: joined.joins }, extras: [], relations: [], crews: [] } }]);
    expect(saved[0].content.rules.joins).toEqual([]);
    // A scenario with joins only is not an empty one, and none at all is
    expect(withJoins(NO_RULES, joined.joins)).not.toBe(NO_RULES);
    expect(withJoins(joined, [])).toBe(NO_RULES);
  });

  it('are not brought by a file or preset that is added', () => {
    const a = joinObjects(NO_RULES, ['A', 'B']);
    const other = { ...PRESET_1HDAB_TOC.content.rules, joins: [{ id: 'JOIN', main: 'Z', members: ['Y'] }] };
    expect(mergeRules(a, other).joins).toEqual(a.joins);
  });
});
