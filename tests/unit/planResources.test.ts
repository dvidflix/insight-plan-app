import { describe, expect, it } from 'vitest';
import { addResource, assignResource, crewOf, daysFromProductivity, deleteResource, productivityOf, setAssignment, setProductivity, unassignResource, updateResource } from '../../src/schedule/planResources';
import { addCodeType, addCodeValue, assignCode, deleteCodeValue, renameCodeType, renameCodeValue } from '../../src/schedule/planCodes';
import { setDurationDays, parsePredecessors, predecessorText, setPredecessors, type PredecessorEntry } from '../../src/schedule/planEdit';
import { programmeRowOps } from '../../src/schedule/nativeOps';
import type { Result } from '../../src/schedule/programmeCommands';
import type { ScheduleModel } from '../../src/schedule/types';
import { activity, model, rel } from './helpers';

const ok = <T extends object>(r: Result<T>) => {
  if ('error' in r) throw new Error(r.error);
  return r;
};

function base(): ScheduleModel {
  const m = model([activity('1', { code: 'A1000', type: 'task', status: 'not-started', durationHours: 80, remainingDurationHours: 80, calendarId: '5' }), activity('2', { code: 'A1010', type: 'task', status: 'not-started', calendarId: '5' })], [rel('1', '2')]);
  m.calendars = [{ id: '5', name: 'Std', hoursPerDay: 8, days: {} }];
  m.resourceCatalog = [];
  m.resourceNames = [];
  return m;
}

describe('resources', () => {
  it('adds a resource, refuses a name in use, renames it everywhere, and deletes it with its assignments', () => {
    let m = ok(addResource(base(), { name: 'Gang A', type: 'labor', capacity: 6 })).model;
    expect(m.resourceCatalog).toEqual([{ id: '1', name: 'Gang A', type: 'labor', capacity: 6 }]);
    expect(addResource(m, { name: 'gang a', type: 'labor' })).toEqual({ error: 'There is already a resource called “gang a”.' });
    m = ok(assignResource(m, ['1', '2'], '1', { units: 4 })).model;
    m = ok(updateResource(m, '1', { name: 'Gang B' })).model;
    expect(m.activities[0].resources[0].resourceName).toBe('Gang B');
    const gone = ok(deleteResource(m, '1'));
    expect(gone.assignments).toBe(2);
    expect(gone.model.activities.every((a) => a.resources.length === 0)).toBe(true);
    expect(gone.model.resourceNames).toEqual([]);
  });

  it('assigns a crew: the quantity is the crew × the hours, and follows the duration', () => {
    let m = ok(addResource(base(), { name: 'Gang A', type: 'labor' })).model;
    m = ok(assignResource(m, ['1'], '1', { units: 4 })).model;
    expect(m.activities[0].resources[0]).toMatchObject({ unitsPerTime: 4, targetQty: 320, remainQty: 320 });
    m = ok(setDurationDays(m, '1', 5)).model;
    expect(m.activities[0].resources[0]).toMatchObject({ targetQty: 160, remainQty: 160 });
    m = ok(setAssignment(m, '1', '1', { units: 2 })).model;
    expect(m.activities[0].resources[0]).toMatchObject({ unitsPerTime: 2, targetQty: 80 });
    expect(crewOf(m.activities[0])).toBe(2);
    expect(ok(unassignResource(m, ['1'], '1')).model.activities[0].resources).toEqual([]);
  });

  it('takes a material as a quantity, not a crew', () => {
    let m = ok(addResource(base(), { name: 'Concrete', type: 'material' })).model;
    m = ok(assignResource(m, ['1'], '1', { qty: 120 })).model;
    expect(m.activities[0].resources[0]).toMatchObject({ targetQty: 120 });
    expect(m.activities[0].resources[0].unitsPerTime).toBeUndefined();
    expect(crewOf(m.activities[0])).toBe(1);
  });
});

describe('productivity', () => {
  it('makes the duration from quantity ÷ (productivity × crew) and follows the crew', () => {
    let m = ok(addResource(base(), { name: 'Gang A', type: 'labor' })).model;
    m = ok(setProductivity(m, '1', { quantity: 240, unit: 'm2', perDay: 12, driven: true })).model;
    // A crew of 1: 240 / 12 = 20 days = 160 hours.
    expect(m.activities[0].durationHours).toBe(160);
    expect(m.udfTypes!.map((t) => t.label).sort()).toEqual(['Duration from productivity', 'Productivity (per day)', 'Quantity', 'Quantity unit']);
    m = ok(assignResource(m, ['1'], '1', { units: 4 })).model;
    // A crew of 4: 5 days.
    expect(m.activities[0].durationHours).toBe(40);
    expect(daysFromProductivity(m.activities[0])).toBe(5);
    expect(productivityOf(m.activities[0])).toMatchObject({ quantity: 240, unit: 'm2', perDay: 12, driven: true });
  });

  it('stops following when the duration is typed', () => {
    let m = ok(setProductivity(base(), '1', { quantity: 100, perDay: 10, driven: true })).model;
    expect(m.activities[0].durationHours).toBe(80);
    m = ok(setDurationDays(m, '1', 3)).model;
    expect(productivityOf(m.activities[0]).driven).toBe(false);
    expect(m.activities[0].durationHours).toBe(24);
  });

  it('refuses a negative quantity', () => {
    expect(setProductivity(base(), '1', { quantity: -1 })).toEqual({ error: 'The quantity is a number, 0 or more.' });
  });
});

describe('activity codes', () => {
  it('builds the dictionary and gives codes to activities, renaming through to them', () => {
    let m = ok(addCodeType(base(), 'Area')).model;
    m = ok(assignCode(m, ['1', '2'], 'Area', 'North')).model;
    expect(m.activityCodeCatalog![0].values.map((v) => v.value)).toEqual(['North']);
    expect(m.activities.map((a) => a.activityCodes.Area)).toEqual(['North', 'North']);
    m = ok(renameCodeValue(m, '1', '1', 'North wing')).model;
    expect(m.activities[0].activityCodes.Area).toBe('North wing');
    m = ok(renameCodeType(m, '1', 'Zone')).model;
    expect(m.activities[0].activityCodes).toEqual({ Zone: 'North wing' });
    expect(m.activityCodeTypes).toEqual(['Zone']);
    m = ok(assignCode(m, ['1'], 'Zone', null)).model;
    expect(m.activities[0].activityCodes).toEqual({});
    const gone = ok(deleteCodeValue(m, '1', '1'));
    expect(gone.assignments).toBe(1);
    expect(addCodeValue(m, '1', 'north wing')).toEqual({ error: '“Zone” already has the value “north wing”.' });
  });
});

describe('predecessors as text', () => {
  it('reads and writes them, with the type and the lag in days', () => {
    expect(parsePredecessors('A1000, A1010SS+2, B7FF-1.5d')).toEqual({
      entries: [
        { code: 'A1000', type: 'FS', lagDays: 0 },
        { code: 'A1010', type: 'SS', lagDays: 2, alt: 'A1010SS' },
        { code: 'B7', type: 'FF', lagDays: -1.5, alt: 'B7FF' },
      ],
    });
    let m = base();
    m.activities.push(activity('3', { code: 'A1020', calendarId: '5' }));
    const parsed = parsePredecessors('A1000SS+2, A1010') as { entries: PredecessorEntry[] };
    m = ok(setPredecessors(m, '3', parsed.entries)).model;
    expect(predecessorText(m, m.activities[2])).toBe('A1000SS+2, A1010');
    expect(setPredecessors(m, '1', [{ code: 'A1020', type: 'FS', lagDays: 0 }])).toHaveProperty('error');
  });
});

describe('saving resources, codes and user fields', () => {
  it('writes an assignment, a resource, a code and a user field as the rows that changed', () => {
    const before = base();
    let m = ok(addResource(before, { name: 'Gang A', type: 'labor', capacity: 6 })).model;
    m = ok(assignResource(m, ['1'], '1', { units: 4 })).model;
    m = ok(addCodeType(m, 'Area')).model;
    m = ok(assignCode(m, ['1'], 'Area', 'North')).model;
    m = ok(setProductivity(m, '1', { quantity: 10, perDay: 5 })).model;
    const ops = programmeRowOps(before, m);
    const rowOf = (table: string) => ops.filter((o) => o.table === table);
    expect(rowOf('RSRC')).toEqual([expect.objectContaining({ op: 'upsert', key: { column: 'rsrc_id', value: 1 }, set: expect.objectContaining({ rsrc_name: 'Gang A', rsrc_type: 'RT_Labor' }) })]);
    expect(rowOf('RSRCRATE')[0]).toMatchObject({ match: { rsrc_id: 1 }, set: expect.objectContaining({ max_qty_per_hr: 6 }) });
    expect(rowOf('TASKRSRC')[0]).toMatchObject({ key: { column: 'taskrsrc_id', value: null }, match: { task_id: 1, rsrc_id: 1 }, set: expect.objectContaining({ target_qty: 320, target_qty_per_hr: 4, rsrc_type: 'RT_Labor' }) });
    expect(rowOf('ACTVTYPE')[0]).toMatchObject({ key: { column: 'actv_code_type_id', value: 1 }, set: expect.objectContaining({ actv_code_type: 'Area' }) });
    expect(rowOf('ACTVCODE')[0]).toMatchObject({ set: expect.objectContaining({ actv_code_name: 'North', actv_code_type_id: 1 }) });
    expect(rowOf('TASKACTV')[0]).toMatchObject({ match: { task_id: 1, actv_code_type_id: 1 }, set: expect.objectContaining({ actv_code_id: 1 }) });
    expect(rowOf('UDFTYPE').map((o) => o.set)).toEqual(expect.arrayContaining([expect.objectContaining({ udf_type_label: 'Quantity', logical_data_type: 'FT_FLOAT', table_name: 'TASK' })]));
    expect(rowOf('UDFVALUE').find((o) => (o.set as { udf_number?: number }).udf_number === 10)).toMatchObject({ match: { fk_id: 1 } });
  });

  it('deletes an assignment and a resource when they are taken out', () => {
    let m = ok(addResource(base(), { name: 'Gang A', type: 'labor' })).model;
    m = ok(assignResource(m, ['1'], '1')).model;
    const after = ok(unassignResource(m, ['1'], '1')).model;
    expect(programmeRowOps(m, after).map((o) => [o.table, o.op])).toEqual([['TASKRSRC', 'delete']]);
    const gone = ok(deleteResource(m, '1')).model;
    expect(programmeRowOps(m, gone).map((o) => [o.table, o.op])).toEqual(expect.arrayContaining([['TASKRSRC', 'delete'], ['RSRC', 'delete'], ['RSRCRATE', 'delete']]));
  });
});
