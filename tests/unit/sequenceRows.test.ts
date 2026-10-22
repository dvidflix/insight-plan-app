import { describe, expect, it } from 'vitest';
import { applyExtraRow, applyLevelTaskRow, extraRows, levelTaskRows, scopeOf, wbsOf } from '../../src/prs/sequenceRows';
import type { ExtraTag, LevelTask } from '../../src/prs/rules';
import type { ScenarioExtra } from '../../src/scenarios/api';

const extras: ScenarioExtra[] = [
  { TaskID: 'X1', Name: 'Site setup', DurationDays: 5, BaselineStart: '2029-04-06', BaselineFinish: '2029-04-12' },
  { TaskID: 'X2', Name: 'Level handover', DurationDays: 0, BaselineStart: '2029-06-01', BaselineFinish: '2029-06-01' },
  { TaskID: 'X3', Name: 'Temporary works', DurationDays: 3, BaselineStart: '2029-05-01', BaselineFinish: '2029-05-04' },
];
const tags: Record<string, ExtraTag> = {
  X2: { building: 'A', level: 'L01', wbs: 'level', task: 'SLABS', kind: 'finish' },
  X3: { wbs: 'path:Temporary / Hoarding' },
};
const levelTasks: LevelTask[] = [{ id: 'LT1', name: 'Slabs', group: 'Slabs' }, { id: 'LT2', name: 'Walls', group: 'Walls', enabled: false }];

describe('extra activities and level tasks as Sequence rows', () => {
  it('maps the WBS place to a scope and back, keeping a folder path as typed', () => {
    expect(scopeOf(undefined)).toEqual({ scope: 'once', path: '' });
    expect(scopeOf('level')).toEqual({ scope: 'level', path: '' });
    expect(scopeOf('path:A / B')).toEqual({ scope: 'folder', path: 'A / B' });
    for (const wbs of ['', 'level', 'slabs', 'path:A / B']) expect(wbsOf(scopeOf(wbs).scope, scopeOf(wbs).path)).toBe(wbs);
  });

  it('writes an unchanged extra row back to exactly the data it came from', () => {
    for (const e of extras) {
      const row = extraRows(extras, tags).find((r) => r.id === e.TaskID)!;
      const out = applyExtraRow(extras, tags, e.TaskID, row);
      expect(out.extras).toEqual(extras);
      expect(out.tags).toEqual(tags);
    }
  });

  it('keeps an extra with no tag untagged', () => {
    const row = extraRows(extras, tags)[0];
    expect(row).toMatchObject({ scope: 'once', building: '', level: '', task: '', type: '' });
    expect(applyExtraRow(extras, tags, 'X1', row).tags.X1).toBeUndefined();
  });

  it('writes an edit to the extra and its tag, and moves the tag when the ID changes', () => {
    const row = { ...extraRows(extras, tags)[1], id: 'X2b', name: 'Handover L01', scope: 'slabs' as const };
    const out = applyExtraRow(extras, tags, 'X2', row);
    expect(out.extras[1]).toMatchObject({ TaskID: 'X2b', Name: 'Handover L01', BaselineStart: '2029-06-01' });
    expect(out.tags.X2).toBeUndefined();
    expect(out.tags.X2b).toEqual({ building: 'A', level: 'L01', wbs: 'slabs', task: 'SLABS', kind: 'finish' });
    expect(out.tags.X3).toEqual(tags.X3);
  });

  it('round-trips the level tasks, including a switched-off one', () => {
    const rows = levelTaskRows(levelTasks);
    expect(rows.map((r) => r.enabled)).toEqual([true, false]);
    let out = levelTasks;
    for (const r of rows) out = applyLevelTaskRow(out, r);
    expect(out).toEqual(levelTasks);
    expect(applyLevelTaskRow(levelTasks, { ...rows[0], enabled: false })[0].enabled).toBe(false);
  });
});
