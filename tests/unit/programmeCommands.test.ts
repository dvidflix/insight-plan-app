import { describe, expect, it } from 'vitest';
import { addActivity, addWbs, deleteActivities, deleteWbs, moveActivities, moveWbs, nextCode, renameWbs, setDataDate, wbsPathOf, type Result } from '../../src/schedule/programmeCommands';
import { programmeRowOps } from '../../src/schedule/nativeOps';
import type { ScheduleModel } from '../../src/schedule/types';
import { activity, day, model, rel } from './helpers';

const ok = <T extends object>(r: Result<T>) => {
  if ('error' in r) throw new Error(r.error);
  return r;
};

function base(): ScheduleModel {
  const m = model(
    [
      activity('1', { code: 'A1000', wbsId: '11', wbsPath: 'Project / Level 1', wbsCodePath: 'P / L1' }),
      activity('2', { code: 'A1010', wbsId: '11', wbsPath: 'Project / Level 1', wbsCodePath: 'P / L1' }),
      activity('3', { code: 'A1020', wbsId: '12', wbsPath: 'Project / Level 2', wbsCodePath: 'P / L2' }),
    ],
    [rel('1', '2'), rel('2', '3')],
  );
  m.wbs = [
    { id: '10', name: 'Project', code: 'P', parentId: null },
    { id: '11', name: 'Level 1', code: 'L1', parentId: '10' },
    { id: '12', name: 'Level 2', code: 'L2', parentId: '10' },
  ];
  m.calendars = [{ id: '5', name: 'Five day', hoursPerDay: 10, days: {} }];
  return m;
}

describe('activities', () => {
  it('adds one after another: its WBS node, calendar and code style, and five days of its calendar', () => {
    const m = base();
    const r = ok(addActivity(m, { after: '2' }));
    const a = r.model.activities.find((x) => x.id === r.id)!;
    expect(a).toMatchObject({ id: '4', code: 'A1030', name: 'New activity', wbsId: '11', wbsPath: 'Project / Level 1', type: 'task', status: 'not-started', durationHours: 50, calendarId: '5' });
    // The others are the same activities; their dates and float are calculated again with the new one in.
    expect(r.model.activities.slice(0, 3).map((x) => [x.id, x.code, x.name, x.wbsId])).toEqual(m.activities.map((x) => [x.id, x.code, x.name, x.wbsId]));
  });

  it('makes a milestone with no duration, and codes that are not in use', () => {
    const m = base();
    const r = ok(addActivity(m, { type: 'milestone-finish', name: 'Handover', wbsId: '12' }));
    expect(r.model.activities.at(-1)).toMatchObject({ type: 'milestone-finish', durationHours: 0, wbsId: '12', name: 'Handover' });
    expect(nextCode(['A1000', 'A1010'], 'A1000')).toBe('A1020');
    expect(nextCode([])).toBe('A1010');
    expect(nextCode(['X-5'], 'X-5')).toBe('X-10');
    expect(new Set(ok(addActivity(ok(addActivity(m)).model)).model.activities.map((a) => a.code)).size).toBe(5);
  });

  it('refuses a WBS node that is not there', () => {
    expect(addActivity(base(), { wbsId: '99' })).toEqual({ error: expect.stringContaining('not in the programme') });
  });

  it('takes activities out with their links, and the rest keeps its objects', () => {
    const m = base();
    const r = ok(deleteActivities(m, ['2']));
    expect(r.removed).toBe(1);
    expect(r.model.activities.map((a) => a.id)).toEqual(['1', '3']);
    expect(r.model.relationships).toEqual([]);
    expect(deleteActivities(m, ['99'])).toHaveProperty('error');
  });
});

describe('WBS', () => {
  it('adds, renames and moves nodes, and the activities below follow in their paths', () => {
    let m = base();
    const added = ok(addWbs(m, 'Zone A', '11'));
    m = added.model;
    expect(m.wbs.find((n) => n.id === added.id)).toMatchObject({ id: '13', name: 'Zone A', parentId: '11' });
    m = ok(moveActivities(m, ['1'], '13')).model;
    expect(m.activities.find((a) => a.id === '1')!.wbsPath).toBe('Project / Level 1 / Zone A');
    m = ok(renameWbs(m, '11', 'Ground floor')).model;
    expect(m.activities.find((a) => a.id === '1')!.wbsPath).toBe('Project / Ground floor / Zone A');
    expect(m.activities.find((a) => a.id === '2')!.wbsPath).toBe('Project / Ground floor');
    m = ok(moveWbs(m, '13', '12')).model;
    expect(m.activities.find((a) => a.id === '1')!.wbsPath).toBe('Project / Level 2 / Zone A');
    expect(wbsPathOf(m.wbs, '13', 'code')).toBe('P / L2 / Zone A');
  });

  it('leaves untouched activities as they are', () => {
    const m = base();
    const r = ok(renameWbs(m, '12', 'Level two'));
    expect(r.model.activities[0]).toBe(m.activities[0]);
    expect(r.model.activities[2]).not.toBe(m.activities[2]);
  });

  it('refuses a node under itself, and deleting a node with something in it', () => {
    const m = ok(addWbs(base(), 'Zone A', '11')).model;
    expect(moveWbs(m, '11', '13')).toEqual({ error: 'A WBS node cannot go under itself.' });
    expect(deleteWbs(m, '11')).toHaveProperty('error', expect.stringContaining('below it'));
    expect(deleteWbs(m, '12')).toHaveProperty('error', expect.stringContaining('1 activity'));
    expect(deleteWbs(m, '10')).toHaveProperty('error');
    expect(ok(deleteWbs(m, '13')).model.wbs.map((n) => n.id)).toEqual(['10', '11', '12']);
  });
});

describe('what saving writes for them', () => {
  it('writes a new activity and node whole, a taken-out activity as deletes, and nothing for the rest', () => {
    const m = base();
    const added = ok(addWbs(m, 'Zone A', '11'));
    const withActivity = ok(addActivity(added.model, { wbsId: added.id, name: 'Pour' }));
    const ops = programmeRowOps(m, withActivity.model);
    const key = (o: (typeof ops)[number]) => `${o.op} ${o.table} ${o.key.value}`;
    expect(ops.map(key)).toContain('upsert PROJWBS 13');
    // Only the new activity is written whole; for the others only the dates and float the calculation gave.
    const calc = /^(early|late)_(start|end)_date$|^(restart|reend)_date$|^(total|free)_float_hr_cnt$/;
    for (const o of ops.filter((x) => x.table === 'TASK' && x.key.value !== 4)) expect(Object.keys(o.set ?? {}).every((c) => calc.test(c))).toBe(true);
    expect(ops.find((o) => key(o) === 'upsert TASK 4')!.set).toMatchObject({ task_code: 'A1030', task_name: 'Pour', wbs_id: 13, task_type: 'TT_Task', status_code: 'TK_NotStart', clndr_id: 5, proj_id: 'p' });

    const removed = programmeRowOps(m, ok(deleteActivities(m, ['2'])).model);
    expect(removed.filter((o) => o.op === 'delete').map((o) => `${o.table} ${o.match ? JSON.stringify(o.match) : o.key.value}`).sort()).toEqual([
      'TASK 2', 'TASKACTV {"task_id":2}', 'TASKPRED {"task_id":2,"pred_task_id":1}', 'TASKPRED {"task_id":3,"pred_task_id":2}', 'TASKRSRC {"task_id":2}',
    ]);
    // The start is the data date until a link says otherwise.
    expect(ok(addActivity(m)).model.activities.at(-1)!.earlyStart).toEqual(day(2028, 1, 3));
  });
});

describe('the data date', () => {
  it('moves what is not started to it, and is written to the project row', () => {
    const m = base();
    const r = ok(setDataDate(m, day(2028, 2, 7)));
    expect(r.model.project.dataDate).toEqual(day(2028, 2, 7));
    expect(r.model.activities.map((a) => a.earlyStart)).toEqual([day(2028, 2, 7), day(2028, 2, 8), day(2028, 2, 9)]);
    const ops = programmeRowOps(m, r.model);
    expect(ops.find((o) => o.table === 'PROJECT')!.set).toEqual({ last_recalc_date: '2028-02-07 00:00' });
    expect(ok(setDataDate(m, m.project.dataDate!)).model).toBe(m);
    expect(setDataDate(m, new Date(NaN))).toHaveProperty('error');
  });
});
