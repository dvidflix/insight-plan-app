import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { HttpError, readBody, send, sendError } from './http';
import { WIKI_DIR } from './wiki';

/** Dev-server bridge to SeaTable (the local Docker instance in C:\insight-stack): the model
    elements go into its "Elements" table, and the columns its users add come back as custom
    fields. The browser never talks to SeaTable (no CORS, no token in the page).

    Settings: SEATABLE_ENV_FILE (default C:\insight-stack\seatable\.env) supplies
    SEATABLE_SERVER_PROTOCOL / SEATABLE_SERVER_HOSTNAME and SEATABLE_RATES_API_TOKEN, the API token
    of the "Insight Plan Rates" base. Only runs under `npm run dev`.

    The file details live in the Files base (SEATABLE_FILES_API_TOKEN): one row per model, programme or
    site mesh of the Inputs page, with the details its users fill in; the Inputs page reads them back.

    Columns of the Elements table:
      GUID, Model, IFC class, Name, Last pushed, Removed   managed by the push
      "Pset.Property" (a name with a dot)                  managed: one per pushed model property
      anything else                                        the user's: pulled as custom fields */

const ENV_FILE = process.env.SEATABLE_ENV_FILE ?? 'C:\\insight-stack\\seatable\\.env';
const TABLE = 'Elements';
const FIXED = ['GUID', 'Model', 'IFC class', 'Name', 'Last pushed', 'Removed'];
/** Column types whose value is not a plain value to bring back. */
const SKIP_TYPES = new Set(['image', 'file', 'button', 'digital-sign', 'geolocation', 'ctime', 'mtime', 'creator', 'last-modifier']);

interface GatewayAccess {
  gw: string;
  headers: Record<string, string>;
  base: string;
  at: number;
}

function readEnv(): Record<string, string> {
  let text: string;
  try {
    text = fs.readFileSync(ENV_FILE, 'utf8');
  } catch {
    throw new HttpError(503, `SeaTable settings not found: ${ENV_FILE}. Set SEATABLE_ENV_FILE to the seatable .env file.`);
  }
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !line.trimStart().startsWith('#')) out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/** Which SeaTable base: "main" (SEATABLE_RATES_API_TOKEN: the rates and the model Elements) or "files"
    (SEATABLE_FILES_API_TOKEN: the Files base with the file details; falls back to the main one). */
type BaseKind = 'main' | 'files';
const cache = new Map<BaseKind, GatewayAccess>();

async function access(kind: BaseKind = 'main', force = false): Promise<GatewayAccess> {
  const cached = cache.get(kind);
  if (cached && !force && Date.now() - cached.at < 6 * 3600_000) return cached;
  const env = readEnv();
  const key = kind === 'files' && env.SEATABLE_FILES_API_TOKEN ? 'SEATABLE_FILES_API_TOKEN' : 'SEATABLE_RATES_API_TOKEN';
  const token = env[key];
  if (!token) throw new HttpError(503, `${key} is missing from ${ENV_FILE}.`);
  const root = `${env.SEATABLE_SERVER_PROTOCOL || 'http'}://${env.SEATABLE_SERVER_HOSTNAME || 'localhost'}`;
  let r: Response;
  try {
    r = await fetch(`${root}/api/v2.1/dtable/app-access-token/`, { headers: { Authorization: `Token ${token}` } });
  } catch (e) {
    throw new HttpError(503, `SeaTable is not reachable at ${root}: is its Docker stack running? (${e instanceof Error ? e.message : e})`);
  }
  if (!r.ok) throw new HttpError(503, `SeaTable refused the API token ${key} in ${ENV_FILE} (${r.status}${r.status === 404 ? ': no such token — it was probably regenerated or revoked, or the base was recreated. Make a new API token for that base in SeaTable (the base menu, API tokens) and paste it into the .env file' : ''}).`);
  const a = (await r.json()) as { access_token: string; dtable_uuid: string; dtable_server: string };
  const got: GatewayAccess = { gw: `${a.dtable_server}api/v2/dtables/${a.dtable_uuid}`, headers: { Authorization: `Bearer ${a.access_token}`, 'Content-Type': 'application/json' }, base: root, at: Date.now() };
  cache.set(kind, got);
  return got;
}

async function call(method: string, path: string, opts: { query?: Record<string, string | number>; json?: unknown; base?: BaseKind } = {}): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const a = await access(opts.base ?? 'main', attempt > 0);
    const qs = opts.query ? `?${new URLSearchParams(Object.entries(opts.query).map(([k, v]): [string, string] => [k, String(v)]))}` : '';
    const r = await fetch(`${a.gw}${path}${qs}`, { method, headers: a.headers, body: opts.json === undefined ? undefined : JSON.stringify(opts.json) });
    if (r.status === 401 && attempt === 0) continue; // the access token expired: ask for a new one
    const text = await r.text();
    if (!r.ok) throw new HttpError(502, `SeaTable ${method} ${path}: ${r.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  }
  throw new HttpError(502, `SeaTable ${method} ${path}: no access.`);
}

interface Col {
  name: string;
  type: string;
}

async function tableInfo(table = TABLE, base: BaseKind = 'main'): Promise<{ exists: boolean; columns: Col[] }> {
  const meta = await call('GET', '/metadata/', { base });
  const t = (meta.metadata?.tables ?? []).find((x: any) => x.name === table);
  return { exists: !!t, columns: t ? t.columns.map((c: any) => ({ name: c.name, type: c.type })) : [] };
}

async function allRows(table = TABLE, base: BaseKind = 'main'): Promise<any[]> {
  const out: any[] = [];
  for (let start = 0; ; start += 1000) {
    const { rows } = await call('GET', '/rows/', { query: { table_name: table, convert_keys: 'true', limit: 1000, start }, base });
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}

async function ensureTable(): Promise<Col[]> {
  const info = await tableInfo();
  if (info.exists) return info.columns;
  await call('POST', '/tables/', {
    json: {
      table_name: TABLE,
      columns: [
        { column_name: 'GUID', column_type: 'text' },
        { column_name: 'Model', column_type: 'text' },
        { column_name: 'IFC class', column_type: 'text' },
        { column_name: 'Name', column_type: 'text' },
        { column_name: 'Last pushed', column_type: 'text' },
        { column_name: 'Removed', column_type: 'checkbox' },
      ],
    },
  });
  return (await tableInfo()).columns;
}

// ---- push sessions: the rows of the table are read once, then chunks are upserted ----

interface PushSession {
  existing: Map<string, { id: string; model: string }>;
  numeric: Set<string>;
  properties: string[];
  seen: Set<string>;
  models: Set<string>;
  pushedAt: string;
}
const sessions = new Map<string, PushSession>();

const clean = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'number' || typeof v === 'string' ? v : String(v));

function normalize(v: unknown): string | number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    const parts = v.map((x) => (x && typeof x === 'object' ? (x as any).display_value ?? (x as any).name ?? (x as any).value ?? '' : x)).filter((x) => x !== '' && x !== null && x !== undefined);
    return parts.length ? parts.join(', ') : null;
  }
  if (typeof v === 'object') {
    const o = v as any;
    const s = o.display_value ?? o.name ?? o.value;
    return s === undefined || s === null || s === '' ? null : String(s);
  }
  return String(v);
}


// ---- the "Models metadata" table: one row per pour, matched to the model elements by the client ----
//   Pour ID (text) and Buildings (multiple select of Unit + Building, e.g. "1HDAB") are the key: an element
//   with the same HPC Pour ID and the Unit + Building of one of them gets the row's other columns as custom fields.
//   The table is in the Files base (or the main one).
const POURS_TABLE = 'Models metadata';
const POURS_KEY_COLUMNS = ['Name', 'Pour ID', 'Buildings'];

async function pullPours(): Promise<{ columns: { name: string; type: string }[]; rows: { pourId: string; buildings: string[]; values: Record<string, string | number> }[] }> {
  for (const base of ['files', 'main'] as BaseKind[]) {
    let info: { exists: boolean; columns: Col[] };
    try {
      info = await tableInfo(POURS_TABLE, base);
    } catch {
      continue;
    }
    if (!info.exists) continue;
    const columns = info.columns.filter((c) => !POURS_KEY_COLUMNS.includes(c.name) && !c.name.startsWith('_') && !SKIP_TYPES.has(c.type));
    const rows: { pourId: string; buildings: string[]; values: Record<string, string | number> }[] = [];
    for (const r of await allRows(POURS_TABLE, base)) {
      const pourId = normalize(r['Pour ID']);
      if (pourId === null) continue;
      const values: Record<string, string | number> = {};
      for (const c of columns) {
        const v = normalize(r[c.name]);
        if (v !== null) values[c.name] = v;
      }
      rows.push({ pourId: String(pourId).trim(), buildings: normalizeList(r.Buildings).map((b) => b.trim()), values });
    }
    return { columns, rows };
  }
  return { columns: [], rows: [] };
}

// ---- the file details table (in the Files base) ----
//   Managed by the app's push: Name (the key), Type, Format, Items, Size (MB), Bounds, Last pushed.
//   The user's columns (Discipline, Building (several allowed), Status, Revision, Notes, any others
//   added in SeaTable) are read back by the Inputs page.
//   The table is "Insight Plan Files", or "Files" when that is the one the base has; else it is made.
const FILES_TABLES = ['Insight Plan Files', 'Files'];
const FILES_MANAGED = ['Name', 'Type', 'Format', 'Items', 'Size (MB)', 'Bounds', 'Last pushed'];
const MANAGED_COLUMNS: { name: string; type: string }[] = [
  { name: 'Type', type: 'text' },
  { name: 'Format', type: 'text' },
  { name: 'Items', type: 'number' },
  { name: 'Size (MB)', type: 'number' },
  { name: 'Bounds', type: 'text' },
  { name: 'Last pushed', type: 'text' },
];
const PALETTE = ['#EAA775', '#FFD966', '#B8E986', '#9FD8DF', '#B4A7D6', '#F4B6C2', '#C9D1D9', '#A4C2F4'];
/** Select-column options (SeaTable wants an id on each: four random hex digits). */
const optionsOf = (names: string[], from = 0) => {
  const used = new Set<string>();
  return names.map((name, i) => {
    let id: string;
    do id = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
    while (used.has(id));
    used.add(id);
    return { id, name, color: PALETTE[(from + i) % PALETTE.length], textColor: '#212529' };
  });
};
const USER_COLUMNS: { name: string; type: string; options?: string[] }[] = [
  { name: 'Discipline', type: 'single-select', options: ['Architecture', 'Structure', 'MEP', 'Civil', 'Landscape', 'Other'] },
  { name: 'Building', type: 'multiple-select', options: [] },
  { name: 'Status', type: 'single-select', options: ['WIP', 'Shared', 'Published', 'Archived'] },
  { name: 'Revision', type: 'text' },
  { name: 'Notes', type: 'long-text' },
];

interface FilePush {
  name: string;
  type: string;
  format: string;
  items: number | null;
  sizeMb: number | null;
  bounds: string;
  /** Details typed in the app before: used only for rows that are new in SeaTable. */
  details?: Record<string, string[]>;
}

let filesTable: string | null = null;

/** The table that holds the file details: "Insight Plan Files", else "Files", else a new "Insight Plan Files". */
async function resolveFilesTable(): Promise<{ name: string; exists: boolean }> {
  const meta = await call('GET', '/metadata/', { base: 'files' });
  const names: string[] = (meta.metadata?.tables ?? []).map((t: any) => t.name);
  const found = FILES_TABLES.find((n) => names.includes(n));
  filesTable = found ?? FILES_TABLES[0];
  return { name: filesTable, exists: !!found };
}

async function ensureFilesTable(buildings: string[]): Promise<string> {
  const { name, exists } = await resolveFilesTable();
  if (!exists) {
    await call('POST', '/tables/', {
      base: 'files',
      json: { table_name: name, columns: [{ column_name: 'Name', column_type: 'text' }, ...MANAGED_COLUMNS.map((c) => ({ column_name: c.name, column_type: c.type }))] },
    });
  }
  const have = new Set((await tableInfo(name, 'files')).columns.map((c) => c.name));
  for (const c of MANAGED_COLUMNS) {
    if (!have.has(c.name)) await call('POST', '/columns/', { base: 'files', json: { table_name: name, column_name: c.name, column_type: c.type } });
  }
  for (const c of USER_COLUMNS) {
    if (have.has(c.name)) continue;
    const options = c.name === 'Building' ? buildings : c.options;
    await call('POST', '/columns/', {
      base: 'files',
      json: { table_name: name, column_name: c.name, column_type: c.type, ...(options ? { column_data: { options: optionsOf(options) } } : {}) },
    });
  }
  return name;
}

/** Adds option names a select column does not have yet. */
async function ensureOptions(table: string, column: string, wanted: string[]): Promise<boolean> {
  if (!wanted.length) return false;
  const meta = await call('GET', '/metadata/', { base: 'files' });
  const t = (meta.metadata?.tables ?? []).find((x: any) => x.name === table);
  const col = t?.columns.find((c: any) => c.name === column);
  if (!col || !/select/.test(col.type)) return false;
  const options: { id?: string; name: string; color: string; textColor: string }[] = col.data?.options ?? [];
  const known = new Set(options.map((o) => o.name));
  const add = wanted.filter((w) => !known.has(w));
  if (!add.length) return false;
  await call('PUT', '/columns/', {
    base: 'files',
    json: { table_name: table, column, op_type: 'modify_column_type', new_column_type: col.type, column_data: { options: [...options, ...optionsOf(add, options.length)] } },
  });
  return true;
}

function normalizeList(v: unknown): string[] {
  if (v === null || v === undefined || v === '') return [];
  if (Array.isArray(v)) return v.flatMap((x) => normalizeList(x));
  if (typeof v === 'object') {
    const o = v as any;
    const s = o.display_value ?? o.name ?? o.value;
    return s === undefined || s === null || s === '' ? [] : [String(s)];
  }
  if (typeof v === 'boolean') return [v ? 'Yes' : 'No'];
  return [String(v)];
}

async function pushFiles(list: FilePush[]) {
  const buildings = [...new Set(list.flatMap((f) => f.details?.Building ?? []))];
  const table = await ensureFilesTable(buildings);
  let changed = await ensureOptions(table, 'Building', buildings);
  for (const col of ['Discipline', 'Status']) changed = (await ensureOptions(table, col, [...new Set(list.flatMap((f) => f.details?.[col] ?? []))])) || changed;
  // SeaTable takes a moment before rows may use an option that was just added.
  if (changed) await new Promise((resolve) => setTimeout(resolve, 1500));
  const existing = new Map<string, string>();
  for (const r of await allRows(table, 'files')) if (r.Name) existing.set(String(r.Name), r._id);
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const appends: Record<string, unknown>[] = [];
  const updates: { row_id: string; row: Record<string, unknown> }[] = [];
  const userCols = new Set(USER_COLUMNS.map((c) => c.name));
  for (const f of list) {
    const managed: Record<string, unknown> = { Name: f.name, Type: f.type, Format: f.format, Bounds: f.bounds, 'Last pushed': when };
    if (f.items !== null) managed.Items = f.items;
    if (f.sizeMb !== null) managed['Size (MB)'] = f.sizeMb;
    const id = existing.get(f.name);
    if (id) {
      updates.push({ row_id: id, row: managed });
      continue;
    }
    const row = { ...managed };
    for (const [field, values] of Object.entries(f.details ?? {})) {
      if (!userCols.has(field) || values.length === 0) continue;
      row[field] = field === 'Building' ? values : values.join(', ');
    }
    appends.push(row);
  }
  for (let i = 0; i < appends.length; i += 200) await call('POST', '/rows/', { base: 'files', json: { table_name: table, rows: appends.slice(i, i + 200) } });
  for (let i = 0; i < updates.length; i += 200) await call('PUT', '/rows/', { base: 'files', json: { table_name: table, updates: updates.slice(i, i + 200) } });
  return { added: appends.length, updated: updates.length, table };
}

/** The user's columns of the files table, for every file: field -> list of values (a file can have several buildings). */
async function pullFiles() {
  const { name: table, exists } = await resolveFilesTable();
  if (!exists) return { fields: [] as { name: string; type: string }[], files: [] as { name: string; values: Record<string, string[]> }[], note: `The files table does not exist yet in the Files base: push the files first.` };
  const info = await tableInfo(table, 'files');
  const fields = info.columns.filter((c) => !FILES_MANAGED.includes(c.name) && !c.name.startsWith('_') && !SKIP_TYPES.has(c.type));
  const out: { name: string; values: Record<string, string[]> }[] = [];
  for (const r of await allRows(table, 'files')) {
    if (!r.Name) continue;
    const values: Record<string, string[]> = {};
    for (const f of fields) {
      const values_ = normalizeList(r[f.name]);
      if (values_.length) values[f.name] = values_;
    }
    out.push({ name: String(r.Name), values });
  }
  return { fields, files: out, table };
}

// ---- retired and extra activities (tables "Retired", "Extra activities" and "Baselines" of the Files base) ----
//   Retired           Task ID (the key), Task name, Reason, Retired on   pushed from the app: generated tasks that stay out of the Gantt
//   Baselines         Name, Start, Finish, Notes                         the user's: named baselines with dates
//   Extra activities  Task ID, Task name, Duration (days), Baseline (a link to Baselines), Predecessors, Successors, WBS, Notes
//                                                                        the user's: activities added to every generated programme
//   Pull writes them to a local JSON file (ADJUSTMENTS_FILE), which the scenario generator reads, so it works with SeaTable
//   switched off (like rates.json).
const RETIRED = 'Retired';
const BASELINES = 'Baselines';
const EXTRAS = 'Extra activities';
const ADJUSTMENTS_FILE = process.env.INSIGHT_ADJUSTMENTS_FILE ?? 'C:\\insight-stack\\data\\adjustments.json';
const RETIRED_COLUMNS = [
  { name: 'Task name', type: 'text' },
  { name: 'Reason', type: 'text' },
  { name: 'Retired on', type: 'text' },
];

/** These three tables live in the Files base (SEATABLE_FILES_API_TOKEN). */
const ADJ_BASE: BaseKind = 'files';

async function tableNames(): Promise<string[]> {
  const meta = await call('GET', '/metadata/', { base: ADJ_BASE });
  return (meta.metadata?.tables ?? []).map((t: any) => t.name);
}

/** A date cell as YYYY-MM-DD ('' when empty). */
const dateOf = (v: unknown): string => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? ''));
  return m ? m[1] : '';
};

const textOf = (v: unknown): string => {
  const n = normalize(v);
  return n === null ? '' : String(n);
};

/** Task IDs written in one cell: separated by commas, semicolons, spaces or new lines. */
const idsOf = (v: unknown): string[] => textOf(v).split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

async function ensureRetiredTable(): Promise<void> {
  if ((await tableNames()).includes(RETIRED)) return;
  await call('POST', '/tables/', {
    base: ADJ_BASE,
    json: { table_name: RETIRED, columns: [{ column_name: 'Task ID', column_type: 'text' }, ...RETIRED_COLUMNS.map((c) => ({ column_name: c.name, column_type: c.type }))] },
  });
}

async function pushRetired(list: { taskId: string; name?: string; reason?: string }[]) {
  await ensureRetiredTable();
  const have = new Set<string>();
  for (const r of await allRows(RETIRED, ADJ_BASE)) if (r['Task ID']) have.add(String(r['Task ID']).trim());
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const rows: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const t of list) {
    const id = String(t.taskId ?? '').trim();
    if (!id) continue;
    if (have.has(id)) {
      skipped++;
      continue;
    }
    have.add(id);
    rows.push({ 'Task ID': id, 'Task name': t.name ?? '', Reason: t.reason ?? '', 'Retired on': when });
  }
  for (let i = 0; i < rows.length; i += 200) await call('POST', '/rows/', { base: ADJ_BASE, json: { table_name: RETIRED, rows: rows.slice(i, i + 200) } });
  return { added: rows.length, skipped };
}

// ---- assumptions (table "Assumptions" of the Files base) ----
//   The Wiki is the source: the tables of docs/wiki/assumptions/*.md whose header starts with "Ref" (ASM-nnn). A push
//   copies them into SeaTable, keyed by Ref: rows are updated or added, never deleted. SeaTable's own edits do not come back.
const ASSUMPTIONS = 'Assumptions';
const ASSUMPTION_COLUMNS = ['Page', 'Project', 'Category', 'Item', 'Value', 'Unit', 'Type', 'Source', 'Last pushed'];

function readAssumptions(): Record<string, string>[] {
  const dir = path.join(WIKI_DIR, 'assumptions');
  const out: Record<string, string>[] = [];
  const seen = new Set<string>();
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []) {
    let header: string[] | null = null;
    for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split(/\r?\n/)) {
      if (!line.trim().startsWith('|')) {
        header = null;
        continue;
      }
      const cells = line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      if (cells[0] === 'Ref') {
        header = cells;
        continue;
      }
      if (!header || !/^ASM-\d+$/.test(cells[0])) continue;
      if (seen.has(cells[0])) throw new HttpError(400, `${cells[0]} appears twice (second time in ${file}): every assumption needs its own Ref.`);
      seen.add(cells[0]);
      const row: Record<string, string> = { Page: `assumptions/${file.replace(/\.md$/, '')}` };
      header.forEach((h, i) => (row[h] = cells[i] ?? ''));
      out.push(row);
    }
  }
  return out;
}

async function pushAssumptions() {
  const list = readAssumptions();
  if (list.length === 0) throw new HttpError(400, 'No assumptions found: add tables with a Ref column (ASM-nnn) to docs/wiki/assumptions.');
  if (!(await tableNames()).includes(ASSUMPTIONS)) {
    await call('POST', '/tables/', { base: ADJ_BASE, json: { table_name: ASSUMPTIONS, columns: [{ column_name: 'Ref', column_type: 'text' }, ...ASSUMPTION_COLUMNS.map((c) => ({ column_name: c, column_type: 'text' }))] } });
  }
  const existing = new Map<string, string>();
  for (const r of await allRows(ASSUMPTIONS, ADJ_BASE)) if (r.Ref) existing.set(String(r.Ref).trim(), r._id);
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const appends: Record<string, unknown>[] = [];
  const updates: { row_id: string; row: Record<string, unknown> }[] = [];
  for (const a of list) {
    const row: Record<string, unknown> = { Ref: a.Ref, 'Last pushed': when };
    for (const c of ASSUMPTION_COLUMNS) if (c in a) row[c] = a[c];
    const id = existing.get(a.Ref);
    if (id) updates.push({ row_id: id, row });
    else appends.push(row);
  }
  for (let i = 0; i < appends.length; i += 200) await call('POST', '/rows/', { base: ADJ_BASE, json: { table_name: ASSUMPTIONS, rows: appends.slice(i, i + 200) } });
  for (let i = 0; i < updates.length; i += 200) await call('PUT', '/rows/', { base: ADJ_BASE, json: { table_name: ASSUMPTIONS, updates: updates.slice(i, i + 200) } });
  return { added: appends.length, updated: updates.length };
}

// ---- calculations (table "Calculations" of the Files base) ----
//   The Wiki is the source: each docs/wiki/calculations/<ref>-*.md page (title "# SF-001 Name (n men, n shifts)", then the
//   Inputs, Calculations, Summary tables and optionally a "Programme field" section). A push writes one row per page, keyed by Ref.
const CALCULATIONS = 'Calculations';
const CALCULATION_COLUMNS = ['Title', 'Inputs', 'Calculations', 'Summary', 'Programme field', 'Page', 'Last pushed'];

/** The rows of the first markdown table under a "## heading" (cells trimmed, header and divider left out). */
function sectionTable(md: string, heading: string): string[][] {
  const lines = md.split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (at < 0) return [];
  const rows: string[][] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith('## ')) break;
    if (!line.trim().startsWith('|')) {
      if (rows.length) break;
      continue;
    }
    const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/\*\*/g, ''));
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    rows.push(cells);
  }
  return rows;
}

function readCalculations(): Record<string, string>[] {
  const dir = path.join(WIKI_DIR, 'calculations');
  const out: Record<string, string>[] = [];
  const seen = new Set<string>();
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'index.md').sort() : []) {
    const md = fs.readFileSync(path.join(dir, file), 'utf8');
    const title = /^#\s+(.+)$/m.exec(md)?.[1].trim() ?? '';
    const ref = /^([A-Z]+-\d+)\b/.exec(title)?.[1];
    if (!ref) continue;
    if (seen.has(ref)) throw new HttpError(400, `${ref} appears twice (second time in ${file}): every calculation needs its own Ref.`);
    seen.add(ref);
    const inputs = sectionTable(md, 'Inputs').slice(1).map((r) => `${r[0]}: ${r[1]} ${r[2] ?? ''}`.trim()).join('\n');
    const steps = sectionTable(md, 'Calculations').slice(1).map((r) => `${r[0]}. ${r[1]}: ${r[2]} = ${r[3]}`).join('\n');
    const sum = sectionTable(md, 'Summary');
    const summary = sum.length > 1 ? sum[0].map((h, i) => `${h}: ${sum[1][i] ?? ''}`).join('\n') : '';
    const field = /## Programme field[\s\S]*?```\r?\n([\s\S]*?)```/.exec(md)?.[1].trim() ?? '';
    out.push({ Ref: ref, Title: title.replace(/^[A-Z]+-\d+\s*/, ''), Inputs: inputs, Calculations: steps, Summary: summary, 'Programme field': field, Page: `calculations/${file.replace(/\.md$/, '')}` });
  }
  return out;
}

async function pushCalculations() {
  const list = readCalculations();
  if (list.length === 0) throw new HttpError(400, 'No calculations found in docs/wiki/calculations (pages titled "SF-001 Name…").');
  if (!(await tableNames()).includes(CALCULATIONS)) {
    await call('POST', '/tables/', { base: ADJ_BASE, json: { table_name: CALCULATIONS, columns: [{ column_name: 'Ref', column_type: 'text' }, ...CALCULATION_COLUMNS.map((c) => ({ column_name: c, column_type: 'text' }))] } });
  }
  const existing = new Map<string, string>();
  for (const r of await allRows(CALCULATIONS, ADJ_BASE)) if (r.Ref) existing.set(String(r.Ref).trim(), r._id);
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const appends: Record<string, unknown>[] = [];
  const updates: { row_id: string; row: Record<string, unknown> }[] = [];
  for (const c of list) {
    const row: Record<string, unknown> = { ...c, 'Last pushed': when };
    const id = existing.get(c.Ref);
    if (id) updates.push({ row_id: id, row });
    else appends.push(row);
  }
  for (let i = 0; i < appends.length; i += 200) await call('POST', '/rows/', { base: ADJ_BASE, json: { table_name: CALCULATIONS, rows: appends.slice(i, i + 200) } });
  for (let i = 0; i < updates.length; i += 200) await call('PUT', '/rows/', { base: ADJ_BASE, json: { table_name: CALCULATIONS, updates: updates.slice(i, i + 200) } });
  return { added: appends.length, updated: updates.length };
}

async function adjustmentsStatus() {
  const names = await tableNames();
  const count = async (n: string) => (names.includes(n) ? (await allRows(n, ADJ_BASE)).length : null);
  return { retired: await count(RETIRED), extras: await count(EXTRAS), baselines: await count(BASELINES), file: ADJUSTMENTS_FILE, pulledAt: readAdjustments()?.pulledAt ?? null };
}

function readAdjustments(): { pulledAt?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(ADJUSTMENTS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function pullAdjustments() {
  const names = await tableNames();
  const missing = [RETIRED, EXTRAS, BASELINES].filter((n) => !names.includes(n));

  const retired = names.includes(RETIRED)
    ? (await allRows(RETIRED, ADJ_BASE)).filter((r) => r['Task ID']).map((r) => ({ taskId: String(r['Task ID']).trim(), name: textOf(r['Task name']), reason: textOf(r.Reason) }))
    : [];

  const baselines = names.includes(BASELINES)
    ? (await allRows(BASELINES, ADJ_BASE)).filter((r) => r.Name).map((r) => ({ id: String(r._id), name: textOf(r.Name), start: dateOf(r.Start), finish: dateOf(r.Finish), notes: textOf(r.Notes) }))
    : [];

  const extras = names.includes(EXTRAS)
    ? (await allRows(EXTRAS, ADJ_BASE)).filter((r) => r['Task ID']).map((r) => {
        // The Baseline link column: [{ row_id, display_value }]. Matched by row id, else by name.
        const link = Array.isArray(r.Baseline) ? r.Baseline[0] : r.Baseline;
        const linkId = link && typeof link === 'object' ? String((link as any).row_id ?? '') : '';
        const linkName = link && typeof link === 'object' ? String((link as any).display_value ?? '') : textOf(link);
        const base = baselines.find((b) => (linkId && b.id === linkId) || (linkName && b.name === linkName));
        const days = Number(r['Duration (days)']);
        return {
          taskId: String(r['Task ID']).trim(),
          name: textOf(r['Task name']) || String(r['Task ID']).trim(),
          durationDays: Number.isFinite(days) && days >= 0 ? days : 0,
          baseline: base?.name ?? linkName,
          baselineStart: base?.start ?? '',
          baselineFinish: base?.finish ?? '',
          predecessors: idsOf(r.Predecessors),
          successors: idsOf(r.Successors),
          wbs: textOf(r.WBS),
          notes: textOf(r.Notes),
        };
      })
    : [];

  const out = { pulledAt: new Date().toISOString(), retired, extras, baselines };
  fs.mkdirSync(path.dirname(ADJUSTMENTS_FILE), { recursive: true });
  fs.writeFileSync(ADJUSTMENTS_FILE, JSON.stringify(out, null, 1), 'utf8');
  return { retired: retired.length, extras: extras.length, baselines: baselines.length, missing, file: ADJUSTMENTS_FILE, pulledAt: out.pulledAt };
}

export function seatablePlugin(): Plugin {
  return {
    name: 'insight-plan-seatable',
    configureServer(server) {
      server.middlewares.use('/api/seatable', async (req, res) => {
        try {
          const route = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/^\/+/, '');

          if (req.method === 'GET' && route === 'status') {
            let env: Record<string, string> = {};
            try {
              env = readEnv();
            } catch (e) {
              return send(res, 200, { configured: false, reachable: false, envFile: ENV_FILE, error: e instanceof Error ? e.message : String(e) });
            }
            try {
              const info = await tableInfo();
              const rows = info.exists ? (await call('GET', '/rows/', { query: { table_name: TABLE, limit: 1 } })).rows.length : 0;
              return send(res, 200, { configured: true, reachable: true, envFile: ENV_FILE, address: `${env.SEATABLE_SERVER_PROTOCOL || 'http'}://${env.SEATABLE_SERVER_HOSTNAME || 'localhost'}`, table: info.exists, columns: info.columns.length, hasRows: rows > 0 });
            } catch (e) {
              return send(res, 200, { configured: true, reachable: false, envFile: ENV_FILE, error: e instanceof Error ? e.message : String(e) });
            }
          }

          // ---- push: start -> rows (many) -> finish ----
          if (req.method === 'POST' && route === 'push/start') {
            const { properties } = (await readBody(req)) as { properties: { key: string; numeric: boolean }[] };
            if (!Array.isArray(properties)) throw new HttpError(400, 'No properties given.');
            const columns = await ensureTable();
            const have = new Set(columns.map((c) => c.name));
            const missing = properties.filter((p) => !have.has(p.key));
            // Columns are added a few at a time (one API call each).
            for (let i = 0; i < missing.length; i += 4) {
              await Promise.all(missing.slice(i, i + 4).map((p) => call('POST', '/columns/', { json: { table_name: TABLE, column_name: p.key, column_type: p.numeric ? 'number' : 'text' } })));
            }
            const current = new Map((await tableInfo()).columns.map((c) => [c.name, c.type]));
            const existing = new Map<string, { id: string; model: string }>();
            for (const r of await allRows()) if (r.GUID) existing.set(String(r.GUID), { id: r._id, model: String(r.Model ?? '') });
            const id = Math.random().toString(36).slice(2);
            sessions.set(id, {
              existing,
              numeric: new Set(properties.filter((p) => current.get(p.key) === 'number').map((p) => p.key)),
              properties: properties.map((p) => p.key),
              seen: new Set(),
              models: new Set(),
              pushedAt: new Date().toISOString().slice(0, 16).replace('T', ' '),
            });
            if (sessions.size > 5) sessions.delete(sessions.keys().next().value as string);
            return send(res, 200, { session: id, existingRows: existing.size, addedColumns: missing.length });
          }

          if (req.method === 'POST' && route === 'push/rows') {
            const { session, model, rows } = (await readBody(req)) as { session: string; model: string; rows: { guid: string; class: string; name: string; props: Record<string, unknown> }[] };
            const s = sessions.get(session);
            if (!s) throw new HttpError(410, 'The push session expired: start the push again.');
            const appends: Record<string, unknown>[] = [];
            const updates: { row_id: string; row: Record<string, unknown> }[] = [];
            for (const r of rows) {
              const row: Record<string, unknown> = { GUID: r.guid, Model: model, 'IFC class': r.class, Name: r.name ?? '', 'Last pushed': s.pushedAt, Removed: false };
              const known = s.existing.get(r.guid);
              for (const key of s.properties) {
                const v = r.props[key];
                if (s.numeric.has(key)) {
                  const n = v === undefined || v === '' || v === null ? null : Number(v);
                  if (n !== null && Number.isFinite(n)) row[key] = n;
                  else if (known) row[key] = null;
                } else if (v !== undefined && v !== null && v !== '') row[key] = clean(v);
                else if (known) row[key] = '';
              }
              s.seen.add(r.guid);
              s.models.add(model);
              if (known) updates.push({ row_id: known.id, row });
              else appends.push(row);
            }
            for (let i = 0; i < appends.length; i += 200) await call('POST', '/rows/', { json: { table_name: TABLE, rows: appends.slice(i, i + 200) } });
            for (let i = 0; i < updates.length; i += 200) await call('PUT', '/rows/', { json: { table_name: TABLE, updates: updates.slice(i, i + 200) } });
            return send(res, 200, { added: appends.length, updated: updates.length });
          }

          if (req.method === 'POST' && route === 'push/finish') {
            const { session } = (await readBody(req)) as { session: string };
            const s = sessions.get(session);
            if (!s) throw new HttpError(410, 'The push session expired.');
            // Rows of the pushed models that are no longer in them: marked, not deleted (the user's columns stay).
            const gone = [...s.existing].filter(([guid, v]) => !s.seen.has(guid) && s.models.has(v.model));
            for (let i = 0; i < gone.length; i += 200) {
              await call('PUT', '/rows/', { json: { table_name: TABLE, updates: gone.slice(i, i + 200).map(([, v]) => ({ row_id: v.id, row: { Removed: true } })) } });
            }
            sessions.delete(session);
            return send(res, 200, { removed: gone.length });
          }

          // ---- pull: the user's columns ----
          if (req.method === 'GET' && route === 'pull') {
            const pours = await pullPours();
            let info: { exists: boolean; columns: Col[] };
            try {
              info = await tableInfo();
            } catch (e) {
              if (!pours.rows.length) throw e;
              // the main base is not reachable (e.g. its token was revoked): the pours alone still come back
              return send(res, 200, { columns: [], rows: [], pours, note: `Pours pulled; the Elements table was not read: ${e instanceof Error ? e.message : e}` });
            }
            if (!info.exists) return send(res, 200, { columns: [], rows: [], pours, note: pours.rows.length ? undefined : 'The Elements table does not exist yet: push the model elements first.' });
            const custom = info.columns.filter((c) => !FIXED.includes(c.name) && !c.name.includes('.') && !c.name.startsWith('_') && !SKIP_TYPES.has(c.type));
            const names = custom.map((c) => c.name);
            const rows: { guid: string; values: Record<string, string | number> }[] = [];
            for (const r of await allRows()) {
              if (!r.GUID) continue;
              const values: Record<string, string | number> = {};
              for (const n of names) {
                const v = normalize(r[n]);
                if (v !== null) values[n] = v;
              }
              if (Object.keys(values).length) rows.push({ guid: String(r.GUID), values });
            }
            return send(res, 200, { columns: custom, rows, pours });
          }

          // ---- file details ("Insight Plan Files") ----
          if (req.method === 'POST' && route === 'files/push') {
            const body = (await readBody(req)) as { files: FilePush[] };
            if (!Array.isArray(body.files)) throw new HttpError(400, 'No files given.');
            return send(res, 200, await pushFiles(body.files));
          }
          if (req.method === 'GET' && route === 'files') return send(res, 200, await pullFiles());

          // ---- retired and extra activities ----
          if (req.method === 'GET' && route === 'adjustments/status') return send(res, 200, await adjustmentsStatus());
          if (req.method === 'POST' && route === 'retired/push') {
            const body = (await readBody(req)) as { tasks: { taskId: string; name?: string; reason?: string }[] };
            if (!Array.isArray(body.tasks) || body.tasks.length === 0) throw new HttpError(400, 'No tasks given.');
            return send(res, 200, await pushRetired(body.tasks));
          }
          if (req.method === 'POST' && route === 'adjustments/pull') return send(res, 200, await pullAdjustments());
          if (req.method === 'POST' && route === 'calculations/push') return send(res, 200, await pushCalculations());
          if (req.method === 'POST' && route === 'assumptions/push') return send(res, 200, await pushAssumptions());
          // The retired Task IDs of the local copy (no SeaTable needed): the app takes those tasks out of the programmes it shows.
          if (req.method === 'GET' && route === 'adjustments/retired') {
            const file = readAdjustments() as { retired?: { taskId: string }[] } | null;
            return send(res, 200, { retired: (file?.retired ?? []).map((r) => r.taskId) });
          }

          throw new HttpError(404, `No such route: ${route}`);
        } catch (e) {
          sendError(res, e);
        }
      });
    },
  };
}
