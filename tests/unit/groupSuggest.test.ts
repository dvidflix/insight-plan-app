import { describe, expect, it } from 'vitest';
import { DEFAULT_TARGETS, levelKey, rebarByPour, suggestGroups, targetFor, wallsToGroup, type WallInfo } from '../../src/scenarios/groupSuggest';
import type { PourRow } from '../../src/scenarios/pourOrder';
import type { ScheduleModel } from '../../src/schedule/types';

const wall = (key: string, rate: number, level = 'L3'): WallInfo => ({ key, label: key, level, tonnes: rate * 2, days: 2, rate });
const targets = { wall: 1, byLevel: { L3: 1, L4: 2 } };
const keys = (g: { members: WallInfo[] }[]) => g.map((x) => x.members.map((m) => m.key));

describe('levels and targets', () => {
  it('names a level whatever its spelling', () => {
    expect(levelKey('L02')).toBe('L2');
    expect(levelKey('Level 3')).toBe('L3');
    expect(levelKey('L1 & 2')).toBe('L1 & 2');
    expect(levelKey('L01 + L02')).toBe('L1 & 2');
    expect(levelKey('Roof')).toBe('');
  });

  it('uses the level\'s target, else the walls\'', () => {
    expect(targetFor(DEFAULT_TARGETS, 'L03')).toBe(0.7058);
    expect(targetFor(DEFAULT_TARGETS, 'L12')).toBe(DEFAULT_TARGETS.wall);
  });
});

describe('suggested groups of walls', () => {
  it('adds walls until their rebar rates reach the target', () => {
    const g = suggestGroups([wall('a', 0.4), wall('b', 0.4), wall('c', 0.4), wall('d', 0.4), wall('e', 0.4), wall('f', 0.4)], targets);
    // 0.4 + 0.4 = 0.8 (0.2 short), + 0.4 = 1.2 (0.2 over): a tie keeps the third wall in.
    expect(keys(g)).toEqual([['a', 'b', 'c'], ['d', 'e', 'f']]);
    expect(g[0].rate).toBeCloseTo(1.2);
    expect(g[0].target).toBe(1);
  });

  it('leaves the last wall for the next group when that is closer to the target', () => {
    const g = suggestGroups([wall('a', 0.5), wall('b', 0.4), wall('c', 0.9), wall('d', 0.3), wall('e', 0.9)], targets);
    // a + b = 0.9; + c = 1.8 is further from 1 than 0.9 is, so c starts the next group. c alone (0.9) is closer to the target
    // than c + d (1.2), so c stays on its own (no group), and d + e (1.2) is the second group.
    expect(keys(g)).toEqual([['a', 'b'], ['d', 'e']]);
  });

  it('does not group a wall that reaches the target alone, nor leave a single wall as a group', () => {
    expect(suggestGroups([wall('a', 1.5)], targets)).toEqual([]);
    expect(suggestGroups([wall('a', 1.5), wall('b', 0.3)], targets)).toEqual([]);
  });

  it('keeps a leftover group of two or more below its target', () => {
    const g = suggestGroups([wall('a', 0.2), wall('b', 0.2)], targets);
    expect(keys(g)).toEqual([['a', 'b']]);
    expect(g[0].rate).toBeLessThan(g[0].target);
  });

  it('takes the target from the first wall of a group, so groups may cross levels', () => {
    const g = suggestGroups([wall('a', 0.7, 'L4'), wall('b', 0.7, 'L3'), wall('c', 0.7, 'L3')], targets);
    expect(keys(g)).toEqual([['a', 'b', 'c']]); // L4 asks for 2 t/day: 2.1 reaches it, whatever the other walls' level
    expect(g[0].target).toBe(2);
  });
});

describe('what the table can group', () => {
  const headers = ['Index', 'Pour ID', 'Level', 'Pour Type', 'PlanningProposedPourID'];
  const row = (key: string, step: number | null, id: string, type = 'WALL', level = 'L03'): PourRow => ({ key, step, cells: ['', id, level, type, id] });
  const rebar = new Map([['101', { tonnes: 2, days: 4 }], ['102', { tonnes: 3, days: 2 }], ['103', { tonnes: 0, days: 2 }]]);

  it('lists the sequenced walls that are alone in their step and have a rebar rate', () => {
    const rows = [
      row('a', 1, '0101'),
      row('b', 2, '102'),
      row('c', 2, '0102'), // b and c are already one step
      row('d', 3, '0103'), // no tonnes
      row('e', 4, '999'), // not in the programme
      row('f', 5, '0101', 'SLAB'),
      row('g', null, '0101'), // not sequenced
    ];
    const { walls, skipped } = wallsToGroup(rows, headers, rebar);
    expect(walls.map((w) => w.key)).toEqual(['a']);
    expect(walls[0].rate).toBeCloseTo(0.5);
    expect(skipped).toBe(2);
  });
});

describe('rebar of a generated programme', () => {
  const model = (activities: unknown[]): ScheduleModel =>
    ({ activityCodeTypes: ['CWA-Element ID'], activities }) as unknown as ScheduleModel;
  const act = (code: string, name: string, el: string, qty: number, hours: number) => ({
    code, name, durationHours: hours, udf: {}, activityCodes: { 'CWA-Element ID': el }, resources: [{ resourceName: 'Rebar (t)', targetQty: qty }, { resourceName: 'Concrete (m3)', targetQty: 99 }],
  });

  it('reads the Rebar activity of each pour: tonnes of its rebar resource, days from its hours', () => {
    const m = model([
      act('SZC-1-L3-W-0101-R', 'H - L3 - Internal Wall 0101 - Rebar', '0101', 2.4, 16),
      act('SZC-1-L3-W-0101-C', 'H - L3 - Internal Wall 0101 - Concrete', '0101', 0, 8),
    ]);
    const r = rebarByPour(m);
    expect([...r.keys()]).toEqual(['101']);
    expect(r.get('101')).toEqual({ tonnes: 2.4, days: 2 });
  });
});
