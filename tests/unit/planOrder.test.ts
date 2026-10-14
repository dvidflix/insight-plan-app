import { describe, expect, it } from 'vitest';
import { duplicateActivities, indentRows, moveRows, outdentRows, planRows, placeTaskAfter, childrenOf } from '../../src/schedule/planOrder';
import { nextCode, type Result } from '../../src/schedule/programmeCommands';
import { programmeRowOps } from '../../src/schedule/nativeOps';
import type { ScheduleModel } from '../../src/schedule/types';
import { activity, model } from './helpers';

const ok = <T extends object>(r: Result<T>) => {
  if ('error' in r) throw new Error(r.error);
  return r;
};

function base(): ScheduleModel {
  const m = model(
    [
      activity('1', { code: 'A1000', wbsId: '11', wbsPath: 'Project / Level 1', wbsCodePath: 'P / L1' }),
      activity('2', { code: 'A1010', wbsId: '11', wbsPath: 'Project / Level 1', wbsCodePath: 'P / L1' }),
      activity('3', { code: 'A1020', wbsId: '11', wbsPath: 'Project / Level 1', wbsCodePath: 'P / L1' }),
      activity('4', { code: 'A1030', wbsId: '12', wbsPath: 'Project / Level 2', wbsCodePath: 'P / L2' }),
    ],
    [],
  );
  m.wbs = [
    { id: '10', name: 'Project', code: 'P', parentId: null },
    { id: '11', name: 'Level 1', code: 'L1', parentId: '10' },
    { id: '12', name: 'Level 2', code: 'L2', parentId: '10' },
  ];
  return m;
}

const shown = (m: ScheduleModel) => planRows(m).map((r) => `${r.depth}:${r.kind === 'wbs' ? r.wbs!.name : r.activity!.code}`);

describe('the planner rows', () => {
  it('lists each node, its child nodes, then its activities', () => {
    expect(shown(base())).toEqual(['0:Project', '1:Level 1', '2:A1000', '2:A1010', '2:A1020', '1:Level 2', '2:A1030']);
  });

  it('hides what is below a collapsed node, and rolls the dates and duration up', () => {
    const m = base();
    m.activities = m.activities.map((a, i) => ({ ...a, earlyStart: new Date(2030, 0, 1 + i), earlyFinish: new Date(2030, 0, 3 + i), durationHours: 8 }));
    const rows = planRows(m, new Set(['11']));
    expect(rows.map((r) => r.id)).toEqual(['10', '11', '12', '4']);
    const level1 = rows.find((r) => r.id === '11')!;
    expect(level1.summary).toMatchObject({ count: 3, hours: 24 });
    expect(level1.summary!.start).toEqual(new Date(2030, 0, 1));
    expect(level1.summary!.finish).toEqual(new Date(2030, 0, 5));
  });
});

describe('moving rows', () => {
  it('moves activities up and down among those of their node, and keeps the order', () => {
    let m = ok(moveRows(base(), [{ kind: 'task', id: '3' }], 'up')).model;
    expect(childrenOf(m, '11').tasks.map((a) => a.code)).toEqual(['A1000', 'A1020', 'A1010']);
    m = ok(moveRows(m, [{ kind: 'task', id: '1' }], 'down')).model;
    expect(childrenOf(m, '11').tasks.map((a) => a.code)).toEqual(['A1020', 'A1000', 'A1010']);
  });

  it('moves several together, and says when they are already at the end', () => {
    const picked = [{ kind: 'task' as const, id: '2' }, { kind: 'task' as const, id: '3' }];
    const m = ok(moveRows(base(), picked, 'up')).model;
    expect(childrenOf(m, '11').tasks.map((a) => a.code)).toEqual(['A1010', 'A1020', 'A1000']);
    expect(moveRows(base(), [{ kind: 'task', id: '1' }], 'up')).toEqual({ error: 'Already at the top.' });
  });

  it('moves WBS nodes among their siblings', () => {
    const m = ok(moveRows(base(), [{ kind: 'wbs', id: '12' }], 'up')).model;
    expect(childrenOf(m, '10').wbs.map((n) => n.name)).toEqual(['Level 2', 'Level 1']);
  });

  it('writes only the rows whose place changed', () => {
    const before = ok(moveRows(base(), [{ kind: 'task', id: '3' }], 'up')).model;
    const after = ok(moveRows(before, [{ kind: 'task', id: '3' }], 'up')).model;
    const ops = programmeRowOps(before, after);
    // Two activities swapped places: two rows, the new number each.
    expect(ops.map((o) => [o.table, o.op, o.key.value, o.set])).toEqual([['TASK', 'upsert', 1, { ip_seq: 20 }], ['TASK', 'upsert', 3, { ip_seq: 10 }]]);
  });
});

describe('indent and outdent', () => {
  it('indents a node under the one above it, and its activities follow with new paths', () => {
    const m = ok(indentRows(base(), [{ kind: 'wbs', id: '12' }])).model;
    expect(m.wbs.find((n) => n.id === '12')!.parentId).toBe('11');
    expect(m.activities.find((a) => a.id === '4')).toMatchObject({ wbsPath: 'Project / Level 1 / Level 2' });
    expect(shown(m)).toEqual(['0:Project', '1:Level 1', '2:Level 2', '3:A1030', '2:A1000', '2:A1010', '2:A1020']);
  });

  it('indents an activity into the last node above it, and refuses when there is none', () => {
    const m = base();
    expect(indentRows(m, [{ kind: 'task', id: '1' }])).toEqual({ error: 'Nothing above to indent under: a row goes under the WBS node above it.' });
    const nested = ok(indentRows(m, [{ kind: 'wbs', id: '12' }])).model;
    const r = ok(indentRows(nested, [{ kind: 'task', id: '1' }]));
    expect(r.model.activities.find((a) => a.id === '1')).toMatchObject({ wbsId: '12', wbsPath: 'Project / Level 1 / Level 2' });
  });

  it('outdents a node to its parent\'s level, right after the parent', () => {
    const nested = ok(indentRows(base(), [{ kind: 'wbs', id: '12' }])).model;
    const m = ok(outdentRows(nested, [{ kind: 'wbs', id: '12' }])).model;
    expect(m.wbs.find((n) => n.id === '12')!.parentId).toBe('10');
    expect(childrenOf(m, '10').wbs.map((n) => n.name)).toEqual(['Level 1', 'Level 2']);
    expect(m.activities.find((a) => a.id === '4')).toMatchObject({ wbsPath: 'Project / Level 2' });
  });

  it('outdents an activity into the parent node, and refuses at the top', () => {
    const m = ok(outdentRows(base(), [{ kind: 'task', id: '2' }])).model;
    expect(m.activities.find((a) => a.id === '2')).toMatchObject({ wbsId: '10', wbsPath: 'Project' });
    expect(outdentRows(m, [{ kind: 'task', id: '2' }])).toEqual({ error: 'Already at the top level: there is no WBS node to move out to.' });
  });
});

describe('placing and copying', () => {
  it('puts an activity right after another', () => {
    const m = placeTaskAfter(base(), '3', '1');
    expect(childrenOf(m, '11').tasks.map((a) => a.code)).toEqual(['A1000', 'A1020', 'A1010']);
  });

  it('duplicates activities after their originals, with their codes and resources, not their id', () => {
    const m = base();
    m.activities[1] = { ...m.activities[1], activityCodes: { Area: 'North' } };
    const r = ok(duplicateActivities(m, ['2'], (used) => String(1 + Math.max(...used.map(Number))), nextCode));
    const copy = r.model.activities.find((a) => a.id === r.ids[0])!;
    expect(copy).toMatchObject({ name: `${m.activities[1].name} copy`, wbsId: '11', activityCodes: { Area: 'North' } });
    expect(copy.code).not.toBe('A1010');
    expect(childrenOf(r.model, '11').tasks.map((a) => a.id)).toEqual(['1', '2', r.ids[0], '3']);
  });
});
