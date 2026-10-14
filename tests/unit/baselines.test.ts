import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectDb } from '../../vite-plugins/db/projectDb';
import { BrowserProjectDb } from '../../src/web/browserDb';
import type { ProjectDbBase } from '../../src/db/core';

/** A baseline is the programme as it was when it was saved: a frozen, hidden copy, kept with the programme it belongs to. */

const XER = [
  'ERMHDR\t20.12\t2029-01-01\tProject\tadmin\tadmin\tdb\tProject Management\tUSD',
  '%T\tPROJECT', '%F\tproj_id\tproj_short_name\tplan_start_date', '%R\t1\tDEMO\t2029-01-01 08:00',
  '%T\tTASK', '%F\ttask_id\tproj_id\ttask_code\ttask_name\ttarget_drtn_hr_cnt\ttarget_start_date', '%R\t1\t1\tA1\tFirst\t16\t2029-01-02 08:00', '%R\t2\t1\tA2\tSecond\t24\t2029-01-04 08:00',
  '%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt', '%R\t1\t2\t1\t1\t1\tPR_FS\t0',
  '%E',
].join('\n');
const meta = { name: 'Source', sourceFile: 'p.xer', sourceFormat: 'xer' as const, kind: 'import' as const, scenario: null, stem: null, projectIds: null };

async function withDbs(run: (db: ProjectDbBase, source: number, reimport: () => number) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-base-'));
  fs.writeFileSync(path.join(dir, 'p.xer'), XER);
  const server = new ProjectDb(dir, path.join(dir, 'insight-plan.db'));
  const browser = await BrowserProjectDb.open('browser:base', null);
  try {
    const scenario = { ...meta, name: 'Gen', kind: 'scenario' as const, scenario: 'S', stem: 'M' };
    run(server, server.importXer(path.join(dir, 'p.xer'), meta).id, () => server.importXer(path.join(dir, 'p.xer'), scenario).id);
    run(browser, browser.importXerBytes(new TextEncoder().encode(XER).buffer as ArrayBuffer, meta).id, () => browser.importXerBytes(new TextEncoder().encode(XER).buffer as ArrayBuffer, scenario).id);
  } finally {
    server.close();
    browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const names = (db: ProjectDbBase, id: number) => db.programmeTables(id).tables.TASK.rows.map((r) => r[db.programmeTables(id).tables.TASK.columns.indexOf('task_name')]);

describe('saved baselines', () => {
  it('keeps the programme as it was, hidden and not editable, whatever happens to the programme after', async () => {
    await withDbs((db, source) => {
      const mine = db.copyProgramme(source, 'Mine');
      const base = db.saveBaseline(mine.id, 'Baseline 1');
      expect(base).toMatchObject({ name: 'Baseline 1', baselineOf: mine.id, hidden: true, editable: false, activityCount: 2 });
      expect(mine.baselineOf).toBeNull();
      db.applyOps(mine.id, [
        { table: 'TASK', op: 'upsert', key: { column: 'task_id', value: 1 }, set: { task_name: 'Changed' } },
        { table: 'TASK', op: 'delete', key: { column: 'task_id', value: 2 } },
      ]);
      expect(names(db, mine.id)).toEqual(['Changed']);
      expect(names(db, base.id)).toEqual(['First', 'Second']);
      expect(db.programmeTables(base.id).tables.TASKPRED.rows).toHaveLength(1);
      // A second baseline is another copy.
      expect(db.saveBaseline(mine.id, 'Baseline 2').baselineOf).toBe(mine.id);
      expect(db.programmes().filter((p) => p.baselineOf === mine.id).map((p) => p.name)).toEqual(['Baseline 1', 'Baseline 2']);
      // A baseline cannot be edited, nor have a baseline of its own.
      expect(() => db.applyOps(base.id, [{ table: 'TASK', op: 'delete', key: { column: 'task_id', value: 1 } }])).toThrow(/editable copy/);
      expect(() => db.saveBaseline(base.id, 'x')).toThrow(/baseline already/);
    });
  });

  it('can be made of an imported programme, and goes with the programme when that is deleted', async () => {
    await withDbs((db, source) => {
      const base = db.saveBaseline(source, 'As imported');
      expect(names(db, base.id)).toEqual(['First', 'Second']);
      db.deleteProgramme(source);
      expect(db.programmes()).toEqual([]);
      expect(base.id).toBeGreaterThan(0);
    });
  });

  it('stays with a generated programme when it is generated again', async () => {
    await withDbs((db, _source, regenerate) => {
      const first = regenerate();
      const base = db.saveBaseline(first, 'Before the rules changed');
      const second = regenerate();
      expect(second).not.toBe(first);
      expect(db.programme(first)).toBeNull();
      expect(db.programme(base.id)).toMatchObject({ baselineOf: second, name: 'Before the rules changed' });
      expect(names(db, base.id)).toEqual(['First', 'Second']);
    });
  });

  it('adds the column to a project database made before baselines', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-base-mig-'));
    let db: ProjectDb | undefined;
    try {
      fs.writeFileSync(path.join(dir, 'p.xer'), XER);
      db = new ProjectDb(dir, path.join(dir, 'insight-plan.db'));
      const id = db.importXer(path.join(dir, 'p.xer'), meta).id;
      db.db.exec('ALTER TABLE ip_programme DROP COLUMN baseline_of');
      db.db.prepare("UPDATE ip_meta SET value = '2' WHERE key = 'schema_version'").run();
      db.close();
      db = new ProjectDb(dir, path.join(dir, 'insight-plan.db'));
      expect(db.meta('schema_version')).toBe('3');
      expect(db.programme(id)).toMatchObject({ name: 'Source', baselineOf: null, activityCount: 2 });
      expect(db.saveBaseline(id, 'B').baselineOf).toBe(id);
    } finally {
      db?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
