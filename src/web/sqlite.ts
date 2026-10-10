import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { SqlDb, SqlStatement } from '../db/core';

/** SQLite compiled to WebAssembly, behind the same small interface as Node's DatabaseSync (src/db/core.ts SqlDb), so the
    project database's logic runs unchanged in the browser edition. The database lives in memory; the file is the bytes
    it exports (see browserDb.ts). */

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
let loading: Promise<Sqlite3> | null = null;
export const loadSqlite = (): Promise<Sqlite3> => (loading ??= sqlite3InitModule());

/** Prepared statements that are no longer referenced are finalized (the WebAssembly heap does not free them by itself). */
const finalizer = new FinalizationRegistry<{ finalize(): void }>((stmt) => {
  try {
    stmt.finalize();
  } catch {
    // the database was closed, which finalized it already
  }
});

export function adaptDb(sqlite3: Sqlite3, raw: InstanceType<Sqlite3['oo1']['DB']>): SqlDb {
  const lastId = () => sqlite3.capi.sqlite3_last_insert_rowid(raw.pointer as number);
  return {
    exec: (sql) => void raw.exec(sql),
    close: () => raw.close(),
    prepare(sql): SqlStatement {
      const stmt = raw.prepare(sql);
      const wrapper: SqlStatement = {
        run(...params) {
          stmt.reset(true);
          if (params.length) stmt.bind(params);
          stmt.step();
          stmt.reset(true);
          return { lastInsertRowid: lastId() };
        },
        get(...params) {
          stmt.reset(true);
          if (params.length) stmt.bind(params);
          const row = stmt.step() ? stmt.get({}) : undefined;
          stmt.reset(true);
          return row;
        },
        all(...params) {
          stmt.reset(true);
          if (params.length) stmt.bind(params);
          const rows: unknown[] = [];
          while (stmt.step()) rows.push(stmt.get({}));
          stmt.reset(true);
          return rows;
        },
      };
      finalizer.register(wrapper, stmt);
      return wrapper;
    },
  };
}

/** A database file's bytes with a WAL-mode header turned into the ordinary one. A project database the desktop edition last
    closed is in WAL mode (its changes are already in the file once the app has closed it), and an in-memory database has no
    write-ahead log to open. */
export function withoutWalHeader(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 100 || bytes[18] !== 2 || bytes[19] !== 2) return bytes;
  const copy = new Uint8Array(bytes);
  copy[18] = 1;
  copy[19] = 1;
  return copy;
}

export function openMemoryDb(sqlite3: Sqlite3, bytes: Uint8Array | null) {
  const raw = new sqlite3.oo1.DB(':memory:', 'c');
  if (bytes && bytes.length) {
    const data = withoutWalHeader(bytes);
    const p = sqlite3.wasm.allocFromTypedArray(data);
    const flags = sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
    const rc = sqlite3.capi.sqlite3_deserialize(raw.pointer as number, 'main', p, data.length, data.length, flags);
    if (rc !== 0) {
      raw.close();
      throw new Error(`The project database file could not be opened (SQLite code ${rc}). Is it a SQLite file?`);
    }
  }
  return raw;
}

export const exportBytes = (sqlite3: Sqlite3, raw: { pointer?: unknown }): Uint8Array => sqlite3.capi.sqlite3_js_db_export(raw.pointer as number);
