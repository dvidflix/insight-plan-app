import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectDb } from '../../vite-plugins/db/projectDb';
import { BrowserProjectDb } from '../../src/web/browserDb';
import type { ProjectDbBase } from '../../src/db/core';
import { normalizeXer } from '../../src/schedule/parsers/normalize';
import { activityColumns, programmeRowOps, xerDate } from '../../src/schedule/nativeOps';
import type { Activity, ScheduleModel } from '../../src/schedule/types';
import { activity, day, model, rel } from './helpers';

/** Edits made on the model reach the P6 tables as row changes, and reading the tables back gives the edited model. */

const CAL = '(0||CalendarData()((0||DaysOfWeek()((0||1()())(0||2()((0||0(s|08:00|f|16:00)())))(0||3()((0||0(s|08:00|f|16:00)())))(0||4()((0||0(s|08:00|f|16:00)())))(0||5()((0||0(s|08:00|f|16:00)())))(0||6()((0||0(s|08:00|f|16:00)())))(0||7()())))(0||Exceptions()())))';
const XER = [
  'ERMHDR\t20.12\t2029-01-01\tProject\tadmin\tadmin\tdb\tProject Management\tUSD',
  '%T\tPROJECT', '%F\tproj_id\tproj_short_name\tplan_start_date\tlast_recalc_date', '%R\t1\tDEMO\t2029-01-01 08:00\t2029-01-01 08:00',
  '%T\tCALENDAR', '%F\tclndr_id\tclndr_name\tday_hr_cnt\tclndr_data', `%R\t5\tFive day\t8\t${CAL}`,
  '%T\tPROJWBS', '%F\twbs_id\tproj_id\tproj_node_flag\twbs_name\twbs_short_name\tparent_wbs_id', '%R\t10\t1\tY\tDemo\tDEMO\t', '%R\t11\t1\tN\tLevel 1\tL1\t10',
  '%T\tTASK', '%F\ttask_id\tproj_id\twbs_id\tclndr_id\ttask_code\ttask_name\ttask_type\tstatus_code\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\ttarget_start_date\ttarget_end_date\tcstr_type\tcstr_date\tsome_unknown_col',
  '%R\t1\t1\t11\t5\tA1\tFirst\tTT_Task\tTK_NotStart\t16\t16\t2029-01-02 08:00\t2029-01-03 16:00\t\t\tkeep me',
  '%R\t2\t1\t11\t5\tA2\tSecond\tTT_Task\tTK_NotStart\t24\t24\t2029-01-04 08:00\t2029-01-08 16:00\t\t\tkeep me too',
  '%R\t3\t1\t11\t5\tA3\tOpening\tTT_FinMile\tTK_NotStart\t0\t0\t2029-01-09 16:00\t2029-01-09 16:00\t\t\tkeep me three',
  '%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt', '%R\t1\t2\t1\t1\t1\tPR_FS\t0', '%R\t2\t3\t2\t1\t1\tPR_FS\t8',
  '%T\tTASKRSRC', '%F\ttaskrsrc_id\ttask_id\tproj_id\trsrc_id\ttarget_qty', '%R\t1\t1\t1\t9\t5', '%R\t2\t2\t1\t9\t7',
  '%E',
].join('\n');
const meta = { name: 'Source', sourceFile: 'p.xer', sourceFormat: 'xer' as const, kind: 'import' as const, scenario: null, stem: null, projectIds: null };

/** The programme as the app reads it from the database. */
function load(db: ProjectDbBase, id: number): ScheduleModel {
  const { tables } = db.programmeTables(id);
  const out: Record<string, Record<string, string>[]> = {};
  for (const [name, t] of Object.entries(tables)) out[name] = t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])));
  return normalizeXer(out, 'p.xer');
}

async function withDbs(run: (db: ProjectDbBase, source: number) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-native-'));
  fs.writeFileSync(path.join(dir, 'p.xer'), XER);
  const server = new ProjectDb(dir, path.join(dir, 'insight-plan.db'));
  const browser = await BrowserProjectDb.open('browser:native', null);
  try {
    run(server, server.importXer(path.join(dir, 'p.xer'), meta).id);
    run(browser, browser.importXerBytes(new TextEncoder().encode(XER).buffer as ArrayBuffer, meta).id);
  } finally {
    server.close();
    browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const FIELDS: (keyof Activity)[] = ['code', 'name', 'wbsId', 'type', 'status', 'targetStart', 'targetFinish', 'durationHours', 'remainingDurationHours', 'constraintType', 'constraintDate', 'calendarId', 'earlyStart', 'earlyFinish', 'totalFloatHours'];
const pick = (a: Activity) => Object.fromEntries(FIELDS.map((f) => [f, a[f] instanceof Date ? (a[f] as Date).getTime() : (a[f] ?? null)]));
const links = (m: ScheduleModel) => m.relationships.map((r) => `${r.predId}>${r.succId} ${r.type} ${r.lagHours}`).sort();
const all = (db: ProjectDbBase, sql: string, ...params: unknown[]) => (db.db.prepare(sql).all(...params) as Record<string, unknown>[]).map((r) => ({ ...r }));

describe('xerDate', () => {
  it('writes the local time the way P6 does', () => {
    expect(xerDate(new Date(2029, 2, 5, 8, 0))).toBe('2029-03-05 08:00');
    expect(xerDate(null)).toBeNull();
  });
});

describe('what an edit writes', () => {
  const m = model([activity('1'), activity('2')], [rel('1', '2')]);
  it('writes only the fields that changed', () => {
    const [a, b] = m.activities;
    expect(activityColumns({ ...a, name: 'New', durationHours: 40 }, a)).toEqual({ task_name: 'New', target_drtn_hr_cnt: 40 });
    expect(activityColumns({ ...a, earlyStart: day(2029, 1, 2) }, a)).toEqual({ early_start_date: '2029-01-02 00:00' });
    expect(activityColumns(b, b)).toEqual({});
  });

  it('writes every field of a new activity, with the columns P6 expects', () => {
    const cols = activityColumns({ ...activity('9'), type: 'milestone-finish' as never, status: 'in-progress' as never });
    expect(cols).toMatchObject({ task_code: '9', task_type: 'TT_FinMile', status_code: 'TK_Active', complete_pct_type: 'CP_Drtn', duration_type: 'DT_FixedDUR2' });
  });

  it('is nothing when nothing changed, and one change per link, activity and project date', () => {
    expect(programmeRowOps(m, m)).toEqual([]);
    const after = { ...m, activities: [m.activities[0], { ...m.activities[1], name: 'Renamed' }], relationships: [{ ...m.relationships[0], lagHours: 8 }], project: { ...m.project, dataDate: day(2029, 2, 1) } };
    const ops = programmeRowOps(m, after);
    expect(ops.map((o) => `${o.op} ${o.table}`)).toEqual(['upsert TASK', 'upsert TASKPRED', 'upsert PROJECT']);
    expect(ops[1]).toMatchObject({ match: { task_id: 2, pred_task_id: 1 }, set: { pred_type: 'PR_FS', lag_hr_cnt: 8 } });
  });
});

describe('a programme edited in place', () => {
  it('reads back as the edited model, and keeps what the app does not edit', async () => {
    await withDbs((db, source) => {
      const copy = db.copyProgramme(source, 'Mine');
      const before = load(db, copy.id);
      expect(before.activities).toHaveLength(3);

      // Edit: rename, longer duration, a constraint, a new WBS node, a new activity linked from A1, A2 and its links removed, a link retyped.
      const [a1, a2, a3] = before.activities;
      const added: Activity = { ...activity('100'), projectId: '1', code: 'A100', name: 'Added', wbsId: '12', type: 'task', status: 'not-started', calendarId: '5', durationHours: 40, remainingDurationHours: 40, targetStart: day(2029, 2, 5), targetFinish: day(2029, 2, 9) };
      const after: ScheduleModel = {
        ...before,
        project: { ...before.project, dataDate: day(2029, 1, 5) },
        wbs: [...before.wbs, { id: '12', name: 'Level 2', code: 'L2', parentId: '10' }],
        activities: [
          { ...a1, name: 'First (renamed)', durationHours: 32, remainingDurationHours: 32, constraintType: 'CS_MSO', constraintDate: day(2029, 1, 2), earlyStart: day(2029, 1, 2), totalFloatHours: 0 },
          a3,
          added,
        ],
        relationships: [{ predId: '1', succId: '100', type: 'SS', lagHours: 16 }, { predId: '100', succId: '3', type: 'FF', lagHours: 0 }],
      };
      void a2;
      const ops = programmeRowOps(before, after);
      db.applyOps(copy.id, ops);

      const reloaded = load(db, copy.id);
      expect(reloaded.activities.map((a) => a.id).sort()).toEqual(['1', '100', '3']);
      for (const a of after.activities) expect(pick(reloaded.activities.find((r) => r.id === a.id)!)).toEqual(pick(a));
      expect(links(reloaded)).toEqual(links(after));
      expect(reloaded.wbs.find((n) => n.id === '12')).toMatchObject({ name: 'Level 2', code: 'L2', parentId: '10' });
      expect(reloaded.project.dataDate).toEqual(day(2029, 1, 5));
      expect(db.programme(copy.id)!.activityCount).toBe(3);

      // What the model does not carry is as it was: the unknown column, the resource rows of the activities that stayed (and not of the one removed).
      expect(all(db, 'SELECT task_id, some_unknown_col AS c FROM TASK WHERE ip_programme_id = ? AND some_unknown_col IS NOT NULL ORDER BY task_id', copy.id).map((r) => r.c)).toEqual(['keep me', 'keep me three']);
      expect(all(db, 'SELECT task_id FROM TASKRSRC WHERE ip_programme_id = ?', copy.id).map((r) => Number(r.task_id))).toEqual([1]);

      // Nothing is left to write once the tables hold the edited model, and the source programme was never touched.
      expect(programmeRowOps(reloaded, after).filter((o) => o.table !== 'PROJWBS' || o.op !== 'upsert')).toEqual([]);
      expect(load(db, source).activities).toHaveLength(3);
    });
  });

  it('reaches the same tables when edits are undone and redone', async () => {
    await withDbs((db, source) => {
      const copy = db.copyProgramme(source, 'Mine');
      const base = load(db, copy.id);
      const edited: ScheduleModel = { ...base, activities: base.activities.map((a) => (a.id === '2' ? { ...a, name: 'Changed', durationHours: 8 } : a)), relationships: base.relationships.slice(0, 1) };
      db.applyOps(copy.id, programmeRowOps(base, edited));
      expect(load(db, copy.id).activities.find((a) => a.id === '2')).toMatchObject({ name: 'Changed', durationHours: 8 });
      db.applyOps(copy.id, programmeRowOps(edited, base)); // undo
      const undone = load(db, copy.id);
      expect(pick(undone.activities.find((a) => a.id === '2')!)).toEqual(pick(base.activities.find((a) => a.id === '2')!));
      expect(links(undone)).toEqual(links(base));
      db.applyOps(copy.id, programmeRowOps(base, edited)); // redo
      expect(links(load(db, copy.id))).toEqual(links(edited));
    });
  });
});
