import { describe, expect, it } from 'vitest';
import { buildSpoolSets, inFolderTree, spoolPath } from '../../src/viewer/spoolSets';
import type { ModelIndex } from '../../src/viewer/ViewerEngine';

const el = (id: number, name: string, system?: string) => ({ localId: id, guid: `g${id}`, name, category: 'IfcPipeSegment', props: system ? { 'Data.System': system } : {} });
const index = (): ReadonlyMap<string, ModelIndex> => new Map([
  ['m1', {
    name: 'M1',
    tree: {} as never,
    names: new Map(),
    layers: new Map(),
    elements: new Map([
      [1, el(1, 'a', '6-CHWR-6500-CSC-001')],
      [2, el(2, 'b', '6-CHWR-6500-CSC-001')],
      [3, el(3, 'c', '6-CHWR-6501-CSC-002')],
      [4, el(4, 'd', '4-CA-6500-C1C-003')],
      [5, el(5, 'e')],
    ]) as never,
  }],
]);

describe('spool sets', () => {
  it('splits a value into folders', () => {
    expect(spoolPath('Systems', '6-CHWR-6500-CSC-001', { delimiter: '-', primary: 2, secondary: 3 })).toBe('Systems / CHWR / 6500');
    expect(spoolPath('Systems', '6-CHWR-6500-CSC-001', { delimiter: '-', secondary: 3 })).toBe('Systems / 6500');
    expect(spoolPath('Systems', 'x', undefined)).toBe('Systems');
  });

  it('makes one search set per value, in folders, leaving out objects without a value', () => {
    const r = buildSpoolSets(index(), { fields: ['Data.System'], folder: 'Systems', output: 'search', split: { delimiter: '-', primary: 2, secondary: 3 } });
    expect(r.sets.map((s) => `${s.group} | ${s.name}`)).toEqual([
      'Systems / CA / 6500 | 4-CA-6500-C1C-003',
      'Systems / CHWR / 6500 | 6-CHWR-6500-CSC-001',
      'Systems / CHWR / 6501 | 6-CHWR-6501-CSC-002',
    ]);
    expect(r.objects).toBe(4);
    expect(r.empty).toBe(1);
    expect(r.sets[1].conditions[0]).toMatchObject({ field: 'Data.System', op: 'equals', value: '6-CHWR-6500-CSC-001' });
  });

  it('makes selection sets from the objects, or only those of a selection', () => {
    const all = buildSpoolSets(index(), { fields: ['Data.System'], folder: 'S', output: 'selection' });
    expect(all.sets.find((s) => s.name === '6-CHWR-6500-CSC-001')?.items).toHaveLength(2);
    const some = buildSpoolSets(index(), { fields: ['Data.System'], folder: 'S', output: 'selection', restrictTo: { m1: [1, 3] } });
    expect(some.sets.map((s) => s.name)).toEqual(['6-CHWR-6500-CSC-001', '6-CHWR-6501-CSC-002']);
  });

  it('makes one set per combination of several properties', () => {
    const r = buildSpoolSets(index(), { fields: ['Data.System', 'Attributes.Class'], folder: 'S', output: 'search' });
    expect(r.sets).toHaveLength(3);
    expect(r.sets[0].conditions).toHaveLength(2);
  });

  it('finds the sets of a folder and the folders inside it', () => {
    expect(inFolderTree('Systems', 'Systems')).toBe(true);
    expect(inFolderTree('Systems / CHWR', 'Systems')).toBe(true);
    expect(inFolderTree('Systems 2', 'Systems')).toBe(false);
  });
});
