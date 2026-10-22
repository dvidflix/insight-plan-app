import { describe, expect, it } from 'vitest';
import { pourRowsOfGroup } from '../../src/scenarios/stepPours';
import { newExtra } from '../../src/prs/sequenceRows';

const rows = [{ key: 'G1#1' }, { key: 'G2' }, { key: 'G3' }, { key: 'G4#2' }];
const membership = new Map<string, Set<string>>([['G1#1', new Set(['Walls'])], ['G2', new Set(['Slabs', 'Walls'])]]);
const guids: Record<string, string[]> = { Rafts: ['G3', 'G4'], Other: ['G1'] };
const guidsOf = (s: { name: string }) => new Set(guids[s.name] ?? []);

describe('the pours of a Sequence step', () => {
  it('finds the pours of a rule group by name, whatever the case', () => {
    expect(pourRowsOfGroup('walls', rows, membership, [], guidsOf).map((r) => r.key)).toEqual(['G1#1', 'G2']);
  });
  it('finds the pours of a model search set by name, by GlobalId, ignoring the #suffix of a row', () => {
    expect(pourRowsOfGroup('RAFTS', rows, membership, [{ name: 'Rafts' }, { name: 'Other' }], guidsOf).map((r) => r.key)).toEqual(['G3', 'G4#2']);
  });
  it('joins the two when a name is both, and does not repeat a pour', () => {
    expect(pourRowsOfGroup('Walls', rows, membership, [{ name: 'Walls' }, { name: 'Rafts' }], (s) => new Set(s.name === 'Walls' ? ['G2', 'G3'] : []))
      .map((r) => r.key)).toEqual(['G1#1', 'G2', 'G3']);
  });
  it('lists nothing for an empty name or a name nothing is in', () => {
    expect(pourRowsOfGroup('', rows, membership, [], guidsOf)).toEqual([]);
    expect(pourRowsOfGroup('Columns', rows, membership, [], guidsOf)).toEqual([]);
  });
});

describe('+ Extra', () => {
  const today = new Date(Date.UTC(2029, 3, 6));
  it('takes the scenario start date, or today, so the dates are valid', () => {
    expect(newExtra([], '2030-02-01', today)).toMatchObject({ TaskID: 'X-1', DurationDays: 1, BaselineStart: '2030-02-01', BaselineFinish: '2030-02-01' });
    expect(newExtra([], '', today).BaselineStart).toBe('2029-04-06');
    expect(newExtra([], 'soon', today).BaselineStart).toBe('2029-04-06');
  });
  it('picks an ID that is free', () => {
    const e = (id: string) => ({ TaskID: id, Name: id, DurationDays: 1, BaselineStart: '', BaselineFinish: '' });
    expect(newExtra([e('X-2'), e('x-3')], '', today).TaskID).toBe('X-4');
  });
});
