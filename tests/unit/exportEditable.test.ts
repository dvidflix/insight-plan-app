import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectDb } from '../../vite-plugins/db/projectDb';
import { BrowserProjectDb } from '../../src/web/browserDb';
import type { ProjectDbBase } from '../../src/db/core';
import { normalizeXer } from '../../src/schedule/parsers/normalize';
import { parseXer } from '../../src/schedule/parsers/xer';
import { tablesToXer } from '../../src/schedule/exportXer';
import { programmeRowOps } from '../../src/schedule/nativeOps';

/** A programme edited in place goes out as an XER with everything the file it came from had, and the edits made. */

const HEADER = 'ERMHDR\t24.12\t2026-05-18\tProject\tdavid\tDavid\tdbxDatabaseNoName\tProject Management\tU.K.';
const CAL = '(0||CalendarData()((0||DaysOfWeek()((0||1()())(0||2()((0||0(s|08:00|f|16:00)())))(0||3()((0||0(s|08:00|f|16:00)())))(0||4()((0||0(s|08:00|f|16:00)())))(0||5()((0||0(s|08:00|f|16:00)())))(0||6()((0||0(s|08:00|f|16:00)())))(0||7()())))(0||Exceptions()())))';
const XER = [
  HEADER,
  '%T\tCURRTYPE', '%F\tcurr_id\tcurr_short_name', '%R\t1\tU.K.',
  '%T\tPROJECT', '%F\tproj_id\tproj_short_name\tplan_start_date\tlast_recalc_date', '%R\t1\tDEMO\t2029-01-01 08:00\t2029-01-01 08:00',
  '%T\tCALENDAR', '%F\tclndr_id\tclndr_name\tday_hr_cnt\tclndr_data', `%R\t5\tFive day\t8\t${CAL}`,
  '%T\tPROJWBS', '%F\twbs_id\tproj_id\tproj_node_flag\twbs_name\twbs_short_name\tparent_wbs_id', '%R\t10\t1\tY\tDemo\tDEMO\t', '%R\t11\t1\tN\tLevel 1\tL1\t10',
  '%T\tTASK', '%F\ttask_id\tproj_id\twbs_id\tclndr_id\ttask_code\ttask_name\ttask_type\tstatus_code\ttarget_drtn_hr_cnt\tsome_unknown_col',
  '%R\t1\t1\t11\t5\tA1\tFirst\tTT_Task\tTK_NotStart\t16\tkeep me',
  '%R\t2\t1\t11\t5\tA2\tSecond\tTT_Task\tTK_NotStart\t24\tkeep me too',
  '%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt', '%R\t1\t2\t1\t1\t1\tPR_FS\t0',
  '%T\tTASKRSRC', '%F\ttaskrsrc_id\ttask_id\tproj_id\trsrc_id\ttarget_qty', '%R\t1\t1\t1\t9\t5',
  '%T\tUDFVALUE', '%F\tudf_type_id\tfk_id\tproj_id\tudf_text', '%R\t3\t1\t1\tnote on A1',
  '%E',
].join('\n');
const meta = { name: 'Source', sourceFile: 'p.xer', sourceFormat: 'xer' as const, kind: 'import' as const, scenario: null, stem: null, projectIds: null };

async function withDbs(run: (db: ProjectDbBase, source: number) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-export-'));
  fs.writeFileSync(path.join(dir, 'p.xer'), XER);
  const server = new ProjectDb(dir, path.join(dir, 'insight-plan.db'));
  const browser = await BrowserProjectDb.open('browser:export', null);
  try {
    run(server, server.importXer(path.join(dir, 'p.xer'), meta).id);
    run(browser, browser.importXerBytes(new TextEncoder().encode(XER).buffer as ArrayBuffer, meta).id);
  } finally {
    server.close();
    browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const asXer = (db: ProjectDbBase, id: number) => {
  const out = db.exportProgramme(id);
  return tablesToXer(out.tables, out.header);
};

function load(db: ProjectDbBase, id: number) {
  const { tables } = db.programmeTables(id);
  const rows: Record<string, Record<string, string>[]> = {};
  for (const [name, t] of Object.entries(tables)) rows[name] = t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])));
  return normalizeXer(rows, 'p.xer');
}

describe('an editable programme written out as an XER', () => {
  it('is the file it came from when nothing was changed: its header, tables, columns, order and rows', async () => {
    await withDbs((db, source) => {
      const copy = db.copyProgramme(source, 'Mine');
      expect(asXer(db, copy.id)).toBe(asXer(db, source));
      expect(parseXer(asXer(db, copy.id))).toEqual(parseXer(XER));
      expect(asXer(db, copy.id).startsWith(HEADER)).toBe(true);
      expect(Object.keys(parseXer(asXer(db, copy.id)))).toEqual(['CURRTYPE', 'PROJECT', 'CALENDAR', 'PROJWBS', 'TASK', 'TASKPRED', 'TASKRSRC', 'UDFVALUE']);
    });
  });

  it('has the edits made, and still everything the app does not edit', async () => {
    await withDbs((db, source) => {
      const copy = db.copyProgramme(source, 'Mine');
      const before = load(db, copy.id);
      db.applyOps(copy.id, programmeRowOps(before, {
        ...before,
        activities: before.activities.map((a) => (a.id === '2' ? { ...a, name: 'Renamed', durationHours: 40 } : a)),
        relationships: [],
      }));
      const written = parseXer(asXer(db, copy.id));
      const original = parseXer(XER);
      expect(written.TASK.map((r) => [r.task_id, r.task_name, r.target_drtn_hr_cnt, r.some_unknown_col])).toEqual([['1', 'First', '16', 'keep me'], ['2', 'Renamed', '40', 'keep me too']]);
      expect(written.TASKPRED).toBeUndefined();
      for (const name of ['CURRTYPE', 'PROJECT', 'CALENDAR', 'PROJWBS', 'TASKRSRC', 'UDFVALUE']) expect(written[name]).toEqual(original[name]);
    });
  });

  it('writes a programme made from scratch that reads back as the programme', async () => {
    await withDbs((db) => {
      const blank = db.blankProgramme('From scratch', '2030-02-04');
      db.applyOps(blank.id, [{ table: 'TASK', op: 'upsert', key: { column: 'task_id', value: 1 }, set: { proj_id: 1, wbs_id: 1, clndr_id: 1, task_code: 'A1000', task_name: 'First', task_type: 'TT_Task', status_code: 'TK_NotStart', target_drtn_hr_cnt: 40 } }]);
      const out = db.exportProgramme(blank.id);
      expect(Object.keys(out.tables)).toEqual(['PROJECT', 'CALENDAR', 'SCHEDOPTIONS', 'PROJWBS', 'TASK']);
      const text = tablesToXer(out.tables, out.header);
      expect(text.split('\r\n')[0]).toMatch(/^ERMHDR\t19\.12\t\d{4}-\d{2}-\d{2}\tProject/);
      const model = normalizeXer(parseXer(text), 'x.xer');
      expect(model.activities.map((a) => [a.id, a.code, a.name, a.durationHours, a.calendarId])).toEqual([['1', 'A1000', 'First', 40, '1']]);
      expect(model.wbs).toHaveLength(1);
      expect(model.calendars[0].days.Monday?.working).toBe(true);
    });
  });
});
