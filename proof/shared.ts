/** Shared by the proof pages: the browser database, an adapter shaped like Node's DatabaseSync, a synthetic XER, and the
    app's XER import routine (copied from vite-plugins/db/projectDb.ts, importXer). */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import serverSource from '../vite-plugins/db/projectDb.ts?raw';

export type Param = string | number | null;

export function adapt(db: any) {
  return {
    exec: (sql: string) => db.exec(sql),
    prepare(sql: string) {
      const stmt = db.prepare(sql);
      const bindAll = (p: Param[]) => { stmt.reset(true); if (p.length) stmt.bind(p); };
      return {
        run(...p: Param[]) {
          bindAll(p);
          stmt.step();
          stmt.reset(true);
          return { get lastInsertRowid() { return db.selectValue('select last_insert_rowid()'); } };
        },
        get(...p: Param[]) {
          bindAll(p);
          const row = stmt.step() ? stmt.get({}) : undefined;
          stmt.reset(true);
          return row;
        },
        all(...p: Param[]) {
          bindAll(p);
          const rows: unknown[] = [];
          while (stmt.step()) rows.push(stmt.get({}));
          stmt.reset(true);
          return rows;
        },
      };
    },
  };
}
export type Db = ReturnType<typeof adapt>;

export function makeXer(tasks: number) {
  const out: string[] = ['ERMHDR\t20.12\t2029-01-01\tProject\tadmin\tadmin\tdb\tProject Management\tUSD'];
  out.push('%T\tPROJECT', '%F\tproj_id\tproj_short_name\tplan_start_date', '%R\t1\tDEMO\t2029-01-01 08:00');
  out.push('%T\tTASK', '%F\ttask_id\tproj_id\ttask_code\ttask_name\ttarget_start_date\ttarget_end_date\ttask_type\tstatus_code\ttarget_drtn_hr_cnt');
  for (let i = 1; i <= tasks; i++) out.push(`%R\t${i}\t1\tA${String(i).padStart(6, '0')}\tPour level ${i % 12} wall ${i}\t2029-03-${(i % 28) + 1} 08:00\t2029-04-${(i % 28) + 1} 16:00\tTT_Task\tTK_NotStart\t${8 + (i % 9) * 8}`);
  out.push('%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tproj_id\tpred_proj_id\tpred_type\tlag_hr_cnt');
  for (let i = 2; i <= tasks; i++) out.push(`%R\t${i}\t${i}\t${i - 1}\t1\t1\tPR_FS\t0`);
  for (let i = 12; i <= tasks; i += 3) out.push(`%R\t${tasks + i}\t${i}\t${i - 11}\t1\t1\tPR_SS\t8`);
  out.push('%E');
  return out.join('\n');
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const q = (n: string) => `"${n}"`;

export function importXer(db: Db, text: string, name: string) {
  const seen = new Map<string, Set<string>>();
  db.exec('BEGIN');
  const programmeId = Number(db.prepare("INSERT INTO ip_programme (name, source_file, source_format, kind) VALUES (?, ?, 'xer', 'import')").run(name, `${name}.xer`).lastInsertRowid);
  let table: string | null = null;
  let insert: ReturnType<Db['prepare']> | null = null;
  let picks: number[] = [];
  let rows = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    const tag = line.slice(0, 2);
    if (tag === '%T') { table = line.slice(2).trim(); insert = null; }
    else if (tag === '%F' && table) {
      const fields = line.split('\t').slice(1).map((f) => f.trim());
      const columns = fields.filter((f) => IDENT.test(f));
      if (!seen.has(table)) {
        const exists = db.prepare('SELECT name FROM ip_p6_table WHERE name = ?').get(table);
        if (!exists) {
          db.exec(`CREATE TABLE ${q(table)} (ip_programme_id INTEGER NOT NULL REFERENCES ip_programme (id) ON DELETE CASCADE${columns.map((c) => `, ${q(c)} TEXT`).join('')})`);
          db.exec(`CREATE INDEX IF NOT EXISTS ${q(`ix_${table}`)} ON ${q(table)} (ip_programme_id, ${q(columns[0])})`);
          db.prepare('INSERT OR IGNORE INTO ip_p6_table (name) VALUES (?)').run(table);
        }
        seen.set(table, new Set(columns));
      }
      picks = columns.map((c) => fields.indexOf(c) + 1);
      insert = db.prepare(`INSERT INTO ${q(table)} (ip_programme_id${columns.map((c) => `, ${q(c)}`).join('')}) VALUES (?${', ?'.repeat(columns.length)})`);
    } else if (tag === '%R' && insert) {
      const v = line.split('\t');
      insert.run(programmeId, ...(picks.map((i) => (i > 0 && v[i] !== undefined && v[i] !== '' ? v[i] : null)) as Param[]));
      rows++;
    }
  }
  db.exec('COMMIT');
  return { programmeId, rows };
}

/** SQLite loaded, and a new in-memory database with the app's real schema. */
export async function newDatabase() {
  const sqlite3 = await sqlite3InitModule();
  const raw = new sqlite3.oo1.DB(':memory:', 'c');
  const schema = /const APP_SCHEMA = `([\s\S]*?)`;/.exec(serverSource)?.[1];
  if (!schema) throw new Error('schema not found');
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(schema);
  return { sqlite3, raw, db: adapt(raw) };
}

/** Opens a database from the bytes of a saved file. */
export function openBytes(sqlite3: any, bytes: Uint8Array) {
  const p = sqlite3.wasm.allocFromTypedArray(bytes);
  const raw = new sqlite3.oo1.DB();
  const rc = sqlite3.capi.sqlite3_deserialize(raw.pointer as number, 'main', p, bytes.length, bytes.length, sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE);
  if (rc !== 0) throw new Error(`could not open the file (code ${rc})`);
  return raw;
}
