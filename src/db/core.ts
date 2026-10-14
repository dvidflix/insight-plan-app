import { XER_TABLE_COLUMNS } from '../schedule/parsers/xerColumns';
import { normalizeRules, totalRules } from '../prs/rules';

/** The project database's logic, independent of where SQLite runs: the dev / production server (node:sqlite, see
    vite-plugins/db/projectDb.ts) and the browser edition (SQLite compiled to WebAssembly, see src/web/). Both give it a
    database with the same shape as Node's DatabaseSync, so the saved insight-plan.db is the same file in either. */

/** A scenario's content for one building, as the generator takes it
    (scenario-engine/main.py --overrides-json, serve.py "generate"). */
export interface SequenceItem { GUID: string; Index: number; Phase?: string }
/** Manual link: activity IDs (P6 task_code), Lag in working hours. */
export interface Relation { ActivityID1: string; ActivityID2: string; Relation: string; Lag: number }
/** Replaces the default crews of a phase (or phase + pour type). */
export interface Crew { Phase: string; PourType: string; Trade: string; Crew: string }
/** An extra activity of a scenario (from a high-level programme): a milestone or work the generated programme does not make. */
export interface Extra { TaskID: string; Name: string; DurationDays: number; BaselineStart: string; BaselineFinish: string }
/** A flag on a pour (its GUID) or a group of the Scenarios table (its key), for review: 'flag' = to fix, 'done' = fixed. */
export interface Flag { Key: string; State: 'flag' | 'done' }
export interface ScenarioContent { sequence: SequenceItem[]; relations: Relation[]; crews: Crew[]; flags?: Flag[]; extras?: Extra[]; /** The scenario's programme rules (src/prs/rules.ts), stored as one JSON document. */ rules?: Record<string, unknown>; /** The WBS order to write into the generated schedule (parent path -> children paths); not stored with the scenario. */ wbsOrder?: Record<string, string[]> }

/** An error with the HTTP status the API answers with. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** The part of Node's DatabaseSync the project database uses. */
export interface SqlStatement {
  run(...params: any[]): { lastInsertRowid: number | bigint };
  get(...params: any[]): unknown;
  all(...params: any[]): unknown[];
}
export interface SqlDb {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
  close(): void;
}

export const DB_FILE = 'insight-plan.db';
export const SCHEMA_VERSION = '3';

export const APP_SCHEMA = `
CREATE TABLE IF NOT EXISTS ip_meta (key TEXT PRIMARY KEY, value TEXT);

-- One row per programme. Its P6 rows (TASK, TASKPRED…) carry its id in
-- ip_programme_id; a 'p6db' programme has none: it is read live from the
-- P6 Professional database at source_path.
CREATE TABLE IF NOT EXISTS ip_programme (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  source_file TEXT,
  source_format TEXT NOT NULL CHECK (source_format IN ('xer', 'xml', 'p6db')),
  source_path TEXT,
  project_ids TEXT NOT NULL DEFAULT '[]',
  kind TEXT NOT NULL DEFAULT 'import' CHECK (kind IN ('import', 'scenario')),
  scenario TEXT,
  stem TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  activity_count INTEGER,
  xer_header TEXT,
  -- 1: a programme of the app's own, edited in place (its rows change); 0: imported or generated, edited on top (overlay).
  editable INTEGER NOT NULL DEFAULT 0,
  -- A saved baseline of another programme (its id): a frozen copy of that programme, hidden until it is looked at.
  baseline_of INTEGER,
  imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS ix_ip_programme_scenario ON ip_programme (scenario, stem);

-- The P6 tables created so far (all carry ip_programme_id).
CREATE TABLE IF NOT EXISTS ip_p6_table (name TEXT PRIMARY KEY);

CREATE TABLE IF NOT EXISTS ip_scenario (
  name TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  notes TEXT
);
-- A scenario's content for one building (model file stem).
CREATE TABLE IF NOT EXISTS ip_scenario_model (
  scenario TEXT NOT NULL REFERENCES ip_scenario (name) ON DELETE CASCADE ON UPDATE CASCADE,
  stem TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  PRIMARY KEY (scenario, stem)
);
-- Pour order: pours sharing a step start together; pours without a row
-- are ordered by the generator's automatic rules.
CREATE TABLE IF NOT EXISTS ip_scenario_step (
  scenario TEXT NOT NULL,
  stem TEXT NOT NULL,
  guid TEXT NOT NULL,
  step INTEGER NOT NULL,
  phase TEXT,
  PRIMARY KEY (scenario, stem, guid),
  FOREIGN KEY (scenario, stem) REFERENCES ip_scenario_model (scenario, stem) ON DELETE CASCADE ON UPDATE CASCADE
);
-- Manual links between generated activities (P6 task_code). They replace
-- the generated links into the successor. Lag in working hours.
CREATE TABLE IF NOT EXISTS ip_scenario_link (
  id INTEGER PRIMARY KEY,
  scenario TEXT NOT NULL,
  stem TEXT NOT NULL,
  pred_task_code TEXT NOT NULL,
  succ_task_code TEXT NOT NULL,
  rel_type TEXT NOT NULL DEFAULT 'FS' CHECK (rel_type IN ('FS', 'SS', 'FF', 'SF')),
  lag_hours REAL NOT NULL DEFAULT 0,
  FOREIGN KEY (scenario, stem) REFERENCES ip_scenario_model (scenario, stem) ON DELETE CASCADE ON UPDATE CASCADE
);
-- Extra activities of the scenario (a high-level programme's milestones and work): added to the generated programme.
-- Baseline dates (yyyy-mm-dd) become the activity's target dates. Duration 0 is a milestone.
CREATE TABLE IF NOT EXISTS ip_scenario_extra (
  id INTEGER PRIMARY KEY,
  scenario TEXT NOT NULL,
  stem TEXT NOT NULL,
  task_code TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  duration_days REAL NOT NULL DEFAULT 0,
  baseline_start TEXT NOT NULL DEFAULT '',
  baseline_finish TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (scenario, stem) REFERENCES ip_scenario_model (scenario, stem) ON DELETE CASCADE ON UPDATE CASCADE
);
-- Programme rules of the scenario (src/prs/rules.ts): durations, rebar, crews, rule groups, level tasks, sequences, contact
-- links, settings. One JSON document per scenario and model; the generator reads it (scenario-engine/core/rules.py).
CREATE TABLE IF NOT EXISTS ip_scenario_rules (
  scenario TEXT NOT NULL,
  stem TEXT NOT NULL,
  rules_json TEXT NOT NULL,
  PRIMARY KEY (scenario, stem),
  FOREIGN KEY (scenario, stem) REFERENCES ip_scenario_model (scenario, stem) ON DELETE CASCADE ON UPDATE CASCADE
);
-- Crews: the rows for a phase (or phase + pour type) replace that phase's
-- default crews (scenario-engine/config.py CREW_TABLE). People per day.
CREATE TABLE IF NOT EXISTS ip_scenario_crew (
  id INTEGER PRIMARY KEY,
  scenario TEXT NOT NULL,
  stem TEXT NOT NULL,
  phase TEXT NOT NULL,
  pour_type TEXT NOT NULL DEFAULT '',
  trade TEXT NOT NULL,
  crew REAL NOT NULL CHECK (crew >= 0),
  FOREIGN KEY (scenario, stem) REFERENCES ip_scenario_model (scenario, stem) ON DELETE CASCADE ON UPDATE CASCADE
);

-- Review flags on pours (key = GUID) and groups of the Scenarios table (key =
-- the group's path): 'flag' = to fix, 'done' = fixed.
CREATE TABLE IF NOT EXISTS ip_scenario_flag (
  scenario TEXT NOT NULL,
  stem TEXT NOT NULL,
  key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('flag', 'done')),
  PRIMARY KEY (scenario, stem, key),
  FOREIGN KEY (scenario, stem) REFERENCES ip_scenario_model (scenario, stem) ON DELETE CASCADE ON UPDATE CASCADE
);

-- 4D link groups: rules (JSON arrays) matching activities to model objects.
CREATE TABLE IF NOT EXISTS ip_link_group (
  id TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  color TEXT,
  appearance_profile_id TEXT,
  tag_id TEXT,
  task_filters TEXT NOT NULL DEFAULT '[]',
  object_filters TEXT NOT NULL DEFAULT '[]',
  match_rules TEXT NOT NULL DEFAULT '[]'
);

-- Site capacity per labour trade (resource name), people per day: the
-- levelling limit, over the programme's own max units.
CREATE TABLE IF NOT EXISTS ip_trade_capacity (
  trade TEXT PRIMARY KEY,
  capacity REAL NOT NULL CHECK (capacity > 0)
);

-- Project settings (JSON values).
CREATE TABLE IF NOT EXISTS ip_setting (key TEXT PRIMARY KEY, value TEXT);

-- Clashes & contacts, kept so they are ready when the models load: one run
-- per model with itself (scope "self:<model>") and per pair of models
-- ("pair:<model A>|<model B>"). The key fingerprints what the result
-- depends on (files, placement, tolerance); a new run replaces the scope's
-- old one. Elements by GlobalId, A in the scope's first model.
CREATE TABLE IF NOT EXISTS ip_clash_run (
  key TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  pair_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS ix_ip_clash_run_scope ON ip_clash_run (scope);
CREATE TABLE IF NOT EXISTS ip_clash_pair (
  run_key TEXT NOT NULL REFERENCES ip_clash_run (key) ON DELETE CASCADE,
  a_guid TEXT NOT NULL,
  b_guid TEXT NOT NULL,
  distance REAL NOT NULL,
  overlap INTEGER NOT NULL,
  position TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_ip_clash_pair_run ON ip_clash_pair (run_key);
`;

/** A stored contact: A's and B's GlobalIds, gap (m), overlapping, where B sits. */
export type ClashPair = [string, string, number, boolean, string];

export interface ProgrammeRow {
  id: number;
  name: string;
  sourceFile: string | null;
  sourceFormat: 'xer' | 'xml' | 'p6db';
  sourcePath: string | null;
  projectIds: string[];
  kind: 'import' | 'scenario';
  scenario: string | null;
  stem: string | null;
  hidden: boolean;
  activityCount: number | null;
  /** Edited in place: the app changes its rows (see applyOps). */
  editable: boolean;
  /** A saved baseline of this programme (a frozen copy of it), or null. */
  baselineOf: number | null;
  importedAt: string;
}

export interface P6ProjectInfo {
  id: string;
  shortName: string;
  name: string;
  activityCount: number;
}

/** A table as columns + rows of strings (XER's raw values; '' for null). */
export interface TableData {
  columns: string[];
  rows: string[][];
}

export interface ImportMeta {
  name: string;
  sourceFile: string;
  sourceFormat: 'xer' | 'xml';
  kind: 'import' | 'scenario';
  scenario: string | null;
  stem: string | null;
  /** Only these P6 projects (null = all in the file). */
  projectIds: string[] | null;
}


/** The order P6 writes its tables in (what a table refers to comes first). A table not named here goes after these, in the order it was added. */
const P6_TABLE_ORDER = [
  'CURRTYPE', 'FINTMPL', 'MEMOTYPE', 'NONWORK', 'OBS', 'PHASE', 'RSRCCURVDATA', 'UDFTYPE', 'PCATTYPE', 'PCATVAL', 'PROJECT', 'CALENDAR', 'SCHEDOPTIONS',
  'PROJWBS', 'RSRC', 'ACTVTYPE', 'RSRCRATE', 'TASK', 'ACTVCODE', 'TASKMEMO', 'TASKPRED', 'TASKRSRC', 'TASKACTV', 'UDFVALUE',
];

/** A change to one row of a programme edited in place (see ProjectDbBase.applyOps). */
export interface RowOp {
  table: string;
  op: 'upsert' | 'delete';
  /** The row's id column (task_id ...) and value; null on an upsert: a new row, given the next id. */
  key: { column: string; value: string | number | null };
  /** Finds the row by these columns instead of by the key's value (a link by its two activities, say). The key column is still
      the row's id: a new row gets the next one. */
  match?: Record<string, string | number>;
  set?: Record<string, string | number | null>;
}

/** The P6 tables the app edits in place. */
const EDITABLE_TABLES = new Set(['TASK', 'TASKPRED', 'PROJWBS', 'TASKRSRC', 'TASKACTV', 'CALENDAR', 'PROJECT']);

const TASK_COLUMNS = [
  'task_id', 'proj_id', 'wbs_id', 'clndr_id', 'phys_complete_pct', 'rev_fdbk_flag', 'lock_plan_flag', 'auto_compute_act_flag', 'complete_pct_type', 'task_type',
  'duration_type', 'status_code', 'task_code', 'task_name', 'rsrc_id', 'total_float_hr_cnt', 'free_float_hr_cnt', 'remain_drtn_hr_cnt', 'act_work_qty',
  'remain_work_qty', 'target_work_qty', 'target_drtn_hr_cnt', 'target_equip_qty', 'act_equip_qty', 'remain_equip_qty', 'cstr_date', 'act_start_date',
  'act_end_date', 'late_start_date', 'late_end_date', 'expect_end_date', 'early_start_date', 'early_end_date', 'restart_date', 'reend_date',
  'target_start_date', 'target_end_date', 'rem_late_start_date', 'rem_late_end_date', 'cstr_type', 'priority_type', 'suspend_date', 'resume_date',
  'float_path', 'float_path_order', 'cstr_date2', 'cstr_type2', 'driving_path_flag', 'create_date', 'update_date',
];

/** P6's calendar text for a Monday-Friday week of 08:00-16:00 with no exceptions (day 1 is Sunday). */
const BLANK_CALENDAR_DATA = '(0||CalendarData()((0||DaysOfWeek()('
  + [1, 2, 3, 4, 5, 6, 7].map((d) => (d === 1 || d === 7 ? `(0||${d}()())` : `(0||${d}()((0||0(s|08:00|f|16:00)())))`)).join('')
  + '))(0||Exceptions()())))';

export const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const q = (id: string) => `"${id.replace(/"/g, '""')}"`;
export const now = () => new Date().toISOString();
export const idParam = (s: string) => (/^\d+$/.test(s) ? Number(s) : s);

/** Column type from P6's naming: *_id integer, counts / quantities / costs
    numeric (so SQL compares them as numbers), everything else text (dates
    are "YYYY-MM-DD HH:MM", which sorts and compares as text). */
export function affinity(col: string): string {
  if (/_id$/i.test(col)) return 'INTEGER';
  if (/(_cnt|_qty|_cost|_pct|_num|_hr|_rate|_len|_number|_wt|_amt|_units)$/i.test(col)) return 'NUMERIC';
  return 'TEXT';
}

/** A value as it is stored in the column. A number put in a text column would come back as "10.0" (the driver binds it as a double):
    it is stored as the text P6 writes. */
export const bindValue = (column: string, v: string | number | null): string | number | null => (typeof v === 'number' && affinity(column) === 'TEXT' ? String(v) : v);

export function tableColumns(db: SqlDb, table: string): string[] | null {
  const rows = db.prepare('SELECT name FROM pragma_table_info(?)').all(table) as { name: string }[];
  return rows.length ? rows.map((r) => r.name) : null;
}

/** Text of a BLOB cell. The server also inflates zlib-compressed text (P6 keeps calendar data that way); the default is plain UTF-8. */
export type BlobText = (b: Uint8Array) => string;
const plainBlobText: BlobText = (b) => new TextDecoder().decode(b);

export function cell(v: unknown, blobText: BlobText = plainBlobText): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (v instanceof Uint8Array) return blobText(v);
  return String(v);
}

/** Reads the P6 tables the app uses (XER_TABLE_COLUMNS) for some projects,
    from the project database (one programme's rows) or from a P6
    Professional database (rows P6 has not deleted). Same row filter as
    xerStream.readXerTables. */
export function readP6Tables(db: SqlDb, opts: { programmeId?: number; projectIds: string[] | null; blobText?: BlobText }): Record<string, TableData> {
  const out: Record<string, TableData> = {};
  for (const [table, wanted] of Object.entries(XER_TABLE_COLUMNS)) {
    const existing = tableColumns(db, table);
    if (!existing) continue;
    const lower = new Set(existing.map((c) => c.toLowerCase()));
    const columns = (wanted ?? existing.filter((c) => c !== 'ip_programme_id')).filter((c) => lower.has(c.toLowerCase()));
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (opts.programmeId !== undefined) {
      where.push('ip_programme_id = ?');
      params.push(opts.programmeId);
    }
    if (lower.has('delete_session_id')) where.push('delete_session_id IS NULL');
    if (opts.projectIds && lower.has('proj_id')) {
      const ids = opts.projectIds.map(idParam);
      const list = ids.map(() => '?').join(', ');
      if (table === 'TASKPRED' && lower.has('pred_proj_id')) {
        where.push(`proj_id IN (${list}) AND pred_proj_id IN (${list})`);
        params.push(...ids, ...ids);
      } else {
        where.push(`(proj_id IS NULL OR proj_id IN (${list}))`);
        params.push(...ids);
      }
    }
    const sql = `SELECT ${columns.map(q).join(', ')} FROM ${q(table)}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
    const rows = (db.prepare(sql).all(...params) as Record<string, unknown>[]).map((r) => Object.values(r).map((v) => cell(v, opts.blobText)));
    out[table] = { columns, rows };
  }
  return out;
}

/** The projects in a set of P6 tables (a programme's, or a P6 database's). */
export function listP6Projects(db: SqlDb, programmeId?: number): P6ProjectInfo[] {
  const cols = (t: string) => new Set((tableColumns(db, t) ?? []).map((c) => c.toLowerCase()));
  const project = cols('PROJECT');
  if (!project.size) return [];
  const filter = (c: Set<string>, extra: string[] = []) => {
    const w = [...extra];
    if (programmeId !== undefined) w.push('ip_programme_id = ?');
    if (c.has('delete_session_id')) w.push('delete_session_id IS NULL');
    return w.length ? ` WHERE ${w.join(' AND ')}` : '';
  };
  const args = programmeId !== undefined ? [programmeId] : [];
  const projects = db
    .prepare(`SELECT proj_id, ${project.has('proj_short_name') ? 'proj_short_name' : "''"} AS short_name FROM PROJECT${filter(project, project.has('project_flag') ? ["COALESCE(project_flag, 'Y') = 'Y'"] : [])}`)
    .all(...args) as { proj_id: unknown; short_name: unknown }[];
  const wbs = cols('PROJWBS');
  const names = new Map<string, string>();
  if (wbs.has('proj_node_flag')) {
    for (const r of db.prepare(`SELECT proj_id, wbs_name FROM PROJWBS${filter(wbs, ["proj_node_flag = 'Y'"])}`).all(...args) as { proj_id: unknown; wbs_name: unknown }[]) {
      names.set(cell(r.proj_id), cell(r.wbs_name));
    }
  }
  const task = cols('TASK');
  const counts = new Map<string, number>();
  if (task.size) {
    for (const r of db.prepare(`SELECT proj_id, COUNT(*) AS n FROM TASK${filter(task)} GROUP BY proj_id`).all(...args) as { proj_id: unknown; n: number }[]) {
      counts.set(cell(r.proj_id), Number(r.n));
    }
  }
  return projects.map((p) => {
    const id = cell(p.proj_id);
    return { id, shortName: cell(p.short_name), name: names.get(id) ?? '', activityCount: counts.get(id) ?? 0 };
  });
}

export interface ProgrammeDbRow {
  id: number;
  name: string;
  source_file: string | null;
  source_format: ProgrammeRow['sourceFormat'];
  source_path: string | null;
  project_ids: string;
  kind: ProgrammeRow['kind'];
  scenario: string | null;
  stem: string | null;
  hidden: number;
  activity_count: number | null;
  editable?: number;
  baseline_of?: number | null;
  imported_at: string;
}

export function parseJson<T>(text: unknown, fallback: T): T {
  try {
    return text === null || text === undefined || text === '' ? fallback : (JSON.parse(String(text)) as T);
  } catch {
    return fallback;
  }
}

export function toProgramme(r: ProgrammeDbRow): ProgrammeRow {
  return {
    id: Number(r.id),
    name: r.name,
    sourceFile: r.source_file,
    sourceFormat: r.source_format,
    sourcePath: r.source_path,
    projectIds: parseJson<unknown[]>(r.project_ids, []).map(String),
    kind: r.kind,
    scenario: r.scenario,
    stem: r.stem,
    hidden: !!r.hidden,
    activityCount: r.activity_count === null ? null : Number(r.activity_count),
    editable: !!r.editable,
    baselineOf: r.baseline_of === null || r.baseline_of === undefined ? null : Number(r.baseline_of),
    importedAt: r.imported_at,
  };
}

export abstract class ProjectDbBase {
  private p6Tables = new Map<string, Set<string>>();

  constructor(readonly root: string, readonly file: string, readonly db: SqlDb) {}

  /** Creates the app's tables on first use. Subclasses call it once the database is open. */
  protected init() {
    this.db.exec(APP_SCHEMA);
    // Version 2: programmes the app edits in place. A column added to a database made before it (nothing is rebuilt or rewritten).
    if (!tableColumns(this.db, 'ip_programme')?.includes('editable')) this.db.exec('ALTER TABLE ip_programme ADD COLUMN editable INTEGER NOT NULL DEFAULT 0');
    // Version 3: saved baselines.
    if (!tableColumns(this.db, 'ip_programme')?.includes('baseline_of')) this.db.exec('ALTER TABLE ip_programme ADD COLUMN baseline_of INTEGER');
    if (this.meta('schema_version') !== SCHEMA_VERSION) this.setMeta('schema_version', SCHEMA_VERSION);
  }

  close() {
    this.db.close();
  }

  /** Commits made by other programs since the app opened the file (only the server can tell). */
  changes(): number {
    return 0;
  }

  /** Runs fn in one write transaction. */
  tx<T>(fn: () => T): T {
    try {
      this.db.exec('BEGIN IMMEDIATE');
    } catch (e) {
      throw locked(e);
    }
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        // already rolled back
      }
      throw locked(e);
    }
  }

  meta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM ip_meta WHERE key = ?').get(key) as { value: string } | undefined;
    return r?.value ?? null;
  }

  protected setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO ip_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  // ---- P6 tables ----

  /** Creates the P6 table, or adds the columns it lacks; returns the usable
      columns in the order given. */
  private ensureP6Table(table: string, fields: string[]): string[] {
    if (!IDENT.test(table) || /^(ip_|sqlite_)/i.test(table)) throw new HttpError(400, `Unexpected XER table name "${table}".`);
    const columns = [...new Set(fields.filter((f) => IDENT.test(f) && f.toLowerCase() !== 'ip_programme_id'))];
    let existing = this.p6Tables.get(table);
    if (!existing) {
      const cols = tableColumns(this.db, table);
      if (cols) existing = new Set(cols.map((c) => c.toLowerCase()));
    }
    if (!existing) {
      this.db.exec(
        `CREATE TABLE ${q(table)} (ip_programme_id INTEGER NOT NULL REFERENCES ip_programme (id) ON DELETE CASCADE${columns.map((c) => `, ${q(c)} ${affinity(c)}`).join('')})`,
      );
      this.db.exec(`CREATE INDEX IF NOT EXISTS ${q(`ix_${table}`)} ON ${q(table)} (ip_programme_id${columns[0] ? `, ${q(columns[0])}` : ''})`);
      this.db.prepare('INSERT OR IGNORE INTO ip_p6_table (name) VALUES (?)').run(table);
      existing = new Set(columns.map((c) => c.toLowerCase()));
    } else {
      for (const c of columns) {
        if (existing.has(c.toLowerCase())) continue;
        this.db.exec(`ALTER TABLE ${q(table)} ADD COLUMN ${q(c)} ${affinity(c)}`);
        existing.add(c.toLowerCase());
      }
    }
    existing.add('ip_programme_id');
    this.p6Tables.set(table, existing);
    return columns;
  }

  private deleteProgrammeRows(id: number) {
    for (const { name } of this.db.prepare('SELECT name FROM ip_p6_table').all() as { name: string }[]) {
      if (tableColumns(this.db, name)) this.db.prepare(`DELETE FROM ${q(name)} WHERE ip_programme_id = ?`).run(id);
    }
    this.db.prepare('DELETE FROM ip_programme WHERE id = ?').run(id);
  }

  /** Imports an XER file into the P6 tables as a new programme (only the
      chosen projects' rows, as the app's own XER reader keeps). A scenario's
      programme replaces that scenario's previous one for the building. */
  importXerLines(lines: Iterable<string>, meta: ImportMeta): ProgrammeRow {
    const keep = meta.projectIds ? new Set(meta.projectIds) : null;
    // Tables may have been changed in another program since the last import.
    this.p6Tables.clear();
    const id = this.tx(() => {
      let oldIds: number[] = [];
      if (meta.kind === 'scenario') {
        const old = this.db.prepare("SELECT id FROM ip_programme WHERE kind = 'scenario' AND scenario = ? AND stem = ?").all(meta.scenario, meta.stem) as { id: number }[];
        oldIds = old.map((o) => Number(o.id));
        for (const o of old) this.deleteProgrammeRows(Number(o.id));
      }
      const res = this.db
        .prepare('INSERT INTO ip_programme (name, source_file, source_format, kind, scenario, stem) VALUES (?, ?, ?, ?, ?, ?)')
        .run(meta.name, meta.sourceFile, meta.sourceFormat, meta.kind, meta.scenario, meta.stem);
      const programmeId = Number(res.lastInsertRowid);
      // The baselines saved of the programme this one replaces are now baselines of this one.
      for (const old of oldIds) this.db.prepare('UPDATE ip_programme SET baseline_of = ? WHERE baseline_of = ?').run(programmeId, old);
      let header: string | null = null;
      let table: string | null = null;
      let insert: SqlStatement | null = null;
      let picks: number[] = [];
      let projCol = -1;
      let predProjCol = -1;
      for (const line of lines) {
        if (!line) continue;
        if (line.startsWith('ERMHDR')) {
          header = line;
          continue;
        }
        const tag = line.slice(0, 2);
        if (tag === '%T') {
          table = line.slice(2).trim();
          insert = null;
        } else if (tag === '%F' && table) {
          const fields = line.split('\t').slice(1).map((f) => f.trim());
          const columns = this.ensureP6Table(table, fields);
          picks = columns.map((c) => fields.indexOf(c) + 1);
          insert = this.db.prepare(`INSERT INTO ${q(table)} (ip_programme_id${columns.map((c) => `, ${q(c)}`).join('')}) VALUES (?${', ?'.repeat(columns.length)})`);
          projCol = fields.indexOf('proj_id') + 1;
          predProjCol = table === 'TASKPRED' ? fields.indexOf('pred_proj_id') + 1 : 0;
        } else if (tag === '%R' && insert) {
          const v = line.split('\t');
          if (keep && projCol > 0) {
            const p = v[projCol] ?? '';
            if (predProjCol > 0) {
              if (!keep.has(p) || !keep.has(v[predProjCol] ?? '')) continue;
            } else if (p !== '' && !keep.has(p)) continue;
          }
          insert.run(programmeId, ...picks.map((i) => (i > 0 && v[i] !== undefined && v[i] !== '' ? v[i] : null)));
        }
      }
      const projects = listP6Projects(this.db, programmeId);
      if (!projects.length) throw new HttpError(400, `${meta.sourceFile} has no P6 project (PROJECT table) to import.`);
      this.db
        .prepare('UPDATE ip_programme SET project_ids = ?, activity_count = ?, xer_header = ? WHERE id = ?')
        .run(JSON.stringify(projects.map((p) => p.id)), projects.reduce((s, p) => s + p.activityCount, 0), header, programmeId);
      return programmeId;
    });
    return this.programme(id)!;
  }

  /** References projects of a P6 Professional database as a programme (read
      live, never copied). */
  linkP6(file: string, db: SqlDb, projectIds: string[], name: string): ProgrammeRow {
    const projects = listP6Projects(db).filter((p) => projectIds.includes(p.id));
    if (!projects.length) throw new HttpError(400, 'None of those projects are in the P6 database.');
    const id = this.tx(() => {
      const res = this.db
        .prepare("INSERT INTO ip_programme (name, source_file, source_format, source_path, project_ids, activity_count) VALUES (?, ?, 'p6db', ?, ?, ?)")
        .run(name, file.split(/[\\/]/).pop() ?? file, file, JSON.stringify(projects.map((p) => p.id)), projects.reduce((s, p) => s + p.activityCount, 0));
      return Number(res.lastInsertRowid);
    });
    return this.programme(id)!;
  }

  programmes(): ProgrammeRow[] {
    return (this.db.prepare('SELECT * FROM ip_programme ORDER BY id').all() as unknown as ProgrammeDbRow[]).map(toProgramme);
  }

  programme(id: number): ProgrammeRow | null {
    const r = this.db.prepare('SELECT * FROM ip_programme WHERE id = ?').get(id) as unknown as ProgrammeDbRow | undefined;
    return r ? toProgramme(r) : null;
  }

  /** The programme's P6 tables, for the app's normaliser. */
  programmeTables(id: number): { programme: ProgrammeRow; tables: Record<string, TableData> } {
    const programme = this.programme(id);
    if (!programme) throw new HttpError(404, `No programme ${id} in the project database.`);
    if (programme.sourceFormat === 'p6db') return { programme, tables: this.linkedP6Tables(programme) };
    return { programme, tables: readP6Tables(this.db, { programmeId: id, projectIds: null }) };
  }

  /** Everything of a programme as P6 tables, for writing it out as an XER: every table and column it has (not only the ones the app
      reads), in the order the file had them, and the file's own header line. The rows of a programme edited in place are as the
      app last wrote them. */
  exportProgramme(id: number): { header: string | null; tables: Record<string, TableData> } {
    const programme = this.programme(id);
    if (!programme) throw new HttpError(404, `No programme ${id} in the project database.`);
    if (programme.sourceFormat === 'p6db') throw new HttpError(400, `"${programme.name}" is read from a P6 Professional database: export it from P6.`);
    const header = (this.db.prepare('SELECT xer_header FROM ip_programme WHERE id = ?').get(id) as { xer_header: string | null } | undefined)?.xer_header ?? null;
    const tables: Record<string, TableData> = {};
    const known = (name: string) => {
      const i = P6_TABLE_ORDER.indexOf(name);
      return i < 0 ? P6_TABLE_ORDER.length : i;
    };
    const names = (this.db.prepare('SELECT name FROM ip_p6_table ORDER BY rowid').all() as { name: string }[]).map((r) => r.name);
    for (const name of [...names].sort((a, b) => known(a) - known(b))) {
      const cols = tableColumns(this.db, name);
      if (!cols) continue;
      const columns = cols.filter((c) => c !== 'ip_programme_id');
      const where = cols.some((c) => c.toLowerCase() === 'delete_session_id') ? ' AND delete_session_id IS NULL' : '';
      const rows = (this.db.prepare(`SELECT ${columns.map(q).join(', ')} FROM ${q(name)} WHERE ip_programme_id = ?${where} ORDER BY rowid`).all(id) as Record<string, unknown>[]).map((r) => Object.values(r).map((v) => cell(v)));
      if (rows.length) tables[name] = { columns, rows };
    }
    return { header, tables };
  }

  /** A programme read live from a P6 Professional database (only where the file is reachable: the server). */
  protected linkedP6Tables(programme: ProgrammeRow): Record<string, TableData> {
    throw new HttpError(400, `"${programme.name}" is read from a P6 Professional database, which this edition cannot open.`);
  }

  setHidden(hidden: Record<string, boolean>) {
    this.tx(() => {
      const stmt = this.db.prepare('UPDATE ip_programme SET hidden = ? WHERE id = ?');
      for (const [id, h] of Object.entries(hidden)) stmt.run(h ? 1 : 0, Number(id));
    });
  }

  renameProgramme(id: number, name: string) {
    this.tx(() => this.db.prepare('UPDATE ip_programme SET name = ? WHERE id = ?').run(name, id));
  }

  /** Deletes a programme, and the baselines saved of it. */
  deleteProgramme(id: number) {
    this.tx(() => {
      for (const b of this.db.prepare('SELECT id FROM ip_programme WHERE baseline_of = ?').all(id) as { id: number }[]) this.deleteProgrammeRows(Number(b.id));
      this.deleteProgrammeRows(id);
    });
  }


  // ---- programmes edited in place ----

  /** A copy of a programme the app can edit in place: every P6 row of it (also the tables the app does not read), so nothing the file
      carried is lost when it is handed back as an XER. A generated programme is copied as an import, so regenerating does not replace it. */
  copyProgramme(id: number, name: string): ProgrammeRow {
    return this.cloneProgramme(id, name, { editable: true });
  }

  /** The programme as it is now, kept under a name: a frozen copy of every P6 row of it, hidden (it loads when it is looked at). Its dates,
      links and everything else can then be compared with the programme as it goes on changing. */
  saveBaseline(id: number, name: string): ProgrammeRow {
    const from = this.programme(id);
    if (!from) throw new HttpError(404, `No programme ${id} in the project database.`);
    if (from.baselineOf !== null) throw new HttpError(400, `"${from.name}" is a baseline already: save the baseline of the programme itself.`);
    return this.cloneProgramme(id, name, { editable: false, hidden: true, baselineOf: id });
  }

  private cloneProgramme(id: number, name: string, o: { editable: boolean; hidden?: boolean; baselineOf?: number }): ProgrammeRow {
    const from = this.programme(id);
    if (!from) throw new HttpError(404, `No programme ${id} in the project database.`);
    if (from.sourceFormat === 'p6db') throw new HttpError(400, `"${from.name}" is read from a P6 Professional database: export it as an XER file and load that to copy it.`);
    const header = this.db.prepare('SELECT xer_header FROM ip_programme WHERE id = ?').get(id) as { xer_header: string | null } | undefined;
    const copyId = this.tx(() => {
      const res = this.db
        .prepare("INSERT INTO ip_programme (name, source_file, source_format, project_ids, kind, activity_count, xer_header, editable, hidden, baseline_of) VALUES (?, ?, ?, ?, 'import', ?, ?, ?, ?, ?)")
        .run(name, from.sourceFile, from.sourceFormat, JSON.stringify(from.projectIds), from.activityCount, header?.xer_header ?? null, o.editable ? 1 : 0, o.hidden ? 1 : 0, o.baselineOf ?? null);
      const newId = Number(res.lastInsertRowid);
      for (const { name: table } of this.db.prepare('SELECT name FROM ip_p6_table').all() as { name: string }[]) {
        const cols = (tableColumns(this.db, table) ?? []).filter((c) => c !== 'ip_programme_id');
        if (!cols.length) continue;
        const list = cols.map(q).join(', ');
        this.db.prepare(`INSERT INTO ${q(table)} (ip_programme_id, ${list}) SELECT ?, ${list} FROM ${q(table)} WHERE ip_programme_id = ?`).run(newId, id);
      }
      return newId;
    });
    return this.programme(copyId)!;
  }

  /** An empty programme to build from scratch: a project, its root WBS node and a Monday-Friday calendar. `start` is YYYY-MM-DD. */
  blankProgramme(name: string, start: string): ProgrammeRow {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new HttpError(400, 'The start date must be YYYY-MM-DD.');
    const day = `${start} 08:00`;
    const today = new Date().toISOString().slice(0, 10) + ' 00:00';
    const id = this.tx(() => {
      const res = this.db
        .prepare("INSERT INTO ip_programme (name, source_file, source_format, project_ids, kind, activity_count, editable) VALUES (?, NULL, 'xer', '[\"1\"]', 'import', 0, 1)")
        .run(name);
      const programmeId = Number(res.lastInsertRowid);
      const put = (table: string, row: Record<string, string | number>) => {
        const columns = this.ensureP6Table(table, Object.keys(row));
        this.db.prepare(`INSERT INTO ${q(table)} (ip_programme_id${columns.map((c) => `, ${q(c)}`).join('')}) VALUES (?${', ?'.repeat(columns.length)})`).run(programmeId, ...columns.map((c) => bindValue(c, row[c])));
      };
      // The columns P6 writes for a project and its schedule options, with P6's own defaults, so what reads the XER finds what it expects.
      put('PROJECT', {
        proj_id: 1, fy_start_month_num: 1, rsrc_self_add_flag: 'Y', allow_complete_flag: 'Y', rsrc_multi_assign_flag: 'Y', checkout_flag: 'N', project_flag: 'Y',
        step_complete_flag: 'N', cost_qty_recalc_flag: 'N', batch_sum_flag: 'Y', name_sep_char: '.', def_complete_pct_type: 'CP_Drtn', proj_short_name: name.slice(0, 20),
        clndr_id: 1, task_code_base: 1000, task_code_step: 10, priority_num: 10, wbs_max_sum_level: 2, strgy_priority_num: 500, critical_drtn_hr_cnt: 0,
        def_cost_per_qty: 0, last_recalc_date: day, plan_start_date: day, plan_end_date: '', scd_end_date: day, add_date: today, def_duration_type: 'DT_FixedDUR2', task_code_prefix: 'A',
        def_qty_type: 'QT_Hour', add_by_name: 'Insight Plan', def_rate_type: 'COST_PER_QTY', add_act_remain_flag: 'N', act_this_per_link_flag: 'Y', def_task_type: 'TT_Task',
        act_pct_link_flag: 'Y', critical_path_type: 'CT_TotFloat', task_code_prefix_flag: 'Y', def_rollup_dates_flag: 'Y', use_project_baseline_flag: 'Y',
        rem_target_link_flag: 'Y', reset_planned_flag: 'Y', allow_neg_act_flag: 'N', sum_assign_level: 'SL_Taskrsrc', export_flag: 'Y',
      });
      put('CALENDAR', { clndr_id: 1, default_flag: 'Y', clndr_name: 'Standard 5 Day Workweek', proj_id: '', base_clndr_id: '', last_chng_date: today, clndr_type: 'CA_Base', day_hr_cnt: 8, week_hr_cnt: 40, month_hr_cnt: 172, year_hr_cnt: 2000, rsrc_private: 'N', clndr_data: BLANK_CALENDAR_DATA });
      put('SCHEDOPTIONS', {
        schedoptions_id: 1, proj_id: 1, sched_outer_depend_type: 'SD_None', sched_open_critical_flag: 'N', sched_lag_early_start_flag: 'Y', sched_retained_logic: 'Y',
        sched_setplantoforecast: 'N', sched_float_type: 'FT_FF', sched_calendar_on_relationship_lag: 'rcal_Predecessor', sched_use_expect_end_flag: 'N',
        sched_progress_override: 'N', level_float_thrs_cnt: 0, level_outer_assign_flag: 'N', level_outer_assign_priority: 5, level_over_alloc_pct: 25,
        level_within_float_flag: 'N', level_keep_sched_date_flag: 'Y', level_all_rsrc_flag: 'Y', sched_use_project_end_date_for_float: 'Y',
        enable_multiple_longest_path_calc: 'N', limit_multiple_longest_path_calc: 'Y', max_multiple_longest_path: 10, use_total_float_multiple_longest_paths: 'Y',
      });
      put('PROJWBS', { wbs_id: 1, proj_id: 1, obs_id: '', seq_num: 0, proj_node_flag: 'Y', sum_data_flag: 'N', status_code: 'WS_Open', wbs_short_name: name.slice(0, 20), wbs_name: name, parent_wbs_id: '' });
      // The task tables, empty, so the first activity only has to be added.
      this.ensureP6Table('TASK', TASK_COLUMNS);
      this.ensureP6Table('TASKPRED', ['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt', 'comments', 'float_path', 'aref', 'arls']);
      this.db.prepare('UPDATE ip_programme SET xer_header = ? WHERE id = ?').run(`ERMHDR\t19.12\t${today.slice(0, 10)}\tProject\tadmin\tadmin\tdbxDatabaseNoName\tProject Management\tUSD`, programmeId);
      return programmeId;
    });
    return this.programme(id)!;
  }

  /** Changes rows of a programme that is edited in place, all or none. A row is found by `key` (a P6 id column and its value) and made
      with `set` (column -> value; columns the table lacks are added). A key value of null on an upsert is a new row: it is given the
      next id of the table. Returns the ids given, by op number. */
  applyOps(id: number, ops: RowOp[]): { applied: number; assigned: Record<number, number> } {
    const programme = this.programme(id);
    if (!programme) throw new HttpError(404, `No programme ${id} in the project database.`);
    if (!programme.editable) throw new HttpError(400, `"${programme.name}" is not edited in place: make an editable copy of it first.`);
    const assigned: Record<number, number> = {};
    this.tx(() => {
      const next = new Map<string, number>();
      ops.forEach((op, i) => {
        if (!EDITABLE_TABLES.has(op.table)) throw new HttpError(400, `The table ${op.table} cannot be edited.`);
        const column = op.key?.column;
        if (!column || !IDENT.test(column) || column === 'ip_programme_id') throw new HttpError(400, `Not an id column: ${column}`);
        // Deleting from a table the programme has not got is nothing to do (and must not create the table).
        if (op.op === 'delete' && !tableColumns(this.db, op.table)) return;
        const set = op.set ?? {};
        for (const c of Object.keys(set)) if (!IDENT.test(c) || c === 'ip_programme_id') throw new HttpError(400, `Not a column: ${c}`);
        const columns = this.ensureP6Table(op.table, [column, ...Object.keys(set), ...Object.keys(op.match ?? {})]);
        if (!columns.includes(column)) throw new HttpError(400, `Not an id column: ${column}`);
        const match = op.match ? Object.entries(op.match) : null;
        for (const [c] of match ?? []) if (!IDENT.test(c) || c === 'ip_programme_id') throw new HttpError(400, `Not a column: ${c}`);
        // The row is found by the match columns when given, else by the key.
        const where = match ? match.map(([c]) => `${q(c)} = ?`).join(' AND ') : `${q(column)} = ?`;
        const whereArgs = match ? match.map(([, v]) => v) : [op.key.value];
        if (op.op === 'delete') {
          if (!match && op.key.value === null) throw new HttpError(400, 'A delete needs the id of the row.');
          this.db.prepare(`DELETE FROM ${q(op.table)} WHERE ip_programme_id = ? AND ${where}`).run(id, ...whereArgs);
          return;
        }
        const keys = Object.keys(set);
        const exists = this.db.prepare(`SELECT ${q(column)} AS k FROM ${q(op.table)} WHERE ip_programme_id = ? AND ${where}`).get(id, ...whereArgs);
        if (exists) {
          if (keys.length) this.db.prepare(`UPDATE ${q(op.table)} SET ${keys.map((c) => `${q(c)} = ?`).join(', ')} WHERE ip_programme_id = ? AND ${where}`).run(...keys.map((c) => bindValue(c, set[c] ?? null)), id, ...whereArgs);
          return;
        }
        let value = op.key.value;
        if (value === null) {
          const k = `${op.table}.${column}`;
          if (!next.has(k)) next.set(k, Number((this.db.prepare(`SELECT COALESCE(MAX(${q(column)}), 0) AS m FROM ${q(op.table)} WHERE ip_programme_id = ?`).get(id) as { m: number }).m) + 1);
          value = next.get(k)!;
          next.set(k, value + 1);
          assigned[i] = value;
        }
        const extra = match ? match.filter(([c]) => c !== column && !keys.includes(c)) : [];
        const names = [column, ...extra.map(([c]) => c), ...keys];
        this.db.prepare(`INSERT INTO ${q(op.table)} (ip_programme_id${names.map((c) => `, ${q(c)}`).join('')}) VALUES (?${', ?'.repeat(names.length)})`)
          .run(id, value, ...extra.map(([c, v]) => bindValue(c, v)), ...keys.map((c) => bindValue(c, set[c] ?? null)));
      });
      this.db.prepare('UPDATE ip_programme SET activity_count = (SELECT COUNT(*) FROM TASK WHERE ip_programme_id = ?) WHERE id = ?').run(id, id);
    });
    return { applied: ops.length, assigned };
  }

  // ---- scenarios ----

  listScenarios(): { name: string; models: { stem: string; saved: number; generated: number | null; rules: number; joins: number }[] }[] {
    const rows = this.db
      .prepare(
        `SELECT s.name, m.stem, m.saved_at,
           (SELECT MAX(p.imported_at) FROM ip_programme p WHERE p.kind = 'scenario' AND p.scenario = m.scenario AND p.stem = m.stem) AS generated
         FROM ip_scenario s LEFT JOIN ip_scenario_model m ON m.scenario = s.name
         WHERE s.name NOT LIKE '\\_%' ESCAPE '\\'
         ORDER BY s.name, m.stem`,
      )
      .all() as { name: string; stem: string | null; saved_at: string | null; generated: string | null }[];
    // How many rules each saved scenario holds (and how many objects are joined), for the scenario list.
    const ruleCounts = new Map<string, { rules: number; joins: number }>();
    for (const r of this.db.prepare('SELECT scenario, stem, rules_json FROM ip_scenario_rules').all() as { scenario: string; stem: string; rules_json: string }[]) {
      const rules = normalizeRules(parseJson(r.rules_json, undefined));
      ruleCounts.set(`${r.scenario}|${r.stem}`, { rules: totalRules(rules), joins: (rules.joins ?? []).length });
    }
    const out = new Map<string, { name: string; models: { stem: string; saved: number; generated: number | null; rules: number; joins: number }[] }>();
    for (const r of rows) {
      const s = out.get(r.name) ?? { name: r.name, models: [] };
      out.set(r.name, s);
      if (r.stem) s.models.push({ stem: r.stem, saved: Date.parse(r.saved_at ?? '') || 0, generated: r.generated ? Date.parse(r.generated) : null, rules: ruleCounts.get(`${r.name}|${r.stem}`)?.rules ?? 0, joins: ruleCounts.get(`${r.name}|${r.stem}`)?.joins ?? 0 });
    }
    // Scenario programmes with no saved order yet (loaded from a file or
    // another project): listed too, so they open as scenarios (saved = 0).
    const orphans = this.db
      .prepare(
        `SELECT p.scenario, p.stem, MAX(p.imported_at) AS generated FROM ip_programme p
         WHERE p.kind = 'scenario' AND p.scenario IS NOT NULL AND p.stem IS NOT NULL AND p.scenario NOT LIKE '\\_%' ESCAPE '\\'
         GROUP BY p.scenario, p.stem`,
      )
      .all() as { scenario: string; stem: string; generated: string | null }[];
    for (const o of orphans) {
      const s = out.get(o.scenario) ?? { name: o.scenario, models: [] };
      out.set(o.scenario, s);
      if (!s.models.some((m) => m.stem === o.stem)) s.models.push({ stem: o.stem, saved: 0, generated: o.generated ? Date.parse(o.generated) : null, rules: 0, joins: 0 });
    }
    return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Deletes a scenario: its order, links, crews and flags (by cascade) and
      the programmes generated from it. */
  deleteScenario(name: string) {
    this.tx(() => {
      const programmes = this.db.prepare("SELECT id FROM ip_programme WHERE kind = 'scenario' AND scenario = ?").all(name) as { id: number }[];
      for (const p of programmes) this.deleteProgrammeRows(Number(p.id));
      this.db.prepare('DELETE FROM ip_scenario WHERE name = ?').run(name);
    });
  }

  readScenario(scenario: string, stem: string): ScenarioContent | null {
    // A scenario made on "<model>" also opens on its "<model>_FIXED" edit, and the other way round.
    const base = stem.replace(/_FIXED$/i, '');
    const found = [stem, base, `${base}_FIXED`].find((s) => this.db.prepare('SELECT 1 FROM ip_scenario_model WHERE scenario = ? AND stem = ?').get(scenario, s));
    if (found === undefined) return null;
    const args = [scenario, found];
    const steps = this.db.prepare('SELECT guid, step, phase FROM ip_scenario_step WHERE scenario = ? AND stem = ? ORDER BY step, guid').all(...args) as { guid: string; step: number; phase: string | null }[];
    const links = this.db
      .prepare('SELECT pred_task_code, succ_task_code, rel_type, lag_hours FROM ip_scenario_link WHERE scenario = ? AND stem = ? ORDER BY id')
      .all(...args) as { pred_task_code: string; succ_task_code: string; rel_type: string; lag_hours: number }[];
    const crews = this.db.prepare('SELECT phase, pour_type, trade, crew FROM ip_scenario_crew WHERE scenario = ? AND stem = ? ORDER BY id').all(...args) as {
      phase: string;
      pour_type: string;
      trade: string;
      crew: number;
    }[];
    const flags = this.db.prepare('SELECT key, state FROM ip_scenario_flag WHERE scenario = ? AND stem = ? ORDER BY key').all(...args) as { key: string; state: 'flag' | 'done' }[];
    const extras = this.db.prepare('SELECT task_code, name, duration_days, baseline_start, baseline_finish FROM ip_scenario_extra WHERE scenario = ? AND stem = ? ORDER BY id').all(...args) as {
      task_code: string;
      name: string;
      duration_days: number;
      baseline_start: string;
      baseline_finish: string;
    }[];
    const ruleRow = this.db.prepare('SELECT rules_json FROM ip_scenario_rules WHERE scenario = ? AND stem = ?').get(...args) as { rules_json: string } | undefined;
    return {
      rules: ruleRow ? parseJson(ruleRow.rules_json, undefined) : undefined,
      extras: extras.map((e) => ({ TaskID: e.task_code, Name: e.name, DurationDays: Number(e.duration_days) || 0, BaselineStart: e.baseline_start, BaselineFinish: e.baseline_finish })),
      flags: flags.map((f) => ({ Key: f.key, State: f.state })),
      sequence: steps.map((s) => ({ GUID: s.guid, Index: Math.trunc(Number(s.step)), Phase: s.phase ?? '' })),
      relations: links.map((l) => ({ ActivityID1: l.pred_task_code, ActivityID2: l.succ_task_code, Relation: l.rel_type, Lag: Number(l.lag_hours) || 0 })),
      crews: crews.map((c) => ({ Phase: c.phase, PourType: c.pour_type ?? '', Trade: c.trade, Crew: String(c.crew) })),
    };
  }

  writeScenario(scenario: string, stem: string, content: ScenarioContent, savedAt = now()) {
    this.tx(() => {
      const args = [scenario, stem];
      this.db.prepare('INSERT OR IGNORE INTO ip_scenario (name) VALUES (?)').run(scenario);
      this.db
        .prepare('INSERT INTO ip_scenario_model (scenario, stem, saved_at) VALUES (?, ?, ?) ON CONFLICT (scenario, stem) DO UPDATE SET saved_at = excluded.saved_at')
        .run(scenario, stem, savedAt);
      for (const t of ['ip_scenario_step', 'ip_scenario_link', 'ip_scenario_crew', 'ip_scenario_flag', 'ip_scenario_extra', 'ip_scenario_rules']) this.db.prepare(`DELETE FROM ${t} WHERE scenario = ? AND stem = ?`).run(...args);
      const step = this.db.prepare('INSERT OR REPLACE INTO ip_scenario_step (scenario, stem, guid, step, phase) VALUES (?, ?, ?, ?, ?)');
      for (const s of content.sequence) step.run(scenario, stem, s.GUID, Math.trunc(s.Index), s.Phase || null);
      const link = this.db.prepare('INSERT INTO ip_scenario_link (scenario, stem, pred_task_code, succ_task_code, rel_type, lag_hours) VALUES (?, ?, ?, ?, ?, ?)');
      for (const r of content.relations) {
        const a = String(r.ActivityID1 ?? '').trim();
        const b = String(r.ActivityID2 ?? '').trim();
        if (!a || !b) continue;
        const type = String(r.Relation ?? 'FS').trim().toUpperCase();
        link.run(scenario, stem, a, b, ['FS', 'SS', 'FF', 'SF'].includes(type) ? type : 'FS', Number(r.Lag) || 0);
      }
      const flag = this.db.prepare('INSERT OR REPLACE INTO ip_scenario_flag (scenario, stem, key, state) VALUES (?, ?, ?, ?)');
      for (const f of content.flags ?? []) if (f.Key && (f.State === 'flag' || f.State === 'done')) flag.run(scenario, stem, f.Key, f.State);
      const extra = this.db.prepare('INSERT INTO ip_scenario_extra (scenario, stem, task_code, name, duration_days, baseline_start, baseline_finish) VALUES (?, ?, ?, ?, ?, ?, ?)');
      const seen = new Set<string>();
      for (const e of content.extras ?? []) {
        const code = String(e.TaskID ?? '').trim();
        if (!code || seen.has(code.toUpperCase())) continue;
        seen.add(code.toUpperCase());
        const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '').trim()) ? String(v).trim() : '');
        extra.run(scenario, stem, code, String(e.Name ?? '').trim(), Math.max(0, Number(e.DurationDays) || 0), day(e.BaselineStart), day(e.BaselineFinish));
      }
      if (content.rules && Object.keys(content.rules).length) {
        this.db.prepare('INSERT INTO ip_scenario_rules (scenario, stem, rules_json) VALUES (?, ?, ?)').run(scenario, stem, JSON.stringify(content.rules));
      }
      const crew = this.db.prepare('INSERT INTO ip_scenario_crew (scenario, stem, phase, pour_type, trade, crew) VALUES (?, ?, ?, ?, ?, ?)');
      for (const c of content.crews) {
        const phase = String(c.Phase ?? '').trim();
        const trade = String(c.Trade ?? '').trim().toUpperCase();
        const n = Number(c.Crew);
        if (!phase || !trade || !Number.isFinite(n) || n < 0) continue;
        crew.run(scenario, stem, phase, String(c.PourType ?? '').trim(), trade, n);
      }
    });
  }

  // ---- link groups, trade capacities, settings ----

  linkGroups(): unknown[] {
    const rows = this.db.prepare('SELECT * FROM ip_link_group ORDER BY sort_order, rowid').all() as Record<string, unknown>[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ''),
      color: String(r.color ?? '#888888'),
      taskFilters: parseJson(r.task_filters, []),
      objectFilters: parseJson(r.object_filters, []),
      matchRules: parseJson(r.match_rules, []),
      appearanceProfileId: r.appearance_profile_id === null || r.appearance_profile_id === undefined ? null : String(r.appearance_profile_id),
      tagId: r.tag_id === null || r.tag_id === undefined ? null : String(r.tag_id),
    }));
  }

  writeLinkGroups(groups: Record<string, unknown>[]) {
    this.tx(() => {
      this.db.exec('DELETE FROM ip_link_group');
      const stmt = this.db.prepare(
        'INSERT OR REPLACE INTO ip_link_group (id, sort_order, name, color, appearance_profile_id, tag_id, task_filters, object_filters, match_rules) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      groups.forEach((g, i) =>
        stmt.run(
          String(g.id),
          i,
          String(g.name ?? ''),
          g.color === undefined ? null : String(g.color),
          (g.appearanceProfileId as string | null | undefined) ?? null,
          (g.tagId as string | null | undefined) ?? null,
          JSON.stringify(g.taskFilters ?? []),
          JSON.stringify(g.objectFilters ?? []),
          JSON.stringify(g.matchRules ?? []),
        ),
      );
    });
  }

  capacities(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.db.prepare('SELECT trade, capacity FROM ip_trade_capacity').all() as { trade: string; capacity: number }[]) out[r.trade] = Number(r.capacity);
    return out;
  }

  writeCapacities(capacities: Record<string, unknown>) {
    this.tx(() => {
      this.db.exec('DELETE FROM ip_trade_capacity');
      const stmt = this.db.prepare('INSERT INTO ip_trade_capacity (trade, capacity) VALUES (?, ?)');
      for (const [trade, v] of Object.entries(capacities)) {
        const n = Number(v);
        if (trade && Number.isFinite(n) && n > 0) stmt.run(trade, n);
      }
    });
  }

  settings(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const r of this.db.prepare('SELECT key, value FROM ip_setting').all() as { key: string; value: string }[]) out[r.key] = parseJson(r.value, r.value);
    return out;
  }

  writeSetting(key: string, value: unknown) {
    this.tx(() => {
      if (value === null || value === undefined) this.db.prepare('DELETE FROM ip_setting WHERE key = ?').run(key);
      else this.db.prepare('INSERT INTO ip_setting (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
    });
  }

  /** The stored clash runs among these keys (the others are not stored). */
  clashRuns(keys: string[]): { key: string; pairs: ClashPair[] }[] {
    const run = this.db.prepare('SELECT key FROM ip_clash_run WHERE key = ?');
    const pairs = this.db.prepare('SELECT a_guid, b_guid, distance, overlap, position FROM ip_clash_pair WHERE run_key = ?');
    const out: { key: string; pairs: ClashPair[] }[] = [];
    for (const key of keys) {
      if (!run.get(key)) continue;
      const rows = pairs.all(key) as { a_guid: string; b_guid: string; distance: number; overlap: number; position: string }[];
      out.push({ key, pairs: rows.map((r) => [r.a_guid, r.b_guid, Number(r.distance), !!r.overlap, r.position]) });
    }
    return out;
  }

  /** Stores a clash run, replacing the scope's earlier ones. */
  writeClashRun(key: string, scope: string, pairs: ClashPair[]) {
    this.tx(() => {
      for (const r of this.db.prepare('SELECT key FROM ip_clash_run WHERE scope = ? OR key = ?').all(scope, key) as { key: string }[]) {
        this.db.prepare('DELETE FROM ip_clash_pair WHERE run_key = ?').run(r.key);
        this.db.prepare('DELETE FROM ip_clash_run WHERE key = ?').run(r.key);
      }
      this.db.prepare('INSERT INTO ip_clash_run (key, scope, pair_count) VALUES (?, ?, ?)').run(key, scope, pairs.length);
      const stmt = this.db.prepare('INSERT INTO ip_clash_pair (run_key, a_guid, b_guid, distance, overlap, position) VALUES (?, ?, ?, ?, ?, ?)');
      for (const [a, b, distance, overlap, position] of pairs) stmt.run(key, String(a), String(b), Number(distance) || 0, overlap ? 1 : 0, String(position));
    });
  }
}

function locked(e: unknown): unknown {
  const msg = e instanceof Error ? e.message : String(e);
  if (/database is locked|SQLITE_BUSY/i.test(msg)) {
    return new HttpError(409, 'The project database is locked by another program — in DB Browser for SQLite, Write Changes (or Revert Changes) to release it, then try again.');
  }
  return e;
}

