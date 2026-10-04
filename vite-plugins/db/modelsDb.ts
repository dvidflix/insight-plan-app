import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from '../http';

/** The project's model store: <project folder>/insight-plan-models.db.
    Beside insight-plan.db (not in it: models are large and change rarely, the
    schedule data changes all the time, and neither belongs in Git).

    Per model: the IFC itself (gzip), the converted .frag with the IFC layers
    it was built with, and the earlier IFCs (a short history, so an edit can be
    undone). The .frag is only a cache of the IFC: it is used while it was
    built from the IFC's current hash by the same converter version. */

export const MODELS_DB_FILE = 'insight-plan-models.db';
const KEEP_VERSIONS = 5;

const nodeRequire = createRequire(import.meta.url);
function openDatabase(file: string): DatabaseSync {
  let sqlite: typeof import('node:sqlite');
  try {
    sqlite = nodeRequire('node:sqlite') as typeof import('node:sqlite');
  } catch {
    throw new HttpError(500, `The model store needs Node.js 22.5 or later (this is ${process.version}).`);
  }
  return new sqlite.DatabaseSync(file);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ip_model (
  name TEXT PRIMARY KEY,
  ifc BLOB NOT NULL,
  ifc_hash TEXT NOT NULL,
  ifc_size INTEGER NOT NULL,
  frag BLOB,
  frag_for_hash TEXT,
  frag_version TEXT,
  layers TEXT,
  note TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS ip_model_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  ifc BLOB NOT NULL,
  ifc_hash TEXT NOT NULL,
  ifc_size INTEGER NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS ix_ip_model_version_name ON ip_model_version (name);
`;

export interface ModelRow {
  name: string;
  ifcSize: number;
  ifcHash: string;
  /** A .frag built from the current IFC by the current converter is stored. */
  cached: boolean;
  note: string | null;
  updatedAt: string;
  versions: number;
}

export interface VersionRow {
  id: number;
  createdAt: string;
  ifcSize: number;
  note: string | null;
}

const toBuffer = (v: unknown): Buffer => Buffer.from(v as Uint8Array);

class ModelsDb {
  private db: DatabaseSync;
  constructor(readonly root: string, file: string) {
    this.db = openDatabase(file);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  list(fragVersion: string): ModelRow[] {
    const rows = this.db
      .prepare(
        `SELECT m.name, m.ifc_size AS ifcSize, m.ifc_hash AS ifcHash, m.note, m.updated_at AS updatedAt,
                (m.frag IS NOT NULL AND m.frag_for_hash = m.ifc_hash AND m.frag_version = ?) AS cached,
                (SELECT COUNT(*) FROM ip_model_version v WHERE v.name = m.name) AS versions
           FROM ip_model m ORDER BY m.name COLLATE NOCASE`,
      )
      .all(fragVersion) as unknown as (Omit<ModelRow, 'cached'> & { cached: number })[];
    return rows.map((r) => ({ ...r, cached: !!r.cached }));
  }

  /** Stores `ifc` as the model's current IFC; a different earlier one goes to the history. */
  saveIfc(name: string, ifc: Buffer, note: string | null): { hash: string; changed: boolean } {
    const hash = crypto.createHash('sha256').update(ifc).digest('hex');
    const current = this.db.prepare('SELECT ifc, ifc_hash AS hash, ifc_size AS size, note FROM ip_model WHERE name = ?').get(name) as { ifc: Uint8Array; hash: string; size: number; note: string | null } | undefined;
    if (current?.hash === hash) return { hash, changed: false };
    const gz = zlib.gzipSync(ifc, { level: 6 });
    this.db.exec('BEGIN');
    try {
      if (current) {
        this.db.prepare('INSERT INTO ip_model_version (name, ifc, ifc_hash, ifc_size, note) VALUES (?, ?, ?, ?, ?)').run(name, current.ifc, current.hash, current.size, current.note);
        this.db
          .prepare('DELETE FROM ip_model_version WHERE name = ? AND id NOT IN (SELECT id FROM ip_model_version WHERE name = ? ORDER BY id DESC LIMIT ?)')
          .run(name, name, KEEP_VERSIONS);
      }
      this.db
        .prepare(
          `INSERT INTO ip_model (name, ifc, ifc_hash, ifc_size, frag, frag_for_hash, frag_version, layers, note, updated_at)
           VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           ON CONFLICT(name) DO UPDATE SET ifc = excluded.ifc, ifc_hash = excluded.ifc_hash, ifc_size = excluded.ifc_size,
             frag = NULL, frag_for_hash = NULL, frag_version = NULL, layers = NULL, note = excluded.note, updated_at = excluded.updated_at`,
        )
        .run(name, gz, hash, ifc.length, note);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return { hash, changed: true };
  }

  getIfc(name: string, versionId?: number): Buffer {
    const row = versionId
      ? (this.db.prepare('SELECT ifc FROM ip_model_version WHERE id = ? AND name = ?').get(versionId, name) as { ifc: Uint8Array } | undefined)
      : (this.db.prepare('SELECT ifc FROM ip_model WHERE name = ?').get(name) as { ifc: Uint8Array } | undefined);
    if (!row) throw new HttpError(404, `No model "${name}" in the model store.`);
    return zlib.gunzipSync(toBuffer(row.ifc));
  }

  /** Stores the converted model, if it was built from the IFC that is current now. */
  saveFrag(name: string, forHash: string, version: string, frag: Buffer, layers: string | null): boolean {
    const row = this.db.prepare('SELECT ifc_hash AS hash FROM ip_model WHERE name = ?').get(name) as { hash: string } | undefined;
    if (!row || row.hash !== forHash) return false;
    this.db.prepare('UPDATE ip_model SET frag = ?, frag_for_hash = ?, frag_version = ?, layers = ? WHERE name = ?').run(frag, forHash, version, layers, name);
    return true;
  }

  getFrag(name: string, version: string): { frag: Buffer; layers: string | null } | null {
    const row = this.db.prepare('SELECT frag, layers FROM ip_model WHERE name = ? AND frag IS NOT NULL AND frag_for_hash = ifc_hash AND frag_version = ?').get(name, version) as { frag: Uint8Array; layers: string | null } | undefined;
    return row ? { frag: toBuffer(row.frag), layers: row.layers } : null;
  }

  versions(name: string): VersionRow[] {
    return this.db
      .prepare('SELECT id, created_at AS createdAt, ifc_size AS ifcSize, note FROM ip_model_version WHERE name = ? ORDER BY id DESC')
      .all(name) as unknown as VersionRow[];
  }

  /** Makes an earlier IFC the current one again (the current one goes to the history). */
  restore(name: string, versionId: number): void {
    const ifc = this.getIfc(name, versionId);
    const note = (this.db.prepare('SELECT note FROM ip_model_version WHERE id = ?').get(versionId) as { note: string | null } | undefined)?.note ?? null;
    this.saveIfc(name, ifc, `Restored: ${note ?? 'earlier version'}`);
  }

  remove(name: string): void {
    this.db.prepare('DELETE FROM ip_model WHERE name = ?').run(name);
    this.db.prepare('DELETE FROM ip_model_version WHERE name = ?').run(name);
  }

  close() {
    try {
      this.db.close();
    } catch {
      // already closed
    }
  }
}

const open = new Map<string, ModelsDb>();

/** The project folder's model store, created on first use. */
export function modelsDb(rawRoot: unknown): ModelsDb {
  const root = path.resolve(String(rawRoot ?? '').trim());
  if (!String(rawRoot ?? '').trim()) throw new HttpError(400, 'No project folder given.');
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new HttpError(400, `There is no folder "${root}".`);
  const file = path.join(root, MODELS_DB_FILE);
  let db = open.get(file);
  if (!db) {
    db = new ModelsDb(root, file);
    open.set(file, db);
  }
  return db;
}

export function closeModelDatabases() {
  for (const db of open.values()) db.close();
  open.clear();
}
