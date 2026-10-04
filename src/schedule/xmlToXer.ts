import { holidayOrExceptions, nested, str, type XmlRow, type XmlTables } from './parsers/xml';

/** Converts a parsed P6 XML (APIBusinessObjects) schedule into P6 XER text:
    project, calendars, WBS, activities, relationships, resources and their
    assignments, activity codes and activity UDFs. XML ObjectIds are reused as
    XER ids, so both files describe the same objects. */
export function xmlToXer(tables: XmlTables): string {
  const t = (name: string): XmlRow[] => tables[name] ?? [];
  const project = t('Project')[0];
  if (!project) throw new Error('The XML has no Project.');
  const projId = str(project, 'ObjectId') || '1';
  const projName = str(project, 'Id') || str(project, 'Name') || 'Project';
  const dataDate = xerDate(str(project, 'DataDate'));
  const activities = t('Activity');
  const calendars = t('Calendar');
  const defaultClndr = str(project, 'ActivityDefaultCalendarObjectId') || str(calendars[0] ?? {}, 'ObjectId') || '1';

  const out: string[] = [];
  out.push(['ERMHDR', '19.12', today(), 'Project', 'admin', 'admin', 'dbxDatabaseNoName', 'Project Management', 'USD'].join('\t'));
  const table = (name: string, fields: string[], rows: Record<string, string | number | null | undefined>[]) => {
    out.push(`%T\t${name}`);
    out.push(['%F', ...fields].join('\t'));
    for (const r of rows) out.push(['%R', ...fields.map((f) => clean(r[f]))].join('\t'));
  };

  table('CURRTYPE', ['curr_id', 'decimal_digit_cnt', 'curr_symbol', 'decimal_symbol', 'digit_group_symbol', 'pos_curr_fmt_type', 'neg_curr_fmt_type', 'curr_type', 'curr_short_name', 'group_digit_cnt', 'base_exch_rate'], [
    { curr_id: 1, decimal_digit_cnt: 2, curr_symbol: '$', decimal_symbol: '.', digit_group_symbol: ',', pos_curr_fmt_type: '#1.1', neg_curr_fmt_type: '(#1.1)', curr_type: 'US Dollar', curr_short_name: 'USD', group_digit_cnt: 3, base_exch_rate: 1 },
  ]);

  // Every WBS node without a parent hangs off the project node, as XER needs.
  // A single top node is taken as the project node itself (P6's XML leaves
  // the project node out; nesting it under a new one would repeat it).
  const allWbs = t('WBS');
  const wbsIds = new Set(allWbs.map((w) => str(w, 'ObjectId')));
  const tops = allWbs.filter((w) => !wbsIds.has(str(w, 'ParentObjectId')));
  const topNode = tops.length === 1 ? tops[0] : null;
  const wbsRows = allWbs.filter((w) => w !== topNode);
  const maxWbsId = allWbs.reduce((m, w) => Math.max(m, Number(str(w, 'ObjectId')) || 0), 0);
  const projNodeId = topNode ? str(topNode, 'ObjectId') : String(maxWbsId + 1);
  table('PROJECT', ['proj_id', 'fy_start_month_num', 'allow_complete_flag', 'project_flag', 'proj_short_name', 'clndr_id', 'plan_start_date', 'last_recalc_date', 'def_duration_type', 'def_complete_pct_type', 'def_task_type', 'guid', 'sum_base_proj_id'], [
    { proj_id: projId, fy_start_month_num: 1, allow_complete_flag: 'Y', project_flag: 'Y', proj_short_name: projName, clndr_id: defaultClndr, plan_start_date: xerDate(str(project, 'PlannedStartDate')) || dataDate, last_recalc_date: dataDate, def_duration_type: 'DT_FixedDUR2', def_complete_pct_type: 'CP_Drtn', def_task_type: 'TT_Task', guid: str(project, 'GUID'), sum_base_proj_id: '' },
  ]);

  table('CALENDAR', ['clndr_id', 'default_flag', 'clndr_name', 'proj_id', 'base_clndr_id', 'last_chng_date', 'clndr_type', 'day_hr_cnt', 'week_hr_cnt', 'month_hr_cnt', 'year_hr_cnt', 'rsrc_private', 'clndr_data'], calendars.map((c) => {
    const id = str(c, 'ObjectId');
    const own = str(c, 'ProjectObjectId');
    return {
      clndr_id: id,
      default_flag: id === defaultClndr ? 'Y' : 'N',
      clndr_name: str(c, 'Name'),
      proj_id: own,
      base_clndr_id: str(c, 'BaseCalendarObjectId'),
      last_chng_date: today(),
      clndr_type: own ? 'CA_Project' : 'CA_Base',
      day_hr_cnt: num(str(c, 'HoursPerDay')),
      week_hr_cnt: num(str(c, 'HoursPerWeek')),
      month_hr_cnt: num(str(c, 'HoursPerMonth')),
      year_hr_cnt: num(str(c, 'HoursPerYear')),
      rsrc_private: 'N',
      clndr_data: calendarData(c),
    };
  }));

  table('PROJWBS', ['wbs_id', 'proj_id', 'obs_id', 'seq_num', 'proj_node_flag', 'sum_data_flag', 'status_code', 'wbs_short_name', 'wbs_name', 'parent_wbs_id', 'guid'], [
    {
      wbs_id: projNodeId,
      proj_id: projId,
      obs_id: '',
      seq_num: 0,
      proj_node_flag: 'Y',
      sum_data_flag: 'N',
      status_code: 'WS_Open',
      wbs_short_name: topNode ? str(topNode, 'Code') || projName : projName,
      wbs_name: topNode ? str(topNode, 'Name') : str(project, 'Name') || projName,
      parent_wbs_id: '',
      guid: topNode ? str(topNode, 'GUID') : '',
    },
    ...wbsRows.map((w, i) => ({
      wbs_id: str(w, 'ObjectId'),
      proj_id: projId,
      obs_id: '',
      seq_num: str(w, 'SequenceNumber') || i + 1,
      proj_node_flag: 'N',
      sum_data_flag: 'N',
      status_code: 'WS_Open',
      wbs_short_name: str(w, 'Code') || str(w, 'Name'),
      wbs_name: str(w, 'Name'),
      parent_wbs_id: wbsIds.has(str(w, 'ParentObjectId')) ? str(w, 'ParentObjectId') : projNodeId,
      guid: str(w, 'GUID'),
    })),
  ]);

  const resources = t('Resource');
  table('RSRC', ['rsrc_id', 'parent_rsrc_id', 'clndr_id', 'rsrc_seq_num', 'rsrc_name', 'rsrc_short_name', 'rsrc_type', 'active_flag', 'def_qty_per_hr', 'cost_qty_type', 'curr_id', 'unit_id', 'guid'], resources.map((r, i) => ({
    rsrc_id: str(r, 'ObjectId'),
    parent_rsrc_id: str(r, 'ParentObjectId'),
    clndr_id: str(r, 'CalendarObjectId') || defaultClndr,
    rsrc_seq_num: i,
    rsrc_name: str(r, 'Name') || str(r, 'Id'),
    rsrc_short_name: str(r, 'Id') || str(r, 'Name'),
    rsrc_type: RSRC_TYPE[str(r, 'ResourceType')] ?? 'RT_Labor',
    active_flag: 'Y',
    def_qty_per_hr: 1,
    cost_qty_type: 'QT_Hour',
    curr_id: 1,
    unit_id: '',
    guid: str(r, 'GUID'),
  })));

  const codeTypes = t('ActivityCodeType');
  table('ACTVTYPE', ['actv_code_type_id', 'actv_short_len', 'seq_num', 'actv_code_type', 'proj_id', 'wbs_id', 'actv_code_type_scope'], codeTypes.map((c, i) => ({
    actv_code_type_id: str(c, 'ObjectId'),
    actv_short_len: str(c, 'Length') || 40,
    seq_num: str(c, 'SequenceNumber') || i,
    actv_code_type: str(c, 'Name'),
    proj_id: str(c, 'ProjectObjectId') || projId,
    wbs_id: '',
    actv_code_type_scope: str(c, 'Scope') === 'Global' ? 'AS_Global' : str(c, 'Scope') === 'EPS' ? 'AS_EPS' : 'AS_Project',
  })));
  const codes = t('ActivityCode');
  table('ACTVCODE', ['actv_code_id', 'parent_actv_code_id', 'actv_code_type_id', 'actv_code_name', 'short_name', 'seq_num', 'color'], codes.map((c, i) => ({
    actv_code_id: str(c, 'ObjectId'),
    parent_actv_code_id: str(c, 'ParentObjectId'),
    actv_code_type_id: str(c, 'CodeTypeObjectId'),
    actv_code_name: str(c, 'Description') || str(c, 'CodeValue'),
    short_name: str(c, 'CodeValue'),
    seq_num: str(c, 'SequenceNumber') || i,
    color: hexToXerColor(str(c, 'Color')),
  })));

  const udfTypes = t('UDFType').filter((u) => /activity|task/i.test(str(u, 'SubjectArea')));
  const udfTypeById = new Map(udfTypes.map((u) => [str(u, 'ObjectId'), u]));
  table('UDFTYPE', ['udf_type_id', 'table_name', 'udf_type_name', 'udf_type_label', 'logical_data_type', 'super_flag'], udfTypes.map((u, i) => ({
    udf_type_id: str(u, 'ObjectId'),
    table_name: 'TASK',
    udf_type_name: `user_field_${900 + i}`,
    udf_type_label: str(u, 'Title'),
    logical_data_type: UDF_TYPE[str(u, 'DataType')] ?? 'FT_TEXT',
    super_flag: 'N',
  })));

  const taskFields = [
    'task_id', 'proj_id', 'wbs_id', 'clndr_id', 'phys_complete_pct', 'rev_fdbk_flag', 'est_wt', 'lock_plan_flag', 'auto_compute_act_flag',
    'complete_pct_type', 'task_type', 'duration_type', 'status_code', 'task_code', 'task_name', 'rsrc_id', 'total_float_hr_cnt', 'free_float_hr_cnt',
    'remain_drtn_hr_cnt', 'act_work_qty', 'remain_work_qty', 'target_work_qty', 'target_drtn_hr_cnt', 'target_equip_qty', 'act_equip_qty', 'remain_equip_qty',
    'cstr_date', 'act_start_date', 'act_end_date', 'late_start_date', 'late_end_date', 'expect_end_date', 'early_start_date', 'early_end_date',
    'restart_date', 'reend_date', 'target_start_date', 'target_end_date', 'rem_late_start_date', 'rem_late_end_date', 'cstr_type', 'priority_type',
    'suspend_date', 'resume_date', 'float_path', 'float_path_order', 'guid', 'tmpl_guid', 'cstr_date2', 'cstr_type2', 'driving_path_flag',
    'act_this_per_work_qty', 'act_this_per_equip_qty', 'external_early_start_date', 'external_late_end_date', 'create_date', 'update_date',
    'create_user', 'update_user', 'location_id',
  ];
  const taskAssignments: Record<string, string>[] = [];
  const udfValues: Record<string, string>[] = [];
  const taskRows = activities.map((a) => {
    const id = str(a, 'ObjectId');
    for (const c of nested(a, 'Code')) {
      taskAssignments.push({ task_id: id, actv_code_type_id: str(c, 'TypeObjectId'), actv_code_id: str(c, 'ValueObjectId'), proj_id: projId });
    }
    for (const u of nested(a, 'UDF')) {
      const type = udfTypeById.get(str(u, 'TypeObjectId'));
      if (!type) continue;
      const text = str(u, 'TextValue');
      const number = str(u, 'NumberValue') || str(u, 'DoubleValue') || str(u, 'IntegerValue') || str(u, 'CostValue');
      udfValues.push({ udf_type_id: str(type, 'ObjectId'), fk_id: id, proj_id: projId, udf_date: xerDate(str(u, 'StartDateValue') || str(u, 'FinishDateValue')), udf_number: number, udf_text: text, udf_code_id: '' });
    }
    const planned = str(a, 'PlannedDuration') || str(a, 'AtCompletionDuration');
    const remain = str(a, 'RemainingDuration') || planned;
    const start = xerDate(str(a, 'StartDate') || str(a, 'PlannedStartDate'));
    const finish = xerDate(str(a, 'FinishDate') || str(a, 'PlannedFinishDate'));
    const pct = num(str(a, 'PercentComplete'));
    return {
      task_id: id,
      proj_id: projId,
      wbs_id: str(a, 'WBSObjectId') || projNodeId,
      clndr_id: str(a, 'CalendarObjectId') || defaultClndr,
      phys_complete_pct: num(str(a, 'PhysicalPercentComplete')) || 0,
      rev_fdbk_flag: 'N',
      est_wt: 1,
      lock_plan_flag: 'N',
      auto_compute_act_flag: 'Y',
      complete_pct_type: PCT_TYPE[str(a, 'PercentCompleteType')] ?? 'CP_Drtn',
      task_type: TASK_TYPE[str(a, 'Type')] ?? 'TT_Task',
      duration_type: DUR_TYPE[str(a, 'DurationType')] ?? 'DT_FixedDUR2',
      status_code: STATUS[str(a, 'Status')] ?? 'TK_NotStart',
      task_code: str(a, 'Id'),
      task_name: str(a, 'Name'),
      rsrc_id: str(a, 'PrimaryResourceObjectId'),
      total_float_hr_cnt: str(a, 'TotalFloat'),
      free_float_hr_cnt: str(a, 'FreeFloat'),
      remain_drtn_hr_cnt: num(remain),
      act_work_qty: 0,
      remain_work_qty: 0,
      target_work_qty: 0,
      target_drtn_hr_cnt: num(planned),
      target_equip_qty: 0,
      act_equip_qty: 0,
      remain_equip_qty: 0,
      cstr_date: xerDate(str(a, 'PrimaryConstraintDate')),
      act_start_date: xerDate(str(a, 'ActualStartDate')),
      act_end_date: xerDate(str(a, 'ActualFinishDate')),
      late_start_date: xerDate(str(a, 'LateStartDate')),
      late_end_date: xerDate(str(a, 'LateFinishDate')),
      expect_end_date: xerDate(str(a, 'ExpectedFinishDate')),
      early_start_date: xerDate(str(a, 'EarlyStartDate')) || start,
      early_end_date: xerDate(str(a, 'EarlyFinishDate')) || finish,
      restart_date: xerDate(str(a, 'RemainingEarlyStartDate')) || (pct >= 1 ? '' : start),
      reend_date: xerDate(str(a, 'RemainingEarlyFinishDate')) || (pct >= 1 ? '' : finish),
      target_start_date: xerDate(str(a, 'PlannedStartDate')) || start,
      target_end_date: xerDate(str(a, 'PlannedFinishDate')) || finish,
      rem_late_start_date: xerDate(str(a, 'RemainingLateStartDate')),
      rem_late_end_date: xerDate(str(a, 'RemainingLateFinishDate')),
      cstr_type: CSTR_TYPE[str(a, 'PrimaryConstraintType')] ?? '',
      priority_type: 'PT_Normal',
      suspend_date: xerDate(str(a, 'SuspendDate')),
      resume_date: xerDate(str(a, 'ResumeDate')),
      float_path: '',
      float_path_order: '',
      guid: str(a, 'GUID'),
      tmpl_guid: '',
      cstr_date2: xerDate(str(a, 'SecondaryConstraintDate')),
      cstr_type2: CSTR_TYPE[str(a, 'SecondaryConstraintType')] ?? '',
      driving_path_flag: /^(true|1)$/i.test(str(a, 'IsLongestPath')) ? 'Y' : 'N',
      act_this_per_work_qty: 0,
      act_this_per_equip_qty: 0,
      external_early_start_date: '',
      external_late_end_date: '',
      create_date: today(),
      update_date: today(),
      create_user: 'admin',
      update_user: 'admin',
      location_id: '',
    };
  });
  table('TASK', taskFields, taskRows);

  table('TASKPRED', ['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt'], t('Relationship').map((r, i) => ({
    task_pred_id: str(r, 'ObjectId') || i + 1,
    task_id: str(r, 'SuccessorActivityObjectId'),
    pred_task_id: str(r, 'PredecessorActivityObjectId'),
    proj_id: projId,
    pred_proj_id: projId,
    pred_type: REL_TYPE[str(r, 'Type')] ?? 'PR_FS',
    lag_hr_cnt: num(str(r, 'Lag')),
  })));

  const rsrcTypeById = new Map(resources.map((r) => [str(r, 'ObjectId'), RSRC_TYPE[str(r, 'ResourceType')] ?? 'RT_Labor']));
  table('TASKRSRC', ['taskrsrc_id', 'task_id', 'proj_id', 'rsrc_id', 'remain_qty', 'target_qty', 'remain_qty_per_hr', 'target_lag_drtn_hr_cnt', 'target_qty_per_hr', 'act_ot_qty', 'act_reg_qty', 'target_cost', 'act_reg_cost', 'act_ot_cost', 'remain_cost', 'rsrc_type', 'curr_id', 'guid'], t('ResourceAssignment').map((r, i) => ({
    taskrsrc_id: str(r, 'ObjectId') || i + 1,
    task_id: str(r, 'ActivityObjectId'),
    proj_id: projId,
    rsrc_id: str(r, 'ResourceObjectId'),
    remain_qty: num(str(r, 'RemainingUnits')),
    target_qty: num(str(r, 'PlannedUnits')),
    // Crew size for labour (people working every day of the activity).
    remain_qty_per_hr: num(str(r, 'RemainingUnitsPerTime')) || num(str(r, 'PlannedUnitsPerTime')) || 1,
    target_lag_drtn_hr_cnt: 0,
    target_qty_per_hr: num(str(r, 'PlannedUnitsPerTime')) || 1,
    act_ot_qty: 0,
    act_reg_qty: 0,
    target_cost: num(str(r, 'PlannedCost')),
    act_reg_cost: num(str(r, 'ActualCost')),
    act_ot_cost: 0,
    remain_cost: num(str(r, 'RemainingCost')),
    rsrc_type: rsrcTypeById.get(str(r, 'ResourceObjectId')) ?? 'RT_Labor',
    curr_id: 1,
    guid: str(r, 'GUID'),
  })));

  table('TASKACTV', ['task_id', 'actv_code_type_id', 'actv_code_id', 'proj_id'], taskAssignments);
  table('UDFVALUE', ['udf_type_id', 'fk_id', 'proj_id', 'udf_date', 'udf_number', 'udf_text', 'udf_code_id'], udfValues);
  out.push('%E');
  return out.join('\r\n') + '\r\n';
}

const TASK_TYPE: Record<string, string> = {
  'Task Dependent': 'TT_Task',
  'Resource Dependent': 'TT_Rsrc',
  'Level of Effort': 'TT_LOE',
  'WBS Summary': 'TT_WBS',
  'Start Milestone': 'TT_Mile',
  'Finish Milestone': 'TT_FinMile',
};
const STATUS: Record<string, string> = { 'Not Started': 'TK_NotStart', 'In Progress': 'TK_Active', Completed: 'TK_Complete' };
const PCT_TYPE: Record<string, string> = { Duration: 'CP_Drtn', Physical: 'CP_Phys', Units: 'CP_Units' };
const DUR_TYPE: Record<string, string> = {
  'Fixed Units/Time': 'DT_FixedRate',
  'Fixed Duration and Units/Time': 'DT_FixedDrtn',
  'Fixed Units': 'DT_FixedQty',
  'Fixed Duration and Units': 'DT_FixedDUR2',
};
const REL_TYPE: Record<string, string> = { 'Finish to Start': 'PR_FS', 'Start to Start': 'PR_SS', 'Finish to Finish': 'PR_FF', 'Start to Finish': 'PR_SF', FinishToStart: 'PR_FS', StartToStart: 'PR_SS', FinishToFinish: 'PR_FF', StartToFinish: 'PR_SF' };
const RSRC_TYPE: Record<string, string> = { Labor: 'RT_Labor', Nonlabor: 'RT_Equip', Material: 'RT_Mat' };
const UDF_TYPE: Record<string, string> = { Text: 'FT_TEXT', Double: 'FT_FLOAT_2_DECIMALS', Integer: 'FT_INT', Cost: 'FT_MONEY', 'Start Date': 'FT_START_DATE', 'Finish Date': 'FT_END_DATE', Indicator: 'FT_STATICTYPE' };
const CSTR_TYPE: Record<string, string> = {
  'Start On': 'CS_MSO',
  'Start On or Before': 'CS_MSOB',
  'Start On or After': 'CS_MSOA',
  'Finish On': 'CS_MEO',
  'Finish On or Before': 'CS_MEOB',
  'Finish On or After': 'CS_MEOA',
  'As Late As Possible': 'CS_ALAP',
  'Mandatory Start': 'CS_MANDSTART',
  'Mandatory Finish': 'CS_MANDFIN',
};
const DAY_NUM: Record<string, number> = { Sunday: 1, Monday: 2, Tuesday: 3, Wednesday: 4, Thursday: 5, Friday: 6, Saturday: 7 };

/** P6 serial dates count days from 1899-12-30. */
const P6_SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);

/** P6's clndr_data mini-language for the calendar's standard work week and
    its dated exceptions (holidays, extra working days). */
function calendarData(cal: XmlRow): string {
  const week = nested(cal, 'StandardWorkWeek')[0];
  const days = new Map<number, string>();
  if (week) {
    for (const d of nested(week, 'StandardWorkHours')) {
      const n = DAY_NUM[str(d, 'DayOfWeek')];
      if (!n) continue;
      const spans = nested(d, 'WorkTime')
        .filter((w) => str(w, 'Start'))
        .map((w, i) => `(0||${i}(s|${str(w, 'Start').slice(0, 5)}|f|${str(w, 'Finish').slice(0, 5)})())`);
      days.set(n, spans.join(''));
    }
  }
  const dayParts = [1, 2, 3, 4, 5, 6, 7].map((n) => `(0||${n}()(${days.get(n) ?? ''}))`).join('');
  const exceptionParts = holidayOrExceptions(cal)
    .map(({ date, spans }, i) => {
      const serial = Math.round((Date.parse(`${date}T00:00:00Z`) - P6_SERIAL_EPOCH_MS) / 86_400_000);
      return `(0||${i}(d|${serial})(${spans.map((s, k) => `(0||${k}(s|${s.start}|f|${s.finish})())`).join('')}))`;
    })
    .join('');
  return `(0||CalendarData()((0||DaysOfWeek()(${dayParts}))(0||VIEW(ShowTotal|Y)())(0||Exceptions()(${exceptionParts}))))`;
}

function xerDate(v: string): string {
  if (!v) return '';
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(v);
  return m ? `${m[1]} ${m[2] ?? '00:00'}` : '';
}

function num(v: string): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function hexToXerColor(v: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(v);
  return m ? String(parseInt(m[1], 16)) : '';
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** XER is tab/line delimited — neither may appear inside a value. */
function clean(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[\t\r\n]+/g, ' ');
}
