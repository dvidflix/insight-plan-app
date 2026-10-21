import type { Activity, ActivityStatus, ActivityType, Relationship, ScheduleModel, WbsNode } from './types';
import type { ScheduleCalendar } from './calendar';
import { calendarData, weekHours } from './calendarData';
import type { DbRowOp } from '../db/api';
import { codeOps, resourceOps, udfOps } from './nativeOpsExtra';

/** A programme edited in place lives in the project database as P6's own tables (see ProjectDbBase.applyOps). This turns the
    difference between two states of its model into the row changes that bring the tables from the one to the other, so every
    edit, an undo and a redo too, reaches the database the same way. Only what changed is written: a column the app does not model,
    or a field nobody touched, keeps the value the file had.

    What is written: activities (TASK), links (TASKPRED), WBS nodes (PROJWBS), calendars, the project's dates (PROJECT), resources
    (RSRC, RSRCRATE) and their assignments (TASKRSRC), activity codes (ACTVTYPE, ACTVCODE) and their assignments (TASKACTV), user
    fields (UDFTYPE) and their values (UDFVALUE); see nativeOpsExtra.ts. */

type Cell = string | number | null;

/** P6's date text, "2029-03-15 08:00", from the date's local time (how the app reads it). */
export function xerDate(d: Date | null | undefined): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** An id as the database holds it: a number when it is one. */
const idValue = (id: string): string | number => (/^\d+$/.test(id) ? Number(id) : id);

const TASK_TYPE: Record<ActivityType, string> = { task: 'TT_Task', 'milestone-start': 'TT_Mile', 'milestone-finish': 'TT_FinMile', loe: 'TT_LOE', 'wbs-summary': 'TT_WBS' };
const STATUS: Record<ActivityStatus, string> = { 'not-started': 'TK_NotStart', 'in-progress': 'TK_Active', completed: 'TK_Complete' };

/** Activity field -> the TASK columns it is written to. A field is written when it differs from before; `value` may give more than one column. */
const ACTIVITY_FIELDS: { fields: (keyof Activity)[]; /** What the columns are made of when that is not just the fields. */ read?: (a: Activity) => unknown; write: (a: Activity) => Record<string, Cell> }[] = [
  { fields: ['code'], write: (a) => ({ task_code: a.code }) },
  { fields: ['name'], write: (a) => ({ task_name: a.name }) },
  { fields: ['wbsId'], write: (a) => ({ wbs_id: a.wbsId === null ? null : idValue(a.wbsId) }) },
  { fields: ['type'], write: (a) => ({ task_type: TASK_TYPE[a.type] ?? 'TT_Task' }) },
  { fields: ['status'], write: (a) => ({ status_code: STATUS[a.status] ?? 'TK_NotStart' }) },
  { fields: ['targetStart'], write: (a) => ({ target_start_date: xerDate(a.targetStart) }) },
  { fields: ['targetFinish'], write: (a) => ({ target_end_date: xerDate(a.targetFinish) }) },
  { fields: ['actualStart'], write: (a) => ({ act_start_date: xerDate(a.actualStart) }) },
  { fields: ['actualFinish'], write: (a) => ({ act_end_date: xerDate(a.actualFinish) }) },
  { fields: ['earlyStart'], write: (a) => ({ early_start_date: xerDate(a.earlyStart) }) },
  { fields: ['earlyFinish'], write: (a) => ({ early_end_date: xerDate(a.earlyFinish) }) },
  { fields: ['lateStart'], write: (a) => ({ late_start_date: xerDate(a.lateStart) }) },
  { fields: ['lateFinish'], write: (a) => ({ late_end_date: xerDate(a.lateFinish) }) },
  { fields: ['durationHours'], write: (a) => ({ target_drtn_hr_cnt: a.durationHours }) },
  { fields: ['remainingDurationHours'], write: (a) => ({ remain_drtn_hr_cnt: a.remainingDurationHours }) },
  { fields: ['totalFloatHours'], write: (a) => ({ total_float_hr_cnt: a.totalFloatHours }) },
  { fields: ['freeFloatHours'], write: (a) => ({ free_float_hr_cnt: a.freeFloatHours }) },
  { fields: ['physicalPercentComplete', 'percentComplete'], read: (a) => a.physicalPercentComplete ?? a.percentComplete, write: (a) => ({ phys_complete_pct: a.physicalPercentComplete ?? a.percentComplete }) },
  { fields: ['constraintType'], write: (a) => ({ cstr_type: a.constraintType }) },
  { fields: ['constraintDate'], write: (a) => ({ cstr_date: xerDate(a.constraintDate) }) },
  { fields: ['secondaryConstraintType'], write: (a) => ({ cstr_type2: a.secondaryConstraintType ?? null }) },
  { fields: ['secondaryConstraintDate'], write: (a) => ({ cstr_date2: xerDate(a.secondaryConstraintDate) }) },
  { fields: ['calendarId'], write: (a) => ({ clndr_id: a.calendarId === null ? null : idValue(a.calendarId) }) },
  { fields: ['durationType'], read: (a) => a.durationType || null, write: (a): Record<string, Cell> => (a.durationType ? { duration_type: a.durationType } : {}) },
  { fields: ['percentCompleteType'], read: (a) => a.percentCompleteType || null, write: (a): Record<string, Cell> => (a.percentCompleteType ? { complete_pct_type: a.percentCompleteType } : {}) },
  { fields: ['remainingStart'], write: (a) => ({ restart_date: xerDate(a.remainingStart) }) },
  { fields: ['remainingFinish'], write: (a) => ({ reend_date: xerDate(a.remainingFinish) }) },
  { fields: ['suspendDate'], write: (a) => ({ suspend_date: xerDate(a.suspendDate) }) },
  { fields: ['resumeDate'], write: (a) => ({ resume_date: xerDate(a.resumeDate) }) },
  { fields: ['expectedFinish'], write: (a) => ({ expect_end_date: xerDate(a.expectedFinish) }) },
  // The planner's order within a WBS node: the project database's own column, left out of an XER.
  { fields: ['seq'], write: (a) => ({ ip_seq: a.seq ?? null }) },
];

const sameValue = (a: unknown, b: unknown) => (a instanceof Date || b instanceof Date ? a instanceof Date && b instanceof Date && a.getTime() === b.getTime() : (a ?? null) === (b ?? null));

/** What a new activity is given in the columns P6 expects, where the model has no value of its own. */
const newTaskDefaults = (): Record<string, Cell> => ({
  complete_pct_type: 'CP_Drtn', duration_type: 'DT_FixedDUR2', priority_type: 'PT_Normal', rev_fdbk_flag: 'N', lock_plan_flag: 'N', auto_compute_act_flag: 'N',
  create_date: xerDate(new Date()), update_date: xerDate(new Date()),
});

/** The columns of a changed or new activity: only the fields that differ from `prev`, or every field when there is none. */
export function activityColumns(a: Activity, prev?: Activity): Record<string, Cell> {
  const out: Record<string, Cell> = prev ? {} : newTaskDefaults();
  for (const f of ACTIVITY_FIELDS) {
    if (prev && (f.read ? sameValue(f.read(a), f.read(prev)) : f.fields.every((k) => sameValue(a[k], prev[k])))) continue;
    Object.assign(out, f.write(a));
  }
  return out;
}

export function relationshipColumns(r: Relationship): Record<string, Cell> {
  // ip_soft is the project database's own column (soft logic), left out of an XER.
  return { pred_type: `PR_${r.type}`, lag_hr_cnt: r.lagHours, ip_soft: r.soft ? 1 : 0 };
}

/** The CALENDAR columns of a changed or new calendar: the name, and the week, hours and exceptions (clndr_data) when those changed. */
export function calendarColumns(c: ScheduleCalendar, prev?: ScheduleCalendar): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  if (!prev || c.name !== prev.name) out.clndr_name = c.name;
  // The same week and holidays read again from the tables are not a change, though they are other objects.
  const sameTime = !!prev && c.hoursPerDay === prev.hoursPerDay && (c.days === prev.days || JSON.stringify(c.days) === JSON.stringify(prev.days))
    && (c.exceptions === prev.exceptions || JSON.stringify(c.exceptions ?? []) === JSON.stringify(prev.exceptions ?? []));
  if (!sameTime) {
    const week = weekHours(c);
    Object.assign(out, {
      clndr_data: calendarData(c), day_hr_cnt: c.hoursPerDay ?? 8, week_hr_cnt: week,
      month_hr_cnt: Math.round((week * 52) / 12), year_hr_cnt: Math.round(week * 52), last_chng_date: xerDate(new Date()),
    });
  }
  if (!prev) Object.assign(out, { clndr_type: 'CA_Base', default_flag: 'N', rsrc_private: 'N', base_clndr_id: '', proj_id: '' });
  return out;
}

const linkKey = (r: Relationship) => `${r.predId}>${r.succId}`;
const linkMatch = (r: Relationship) => ({ task_id: idValue(r.succId), pred_task_id: idValue(r.predId) });

function wbsColumns(n: WbsNode, prev?: WbsNode): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  if (!prev || n.name !== prev.name) out.wbs_name = n.name;
  if (!prev || (n.code ?? '') !== (prev.code ?? '')) out.wbs_short_name = n.code ?? '';
  if (!prev || n.parentId !== prev.parentId) out.parent_wbs_id = n.parentId === null ? null : idValue(n.parentId);
  if (n.seq !== prev?.seq && (n.seq !== undefined || prev)) out.seq_num = n.seq ?? 0;
  return out;
}

/** The row changes that take the programme's tables from `before` to `after` (two states of one programme's model). */
export function programmeRowOps(before: ScheduleModel, after: ScheduleModel): DbRowOp[] {
  const gone: DbRowOp[] = [];
  const made: DbRowOp[] = [];

  // Links.
  const beforeLinks = new Map(before.relationships.map((r) => [linkKey(r), r]));
  const afterLinks = new Map(after.relationships.map((r) => [linkKey(r), r]));
  for (const [k, r] of beforeLinks) if (!afterLinks.has(k)) gone.push({ table: 'TASKPRED', op: 'delete', key: { column: 'task_pred_id', value: null }, match: linkMatch(r) });

  // Activities.
  const projectOf = (id: string | undefined) => (id ?? after.project.id);
  const beforeActs = new Map(before.activities.map((a) => [a.id, a]));
  const afterActs = new Map(after.activities.map((a) => [a.id, a]));
  for (const id of beforeActs.keys()) {
    if (afterActs.has(id)) continue;
    // The activity's rows in the tables the model does not carry go with it.
    for (const table of ['TASKRSRC', 'TASKACTV']) gone.push({ table, op: 'delete', key: { column: 'task_id', value: null }, match: { task_id: idValue(id) } });
    gone.push({ table: 'TASK', op: 'delete', key: { column: 'task_id', value: idValue(id) } });
  }

  // Calendars.
  const beforeCals = new Map(before.calendars.map((c) => [c.id, c]));
  const afterCals = new Map(after.calendars.map((c) => [c.id, c]));
  for (const id of beforeCals.keys()) if (!afterCals.has(id)) gone.push({ table: 'CALENDAR', op: 'delete', key: { column: 'clndr_id', value: idValue(id) } });
  for (const [id, c] of afterCals) {
    const prev = beforeCals.get(id);
    if (prev === c) continue;
    const set = calendarColumns(c, prev);
    if (Object.keys(set).length) made.push({ table: 'CALENDAR', op: 'upsert', key: { column: 'clndr_id', value: idValue(id) }, set });
  }

  // WBS.
  const beforeWbs = new Map(before.wbs.map((n) => [n.id, n]));
  const afterWbs = new Map(after.wbs.map((n) => [n.id, n]));
  for (const id of beforeWbs.keys()) if (!afterWbs.has(id)) gone.push({ table: 'PROJWBS', op: 'delete', key: { column: 'wbs_id', value: idValue(id) } });
  for (const [id, n] of afterWbs) {
    const prev = beforeWbs.get(id);
    if (prev === n) continue;
    const set = wbsColumns(n, prev);
    if (!prev) Object.assign(set, { proj_id: idValue(after.project.id), proj_node_flag: 'N', sum_data_flag: 'N', status_code: 'WS_Open', ...(set.seq_num === undefined ? { seq_num: 0 } : {}) });
    if (Object.keys(set).length) made.push({ table: 'PROJWBS', op: 'upsert', key: { column: 'wbs_id', value: idValue(id) }, set });
  }

  for (const [id, a] of afterActs) {
    const prev = beforeActs.get(id);
    if (prev === a) continue;
    const set = activityColumns(a, prev);
    if (!prev) set.proj_id = idValue(projectOf(a.projectId));
    if (Object.keys(set).length) made.push({ table: 'TASK', op: 'upsert', key: { column: 'task_id', value: idValue(id) }, set });
  }

  for (const [k, r] of afterLinks) {
    const prev = beforeLinks.get(k);
    if (prev && prev.type === r.type && prev.lagHours === r.lagHours && !!prev.soft === !!r.soft) continue;
    const proj = (id: string) => idValue(projectOf(afterActs.get(id)?.projectId));
    made.push({
      table: 'TASKPRED', op: 'upsert', key: { column: 'task_pred_id', value: null }, match: linkMatch(r),
      set: prev ? relationshipColumns(r) : { ...relationshipColumns(r), proj_id: proj(r.succId), pred_proj_id: proj(r.predId) },
    });
  }

  // The project's dates.
  const projectSet: Record<string, Cell> = {};
  if (!sameValue(before.project.dataDate, after.project.dataDate)) projectSet.last_recalc_date = xerDate(after.project.dataDate);
  if (!sameValue(before.project.planStart, after.project.planStart)) projectSet.plan_start_date = xerDate(after.project.planStart);
  if (Object.keys(projectSet).length) made.push({ table: 'PROJECT', op: 'upsert', key: { column: 'proj_id', value: idValue(after.project.id) }, set: projectSet });

  // Resources and their assignments, activity codes and their assignments, user fields and their values.
  resourceOps(before, after, gone, made);
  codeOps(before, after, gone, made);
  udfOps(before, after, gone, made);

  return [...gone, ...made];
}
