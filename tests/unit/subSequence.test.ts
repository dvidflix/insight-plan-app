import { describe, expect, it } from 'vitest';
import { expandWork, slotWindow, splitIndex } from '../../src/schedule/subSequence';
import { computeGroupLinks, emptyGroup, type LinkGroup } from '../../src/schedule/linkGroups';
import type { ElementSummary } from '../../src/viewer/types';
import { activity, day, model } from './helpers';

const DAY = 86_400_000;
const part = (localId: number, id: string): ElementSummary =>
  ({ localId, category: 'IFCSLAB', name: id, guid: `g${localId}`, fileName: 'm.ifc', props: { 'Pset.PourId': id } }) as unknown as ElementSummary;

describe('splitIndex', () => {
  it('cuts the numeric tail after the last separator', () => {
    expect(splitIndex('P101-12', '-')).toEqual({ parent: 'P101', index: 12 });
    expect(splitIndex('A-B-3', '-')).toEqual({ parent: 'A-B', index: 3 });
    expect(splitIndex('P101.04', '.')).toEqual({ parent: 'P101', index: 4 });
  });
  it('keeps a value with no numeric tail as its own parent', () => {
    expect(splitIndex('P101', '-')).toEqual({ parent: 'P101', index: null });
    expect(splitIndex('P101-A', '-')).toEqual({ parent: 'P101-A', index: null });
    expect(splitIndex('-7', '-')).toEqual({ parent: '-7', index: null });
  });
});

describe('slotWindow', () => {
  const D = 10 * DAY;
  it('shares the window equally one after another by default', () => {
    expect(slotWindow(0, D, 0, 5, 0)).toEqual([0, 2 * DAY]);
    expect(slotWindow(0, D, 4, 5, 0)).toEqual([8 * DAY, 10 * DAY]);
  });
  it('overlap makes the slots longer and start earlier, still filling the window', () => {
    const [s0, f0] = slotWindow(0, D, 0, 3, 50);
    const [s1] = slotWindow(0, D, 1, 3, 50);
    const [, f2] = slotWindow(0, D, 2, 3, 50);
    expect(s0).toBe(0);
    expect(f2).toBeCloseTo(D);
    expect(s1).toBeLessThan(f0); // the second starts before the first ends
    expect(f0 - s0).toBeCloseTo(D / 2); // 1 + 2 * 0.5 = 2 steps
  });
  it('a negative overlap leaves a gap between slots', () => {
    const [, f0] = slotWindow(0, D, 0, 3, -100);
    const [s1] = slotWindow(0, D, 1, 3, -100);
    expect(s1 - f0).toBeCloseTo(f0); // gap as long as a slot
    expect(slotWindow(0, D, 2, 3, -100)[1]).toBeCloseTo(D);
  });
  it('a single slot is the whole window', () => {
    expect(slotWindow(5, D, 0, 1, 40)).toEqual([5, D]);
  });
});

describe('a group with sub-sequence', () => {
  const tasks = [activity('T1', { code: 'P101', earlyStart: day(2028, 1, 3), earlyFinish: day(2028, 1, 13), targetStart: day(2028, 1, 3), targetFinish: day(2028, 1, 13) })];
  const objects = [part(1, 'P101-2'), part(2, 'P101-1'), part(3, 'P101-3'), part(4, 'P102-1')];
  const group: LinkGroup = {
    ...emptyGroup('Pours'),
    matchRules: [{ id: 'r', taskField: '_code', objectPropertySet: 'Pset', objectAttribute: 'PourId', conj: 'or' }],
    subSequence: { enabled: true, field: '', separator: '-', overlapPct: 0 },
  };

  it('links every part to the parent activity and ranks them by index', () => {
    const out = computeGroupLinks(model(tasks), objects, group);
    expect(out.taskToElements.get('T1')?.sort()).toEqual([1, 2, 3]);
    const slots = out.sub!.get('T1')!;
    expect(slots.get(2)).toEqual({ slot: 0, slots: 3 });
    expect(slots.get(1)).toEqual({ slot: 1, slots: 3 });
    expect(slots.get(3)).toEqual({ slot: 2, slots: 3 });
  });

  it('without it the parent ID does not match the parts', () => {
    const out = computeGroupLinks(model(tasks), objects, { ...group, subSequence: undefined });
    expect(out.taskToElements.size).toBe(0);
  });

  it('drives each part over its own slot of the activity', () => {
    const m = model(tasks);
    const out = computeGroupLinks(m, objects, group);
    const work = expandWork(out.taskToElements, out.sub, new Map(m.activities.map((a) => [a.id, a])), 'planned', 0);
    expect(work).toHaveLength(3);
    const total = day(2028, 1, 13).getTime() - day(2028, 1, 3).getTime();
    expect(work[0].ids).toEqual([2]);
    expect(work[0].activity.earlyStart!.getTime()).toBe(day(2028, 1, 3).getTime());
    expect(work[0].activity.earlyFinish!.getTime() - work[0].activity.earlyStart!.getTime()).toBeCloseTo(total / 3);
    expect(work[2].activity.earlyFinish!.getTime()).toBeCloseTo(day(2028, 1, 13).getTime());
    expect(new Set(work.map((w) => w.activity.id)).size).toBe(3);
  });

  it('leaves an activity whole when it has a single slot', () => {
    const m = model(tasks);
    const out = computeGroupLinks(m, [part(1, 'P101-1')], group);
    expect(out.sub?.size ?? 0).toBe(0);
    const work = expandWork(out.taskToElements, out.sub, new Map(m.activities.map((a) => [a.id, a])), 'planned', 0);
    expect(work).toHaveLength(1);
    expect(work[0].activity.id).toBe('T1');
  });
});
