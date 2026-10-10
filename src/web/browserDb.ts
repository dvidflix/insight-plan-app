import { DB_FILE, ProjectDbBase, type ImportMeta, type ProgrammeRow } from '../db/core';
import { adaptDb, exportBytes, loadSqlite, openMemoryDb } from './sqlite';

/** The project database in the browser edition: the shared logic (src/db/core.ts) on SQLite in memory. `onWrite` fires
    after every committed write, so the owner can save the file; `exportFile` gives the file's bytes. */

const utf8 = new TextDecoder('utf-8', { fatal: true });
const ansi = new TextDecoder('windows-1252');

/** An XER's text: UTF-8 when valid, otherwise Windows-1252 (P6 writes XER in the ANSI code page). */
export function xerText(bytes: ArrayBuffer): string {
  try {
    return utf8.decode(bytes);
  } catch {
    return ansi.decode(bytes);
  }
}

export class BrowserProjectDb extends ProjectDbBase {
  onWrite: (() => void) | null = null;
  private exporter: () => Uint8Array;

  private constructor(root: string, db: ReturnType<typeof adaptDb>, exporter: () => Uint8Array) {
    super(root, DB_FILE, db);
    this.exporter = exporter;
  }

  /** Opens the project database from the file's bytes (null = a new project: the file is created on the first save). */
  static async open(root: string, bytes: Uint8Array | null): Promise<BrowserProjectDb> {
    const sqlite3 = await loadSqlite();
    const raw = openMemoryDb(sqlite3, bytes);
    const db = adaptDb(sqlite3, raw);
    db.exec('PRAGMA foreign_keys = ON');
    const project = new BrowserProjectDb(root, db, () => exportBytes(sqlite3, raw));
    project.init();
    return project;
  }

  /** The database as a file, readable by any SQLite tool. */
  exportFile(): Uint8Array {
    return this.exporter();
  }

  override tx<T>(fn: () => T): T {
    const result = super.tx(fn);
    this.onWrite?.();
    return result;
  }

  /** Imports an XER file (its bytes) into the P6 tables as a new programme. */
  importXerBytes(bytes: ArrayBuffer, meta: ImportMeta): ProgrammeRow {
    return this.importXerLines(xerText(bytes).split(/\r?\n/), meta);
  }
}
