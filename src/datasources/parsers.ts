import * as XLSX from 'xlsx';
import { loadSqlite, openMemoryDb } from '../web/sqlite';

/** A table of data from an external source: named columns, and rows of values in the same order. */
export interface DataTable {
  columns: string[];
  rows: (string | number | null)[][];
}

/** What kind of file a data source reads. */
export type SourceKind = 'csv' | 'excel' | 'sqlite';

export const SOURCE_KIND_LABEL: Record<SourceKind, string> = { csv: 'CSV / text', excel: 'Excel', sqlite: 'SQLite (.db)' };

/** The kind of source a file name belongs to, or null when none reads it. */
export function kindOfFile(name: string): SourceKind | null {
  const ext = /\.([^.]+)$/.exec(name.toLowerCase())?.[1];
  if (!ext) return null;
  if (['csv', 'tsv', 'txt'].includes(ext)) return 'csv';
  if (['xlsx', 'xlsm', 'xlsb', 'xls', 'ods'].includes(ext)) return 'excel';
  if (['db', 'sqlite', 'sqlite3', 'db3'].includes(ext)) return 'sqlite';
  return null;
}

/** The delimiter a text file uses: the one of tab, semicolon, comma and pipe that is most common in its first lines. */
export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 4000).split(/\r?\n/).slice(0, 8).join('\n');
  let best = ',';
  let bestCount = 0;
  for (const d of [',', ';', '\t', '|']) {
    const n = sample.split(d).length - 1;
    if (n > bestCount) { best = d; bestCount = n; }
  }
  return best;
}

/** Splits delimited text into rows of cells: quoted cells may hold the delimiter, line breaks and doubled quotes. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Column names that are never empty or repeated ("Name", "Name 2"). */
export function uniqueHeaders(raw: unknown[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = String(h ?? '').trim() || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} ${n}`;
  });
}

/** Rows of cells as a table: the first row names the columns, or the columns are "Column 1", "Column 2" … */
export function tableFromRows(grid: unknown[][], firstRowHeaders: boolean): DataTable {
  const width = grid.reduce((n, r) => Math.max(n, r.length), 0);
  const head = firstRowHeaders && grid.length ? grid[0] : Array.from({ length: width }, () => '');
  const body = firstRowHeaders ? grid.slice(1) : grid;
  const columns = uniqueHeaders(Array.from({ length: width }, (_, i) => head[i]));
  const rows = body
    .filter((r) => r.some((v) => v !== '' && v !== null && v !== undefined))
    .map((r) => columns.map((_, i) => cellValue(r[i])));
  return { columns, rows };
}

function cellValue(v: unknown): string | number | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v === 'number') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

/** A CSV / text file as a table. */
export function parseCsvTable(text: string, opts: { delimiter?: string; firstRowHeaders?: boolean } = {}): DataTable {
  const delimiter = opts.delimiter ?? detectDelimiter(text);
  return tableFromRows(parseDelimited(text, delimiter), opts.firstRowHeaders ?? true);
}

/** Every sheet of a workbook as a table, in the workbook's order. */
export function parseExcelTables(bytes: ArrayBuffer | Uint8Array, firstRowHeaders = true): Record<string, DataTable> {
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
  const out: Record<string, DataTable> = {};
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
    out[name] = tableFromRows(grid, firstRowHeaders);
  }
  return out;
}

/** Every table and view of a SQLite file (read in memory; the file itself is not changed). */
export async function parseSqliteTables(bytes: Uint8Array): Promise<Record<string, DataTable>> {
  const sqlite3 = await loadSqlite();
  const raw = openMemoryDb(sqlite3, bytes);
  try {
    const names: string[] = [];
    raw.exec({ sql: "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name", rowMode: 'array', callback: (r: unknown[]) => { names.push(String(r[0])); } });
    const out: Record<string, DataTable> = {};
    for (const name of names) {
      const columns: string[] = [];
      const rows: (string | number | null)[][] = [];
      raw.exec({
        sql: `SELECT * FROM "${name.replace(/"/g, '""')}"`,
        rowMode: 'array',
        columnNames: columns,
        callback: (r: unknown[]) => { rows.push(r.map((v) => (v instanceof Uint8Array ? `(${v.length} bytes)` : typeof v === 'bigint' ? Number(v) : cellValue(v)))); },
      });
      out[name] = { columns: uniqueHeaders(columns), rows };
    }
    return out;
  } finally {
    raw.close();
  }
}

/** The tables of a file: one for a text file (named after the file), one per sheet of a workbook, one per table of a database. */
export async function readTables(kind: SourceKind, file: File): Promise<Record<string, DataTable>> {
  if (kind === 'csv') return { [file.name.replace(/\.[^.]+$/, '') || 'Data']: parseCsvTable(await file.text()) };
  const bytes = new Uint8Array(await file.arrayBuffer());
  return kind === 'excel' ? parseExcelTables(bytes) : parseSqliteTables(bytes);
}
