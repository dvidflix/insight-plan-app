import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { DB_FILE, HttpError, ProjectDbBase, listP6Projects, now, readP6Tables, tableColumns, type ImportMeta, type ProgrammeRow, type SqlDb, type TableData } from '../../src/db/core';
import { scenariosDir } from '../projectLayout';
import { readJsonScenario, readLegacyWorkbook, type ScenarioContent } from './scenarioFiles';

/** The project database on the server (the dev server and the production server): one SQLite file in the project folder,
    opened with node:sqlite. The logic is shared with the browser edition (src/db/core.ts); this adds what needs Node:
    the file, WAL mode (other programs can read and write while the app has it open; their commits show up in
    PRAGMA data_version, which the app polls to offer a reload), XER files read from disk, P6 Professional databases and the
    one-off import of the scenarios kept as files. */

export { DB_FILE, listP6Projects, readP6Tables };
export type { ClashPair, ImportMeta, P6ProjectInfo, ProgrammeRow, TableData } from '../../src/db/core';

const nodeRequire = createRequire(import.meta.url);
let sqlite: typeof import('node:sqlite') | null | undefined;
function openDatabase(file: string, readOnly: boolean): DatabaseSync {
  if (sqlite === undefined) {
    try {
      sqlite = nodeRequire('node:sqlite') as typeof import('node:sqlite');
    } catch {
      sqlite = null;
    }
  }
  if (!sqlite) throw new HttpError(500, `The project database needs Node.js 22.5 or later (this is ${process.version}).`);
  return new sqlite.DatabaseSync(file, { readOnly });
}

function blobText(b: Uint8Array): string {
  const buf = Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  // P6 may keep long text (calendar data) zlib-compressed.
  if (buf[0] === 0x78) {
    try {
      return zlib.inflateSync(buf).toString('utf8');
    } catch {
      // not compressed after all
    }
  }
  return buf.toString('utf8');
}

// ---- P6 Professional databases (read-only) ----

const p6Dbs = new Map<string, DatabaseSync>();

/** A P6 Professional standalone (SQLite) database, opened read-only: P6
    relies on its own ids and consistency checks, so the app never writes
    to it — changes go back to P6 by XER / XML import. */
export function p6Database(raw: unknown): { file: string; db: DatabaseSync } {
  const file = path.resolve(String(raw ?? '').trim());
  if (!String(raw ?? '').trim() || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new HttpError(400, `No database file at "${file}".`);
  let db = p6Dbs.get(file);
  if (!db) {
    try {
      db = openDatabase(file, true);
      db.exec('PRAGMA busy_timeout = 5000');
      if (!tableColumns(db, 'PROJECT') || !tableColumns(db, 'TASK')) throw new Error('no PROJECT / TASK tables');
    } catch (e) {
      db?.close();
      throw new HttpError(400, `"${file}" is not a P6 Professional SQLite database (${e instanceof Error ? e.message : e}).`);
    }
    p6Dbs.set(file, db);
  }
  return { file, db };
}

// ---- XER reading ----

const utf8 = new TextDecoder('utf-8', { fatal: true });
const ansi = new TextDecoder('windows-1252');

/** The file's lines, each decoded as UTF-8 when valid and as Windows-1252
    otherwise (P6 writes XER in the ANSI code page). */
function* xerLines(file: string): Generator<string> {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(8 << 20);
  const decode = (b: Buffer, s: number, e: number) => {
    const sub = b.subarray(s, e);
    try {
      return utf8.decode(sub);
    } catch {
      return ansi.decode(sub);
    }
  };
  let carry: Buffer | null = null;
  try {
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (!n) break;
      const chunk: Buffer = carry ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      let s = 0;
      for (let nl = chunk.indexOf(10); nl !== -1; nl = chunk.indexOf(10, s)) {
        yield decode(chunk, s, nl > s && chunk[nl - 1] === 13 ? nl - 1 : nl);
        s = nl + 1;
      }
      carry = s < chunk.length ? Buffer.from(chunk.subarray(s)) : null;
    }
    if (carry?.length) yield decode(carry, 0, carry[carry.length - 1] === 13 ? carry.length - 1 : carry.length);
  } finally {
    fs.closeSync(fd);
  }
}

// ---- the project database ----

export class ProjectDb extends ProjectDbBase {
  private dataVersion = 0;
  private externalChanges = 0;

  constructor(root: string, file: string) {
    super(root, file, openDatabase(file, false) as unknown as SqlDb);
    try {
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
      this.init();
      this.importScenarioFiles();
    } catch (e) {
      this.db.close();
      throw e;
    }
    this.dataVersion = this.readDataVersion();
  }

  private readDataVersion() {
    return Number((this.db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version);
  }

  /** Counts commits made by other programs (DBeaver...) since the app opened the file. The app's own writes don't count. */
  override changes(): number {
    const v = this.readDataVersion();
    if (v !== this.dataVersion) {
      this.dataVersion = v;
      this.externalChanges++;
    }
    return this.externalChanges;
  }

  /** Imports an XER file into the P6 tables as a new programme. */
  importXer(file: string, meta: ImportMeta): ProgrammeRow {
    return this.importXerLines(xerLines(file), meta);
  }

  protected override linkedP6Tables(programme: ProgrammeRow): Record<string, TableData> {
    const { db } = p6Database(programme.sourcePath);
    return readP6Tables(db as unknown as SqlDb, { projectIds: programme.projectIds, blobText });
  }

  /** Once, on a project's first database: the scenarios kept as JSON files
      (and legacy Overrides workbooks) in scenarios/. The files are left
      where they are but no longer read. */
  private importScenarioFiles() {
    if (this.meta('scenario_files_imported')) return;
    const dir = scenariosDir(this.root);
    const found: { scenario: string; stem: string; content: ScenarioContent; savedAt: string }[] = [];
    if (fs.existsSync(dir)) {
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!d.isDirectory() || d.name.startsWith('_')) continue;
        const sdir = path.join(dir, d.name);
        const files = new Map<string, string>();
        const xlsxDir = path.join(sdir, '4-schedule-xlsx');
        if (fs.existsSync(xlsxDir)) for (const f of fs.readdirSync(xlsxDir)) if (f.endsWith('_Overrides.xlsx') && !f.startsWith('~$')) files.set(f.slice(0, -'_Overrides.xlsx'.length), path.join(xlsxDir, f));
        for (const f of fs.readdirSync(sdir)) if (f.endsWith('.scenario.json')) files.set(f.slice(0, -'.scenario.json'.length), path.join(sdir, f));
        for (const [stem, file] of files) {
          try {
            const content = file.endsWith('.json') ? readJsonScenario(file) : readLegacyWorkbook(file);
            if (content) found.push({ scenario: d.name, stem, content, savedAt: fs.statSync(file).mtime.toISOString() });
          } catch {
            // unreadable file: skipped
          }
        }
      }
    }
    for (const f of found) if (!this.readScenario(f.scenario, f.stem)) this.writeScenario(f.scenario, f.stem, f.content, f.savedAt);
    this.setMeta('scenario_files_imported', now());
  }

}

// ---- open databases, one per project folder ----

const open = new Map<string, ProjectDb>();

/** The project folder's database, created on first use. */
export function projectDb(rawRoot: unknown): ProjectDb {
  const root = path.resolve(String(rawRoot ?? '').trim());
  if (!String(rawRoot ?? '').trim()) throw new HttpError(400, 'No project folder given.');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new HttpError(400, `There is no folder "${root}".`);
  const file = path.join(root, DB_FILE);
  let db = open.get(file);
  if (!db) {
    db = new ProjectDb(root, file);
    open.set(file, db);
  }
  return db;
}

/** The project databases opened since the dev server started (file paths). */
export const openProjectFiles = () => [...open.keys()];

export function closeAllDatabases() {
  for (const db of open.values()) db.close();
  open.clear();
  for (const db of p6Dbs.values()) db.close();
  p6Dbs.clear();
}
