import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectDb } from '../../vite-plugins/db/projectDb';

/** A small XER with the P6 tables the app reads, enough to exercise import, read-back, hiding, deleting and the app's own tables. */
function xer(tasks: number): string {
  const out = ['ERMHDR\t20.12\t2029-01-01\tProject\tadmin\tadmin\tdb\tProject Management\tUSD'];
  out.push('%T\tPROJECT', '%F\tproj_id\tproj_short_name\tplan_start_date', '%R\t1\tDEMO\t2029-01-01 08:00');
  out.push('%T\tTASK', '%F\ttask_id\tproj_id\ttask_code\ttask_name\ttarget_start_date\ttarget_end_date\ttask_type\tstatus_code\ttarget_drtn_hr_cnt');
  for (let i = 1; i <= tasks; i++) out.push(`%R\t${i}\t1\tA${String(i).padStart(4, '0')}\tPour ${i}\t2029-03-${(i % 28) + 1} 08:00\t2029-04-${(i % 28) + 1} 16:00\tTT_Task\tTK_NotStart\t${8 + (i % 5) * 8}`);
  out.push('%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt');
  for (let i = 2; i <= tasks; i++) out.push(`%R\t${i}\t${i}\t${i - 1}\t1\t1\tPR_FS\t0`);
  out.push('%E');
  return out.join('\n');
}

type Impl = new (root: string, file: string) => ProjectDb;

function exercise(Db: Impl) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-db-'));
  const file = path.join(dir, 'programme.xer');
  fs.writeFileSync(file, xer(40));
  const db = new Db(dir, path.join(dir, 'insight-plan.db'));
  try {
    const meta = { name: 'Test', sourceFile: 'programme.xer', sourceFormat: 'xer' as const, kind: 'import' as const, scenario: null, stem: null, projectIds: null };
    const imported = db.importXer(file, meta);
    const second = db.importXer(file, { ...meta, name: 'Second' });
    const tables = db.programmeTables(imported.id).tables;
    db.setHidden({ [second.id]: true });
    db.renameProgramme(imported.id, 'Renamed');
    db.writeLinkGroups([{ id: 'g1', name: 'Walls', color: '#ff0000', taskFilters: [{ a: 1 }], objectFilters: [], matchRules: [] }]);
    db.writeCapacities({ LAB: 12, BAD: -1 });
    db.writeSetting('ui:x', { a: [1, 2] });
    db.writeClashRun('k1', 'self:A', [['a', 'b', 0.5, true, 'above']]);
    const before = db.programmes();
    db.deleteProgramme(second.id);
    return {
      imported: { ...imported, importedAt: '' },
      tableNames: Object.keys(tables).sort(),
      taskRows: tables.TASK.rows.length,
      firstTask: tables.TASK.rows[0],
      lastPred: tables.TASKPRED.rows.at(-1),
      hiddenBefore: before.map((p) => [p.name, p.hidden]),
      programmesAfter: db.programmes().map((p) => [p.id, p.name, p.hidden, p.activityCount]),
      linkGroups: db.linkGroups(),
      capacities: db.capacities(),
      settings: db.settings(),
      clashes: db.clashRuns(['k1', 'nope']),
    };
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('project database (server)', () => {
  it('imports, reads back, hides, deletes and stores the app data', () => {
    const r = exercise(ProjectDb);
    expect(r.taskRows).toBe(40);
    expect(r.tableNames).toEqual(['PROJECT', 'TASK', 'TASKPRED']);
    expect(r.firstTask).toBeDefined();
    expect(r.hiddenBefore).toEqual([['Renamed', false], ['Second', true]]);
    expect(r.programmesAfter.map((p) => p[1])).toEqual(['Renamed']);
    expect(r.capacities).toEqual({ LAB: 12 });
    expect(r.settings).toEqual({ 'ui:x': { a: [1, 2] } });
    expect(r.clashes).toEqual([{ key: 'k1', pairs: [['a', 'b', 0.5, true, 'above']] }]);
  });
});
