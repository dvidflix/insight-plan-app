import { XER_TABLE_COLUMNS } from './normalize';
import type { XerTables } from './xer';

/** Streaming reader for large P6 .xer exports (hundreds of MB, many projects).
    parseXer() needs the whole file as one string and turns every row of
    every table into an object — several GB for a 300 MB file. This streams the
    file's bytes instead, in two passes:
    - indexXer(): one scan of the raw bytes, recording where each table
      starts and ends, plus the project list (with names and activity
      counts) for the picker — without decoding the bulk of the rows;
    - readXerTables(): reads only the tables normalizeXer uses, and only the
      rows of the chosen projects (proj_id is checked on the raw bytes
      before a row is decoded) and only the columns it reads, into the same
      XerTables shape parseXer gives.
    Lines are decoded as UTF-8 when valid and as Windows-1252 otherwise — P6
    writes XER in the ANSI code page, so "m²" or "°" would come out as
    replacement characters if the file were read as UTF-8 throughout. */

export interface XerProjectInfo {
  id: string;
  shortName: string;
  /** The project's root WBS node name (P6's "Project Name"), '' if absent. */
  name: string;
  activityCount: number;
}

export interface XerIndex {
  size: number;
  /** Byte range [start, end) of each table, from its %T line to the next table. */
  tables: Record<string, [number, number]>;
  projects: XerProjectInfo[];
}

export type XerProgress = (done: number, total: number) => void;

/** Bytes between progress reports. */
const PROGRESS_STEP = 4 * 1024 * 1024;
const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const PCT = 0x25; // %
const T = 0x54;
const F = 0x46;
const R = 0x52;
const E = 0x45;

type LineFn = (buf: Uint8Array, start: number, end: number, offset: number) => void;

/** Calls onLine for every line of the blob (without its line break), with
    the line's absolute byte offset in the blob. Reads through blob.stream():
    in Chrome, reading a large file as a series of Blob.slice() calls is
    ~60x slower (33 s against 0.5 s for a 375 MB file). */
async function scanLines(blob: Blob, onLine: LineFn, onProgress?: XerProgress) {
  const reader = blob.stream().getReader();
  let carry: Uint8Array | null = null;
  let pos = 0;
  let reported = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let buf = value;
    if (carry) {
      buf = new Uint8Array(carry.length + value.length);
      buf.set(carry);
      buf.set(value, carry.length);
    }
    const base = pos - (carry?.length ?? 0);
    pos += value.length;
    let s = 0;
    for (let nl = buf.indexOf(LF); nl !== -1; nl = buf.indexOf(LF, s)) {
      onLine(buf, s, nl > s && buf[nl - 1] === CR ? nl - 1 : nl, base + s);
      s = nl + 1;
    }
    carry = s < buf.length ? buf.slice(s) : null;
    if (pos - reported >= PROGRESS_STEP) {
      reported = pos;
      onProgress?.(pos, blob.size);
    }
  }
  if (carry) {
    const end = carry[carry.length - 1] === CR ? carry.length - 1 : carry.length;
    onLine(carry, 0, end, blob.size - carry.length);
  }
  onProgress?.(blob.size, blob.size);
}

const utf8 = new TextDecoder('utf-8', { fatal: true });
const ansi = new TextDecoder('windows-1252');

function decode(buf: Uint8Array, start: number, end: number): string {
  const bytes = buf.subarray(start, end);
  for (let i = start; i < end; i++) {
    if (buf[i] >= 0x80) {
      try {
        return utf8.decode(bytes);
      } catch {
        return ansi.decode(bytes);
      }
    }
  }
  return ansi.decode(bytes);
}

/** The col-th value of a %R line, read straight from the bytes (ASCII ids only). */
function fieldAt(buf: Uint8Array, start: number, end: number, col: number): string {
  let from = buf.indexOf(TAB, start) + 1; // skip "%R"
  if (from === 0 || from > end) return '';
  for (let c = 0; c < col; c++) {
    const t = buf.indexOf(TAB, from);
    if (t === -1 || t >= end) return '';
    from = t + 1;
  }
  let to = buf.indexOf(TAB, from);
  if (to === -1 || to > end) to = end;
  let out = '';
  for (let i = from; i < to; i++) out += String.fromCharCode(buf[i]);
  return out;
}

function toRow(fields: string[], line: string): Record<string, string> {
  const values = line.split('\t');
  const row: Record<string, string> = {};
  for (let i = 0; i < fields.length; i++) row[fields[i]] = values[i + 1] ?? '';
  return row;
}

/** Like toRow, but only the given [name, column] pairs. */
function toPrunedRow(picks: [string, number][], line: string): Record<string, string> {
  const values = line.split('	');
  const row: Record<string, string> = {};
  for (const [name, i] of picks) row[name] = values[i + 1] ?? '';
  return row;
}

const fieldsOf = (buf: Uint8Array, start: number, end: number) => decode(buf, start, end).split('\t').slice(1);

export async function indexXer(file: Blob, onProgress?: XerProgress): Promise<XerIndex> {
  const tables: Record<string, [number, number]> = {};
  const projects = new Map<string, XerProjectInfo>();
  const rootNames = new Map<string, string>();
  const counts = new Map<string, number>();
  let current = '';
  let currentStart = 0;
  let fields: string[] = [];
  let col = (name: string) => fields.indexOf(name);

  await scanLines(file, (buf, s, e, offset) => {
    if (buf[s] !== PCT) return;
    const kind = buf[s + 1];
    if (kind === T || kind === E) {
      if (current) tables[current] = [currentStart, offset];
      current = kind === T ? decode(buf, s + 2, e).trim() : '';
      currentStart = offset;
      fields = [];
      return;
    }
    if (kind === F) {
      fields = fieldsOf(buf, s, e);
      const cols = new Map(fields.map((f, i) => [f, i]));
      col = (name) => cols.get(name) ?? -1;
      return;
    }
    if (kind !== R) return;
    if (current === 'PROJECT') {
      const row = toRow(fields, decode(buf, s, e));
      projects.set(row.proj_id, { id: row.proj_id, shortName: row.proj_short_name || row.proj_id, name: '', activityCount: 0 });
    } else if (current === 'PROJWBS') {
      if (fieldAt(buf, s, e, col('proj_node_flag')) !== 'Y') return;
      const row = toRow(fields, decode(buf, s, e));
      rootNames.set(row.proj_id, row.wbs_name ?? '');
    } else if (current === 'TASK') {
      const p = fieldAt(buf, s, e, col('proj_id'));
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }, onProgress);
  if (current) tables[current] = [currentStart, file.size];

  for (const p of projects.values()) {
    p.name = rootNames.get(p.id) ?? '';
    p.activityCount = counts.get(p.id) ?? 0;
  }
  return { size: file.size, tables, projects: [...projects.values()] };
}

/** Reads the tables normalizeXer needs, keeping only rows of the given
    projects (all rows when projectIds is null). Rows with an empty proj_id
    (global calendars, global activity code types) are always kept;
    relationships are kept only when both ends are in the chosen projects,
    so links between two chosen projects survive. */
export async function readXerTables(file: Blob, index: XerIndex, projectIds: string[] | null, onProgress?: XerProgress): Promise<XerTables> {
  const keep = projectIds ? new Set(projectIds) : null;
  const wanted = Object.keys(XER_TABLE_COLUMNS).filter((t) => index.tables[t]);
  const total = wanted.reduce((sum, t) => sum + index.tables[t][1] - index.tables[t][0], 0);
  const tables: XerTables = {};
  let done = 0;
  for (const name of wanted) {
    const [start, end] = index.tables[name];
    const rows: Record<string, string>[] = (tables[name] = []);
    const columns = XER_TABLE_COLUMNS[name];
    let fields: string[] = [];
    let picks: [string, number][] = [];
    let projCol = -1;
    let predProjCol = -1;
    await scanLines(file.slice(start, end), (buf, s, e) => {
      if (buf[s] !== PCT) return;
      if (buf[s + 1] === F) {
        fields = fieldsOf(buf, s, e);
        picks = columns ? columns.map((c) => [c, fields.indexOf(c)] as [string, number]).filter(([, i]) => i !== -1) : [];
        projCol = fields.indexOf('proj_id');
        predProjCol = name === 'TASKPRED' ? fields.indexOf('pred_proj_id') : -1;
        return;
      }
      if (buf[s + 1] !== R) return;
      if (keep && projCol !== -1) {
        const p = fieldAt(buf, s, e, projCol);
        if (predProjCol !== -1) {
          if (!keep.has(p) || !keep.has(fieldAt(buf, s, e, predProjCol))) return;
        } else if (p !== '' && !keep.has(p)) return;
      }
      const line = decode(buf, s, e);
      rows.push(columns ? toPrunedRow(picks, line) : toRow(fields, line));
    }, (d) => onProgress?.(done + d, total));
    done += end - start;
  }
  return tables;
}
