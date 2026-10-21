import { deriveLoeDates } from '../loeDates';
import type {
  Activity,
  ActivityCodeTypeDef,
  ActivityCodeValue,
  ActivityStatus,
  ActivityType,
  Relationship,
  ResourceAssignment,
  ResourceInfo,
  ScheduleModel,
  UdfTypeDef,
  WbsNode,
} from '../types';
import { dayNumberIso, type CalendarDay, type CalendarException, type ScheduleCalendar } from '../calendar';
import { normalizeRelType } from '../relType';
import type { XerTables } from './xer';

function num(v: string | undefined, fallback = 0): number {
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function date(v: string | undefined): Date | null {
  if (!v) return null;
  // P6 XER dates look like "2024-03-15 08:00" or "2024-03-15".
  const iso = v.trim().replace(' ', 'T');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const TASK_TYPE_MAP: Record<string, ActivityType> = {
  TT_Mile: 'milestone-start',
  TT_FinMile: 'milestone-finish',
  TT_LOE: 'loe',
  TT_WBS: 'wbs-summary',
  TT_Task: 'task',
  TT_Rsrc: 'task',
};

const STATUS_MAP: Record<string, ActivityStatus> = {
  TK_NotStart: 'not-started',
  TK_Active: 'in-progress',
  TK_Complete: 'completed',
};

const RSRC_TYPE_MAP: Record<string, ResourceAssignment['resourceType']> = {
  RT_Labor: 'labor',
  RT_Mat: 'material',
  RT_Equip: 'equipment',
};

export { XER_TABLE_COLUMNS } from './xerColumns';

/** projectId: one project, several (loaded together as one schedule, so
    relationships between them are kept — each project's root WBS node
    becomes its own top-level band), or all of them when omitted. */
export function normalizeXer(tables: XerTables, fileName: string, projectId?: string | string[]): ScheduleModel {
  const chosen = projectId === undefined ? null : new Set(Array.isArray(projectId) ? projectId : [projectId]);
  const inScope = (r: Record<string, string>) => !chosen || chosen.has(r.proj_id);
  const projectRows = tables.PROJECT ?? [];
  const headerRows = chosen ? projectRows.filter(inScope) : projectRows.slice(0, 1);

  const wbsRows = (tables.PROJWBS ?? []).filter(inScope);
  const wbsById = new Map<string, WbsNode>();
  for (const row of wbsRows) {
    wbsById.set(row.wbs_id, {
      id: row.wbs_id,
      name: row.wbs_name ?? '',
      code: row.wbs_short_name ?? '',
      parentId: row.parent_wbs_id || null,
      ...(row.seq_num ? { seq: num(row.seq_num) } : {}),
    });
  }
  const wbsPath = (wbsId: string | null, field: 'name' | 'code' = 'name'): string => {
    const parts: string[] = [];
    let cursor = wbsId;
    let guard = 0;
    while (cursor && guard++ < 50) {
      const node = wbsById.get(cursor);
      if (!node) break;
      parts.unshift(field === 'code' ? node.code ?? '' : node.name);
      cursor = node.parentId;
    }
    return parts.join(' / ');
  };

  const rsrcNames = new Map<string, string>();
  for (const row of tables.RSRC ?? []) {
    rsrcNames.set(row.rsrc_id, row.rsrc_name ?? row.rsrc_short_name ?? row.rsrc_id);
  }

  const rsrcByTask = new Map<string, ResourceAssignment[]>();
  for (const row of tables.TASKRSRC ?? []) {
    const list = rsrcByTask.get(row.task_id) ?? [];
    list.push({
      resourceId: row.rsrc_id,
      resourceName: rsrcNames.get(row.rsrc_id) ?? row.rsrc_id,
      resourceType: RSRC_TYPE_MAP[row.rsrc_type] ?? 'other',
      targetQty: num(row.target_qty),
      remainQty: num(row.remain_qty),
      targetCost: num(row.target_cost),
      actualCost: num(row.act_reg_cost) + num(row.act_ot_cost),
      unitsPerTime: num(row.target_qty_per_hr) || undefined,
      ...(String(row.ip_primary ?? '') === '1' ? { primary: true } : {}),
    });
    rsrcByTask.set(row.task_id, list);
  }

  const actvCodeTypeNames = new Map<string, string>();
  for (const row of tables.ACTVTYPE ?? []) {
    actvCodeTypeNames.set(row.actv_code_type_id, row.actv_code_type ?? row.actv_code_type_id);
  }
  const actvCodeNames = new Map<string, string>();
  const codeValuesByType = new Map<string, ActivityCodeValue[]>();
  for (const row of tables.ACTVCODE ?? []) {
    actvCodeNames.set(row.actv_code_id, row.actv_code_name ?? row.actv_code ?? row.actv_code_id);
    // actv_short_name/actv_code is the short "code value" (e.g. "BF"), while
    // actv_code_name is the fuller description (e.g. "Backfilling") — same
    // fields the P6 client shows as separate columns in its codes dictionary.
    const value = row.actv_short_name ?? row.actv_code ?? row.actv_code_name ?? row.actv_code_id;
    const description = row.actv_code_name ?? value;
    const list = codeValuesByType.get(row.actv_code_type_id) ?? [];
    list.push({ id: row.actv_code_id, value, description, parentId: row.parent_actv_code_id || null });
    codeValuesByType.set(row.actv_code_type_id, list);
  }
  const activityCodeCatalog: ActivityCodeTypeDef[] = [...actvCodeTypeNames.entries()].map(([typeId, name]) => ({
    id: typeId,
    name,
    values: codeValuesByType.get(typeId) ?? [],
  }));
  const codesByTask = new Map<string, Record<string, string>>();
  for (const row of tables.TASKACTV ?? []) {
    const typeName = actvCodeTypeNames.get(row.actv_code_type_id) ?? row.actv_code_type_id;
    const codeName = actvCodeNames.get(row.actv_code_id) ?? row.actv_code_id;
    const map = codesByTask.get(row.task_id) ?? {};
    map[typeName] = codeName;
    codesByTask.set(row.task_id, map);
  }

  const udfDefs = (tables.UDFTYPE ?? []).filter((r) => r.table_name === 'TASK');
  const udfLabelById = new Map(udfDefs.map((r) => [r.udf_type_id, r.udf_type_label || r.udf_type_name || r.udf_type_id]));
  const udfTypes: UdfTypeDef[] = udfDefs.map((r) => ({ id: r.udf_type_id, label: r.udf_type_label || r.udf_type_name || r.udf_type_id, dataType: /FLOAT|INT|DOUBLE|NUMBER|COST|DECIMAL/i.test(r.logical_data_type ?? '') ? 'number' : 'text' }));
  const udfByTask = new Map<string, Record<string, string | number>>();
  for (const row of tables.UDFVALUE ?? []) {
    if (!udfLabelById.has(row.udf_type_id)) continue;
    const label = udfLabelById.get(row.udf_type_id)!;
    let value: string | number = '';
    if (row.udf_text) value = row.udf_text;
    else if (row.udf_number) value = num(row.udf_number);
    const map = udfByTask.get(row.fk_id) ?? {};
    map[label] = value;
    udfByTask.set(row.fk_id, map);
  }

  const taskRows = (tables.TASK ?? []).filter(inScope);
  const activities: Activity[] = taskRows.map((row) => {
    const totalFloat = row.total_float_hr_cnt ? num(row.total_float_hr_cnt) : null;
    const freeFloat = row.free_float_hr_cnt ? num(row.free_float_hr_cnt) : null;
    return {
      id: row.task_id,
      projectId: row.proj_id,
      code: row.task_code ?? '',
      name: row.task_name ?? '',
      wbsId: row.wbs_id || null,
      wbsPath: wbsPath(row.wbs_id || null),
      wbsCodePath: wbsPath(row.wbs_id || null, 'code'),
      type: TASK_TYPE_MAP[row.task_type] ?? 'task',
      status: STATUS_MAP[row.status_code] ?? 'not-started',
      targetStart: date(row.target_start_date),
      targetFinish: date(row.target_end_date),
      actualStart: date(row.act_start_date),
      actualFinish: date(row.act_end_date),
      earlyStart: date(row.early_start_date),
      earlyFinish: date(row.early_end_date),
      lateStart: date(row.late_start_date),
      lateFinish: date(row.late_end_date),
      durationHours: num(row.target_drtn_hr_cnt),
      remainingDurationHours: num(row.remain_drtn_hr_cnt),
      totalFloatHours: totalFloat,
      freeFloatHours: freeFloat,
      // Matches insight-plan-web exactly: critical = total float <= 0. (P6's
      // own driving_path_flag is deliberately not consulted — that repo
      // never reads it either, to keep one single, consistent definition of
      // "critical" across the table, Gantt, checks and views.)
      isCritical: totalFloat !== null && totalFloat <= 0,
      percentComplete: num(row.phys_complete_pct) || estimatePercentComplete(row),
      constraintType: row.cstr_type || null,
      constraintDate: date(row.cstr_date),
      activityCodes: codesByTask.get(row.task_id) ?? {},
      resources: rsrcByTask.get(row.task_id) ?? [],
      calendarId: row.clndr_id || null,
      udf: udfByTask.get(row.task_id) ?? {},
      physicalPercentComplete: row.phys_complete_pct ? num(row.phys_complete_pct) : null,
      durationType: row.duration_type ?? '',
      percentCompleteType: row.complete_pct_type ?? '',
      secondaryConstraintType: row.cstr_type2 || null,
      secondaryConstraintDate: date(row.cstr_date2),
      remainingStart: date(row.restart_date),
      remainingFinish: date(row.reend_date),
      suspendDate: date(row.suspend_date),
      resumeDate: date(row.resume_date),
      expectedFinish: date(row.expect_end_date),
      primaryResource: row.rsrc_id ? (rsrcNames.get(row.rsrc_id) ?? '') : '',
      longestPath: row.driving_path_flag === 'Y',
      ...(row.ip_seq ? { seq: num(row.ip_seq) } : {}),
    };
  });

  // Links to activities not loaded (other projects in the file) are dropped.
  const taskIds = new Set(taskRows.map((r) => r.task_id));
  const relationships: Relationship[] = (tables.TASKPRED ?? []).filter((row) => taskIds.has(row.task_id) && taskIds.has(row.pred_task_id)).map((row) => ({
    predId: row.pred_task_id,
    succId: row.task_id,
    type: normalizeRelType(row.pred_type),
    lagHours: num(row.lag_hr_cnt),
    ...(String(row.ip_soft ?? '') === '1' ? { soft: true } : {}),
  }));

  // The weekly working-day pattern and the dated exceptions (holidays,
  // extra working days) are decoded from clndr_data; without a weekly
  // pattern, calendar.ts assumes Mon-Fri.
  const calendars: ScheduleCalendar[] = (tables.CALENDAR ?? []).map((row) => ({
    id: row.clndr_id,
    name: row.clndr_name ?? '',
    hoursPerDay: row.day_hr_cnt ? num(row.day_hr_cnt) : null,
    days: clndrWeek(row.clndr_data),
    exceptions: clndrExceptions(row.clndr_data),
  }));

  return {
    id: '',
    sourceFileName: fileName,
    sourceFormat: 'xer',
    project: projectHeader(headerRows, fileName),
    activities: deriveLoeDates(activities, relationships),
    relationships,
    wbs: [...wbsById.values()],
    activityCodeTypes: [...actvCodeTypeNames.values()],
    activityCodeCatalog,
    resourceNames: [...rsrcNames.values()],
    resourceCatalog: xerResourceCatalog(tables, rsrcNames),
    udfTypes,
    calendars,
    computedFloat: false,
  };
}

/** RSRC rows with type, and capacity from their latest RSRCRATE max_qty_per_hr (labour). */
function xerResourceCatalog(tables: XerTables, names: Map<string, string>): ResourceInfo[] {
  const maxById = new Map<string, { date: string; units: number }>();
  const costById = new Map<string, number>();
  for (const row of tables.RSRCRATE ?? []) {
    if (num(row.cost_per_qty) > 0) costById.set(row.rsrc_id, num(row.cost_per_qty));
    const units = num(row.max_qty_per_hr);
    const prev = maxById.get(row.rsrc_id);
    const date = row.start_date ?? '';
    if (units > 0 && (!prev || date >= prev.date)) maxById.set(row.rsrc_id, { date, units });
  }
  return (tables.RSRC ?? []).map((row) => {
    const type = RSRC_TYPE_MAP[row.rsrc_type] ?? 'other';
    const units = maxById.get(row.rsrc_id)?.units ?? null;
    const cost = costById.get(row.rsrc_id);
    return { id: row.rsrc_id, name: names.get(row.rsrc_id) ?? row.rsrc_id, type, capacity: type === 'labor' || type === 'equipment' || (type === 'material' && (units ?? 0) >= 1) ? units : null, ...(cost ? { costPerUnit: cost } : {}) };
  });
}

const MAX_NAMES = 3;

function projectHeader(rows: Record<string, string>[], fileName: string): ScheduleModel['project'] {
  if (rows.length <= 1) {
    const row = rows[0];
    return {
      id: row?.proj_id ?? '',
      name: row?.proj_short_name ?? fileName,
      dataDate: date(row?.last_recalc_date),
      planStart: date(row?.plan_start_date),
      planFinish: date(row?.plan_end_date),
    };
  }
  const pick = (field: string, later: boolean) =>
    rows.map((r) => date(r[field])).reduce<Date | null>((a, b) => (!a ? b : !b ? a : (b > a) === later ? b : a), null);
  const names = rows.map((r) => r.proj_short_name || r.proj_id);
  return {
    id: rows.map((r) => r.proj_id).join('+'),
    name: names.length > MAX_NAMES ? `${names.slice(0, MAX_NAMES).join(' + ')} + ${names.length - MAX_NAMES} more` : names.join(' + '),
    dataDate: pick('last_recalc_date', true),
    planStart: pick('plan_start_date', false),
    planFinish: pick('plan_end_date', true),
  };
}

/** For the multi-project picker: lists projects present in a raw parse
    without paying for the (potentially large) TASK/TASKPRED normalization. */
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The standard week from P6's clndr_data mini-language:
    (0||CalendarData()((0||DaysOfWeek()((0||1()())(0||2()((0||0(s|08:00|f|16:00)())))…))…)),
    day 1 = Sunday; a day with a work span (s|start|f|finish, either order)
    is working. {} when there is no DaysOfWeek section. */
export function clndrWeek(data: string | undefined): Record<string, CalendarDay> {
  if (!data) return {};
  const start = data.indexOf('DaysOfWeek()');
  if (start < 0) return {};
  const ends = ['VIEW(', 'Exceptions()'].map((m) => data.indexOf(m, start)).filter((i) => i > 0);
  const section = data.slice(start, ends.length ? Math.min(...ends) : undefined);
  const marks = [...section.matchAll(/\(0\|\|([1-7])\(\)\(/g)];
  const days: Record<string, CalendarDay> = {};
  marks.forEach((m, i) => {
    const body = section.slice(m.index! + m[0].length, marks[i + 1]?.index ?? section.length);
    days[DAY_NAMES[Number(m[1]) - 1]] = workSpans(body);
  });
  return days;
}

/** P6 serial dates count days from 1899-12-30; day numbers from 1970-01-01. */
const P6_SERIAL_EPOCH = 25569;

/** The dated exceptions from clndr_data's Exceptions() section, sorted:
    (0||0(d|45292)()) is a holiday, one with work spans an extra working
    day: (0||1(d|45293)((0||0(s|08:00|f|12:00)()))). */
export function clndrExceptions(data: string | undefined): CalendarException[] {
  if (!data) return [];
  const start = data.indexOf('Exceptions()');
  if (start < 0) return [];
  const section = data.slice(start);
  const marks = [...section.matchAll(/\(0\|\|\d+\(d\|(\d+)\)\(/g)];
  const out = marks.map((m, i): CalendarException => {
    const body = section.slice(m.index! + m[0].length, marks[i + 1]?.index ?? section.length);
    return { date: dayNumberIso(Number(m[1]) - P6_SERIAL_EPOCH), ...workSpans(body) };
  });
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** A day's work spans (s|start|f|finish, either order): working with its
    first start – last finish, or not working when it has none. */
function workSpans(body: string): CalendarDay {
  const spans = [...body.matchAll(/\(((?:[sf]\|\d{1,2}:\d{2}\|?){2})\)/g)].map((x) => {
    const start = /s\|(\d{1,2}:\d{2})/.exec(x[1])?.[1] ?? '';
    const finish = /f\|(\d{1,2}:\d{2})/.exec(x[1])?.[1] ?? '';
    return { start: start.padStart(5, '0'), finish: finish.padStart(5, '0') };
  });
  return spans.length ? { working: true, range: `${spans[0].start}–${spans[spans.length - 1].finish}`, spans } : { working: false, range: '' };
}

export function listXerProjects(tables: XerTables): { id: string; name: string }[] {
  return (tables.PROJECT ?? []).map((p) => ({ id: p.proj_id, name: p.proj_short_name || p.proj_id }));
}

/** Whether the source file already carried usable float values for most
    tasks — if not, loadSchedule.ts falls back to recomputeCpm(). */
export function hasUsableSourceFloat(tables: XerTables): boolean {
  const taskRows = tables.TASK ?? [];
  if (taskRows.length === 0) return true;
  const withFloat = taskRows.filter((row) => row.total_float_hr_cnt !== undefined && row.total_float_hr_cnt !== '').length;
  return withFloat >= taskRows.length / 2;
}

function estimatePercentComplete(row: Record<string, string>): number {
  const target = num(row.target_drtn_hr_cnt);
  const remain = num(row.remain_drtn_hr_cnt);
  if (row.status_code === 'TK_Complete') return 100;
  if (row.status_code === 'TK_NotStart') return 0;
  if (target <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((target - remain) / target) * 100)));
}
