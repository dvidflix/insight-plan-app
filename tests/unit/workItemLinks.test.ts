import { describe, expect, it } from 'vitest';
import { computeGroupLinks, emptyGroup, objectFieldValue, setWorkItemMembers, WORK_ITEM_FIELD } from '../../src/schedule/linkGroups';
import type { ElementSummary } from '../../src/viewer/types';
import type { ScheduleModel } from '../../src/schedule/types';

const el = (localId: number, guid: string): ElementSummary => ({ localId, guid, name: guid, category: 'IFCWALL', fileName: 'm.ifc', props: {} });

describe('work item links', () => {
  it('links the activities that carry a work item id to the item\'s objects', () => {
    setWorkItemMembers(new Map([['g1', 'WI|A'], ['g2', 'WI|A'], ['g3', 'WI|B']]));
    const elements = [el(1, 'g1'), el(2, 'g2'), el(3, 'g3'), el(4, 'g4')];
    expect(objectFieldValue(elements[3], '_workitem', '')).toBe('');
    const group = { ...emptyGroup('Work items'), matchRules: [{ id: 'm', taskField: WORK_ITEM_FIELD, objectPropertySet: '_workitem', objectAttribute: '', conj: 'and' as const }] };
    const act = (id: string, item: string) => ({ id, code: id, name: id, activityCodes: {}, udf: { [WORK_ITEM_FIELD]: item } });
    const model = { activities: [act('a1', 'WI|A'), act('a2', 'WI|A'), act('b1', 'WI|B'), act('x', '')] } as unknown as ScheduleModel;
    const { taskToElements } = computeGroupLinks(model, elements, group);
    expect([...taskToElements.get('a1')!].sort()).toEqual([1, 2]);
    expect(taskToElements.get('a2')).toEqual(taskToElements.get('a1'));
    expect(taskToElements.get('b1')).toEqual([3]);
    expect(taskToElements.has('x')).toBe(false);
    setWorkItemMembers(new Map());
  });
});
