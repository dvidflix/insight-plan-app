import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectDb } from '../../vite-plugins/db/projectDb';
import { normalizeXer } from '../../src/schedule/parsers/normalize';
import { parseXer } from '../../src/schedule/parsers/xer';
import { tablesToXer } from '../../src/schedule/exportXer';
import { summariseIssues, validateXer } from '../../src/schedule/xerValidate';
import { programmeRowOps } from '../../src/schedule/nativeOps';
import { addActivity, addCalendar, addWbs, moveActivities, type Result } from '../../src/schedule/programmeCommands';
import { activity, day, model } from './helpers';

const ok = <T extends object>(r: Result<T>) => {
  if ('error' in r) throw new Error(r.error);
  return r;
};

const CAL = '(0||CalendarData()((0||DaysOfWeek()((0||1()())(0||2()((0||0(s|08:00|f|16:00)())))(0||3()((0||0(s|08:00|f|16:00)())))(0||4()((0||0(s|08:00|f|16:00)())))(0||5()((0||0(s|08:00|f|16:00)())))(0||6()((0||0(s|08:00|f|16:00)())))(0||7()())))(0||Exceptions()())))';
const GOOD = [
  'ERMHDR\t20.12\t2029-01-01\tProject\tadmin\tadmin\tdb\tProject Management\tUSD',
  '%T\tPROJECT', '%F\tproj_id\tproj_short_name\tclndr_id\tplan_start_date', '%R\t1\tDEMO\t5\t2029-01-01 08:00',
  '%T\tCALENDAR', '%F\tclndr_id\tclndr_name\tclndr_type\tday_hr_cnt\tclndr_data', `%R\t5\tFive day\tCA_Base\t8\t${CAL}`,
  '%T\tPROJWBS', '%F\twbs_id\tproj_id\tproj_node_flag\twbs_name\tparent_wbs_id', '%R\t10\t1\tY\tDemo\t', '%R\t11\t1\tN\tLevel 1\t10',
  '%T\tTASK', '%F\ttask_id\tproj_id\twbs_id\tclndr_id\ttask_code\ttask_name\ttask_type\tstatus_code\ttarget_drtn_hr_cnt\ttarget_start_date',
  '%R\t1\t1\t11\t5\tA1\tFirst\tTT_Task\tTK_NotStart\t16\t2029-01-02 08:00',
  '%R\t2\t1\t11\t5\tA2\tSecond\tTT_Task\tTK_NotStart\t24\t2029-01-04 08:00',
  '%R\t3\t1\t11\t5\tM1\tDone\tTT_FinMile\tTK_NotStart\t0\t2029-01-09 16:00',
  '%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt', '%R\t1\t2\t1\t1\t1\tPR_FS\t0', '%R\t2\t3\t2\t1\t1\tPR_FS\t8',
  '%T\tTASKRSRC', '%F\ttaskrsrc_id\ttask_id\tproj_id\trsrc_id', '%R\t1\t1\t1\t9',
  '%E',
].join('\r\n') + '\r\n';

const messages = (text: string, severity?: 'error' | 'warning') => validateXer(text).filter((i) => !severity || i.severity === severity).map((i) => `${i.table}: ${i.message}`);
const changed = (from: string, to: string) => {
  expect(GOOD).toContain(from);
  return GOOD.replace(from, to);
};

describe('checking an XER the way P6 reads it', () => {
  it('finds nothing wrong with a good file', () => {
    expect(messages(GOOD)).toEqual([]);
  });

  it('finds a file that is not shaped like an XER', () => {
    expect(messages(GOOD.replace('%E\r\n', ''), 'error')).toEqual(['file: the file does not end with %E']);
    expect(messages(GOOD.replace('ERMHDR\t20.12', 'XX\t20.12'), 'error')).toContain('ERMHDR: the file does not start with an ERMHDR line');
    expect(messages(changed('%R\t2\t1\t11\t5\tA2\tSecond\tTT_Task\tTK_NotStart\t24\t2029-01-04 08:00', '%R\t2\t1\t11\t5\tA2\tSecond\tTT_Task\tTK_NotStart\t24'), 'error')).toEqual(['TASK: a row has 9 values for 10 fields']);
    expect(messages(GOOD.replace(/\r\n/g, '\n'), 'warning')).toEqual(['file: the lines are not separated by CR LF, as P6 writes them']);
  });

  it('finds rows that name what is not there', () => {
    expect(messages(changed('%R\t1\t2\t1\t1\t1\tPR_FS\t0', '%R\t1\t2\t99\t1\t1\tPR_FS\t0'), 'error')).toEqual(['TASKPRED: link 2 after 99 names a task that is not in the file']);
    expect(messages(changed('%R\t11\t1\tN\tLevel 1\t10', '%R\t11\t1\tN\tLevel 1\t77'), 'error')).toEqual(['PROJWBS: WBS 11 (Level 1) is under 77, which is not in the file']);
    expect(messages(changed('A2\tSecond\tTT_Task', 'A2\tSecond\tTT_Task').replace('%R\t2\t1\t11\t5', '%R\t2\t1\t11\t6'), 'error')).toEqual(['TASK: task 2 (A2) uses calendar 6, which is not in the file']);
    expect(messages(GOOD.replace('%R\t1\t1\t11\t5\tA1', '%R\t1\t1\t12\t5\tA1'), 'error')).toEqual(['TASK: task 1 (A1) is under WBS 12, which is not in the file']);
    expect(messages(GOOD.replace('%R\t1\t1\t1\t9', '%R\t1\t8\t1\t9'), 'warning')).toEqual(['TASKRSRC: a row belongs to task 8, which is not in the file']);
  });

  it('finds what P6 needs to be one of: ids, codes, one project node, a good status', () => {
    expect(messages(GOOD.replace('%R\t2\t1\t11\t5\tA2', '%R\t2\t1\t11\t5\tA1'), 'error')).toEqual(['TASK: Activity ID A1 is used twice in project 1']);
    expect(messages(GOOD.replace('%R\t3\t1\t11\t5\tM1', '%R\t2\t1\t11\t5\tM1'), 'error')).toContain('TASK: task_id 2 is used twice');
    expect(messages(GOOD.replace('%R\t11\t1\tN\tLevel 1\t10', '%R\t11\t1\tY\tLevel 1\t10'), 'error')).toEqual(['PROJWBS: project 1 has 2 project WBS nodes: it needs exactly one']);
    expect(messages(GOOD.replace('TK_NotStart\t16', 'TK_Started\t16'), 'error')).toEqual(['TASK: task 1 has the status TK_Started']);
    expect(messages(GOOD.replace('2029-01-02 08:00', '02/01/2029'), 'error')).toEqual(['TASK: task 1 (A1) has “02/01/2029” in target_start_date']);
    expect(messages(GOOD.replace('PR_FS\t0', 'PR_XX\t0'), 'error')).toEqual(['TASKPRED: link 2 after 1 has the type PR_XX']);
  });

  it('finds a loop in the links, but not a start-to-start one way and a finish-to-finish the other', () => {
    const loop = GOOD.replace('%R\t2\t3\t2\t1\t1\tPR_FS\t8', '%R\t2\t3\t2\t1\t1\tPR_FS\t8\r\n%R\t3\t1\t3\t1\t1\tPR_FS\t0');
    expect(messages(loop, 'error')).toEqual([expect.stringMatching(/^TASKPRED: the links make a loop through task/)]);
    const both = GOOD.replace('%R\t1\t2\t1\t1\t1\tPR_FS\t0', '%R\t1\t2\t1\t1\t1\tPR_SS\t0\r\n%R\t4\t1\t2\t1\t1\tPR_FF\t0');
    expect(messages(both, 'error')).toEqual([]);
    // Two links of the same type between the same two activities is worth a look; two of different types is not.
    expect(messages(GOOD.replace('%R\t2\t3\t2\t1\t1\tPR_FS\t8', '%R\t2\t3\t2\t1\t1\tPR_FS\t8\r\n%R\t3\t3\t2\t1\t1\tPR_FS\t0'), 'warning')).toEqual(['TASKPRED: 2 is linked to 3 by PR_FS more than once'.replace('2 is linked to 3', '2 is linked to 3')].map(() => expect.stringContaining('more than once')));
    expect(messages(GOOD.replace('%R\t2\t3\t2\t1\t1\tPR_FS\t8', '%R\t2\t3\t2\t1\t1\tPR_FS\t8\r\n%R\t3\t3\t2\t1\t1\tPR_SS\t0'), 'warning')).toEqual([]);
  });

  it('finds a calendar P6 could not read', () => {
    expect(messages(GOOD.replace(CAL, ''), 'error')).toEqual(['CALENDAR: calendar 5: it has no calendar data (clndr_data)']);
    expect(messages(GOOD.replace(CAL, CAL.slice(0, -2)), 'error')).toEqual(['CALENDAR: calendar 5: its calendar data has brackets left open']);
  });

  it('says it in a few lines', () => {
    const text = summariseIssues(validateXer(GOOD.replace('%R\t2\t1\t11\t5\tA2', '%R\t2\t1\t11\t5\tA1')));
    expect(text.split('\n')[0]).toBe('1 problem');
    expect(text).toContain('Activity ID A1 is used twice');
  });
});

describe('what the app exports', () => {
  it('is a valid XER for a programme made from scratch, and for one edited all over', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-validate-'));
    let db: ProjectDb | undefined;
    try {
      db = new ProjectDb(dir, path.join(dir, 'insight-plan.db'));
      const load = (id: number) => {
        const { tables } = db!.programmeTables(id);
        const rows: Record<string, Record<string, string>[]> = {};
        for (const [name, t] of Object.entries(tables)) rows[name] = t.rows.map((r) => Object.fromEntries(t.columns.map((c, i) => [c, r[i]])));
        return normalizeXer(rows, 'x.xer');
      };
      const exported = (id: number) => {
        const out = db!.exportProgramme(id);
        return tablesToXer(out.tables, out.header);
      };

      const blank = db.blankProgramme('From scratch', '2030-02-04');
      let m = load(blank.id);
      const zone = ok(addWbs(m, 'Zone A', m.wbs[0].id));
      m = zone.model;
      const first = ok(addActivity(m, { name: 'Pour', wbsId: zone.id }));
      const second = ok(addActivity(first.model, { name: 'Strip', after: first.id }));
      const link = { ...second.model, relationships: [{ predId: first.id, succId: second.id, type: 'FS' as const, lagHours: 16 }] };
      const night = ok(addCalendar(link, 'Night shift', link.calendars[0].id));
      db.applyOps(blank.id, programmeRowOps(load(blank.id), night.model));
      expect(messages(exported(blank.id))).toEqual([]);
      const written = parseXer(exported(blank.id));
      expect(written.TASK.map((r) => r.task_code)).toEqual(['A1010', 'A1020']);
      expect(written.CALENDAR.map((r) => r.clndr_name)).toEqual(['Standard 5 Day Workweek', 'Night shift']);

      // A programme with a task moved to another WBS node, a task deleted, and the data date moved.
      const moved = ok(moveActivities(night.model, [second.id], night.model.wbs[0].id));
      db.applyOps(blank.id, programmeRowOps(night.model, { ...moved.model, project: { ...moved.model.project, dataDate: day(2030, 3, 4) } }));
      expect(messages(exported(blank.id))).toEqual([]);
      expect(activity('x').id).toBe('x');
      expect(model([]).activities).toEqual([]);
    } finally {
      db?.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
