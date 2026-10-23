import { describe, expect, it } from 'vitest';
import { attachedSetNames, attachSummary, resolveAttachments, setsOfTarget } from '../../src/prs/extraAttach';
import type { SearchSet } from '../../src/viewer/searchSets';
import type { ExtraTag } from '../../src/prs/rules';

const set = (name: string, group: string, kind: SearchSet['kind'] = 'search'): SearchSet => ({ id: name, name, group, kind, match: 'all', conditions: [] });
const sets = [set('A1', 'Build / A'), set('A2', 'Build / A'), set('B1', 'Build / B'), set('Pick', 'Build / A', 'selection'), set('Solo', '')];

describe('extra activities attached to the set tree', () => {
  it('finds a set by name, else every set inside a folder', () => {
    expect(setsOfTarget('A1', sets).map((s) => s.name)).toEqual(['A1']);
    expect(setsOfTarget('Build', sets).map((s) => s.name)).toEqual(['A1', 'A2', 'B1']);
    expect(setsOfTarget('build / a', sets).map((s) => s.name)).toEqual(['A1', 'A2']);
    expect(setsOfTarget('Nothing', sets)).toEqual([]);
  });
  it('gives the generator the names of the sets, and leaves the scenario\'s target as typed', () => {
    const tags: Record<string, ExtraTag> = { X: { building: 'H1', attach: { target: 'Build / A', type: 'SS' } }, Y: { level: 'L1' } };
    const out = resolveAttachments(tags, sets);
    expect(out.X.attach).toEqual({ target: 'Build / A', type: 'SS', groups: ['A1', 'A2'] });
    expect(out.X.building).toBe('H1');
    expect(out.Y).toBe(tags.Y);
    expect(tags.X.attach!.groups).toBeUndefined();
    expect(attachedSetNames(tags, sets)).toEqual(['A1', 'A2']);
  });
  it('is the same object when nothing is attached, and says when a target finds nothing', () => {
    const tags = { Y: { level: 'L1' } };
    expect(resolveAttachments(tags, sets)).toBe(tags);
    expect(attachSummary({ target: 'Gone' }, sets)).toMatch(/nothing is linked/);
    expect(attachSummary({ target: 'Build' }, sets)).toBe('3 sets');
  });
});
