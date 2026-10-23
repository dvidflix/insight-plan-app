import { describe, expect, it } from 'vitest';
import { suggestMatches, unlinked, confidenceOf } from '../../src/schedule/suggestMatches';
import { computeGroupLinks, emptyGroup } from '../../src/schedule/linkGroups';
import type { ScheduleModel } from '../../src/schedule/types';
import type { ElementSummary } from '../../src/viewer/types';

const task = (id: string, code: string, pour: string, name = id) => ({ id, code, name, type: 'task', activityCodes: { 'Pour ID': pour }, udf: {} });
const el = (localId: number, pourId: string, name = 'Slab'): ElementSummary => ({ localId, guid: `g${localId}`, name, category: 'IFCSLAB', fileName: 'm.ifc', props: { 'CWA Pour.Pour ID': pourId, 'CWA Pour.Level': 'L1' } });

const model = { activities: [task('a1', 'A1', 'P1'), task('a2', 'A2', 'P2'), task('a3', 'A3', 'P3'), task('a4', 'A4', '')], activityCodeTypes: ['Pour ID'] } as unknown as ScheduleModel;
const models = [{ modelId: 'm', elements: [el(1, 'P1'), el(2, 'p1'), el(3, 'P2'), el(4, 'Q9')] }];

describe('suggested matches', () => {
  it('finds what is unlinked, counting an object a group links as linked', () => {
    const owned = new Set(['m:1']);
    const objectsOf = new Map([['a3', new Map([['m', new Set([4])]])]]);
    const gaps = unlinked(model, models, objectsOf, owned);
    expect(gaps.tasks).toEqual(['a1', 'a2', 'a4']);
    expect([...gaps.objects].sort()).toEqual(['m:2', 'm:3', 'm:4']);
    expect(gaps.totalTasks).toBe(4);
  });
  it('proposes the pair of fields that links the most unlinked tasks, as a match rule', () => {
    const gaps = unlinked(model, models, new Map(), new Set());
    const [best] = suggestMatches(model, models, gaps);
    expect(best.rule).toMatchObject({ taskField: 'Pour ID', objectPropertySet: 'CWA Pour', objectAttribute: 'Pour ID' });
    expect(best.tasks).toBe(2); // P1 and P2; the task with no Pour ID and P3 (no object) are not linked
    expect(best.objects).toBe(3); // P1 twice (any case) and P2
    expect(best.confidence).toBe('medium'); // 2 of the 4 unlinked tasks
  });
  it('is what a Link Group with that rule then links', () => {
    const gaps = unlinked(model, models, new Map(), new Set());
    const [best] = suggestMatches(model, models, gaps);
    const group = { ...emptyGroup('Suggested'), matchRules: [{ id: 'r', ...best.rule }] };
    const links = computeGroupLinks(model, models[0].elements, group).taskToElements;
    expect([...links.keys()].sort()).toEqual(['a1', 'a2']);
    expect(links.get('a1')!.sort()).toEqual([1, 2]);
  });
  it('proposes nothing when nothing is unlinked', () => {
    expect(suggestMatches(model, models, unlinked(model, [{ modelId: 'm', elements: [] }], new Map(), new Set()))).toEqual([]);
  });
  it('grades by the share of the unlinked tasks', () => {
    expect([confidenceOf(0.9), confidenceOf(0.3), confidenceOf(0.05)]).toEqual(['high', 'medium', 'low']);
  });
});
