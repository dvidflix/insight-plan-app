import { describe, expect, it } from 'vitest';
import { groupNamesUsed, replaceGroupName } from '../../src/prs/replaceGroup';
import { NO_RULES, normalizeRules } from '../../src/prs/rules';

const rules = () => normalizeRules({
  ...NO_RULES,
  groups: [{ id: 'WALLS', name: 'WALLS', forEach: [], filters: [] }],
  sequences: [{ id: 's', steps: [{ group: 'WALLS' }, { group: 'Slabs|Walls' }] }],
  levelTasks: [{ id: 'l', name: 'Walls', group: 'walls' }],
  limits: [{ id: 'x', phase: 'Formwork', group: 'SLABS', max: 4 }],
});

describe('replace a group by another', () => {
  it('changes every place that names it, case-blind, and leaves the groups themselves', () => {
    const r = replaceGroupName(rules(), 'WALLS', 'Internal Wall|External Wall');
    expect(r.count).toBe(3);
    expect(r.rules.sequences[0].steps.map((s) => s.group)).toEqual(['Internal Wall|External Wall', 'Slabs|Internal Wall|External Wall']);
    expect(r.rules.levelTasks[0].group).toBe('Internal Wall|External Wall');
    expect(r.rules.limits[0].group).toBe('SLABS');
    expect(r.rules.groups.map((g) => g.id)).toEqual(['WALLS']);
  });
  it('is the same rules when nothing names it, and lists the names in use', () => {
    const base = rules();
    expect(replaceGroupName(base, 'NOPE', 'X').rules).toBe(base);
    expect(groupNamesUsed(base).map((n) => n.toUpperCase())).toEqual(['SLABS', 'WALLS']);
  });
});
