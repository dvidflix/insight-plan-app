/* No imports: the dev server's project database (vite-plugins/db) reads
   the same tables and columns from SQLite. */

/** The tables normalizeXer reads and, for the big ones, the columns it
    reads (null = keep every column) — the streaming reader (xerStream.ts)
    keeps nothing else, so a column read below must be listed here too. */
export const XER_TABLE_COLUMNS: Record<string, string[] | null> = {
  PROJECT: null,
  CALENDAR: null,
  RSRC: null,
  RSRCRATE: null,
  ACTVTYPE: null,
  ACTVCODE: null,
  UDFTYPE: null,
  PROJWBS: ['wbs_id', 'proj_id', 'proj_node_flag', 'wbs_name', 'wbs_short_name', 'parent_wbs_id', 'seq_num'],
  TASK: [
    'task_id', 'proj_id', 'wbs_id', 'clndr_id', 'rsrc_id', 'task_code', 'task_name', 'task_type', 'status_code',
    'total_float_hr_cnt', 'free_float_hr_cnt', 'target_drtn_hr_cnt', 'remain_drtn_hr_cnt', 'phys_complete_pct',
    'target_start_date', 'target_end_date', 'act_start_date', 'act_end_date', 'early_start_date', 'early_end_date',
    'late_start_date', 'late_end_date', 'restart_date', 'reend_date', 'suspend_date', 'resume_date', 'expect_end_date',
    'cstr_type', 'cstr_date', 'cstr_type2', 'cstr_date2', 'duration_type', 'complete_pct_type', 'driving_path_flag', 'ip_seq',
  ],
  TASKPRED: ['task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt', 'ip_soft'],
  TASKRSRC: ['task_id', 'proj_id', 'rsrc_id', 'rsrc_type', 'target_qty', 'remain_qty', 'target_qty_per_hr', 'target_cost', 'act_reg_cost', 'act_ot_cost', 'ip_primary'],
  TASKACTV: ['task_id', 'actv_code_type_id', 'actv_code_id'],
  UDFVALUE: ['udf_type_id', 'fk_id', 'udf_text', 'udf_number'],
};
