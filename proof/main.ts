/** Proof: can the project database run in the browser? The app's own schema and a copy of its XER import routine
    (vite-plugins/db/projectDb.ts, importXer) run on SQLite compiled to WebAssembly, behind a small adapter that has
    the same shape as Node's DatabaseSync (prepare().run/get/all, exec), which is what the server code is written to. */
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import serverSource from '../vite-plugins/db/projectDb.ts?raw';

type Param = string | number | null;

// ---- The adapter: Node's DatabaseSync interface over sqlite-wasm's oo1 API ----
function adapt(db: any) {
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

// ---- A synthetic XER of realistic size ----
function makeXer(tasks: number) {
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
const affinity = (c: string) => (/_cnt$|_id$/i.test(c) ? 'TEXT' : 'TEXT');

// ---- The import routine, as in projectDb.ts importXer (tables created on the fly, ALTER TABLE, one transaction) ----
function importXer(db: ReturnType<typeof adapt>, text: string, name: string) {
  const seen = new Map<string, Set<string>>();
  db.exec('BEGIN');
  const programmeId = Number(db.prepare("INSERT INTO ip_programme (name, source_file, source_format, kind) VALUES (?, ?, 'xer', 'import')").run(name, `${name}.xer`).lastInsertRowid);
  let table: string | null = null;
  let insert: ReturnType<ReturnType<typeof adapt>['prepare']> | null = null;
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
          db.exec(`CREATE TABLE ${q(table)} (ip_programme_id INTEGER NOT NULL REFERENCES ip_programme (id) ON DELETE CASCADE${columns.map((c) => `, ${q(c)} ${affinity(c)}`).join('')})`);
          db.exec(`CREATE INDEX IF NOT EXISTS ${q(`ix_${table}`)} ON ${q(table)} (ip_programme_id, ${q(columns[0])})`);
          db.prepare('INSERT OR IGNORE INTO ip_p6_table (name) VALUES (?)').run(table);
        }
        seen.set(table, new Set(columns));
      }
      picks = columns.map((c) => fields.indexOf(c) + 1);
      insert = db.prepare(`INSERT INTO ${q(table)} (ip_programme_id${columns.map((c) => `, ${q(c)}`).join('')}) VALUES (?${', ?'.repeat(columns.length)})`);
    } else if (tag === '%R' && insert) {
      const v = line.split('\t');
      insert.run(programmeId, ...picks.map((i) => (i > 0 && v[i] !== undefined && v[i] !== '' ? v[i] : null)) as Param[]);
      rows++;
    }
  }
  db.exec('COMMIT');
  return { programmeId, rows };
}

const t = () => performance.now();
const ms = (a: number) => Math.round(performance.now() - a);

async function main() {
  const result: Record<string, unknown> = {};
  const sqlite3 = await sqlite3InitModule();
  result.sqliteVersion = sqlite3.version.libVersion;
  const raw = new sqlite3.oo1.DB(':memory:', 'c');
  const db = adapt(raw);

  // 1. The app's real schema, taken from the server source file
  const schema = /const APP_SCHEMA = `([\s\S]*?)`;/.exec(serverSource)?.[1];
  if (!schema) throw new Error('schema not found');
  let s = t();
  raw.exec('PRAGMA foreign_keys = ON;');
  raw.exec(schema);
  result.schemaTables = raw.selectValue("select count(*) from sqlite_master where type='table'");
  result.schemaMs = ms(s);

  // 2. Import a programme of 50,000 activities
  const TASKS = 50000;
  const xer = makeXer(TASKS);
  result.xerMB = Math.round((xer.length / 1e6) * 10) / 10;
  s = t();
  const imp = importXer(db, xer, 'Big programme');
  result.importMs = ms(s);
  result.rowsImported = imp.rows;

  // 3. Read it back the way the app does
  s = t();
  const tasks = db.prepare('SELECT * FROM TASK WHERE ip_programme_id = ?').all(imp.programmeId);
  const preds = db.prepare('SELECT * FROM TASKPRED WHERE ip_programme_id = ?').all(imp.programmeId);
  result.readMs = ms(s);
  result.tasksRead = tasks.length;
  result.predsRead = preds.length;
  result.sampleTask = (tasks[0] as Record<string, unknown>)?.task_code;

  // 4. A second programme: the tables already exist (the ALTER / reuse path), then delete it (ON DELETE CASCADE)
  const imp2 = importXer(db, makeXer(2000), 'Small programme');
  const before = Number(raw.selectValue('select count(*) from TASK'));
  db.prepare('DELETE FROM ip_programme WHERE id = ?').run(imp2.programmeId);
  const after = Number(raw.selectValue('select count(*) from TASK'));
  result.cascade = { before, after, removed: before - after };

  // 5. Save: export the database as a normal SQLite file, keep it in the browser's private storage, reload it
  s = t();
  const bytes: Uint8Array = sqlite3.capi.sqlite3_js_db_export(raw.pointer as number);
  result.fileMB = Math.round((bytes.length / 1e6) * 10) / 10;
  result.exportMs = ms(s);
  result.fileHeader = new TextDecoder().decode(bytes.slice(0, 15));
  s = t();
  const root = await navigator.storage.getDirectory();
  const handle = await root.getFileHandle('insight-plan.db', { create: true });
  const w = await (handle as any).createWritable();
  await w.write(bytes);
  await w.close();
  result.writeMs = ms(s);
  s = t();
  const back = new Uint8Array(await (await handle.getFile()).arrayBuffer());
  const p = sqlite3.wasm.allocFromTypedArray(back);
  const reopened = new sqlite3.oo1.DB();
  const rc = sqlite3.capi.sqlite3_deserialize(reopened.pointer as number, 'main', p, back.length, back.length, sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE);
  result.reopenMs = ms(s);
  result.deserializeRc = rc;
  result.reopenedTasks = Number(reopened.selectValue('select count(*) from TASK'));
  result.reopenedProgrammes = Number(reopened.selectValue('select count(*) from ip_programme'));
  result.integrity = reopened.selectValue('pragma integrity_check');
  result.pass = result.reopenedTasks === TASKS && result.integrity === 'ok' && (result.cascade as any).removed === 2000 && result.fileHeader === 'SQLite format 3';
  return result;
}

main()
  .then((r) => { (window as any).__proof = r; document.getElementById('out')!.textContent = JSON.stringify(r, null, 2); document.body.id = 'done'; })
  .catch((e) => { (window as any).__proof = { error: String(e?.stack ?? e) }; document.getElementById('out')!.textContent = String(e?.stack ?? e); document.body.id = 'done'; });
