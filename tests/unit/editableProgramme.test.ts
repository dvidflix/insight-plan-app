import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectDb } from '../../vite-plugins/db/projectDb';
import { BrowserProjectDb } from '../../src/web/browserDb';
import { clndrWeek } from '../../src/schedule/parsers/normalize';
import type { ProjectDbBase } from '../../src/db/core';

/** Programmes edited in place: a copy that keeps every row, a blank one, and row changes, on the server's database and the browser's. */

const XER = [
  'ERMHDR\t20.12\t2029-01-01\tProject\tadmin\tadmin\tdb\tProject Management\tUSD',
  '%T\tPROJECT', '%F\tproj_id\tproj_short_name\tplan_start_date', '%R\t1\tDEMO\t2029-01-01 08:00',
  '%T\tTASK', '%F\ttask_id\tproj_id\ttask_code\ttask_name\ttarget_drtn_hr_cnt\tsome_unknown_col',
  '%R\t1\t1\tA1\tFirst\t8\tkeep me', '%R\t2\t1\tA2\tSecond\t16\tkeep me too',
  '%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt', '%R\t1\t2\t1\t1\t1\tPR_FS\t0',
  '%T\tUNREAD', '%F\tid\tnote', '%R\t7\tnot read by the app',
  '%E',
].join('\n');
const meta = { name: 'Source', sourceFile: 'p.xer', sourceFormat: 'xer' as const, kind: 'import' as const, scenario: null, stem: null, projectIds: null };

async function withDbs(run: (db: ProjectDbBase, load: () => number) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-edit-'));
  fs.writeFileSync(path.join(dir, 'p.xer'), XER);
  const server = new ProjectDb(dir, path.join(dir, 'insight-plan.db'));
  const browser = await BrowserProjectDb.open('browser:edit', null);
  try {
    run(server, () => server.importXer(path.join(dir, 'p.xer'), meta).id);
    run(browser, () => browser.importXerBytes(new TextEncoder().encode(XER).buffer as ArrayBuffer, meta).id);
  } finally {
    server.close();
    browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const tasksOf = (db: ProjectDbBase, id: number) => db.programmeTables(id).tables.TASK.rows;
const all = (db: ProjectDbBase, sql: string, ...params: unknown[]) => (db.db.prepare(sql).all(...params) as Record<string, unknown>[]).map((r) => ({ ...r }));

describe('programmes edited in place', () => {
  it('copies every row, the unread tables and columns too, and leaves the source alone', async () => {
    await withDbs((db, load) => {
      const source = load();
      expect(db.programme(source)!.editable).toBe(false);
      const copy = db.copyProgramme(source, 'Mine');
      expect(copy).toMatchObject({ name: 'Mine', editable: true, kind: 'import', activityCount: 2 });
      expect(tasksOf(db, copy.id)).toEqual(tasksOf(db, source));
      expect(all(db, 'SELECT some_unknown_col AS c FROM TASK WHERE ip_programme_id = ? ORDER BY task_id', copy.id).map((r) => r.c)).toEqual(['keep me', 'keep me too']);
      expect(all(db, 'SELECT COUNT(*) AS n FROM UNREAD WHERE ip_programme_id = ?', copy.id)[0].n).toBe(1);
      db.applyOps(copy.id, [{ table: 'TASK', op: 'upsert', key: { column: 'task_id', value: 1 }, set: { task_name: 'Changed' } }]);
      expect(tasksOf(db, source)[0]).toContain('First');
    });
  });

  it('changes, adds and deletes rows, giving new rows the next id, all in one transaction', async () => {
    await withDbs((db, load) => {
      const copy = db.copyProgramme(load(), 'Mine');
      const r = db.applyOps(copy.id, [
        { table: 'TASK', op: 'upsert', key: { column: 'task_id', value: 2 }, set: { task_name: 'Renamed', target_drtn_hr_cnt: 24 } },
        { table: 'TASK', op: 'upsert', key: { column: 'task_id', value: null }, set: { proj_id: 1, task_code: 'A3', task_name: 'Third', brand_new_col: 'x' } },
        { table: 'TASK', op: 'upsert', key: { column: 'task_id', value: null }, set: { proj_id: 1, task_code: 'A4', task_name: 'Fourth' } },
        { table: 'TASKPRED', op: 'delete', key: { column: 'task_pred_id', value: 1 } },
      ]);
      expect(r.assigned).toEqual({ 1: 3, 2: 4 });
      const rows = all(db, 'SELECT task_id, task_code, task_name, target_drtn_hr_cnt FROM TASK WHERE ip_programme_id = ? ORDER BY task_id', copy.id);
      expect(rows.map((x) => [Number(x.task_id), x.task_code, x.task_name])).toEqual([[1, 'A1', 'First'], [2, 'A2', 'Renamed'], [3, 'A3', 'Third'], [4, 'A4', 'Fourth']]);
      expect(Number(rows[1].target_drtn_hr_cnt)).toBe(24);
      expect(db.programme(copy.id)!.activityCount).toBe(4);
      expect(db.programmeTables(copy.id).tables.TASKPRED.rows).toHaveLength(0);

      // Nothing is applied when one of the changes is refused.
      expect(() => db.applyOps(copy.id, [
        { table: 'TASK', op: 'delete', key: { column: 'task_id', value: 1 } },
        { table: 'ip_meta', op: 'upsert', key: { column: 'key', value: 'x' }, set: { value: 'y' } },
      ])).toThrow();
      expect(tasksOf(db, copy.id)).toHaveLength(4);
      expect(() => db.applyOps(copy.id, [{ table: 'TASK', op: 'upsert', key: { column: 'task_id; DROP TABLE TASK', value: 1 } }])).toThrow();
    });
  });

  it('refuses changes to a programme that is not edited in place', async () => {
    await withDbs((db, load) => {
      expect(() => db.applyOps(load(), [{ table: 'TASK', op: 'delete', key: { column: 'task_id', value: 1 } }])).toThrow(/editable copy/);
    });
  });

  it('makes a blank programme with a project, a root WBS node and a Monday-Friday calendar', async () => {
    await withDbs((db) => {
      const blank = db.blankProgramme('From scratch', '2030-02-04');
      expect(blank).toMatchObject({ name: 'From scratch', editable: true, activityCount: 0, sourceFormat: 'xer' });
      const { tables } = db.programmeTables(blank.id);
      expect(Object.keys(tables)).toEqual(expect.arrayContaining(['PROJECT', 'CALENDAR', 'PROJWBS', 'TASK', 'TASKPRED']));
      expect(tables.PROJWBS.rows).toHaveLength(1);
      const week = clndrWeek(tables.CALENDAR.rows[0][tables.CALENDAR.columns.indexOf('clndr_data')]);
      expect(Object.entries(week).filter(([, d]) => d.working).map(([n]) => n)).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']);
      const added = db.applyOps(blank.id, [{ table: 'TASK', op: 'upsert', key: { column: 'task_id', value: null }, set: { proj_id: 1, wbs_id: 1, task_code: 'A1000', task_name: 'First task' } }]);
      expect(added.assigned).toEqual({ 0: 1 });
      expect(db.programme(blank.id)!.activityCount).toBe(1);
      expect(() => db.blankProgramme('x', 'soon')).toThrow();
    });
  });

  it('adds the editable column to a project database made before it, and keeps what was in it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-migrate-'));
    try {
      fs.writeFileSync(path.join(dir, 'p.xer'), XER);
      const old = new ProjectDb(dir, path.join(dir, 'insight-plan.db'));
      const id = old.importXer(path.join(dir, 'p.xer'), meta).id;
      old.db.exec('ALTER TABLE ip_programme DROP COLUMN editable');
      old.db.prepare("UPDATE ip_meta SET value = '1' WHERE key = 'schema_version'").run();
      old.close();
      const again = new ProjectDb(dir, path.join(dir, 'insight-plan.db'));
      expect(again.meta('schema_version')).toBe('3');
      expect(again.programme(id)).toMatchObject({ name: 'Source', editable: false, activityCount: 2 });
      expect(tasksOf(again, id)).toHaveLength(2);
      again.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
