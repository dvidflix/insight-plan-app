import type { DatabaseSync } from 'node:sqlite';

/** Analytics views: flat, ready-to-chart SQL views over the project database, for
    Apache Superset (or any BI tool) to read. The P6 tables keep one programme's rows
    behind ip_programme_id, and which columns exist depends on the XER files imported,
    so the views are written from the columns present and rebuilt whenever programmes
    are imported, deleted, renamed or tagged.

      v_programme              one row per programme: type (Scenario / Monthly update / Baseline / Other),
                               building, period (YYYY-MM), data date
      v_activity               every activity of every programme, with its WBS, dates, float and status
      v_relationship           every logic link, with both activities' codes and names
      v_resource_assignment    every resource assignment, with the resource and the activity

    Programmes read live from a P6 Professional database are not copied, so they are not in the views.
    Superset's datasets are these views (see stack/provision.mjs). */

export const ANALYTICS_VIEWS = ['v_programme', 'v_activity', 'v_relationship', 'v_resource_assignment'] as const;

const q = (id: string) => `"${id.replace(/"/g, '""')}"`;

/** A table's columns by lower-case name, or null when the table does not exist. */
function columnsOf(db: DatabaseSync, table: string): Map<string, string> | null {
  const rows = db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as { name: string }[];
  return rows.length ? new Map(rows.map((r) => [r.name.toLowerCase(), r.name])) : null;
}

/** `alias.column AS as`, or NULL when the table lacks the column (so a view always has the same columns). */
function pick(alias: string, have: Map<string, string>, column: string, as = column): string {
  const actual = have.get(column);
  return actual ? `${alias}.${q(actual)} AS ${q(as)}` : `NULL AS ${q(as)}`;
}

const has = (m: Map<string, string> | null, ...cols: string[]) => !!m && cols.every((c) => m.has(c));

/** (Re)creates the views from the tables present. Never throws: a view that cannot be made is left out. */
export function refreshAnalyticsViews(db: DatabaseSync) {
  const make = (name: string, sql: string | null) => {
    try {
      db.exec(`DROP VIEW IF EXISTS ${name}`);
      if (sql) db.exec(`CREATE VIEW ${name} AS ${sql}`);
    } catch {
      // left out; the others still work
    }
  };

  make(
    'v_programme',
    `SELECT id AS programme_id,
       name AS programme,
       CASE WHEN kind = 'scenario' THEN 'Scenario' ELSE COALESCE(NULLIF(copy_kind, ''), 'Monthly update') END AS programme_type,
       scenario,
       COALESCE(NULLIF(building, ''), stem) AS building,
       period,
       data_date,
       imported_at,
       activity_count,
       source_file,
       hidden
     FROM ip_programme WHERE source_format <> 'p6db'`,
  );

  const task = columnsOf(db, 'TASK');
  const wbs = columnsOf(db, 'PROJWBS');
  const proj = columnsOf(db, 'PROJECT');
  const pred = columnsOf(db, 'TASKPRED');
  const rsrc = columnsOf(db, 'RSRC');
  const assign = columnsOf(db, 'TASKRSRC');

  if (!has(task, 'task_id')) {
    for (const v of ['v_activity', 'v_relationship', 'v_resource_assignment']) make(v, null);
    return;
  }
  const t = task!;

  const day = (col: string, as: string) => (t.has(col) ? `substr(t.${q(t.get(col)!)}, 1, 10) AS ${q(as)}` : `NULL AS ${q(as)}`);
  const float = t.has('total_float_hr_cnt') ? 't."total_float_hr_cnt"' : null;
  make(
    'v_activity',
    `SELECT p.programme_id, p.programme, p.programme_type, p.building, p.period,
       ${pick('t', t, 'task_id')}, ${pick('t', t, 'task_code', 'activity_id')}, ${pick('t', t, 'task_name', 'activity_name')},
       ${pick('t', t, 'status_code', 'status')}, ${pick('t', t, 'task_type', 'activity_type')},
       ${has(wbs, 'wbs_name', 'wbs_id') ? 'w."wbs_name" AS wbs_name' : 'NULL AS wbs_name'},
       ${day('target_start_date', 'start_date')}, ${day('target_end_date', 'finish_date')},
       ${day('act_start_date', 'actual_start')}, ${day('act_end_date', 'actual_finish')},
       ${day('early_start_date', 'early_start')}, ${day('early_end_date', 'early_finish')},
       ${t.has('target_end_date') ? `substr(t."${t.get('target_end_date')}", 1, 7) AS finish_month` : 'NULL AS finish_month'},
       ${t.has('target_drtn_hr_cnt') ? `ROUND(t."${t.get('target_drtn_hr_cnt')}" / 8.0, 1) AS duration_days` : 'NULL AS duration_days'},
       ${t.has('remain_drtn_hr_cnt') ? `ROUND(t."${t.get('remain_drtn_hr_cnt')}" / 8.0, 1) AS remaining_days` : 'NULL AS remaining_days'},
       ${float ? `ROUND(${float} / 8.0, 1) AS float_days` : 'NULL AS float_days'},
       ${float ? `CASE WHEN ${float} <= 0 THEN 1 ELSE 0 END AS is_critical` : 'NULL AS is_critical'},
       ${pick('t', t, 'phys_complete_pct', 'percent_complete')},
       ${has(proj, 'proj_short_name', 'proj_id') ? 'j."proj_short_name" AS project' : 'NULL AS project'}
     FROM TASK t
     JOIN v_programme p ON p.programme_id = t.ip_programme_id
     ${has(wbs, 'wbs_id', 'wbs_name') && t.has('wbs_id') ? 'LEFT JOIN PROJWBS w ON w.ip_programme_id = t.ip_programme_id AND w."wbs_id" = t."wbs_id"' : ''}
     ${has(proj, 'proj_id', 'proj_short_name') && t.has('proj_id') ? 'LEFT JOIN PROJECT j ON j.ip_programme_id = t.ip_programme_id AND j."proj_id" = t."proj_id"' : ''}`,
  );

  make(
    'v_relationship',
    has(pred, 'task_id', 'pred_task_id') && t.has('task_code')
      ? `SELECT p.programme_id, p.programme, p.programme_type, p.building, p.period,
           ${pick('r', pred!, 'pred_type', 'relationship')},
           ${pred!.has('lag_hr_cnt') ? 'ROUND(r."lag_hr_cnt" / 8.0, 1) AS lag_days' : 'NULL AS lag_days'},
           a."task_code" AS predecessor_id, ${pick('a', t, 'task_name', 'predecessor_name')},
           b."task_code" AS successor_id, ${pick('b', t, 'task_name', 'successor_name')}
         FROM TASKPRED r
         JOIN v_programme p ON p.programme_id = r.ip_programme_id
         JOIN TASK a ON a.ip_programme_id = r.ip_programme_id AND a."task_id" = r."pred_task_id"
         JOIN TASK b ON b.ip_programme_id = r.ip_programme_id AND b."task_id" = r."task_id"`
      : null,
  );

  make(
    'v_resource_assignment',
    has(assign, 'task_id', 'rsrc_id') && has(rsrc, 'rsrc_id') && t.has('task_code')
      ? `SELECT p.programme_id, p.programme, p.programme_type, p.building, p.period,
           a."task_code" AS activity_id, ${pick('a', t, 'task_name', 'activity_name')},
           ${rsrc!.has('rsrc_name') ? 'r."rsrc_name" AS resource' : 'NULL AS resource'},
           ${pick('x', assign!, 'target_qty')}, ${pick('x', assign!, 'remain_qty')}, ${pick('x', assign!, 'act_reg_qty', 'actual_qty')},
           ${pick('x', assign!, 'target_cost')}
         FROM TASKRSRC x
         JOIN v_programme p ON p.programme_id = x.ip_programme_id
         JOIN TASK a ON a.ip_programme_id = x.ip_programme_id AND a."task_id" = x."task_id"
         LEFT JOIN RSRC r ON r.ip_programme_id = x.ip_programme_id AND r."rsrc_id" = x."rsrc_id"`
      : null,
  );
}

/** What kind of programme this is, and for which month, from its file name and P6 data date. */
export function guessTags(name: string, dataDate: string | null): { copyKind: string; period: string | null } {
  const text = name.toLowerCase();
  const copyKind = /baseline|\bbl\d*\b|\bbaseline\b/.test(text) ? 'Baseline' : 'Monthly update';
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  let m = /(20\d{2})[-_ .]?(0[1-9]|1[0-2])(?!\d)/.exec(text);
  if (m) return { copyKind, period: `${m[1]}-${m[2]}` };
  m = new RegExp(`(${months.join('|')})[a-z]*[-_ .]?(?:\\d{1,2}[-_ .]?)?(20\\d{2}|\\d{2})(?!\\d)`).exec(text);
  if (m) {
    const y = m[2].length === 2 ? `20${m[2]}` : m[2];
    return { copyKind, period: `${y}-${String(months.indexOf(m[1]) + 1).padStart(2, '0')}` };
  }
  return { copyKind, period: dataDate ? dataDate.slice(0, 7) : null };
}
