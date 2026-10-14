import { parseXer } from './parsers/xer';

/** Checks an XER the way P6 reads one: the shape of the file, then what the rows say about each other (every link, WBS parent, calendar
    and project a row names must be there, codes and ids must not repeat, there must be no loop). The rules are P6's as the XER files of
    P6 itself keep them. An `error` is something P6 refuses or misreads; a `warning` something it accepts but a planner would want to know. */

export interface XerIssue {
  severity: 'error' | 'warning';
  table: string;
  message: string;
  /** The row's id (task_id ...), when the issue is about one row. */
  row?: string;
}

const TASK_TYPES = new Set(['TT_Task', 'TT_Mile', 'TT_FinMile', 'TT_LOE', 'TT_WBS', 'TT_Rsrc']);
const STATUSES = new Set(['TK_NotStart', 'TK_Active', 'TK_Complete']);
const REL_TYPES = new Set(['PR_FS', 'PR_SS', 'PR_FF', 'PR_SF']);
const DATE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/;
const TASK_DATES = ['target_start_date', 'target_end_date', 'act_start_date', 'act_end_date', 'early_start_date', 'early_end_date', 'late_start_date', 'late_end_date', 'restart_date', 'reend_date', 'cstr_date', 'suspend_date', 'resume_date', 'expect_end_date'];
const MAX_PER_KIND = 5;

/** Brackets of the calendar text balance, and it names the days of the week. */
function calendarTextProblem(data: string): string | null {
  if (!data) return 'it has no calendar data (clndr_data)';
  let depth = 0;
  for (const ch of data) {
    if (ch === '(') depth++;
    else if (ch === ')' && --depth < 0) return 'its calendar data closes more brackets than it opens';
  }
  if (depth !== 0) return 'its calendar data has brackets left open';
  if (!data.includes('DaysOfWeek')) return 'its calendar data has no DaysOfWeek';
  return null;
}

export function validateXer(text: string): XerIssue[] {
  const issues: XerIssue[] = [];
  const counts = new Map<string, number>();
  const add = (severity: XerIssue['severity'], table: string, message: string, row?: string) => {
    const kind = `${severity}|${table}|${message.replace(/\d+/g, '#')}`;
    const n = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, n);
    if (n <= MAX_PER_KIND) issues.push({ severity, table, message, row });
    else if (n === MAX_PER_KIND + 1) issues.push({ severity, table, message: `${message} (and more like it)` });
  };

  // ---- the shape of the file ----
  const lines = text.split(/\r\n|\r|\n/).filter((l) => l !== '');
  if (!lines[0]?.startsWith('ERMHDR\t')) add('error', 'ERMHDR', 'the file does not start with an ERMHDR line');
  else if (lines[0].split('\t').length < 9) add('error', 'ERMHDR', 'the ERMHDR line has fewer than the 9 fields P6 writes (version, date, ... currency)');
  if (lines[lines.length - 1] !== '%E') add('error', 'file', 'the file does not end with %E');
  if (!text.includes('\r\n')) add('warning', 'file', 'the lines are not separated by CR LF, as P6 writes them');
  let table = '';
  let width = 0;
  for (const line of lines) {
    if (line.startsWith('%T\t')) {
      table = line.slice(3);
      width = -1;
    } else if (line.startsWith('%F\t')) {
      width = line.split('\t').length - 1;
      if (width < 1) add('error', table, 'a table with no fields');
    } else if (line.startsWith('%R\t')) {
      if (width < 0) add('error', table, 'a row before the fields of the table');
      else if (line.split('\t').length - 1 !== width) add('error', table, `a row has ${line.split('\t').length - 1} values for ${width} fields`);
    }
  }

  // ---- what the rows say ----
  const t = parseXer(text);
  const rows = (name: string) => t[name] ?? [];
  const idSet = (name: string, col: string) => new Set(rows(name).map((r) => r[col]));
  const unique = (name: string, col: string, what = col) => {
    const seen = new Set<string>();
    for (const r of rows(name)) {
      if (seen.has(r[col])) add('error', name, `${what} ${r[col]} is used twice`, r[col]);
      seen.add(r[col]);
    }
  };

  for (const need of ['PROJECT', 'CALENDAR', 'PROJWBS', 'TASK']) if (rows(need).length === 0) add('error', need, `the file has no ${need} rows`);

  const projects = idSet('PROJECT', 'proj_id');
  const calendars = idSet('CALENDAR', 'clndr_id');
  const wbs = new Map(rows('PROJWBS').map((r) => [r.wbs_id, r]));
  const tasks = new Map(rows('TASK').map((r) => [r.task_id, r]));

  unique('PROJECT', 'proj_id');
  unique('CALENDAR', 'clndr_id');
  unique('PROJWBS', 'wbs_id');
  unique('TASK', 'task_id');
  unique('TASKPRED', 'task_pred_id');

  for (const p of rows('PROJECT')) {
    if (p.clndr_id && !calendars.has(p.clndr_id)) add('error', 'PROJECT', `project ${p.proj_id} uses calendar ${p.clndr_id}, which is not in the file`, p.proj_id);
  }

  const names = new Set<string>();
  for (const c of rows('CALENDAR')) {
    const problem = calendarTextProblem(c.clndr_data ?? '');
    if (problem) add('error', 'CALENDAR', `calendar ${c.clndr_id}: ${problem}`, c.clndr_id);
    if (!c.clndr_name) add('error', 'CALENDAR', `calendar ${c.clndr_id} has no name`, c.clndr_id);
    const key = `${c.clndr_type}|${c.proj_id}|${(c.clndr_name ?? '').toLowerCase()}`;
    if (names.has(key)) add('warning', 'CALENDAR', `two calendars are called “${c.clndr_name}”`, c.clndr_id);
    names.add(key);
    if (c.day_hr_cnt && !(Number(c.day_hr_cnt) > 0)) add('error', 'CALENDAR', `calendar ${c.clndr_id} has ${c.day_hr_cnt} hours a day`, c.clndr_id);
  }

  // The WBS: one project node per project, every other node under a node that is there, no loop.
  const roots = new Map<string, number>();
  for (const w of wbs.values()) {
    if (w.proj_id && !projects.has(w.proj_id)) add('error', 'PROJWBS', `WBS ${w.wbs_id} belongs to project ${w.proj_id}, which is not in the file`, w.wbs_id);
    if (w.proj_node_flag === 'Y') roots.set(w.proj_id, (roots.get(w.proj_id) ?? 0) + 1);
    else if (!w.parent_wbs_id) add('error', 'PROJWBS', `WBS ${w.wbs_id} (${w.wbs_name}) has no parent and is not the project node`, w.wbs_id);
    else if (!wbs.has(w.parent_wbs_id)) add('error', 'PROJWBS', `WBS ${w.wbs_id} (${w.wbs_name}) is under ${w.parent_wbs_id}, which is not in the file`, w.wbs_id);
    if (!w.wbs_name) add('error', 'PROJWBS', `WBS ${w.wbs_id} has no name`, w.wbs_id);
    for (let cursor: string | undefined = w.parent_wbs_id, guard = 0; cursor; cursor = wbs.get(cursor)?.parent_wbs_id) {
      if (cursor === w.wbs_id || ++guard > 200) {
        add('error', 'PROJWBS', `WBS ${w.wbs_id} (${w.wbs_name}) is under itself`, w.wbs_id);
        break;
      }
    }
  }
  for (const proj of projects) if ((roots.get(proj) ?? 0) !== 1) add('error', 'PROJWBS', `project ${proj} has ${roots.get(proj) ?? 0} project WBS nodes: it needs exactly one`);

  // The tasks.
  const codes = new Set<string>();
  for (const k of tasks.values()) {
    const id = k.task_id;
    if (!projects.has(k.proj_id)) add('error', 'TASK', `task ${id} belongs to project ${k.proj_id}, which is not in the file`, id);
    if (!k.task_code) add('error', 'TASK', `task ${id} has no Activity ID`, id);
    else if (codes.has(`${k.proj_id}|${k.task_code}`)) add('error', 'TASK', `Activity ID ${k.task_code} is used twice in project ${k.proj_id}`, id);
    codes.add(`${k.proj_id}|${k.task_code}`);
    if (!k.task_name) add('warning', 'TASK', `task ${id} (${k.task_code}) has no name`, id);
    const w = wbs.get(k.wbs_id);
    if (!k.wbs_id) add('error', 'TASK', `task ${id} (${k.task_code}) is under no WBS node`, id);
    else if (!w) add('error', 'TASK', `task ${id} (${k.task_code}) is under WBS ${k.wbs_id}, which is not in the file`, id);
    else if (w.proj_id && w.proj_id !== k.proj_id) add('error', 'TASK', `task ${id} (${k.task_code}) is under a WBS node of another project`, id);
    if (k.clndr_id && !calendars.has(k.clndr_id)) add('error', 'TASK', `task ${id} (${k.task_code}) uses calendar ${k.clndr_id}, which is not in the file`, id);
    if (!k.clndr_id) add('warning', 'TASK', `task ${id} (${k.task_code}) has no calendar`, id);
    if (k.task_type && !TASK_TYPES.has(k.task_type)) add('error', 'TASK', `task ${id} has the type ${k.task_type}`, id);
    if (k.status_code && !STATUSES.has(k.status_code)) add('error', 'TASK', `task ${id} has the status ${k.status_code}`, id);
    for (const col of ['target_drtn_hr_cnt', 'remain_drtn_hr_cnt']) if (k[col] && !(Number(k[col]) >= 0)) add('error', 'TASK', `task ${id} (${k.task_code}) has ${k[col]} in ${col}`, id);
    for (const col of TASK_DATES) if (k[col] && !DATE.test(k[col])) add('error', 'TASK', `task ${id} (${k.task_code}) has “${k[col]}” in ${col}`, id);
    if (k.status_code === 'TK_Complete' && !k.act_end_date) add('warning', 'TASK', `task ${id} (${k.task_code}) is complete with no actual finish`, id);
    if (k.status_code && k.status_code !== 'TK_NotStart' && !k.act_start_date) add('warning', 'TASK', `task ${id} (${k.task_code}) has started with no actual start`, id);
    if ((k.task_type === 'TT_Mile' || k.task_type === 'TT_FinMile') && Number(k.target_drtn_hr_cnt || 0) !== 0) add('warning', 'TASK', `milestone ${id} (${k.task_code}) has a duration`, id);
  }

  // The links: both ends there, a type P6 knows, no activity linked to itself, a pair of activities linked once, no loop.
  const pairs = new Set<string>();
  const succs = new Map<string, string[]>();
  for (const r of rows('TASKPRED')) {
    const label = `${r.task_id} after ${r.pred_task_id}`;
    if (!tasks.has(r.task_id) || !tasks.has(r.pred_task_id)) add('error', 'TASKPRED', `link ${label} names a task that is not in the file`, r.task_pred_id);
    if (r.task_id === r.pred_task_id) add('error', 'TASKPRED', `task ${r.task_id} is linked to itself`, r.task_pred_id);
    if (!REL_TYPES.has(r.pred_type)) add('error', 'TASKPRED', `link ${label} has the type ${r.pred_type}`, r.task_pred_id);
    if (r.lag_hr_cnt && !Number.isFinite(Number(r.lag_hr_cnt))) add('error', 'TASKPRED', `link ${label} has the lag ${r.lag_hr_cnt}`, r.task_pred_id);
    // P6 keeps one link of each type between two activities (a start-to-start and a finish-to-finish, say), not two of the same.
    const pair = `${r.pred_task_id}>${r.task_id}>${r.pred_type}`;
    if (pairs.has(pair)) add('warning', 'TASKPRED', `${r.pred_task_id} is linked to ${r.task_id} by ${r.pred_type} more than once`, r.task_pred_id);
    pairs.add(pair);
    // The start and the finish of each activity are the points of the network: a loop is a way round them, through the activity's own
    // length from its start to its finish. (A start-to-start link one way and a finish-to-finish the other is not one.)
    const from = `${r.pred_task_id}${r.pred_type === 'PR_SS' || r.pred_type === 'PR_SF' ? ':s' : ':f'}`;
    const to = `${r.task_id}${r.pred_type === 'PR_SS' || r.pred_type === 'PR_FS' ? ':s' : ':f'}`;
    (succs.get(from) ?? succs.set(from, []).get(from)!).push(to);
    if (!succs.has(`${r.pred_task_id}:s`)) succs.set(`${r.pred_task_id}:s`, []);
    if (!succs.has(`${r.task_id}:s`)) succs.set(`${r.task_id}:s`, []);
  }
  for (const k of tasks.keys()) {
    const start = succs.get(`${k}:s`);
    if (start && !start.includes(`${k}:f`)) start.push(`${k}:f`);
  }
  // A loop: what a depth-first walk meets again before it has finished with it.
  const state = new Map<string, 1 | 2>();
  let loop: string | null = null;
  for (const start of succs.keys()) {
    if (loop || state.has(start)) continue;
    const stack: [string, number][] = [[start, 0]];
    state.set(start, 1);
    while (stack.length && !loop) {
      const top = stack[stack.length - 1];
      const next = succs.get(top[0])?.[top[1]++];
      if (next === undefined) {
        state.set(top[0], 2);
        stack.pop();
      } else if (state.get(next) === 1) loop = next;
      else if (!state.has(next)) {
        state.set(next, 1);
        stack.push([next, 0]);
      }
    }
  }
  if (loop) add('error', 'TASKPRED', `the links make a loop through task ${loop.split(':')[0]} (${tasks.get(loop.split(':')[0])?.task_code ?? ''})`, loop.split(':')[0]);

  // Rows kept per task that belong to no task.
  for (const name of ['TASKRSRC', 'TASKACTV', 'TASKMEMO']) {
    for (const r of rows(name)) if (r.task_id && !tasks.has(r.task_id)) add('warning', name, `a row belongs to task ${r.task_id}, which is not in the file`);
  }
  for (const r of rows('UDFVALUE')) {
    if (r.fk_id && !tasks.has(r.fk_id) && !projects.has(r.fk_id) && !wbs.has(r.fk_id)) add('warning', 'UDFVALUE', `a value belongs to ${r.fk_id}, which is not a task, project or WBS node of the file`);
  }

  return issues;
}

/** The issues as a few lines for a message: errors first, with how many there are. */
export function summariseIssues(issues: XerIssue[], limit = 6): string {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.length - errors.length;
  const first = [...errors, ...issues.filter((i) => i.severity === 'warning')].slice(0, limit).map((i) => `• ${i.table}: ${i.message}`);
  return `${errors.length} ${errors.length === 1 ? 'problem' : 'problems'}${warnings ? `, ${warnings} to look at` : ''}\n${first.join('\n')}`;
}
