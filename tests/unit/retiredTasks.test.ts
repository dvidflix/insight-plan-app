import { describe, expect, it } from 'vitest';
import { withoutRetired } from '../../src/state/retiredTasksStore';
import type { Relationship, ScheduleModel } from '../../src/schedule/types';

const model = (codes: string[], links: [string, string][]): ScheduleModel =>
  ({
    activities: codes.map((code) => ({ id: `id-${code}`, code, name: code })),
    relationships: links.map(([p, s]): Relationship => ({ predId: `id-${p}`, succId: `id-${s}`, type: 'FS', lagHours: 0 })),
  }) as unknown as ScheduleModel;

const pairs = (m: ScheduleModel) => m.relationships.map((r) => `${r.predId.slice(3)}>${r.succId.slice(3)}`).sort();

describe('tasks retired in SeaTable', () => {
  it('leaves the programme alone when nothing is retired or nothing matches', () => {
    const m = model(['A', 'B'], [['A', 'B']]);
    expect(withoutRetired(m, new Set())).toBe(m);
    expect(withoutRetired(m, new Set(['NOPE']))).toBe(m);
  });

  it('takes a retired task out, whatever the case of its Task ID', () => {
    const m = model(['a-r', 'A-F'], []);
    expect(withoutRetired(m, new Set(['A-R'])).activities.map((a) => a.code)).toEqual(['A-F']);
  });

  it('closes the chain up around a retired task', () => {
    const m = model(['R', 'F', 'C'], [['R', 'F'], ['F', 'C']]);
    expect(pairs(withoutRetired(m, new Set(['F'])))).toEqual(['R>C']);
  });

  it('closes up several retired tasks in a row, and several predecessors / successors', () => {
    const m = model(['P1', 'P2', 'X', 'Y', 'S1', 'S2'], [['P1', 'X'], ['P2', 'X'], ['X', 'Y'], ['Y', 'S1'], ['Y', 'S2']]);
    expect(pairs(withoutRetired(m, new Set(['X', 'Y'])))).toEqual(['P1>S1', 'P1>S2', 'P2>S1', 'P2>S2']);
  });

  it('does not duplicate a link the programme already has, and drops links with nothing on one side', () => {
    const m = model(['A', 'B', 'C'], [['A', 'B'], ['B', 'C'], ['A', 'C']]);
    expect(pairs(withoutRetired(m, new Set(['B'])))).toEqual(['A>C']);
    const last = model(['A', 'B'], [['A', 'B']]);
    expect(withoutRetired(last, new Set(['B'])).relationships).toEqual([]);
  });
});
