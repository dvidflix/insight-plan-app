import { HttpError } from '../db/core';

/** The project's model store in the browser edition: each model is kept as plain files in the project folder's
    "insight-plan-models" folder, so the IFCs stay ordinary files (in OneDrive too) and saving one never rewrites the others.

      <name>.ifc        the current IFC
      <name>.frag       its converted copy, a cache of the IFC (used while it was built from the IFC's current hash)
      <name>.json       hash, size, note, when, the converted copy's details, and the earlier versions
      <name>.v<id>.ifc  earlier IFCs (a short history, so an edit can be undone)

    The same operations as the server's store (vite-plugins/db/modelsDb.ts), which keeps them in a SQLite file instead. */

export const MODELS_FOLDER = 'insight-plan-models';
const KEEP_VERSIONS = 5;

export interface ModelRow {
  name: string;
  ifcSize: number;
  ifcHash: string;
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

interface Meta {
  name: string;
  hash: string;
  size: number;
  note: string | null;
  updatedAt: string;
  frag: { forHash: string; version: string; layers: string | null } | null;
  versions: { id: number; createdAt: string; size: number; hash: string; note: string | null }[];
  nextVersionId: number;
}

const enc = (name: string) => encodeURIComponent(name);
const buf = (b: Uint8Array | ArrayBuffer) => (b instanceof Uint8Array ? b : new Uint8Array(b));

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export class FolderModelStore {
  private dir: Promise<FileSystemDirectoryHandle>;

  constructor(project: FileSystemDirectoryHandle) {
    this.dir = project.getDirectoryHandle(MODELS_FOLDER, { create: true });
  }

  private async read(file: string): Promise<Uint8Array | null> {
    try {
      const handle = await (await this.dir).getFileHandle(file);
      return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return null;
      throw e;
    }
  }

  private async write(file: string, bytes: Uint8Array | string) {
    const handle = await (await this.dir).getFileHandle(file, { create: true });
    const w = await handle.createWritable();
    await w.write((typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes) as unknown as BufferSource);
    await w.close();
  }

  private async remove(file: string) {
    try {
      await (await this.dir).removeEntry(file);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
    }
  }

  private async meta(name: string): Promise<Meta | null> {
    const bytes = await this.read(`${enc(name)}.json`);
    return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as Meta) : null;
  }

  private writeMeta(m: Meta) {
    return this.write(`${enc(m.name)}.json`, JSON.stringify(m));
  }

  async list(fragVersion: string): Promise<ModelRow[]> {
    const rows: ModelRow[] = [];
    for await (const [file, entry] of (await this.dir).entries()) {
      if (entry.kind !== 'file' || !file.endsWith('.json')) continue;
      const m = JSON.parse(new TextDecoder().decode((await this.read(file))!)) as Meta;
      rows.push({ name: m.name, ifcSize: m.size, ifcHash: m.hash, cached: !!m.frag && m.frag.forHash === m.hash && m.frag.version === fragVersion, note: m.note, updatedAt: m.updatedAt, versions: m.versions.length });
    }
    return rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  /** Stores `ifc` as the model's current IFC; a different earlier one goes to the history. */
  async saveIfc(name: string, ifc: Uint8Array | ArrayBuffer, note: string | null): Promise<{ hash: string; changed: boolean }> {
    const bytes = buf(ifc);
    const hash = await sha256(bytes);
    const current = await this.meta(name);
    if (current?.hash === hash) return { hash, changed: false };
    const meta: Meta = { name, hash, size: bytes.length, note, updatedAt: new Date().toISOString(), frag: null, versions: current?.versions ?? [], nextVersionId: current?.nextVersionId ?? 1 };
    if (current) {
      const earlier = await this.read(`${enc(name)}.ifc`);
      if (earlier) {
        const id = meta.nextVersionId++;
        await this.write(`${enc(name)}.v${id}.ifc`, earlier);
        meta.versions.push({ id, createdAt: current.updatedAt, size: current.size, hash: current.hash, note: current.note });
        while (meta.versions.length > KEEP_VERSIONS) {
          const old = meta.versions.shift()!;
          await this.remove(`${enc(name)}.v${old.id}.ifc`);
        }
      }
    }
    await this.write(`${enc(name)}.ifc`, bytes);
    await this.remove(`${enc(name)}.frag`);
    await this.writeMeta(meta);
    return { hash, changed: true };
  }

  async getIfc(name: string, versionId?: number): Promise<Uint8Array> {
    const bytes = await this.read(versionId ? `${enc(name)}.v${versionId}.ifc` : `${enc(name)}.ifc`);
    if (!bytes) throw new HttpError(404, `No model "${name}" in the model store.`);
    return bytes;
  }

  /** Stores the converted model, if it was built from the IFC that is current now. */
  async saveFrag(name: string, forHash: string, version: string, frag: Uint8Array | ArrayBuffer, layers: string | null): Promise<boolean> {
    const meta = await this.meta(name);
    if (!meta || meta.hash !== forHash) return false;
    await this.write(`${enc(name)}.frag`, buf(frag));
    meta.frag = { forHash, version, layers };
    await this.writeMeta(meta);
    return true;
  }

  async getFrag(name: string, version: string): Promise<{ frag: Uint8Array; layers: string | null } | null> {
    const meta = await this.meta(name);
    if (!meta?.frag || meta.frag.forHash !== meta.hash || meta.frag.version !== version) return null;
    const frag = await this.read(`${enc(name)}.frag`);
    return frag ? { frag, layers: meta.frag.layers } : null;
  }

  async versions(name: string): Promise<VersionRow[]> {
    const meta = await this.meta(name);
    return (meta?.versions ?? []).map((v) => ({ id: v.id, createdAt: v.createdAt, ifcSize: v.size, note: v.note })).sort((a, b) => b.id - a.id);
  }

  /** Makes an earlier IFC the current one again (the current one goes to the history). */
  async restore(name: string, versionId: number): Promise<void> {
    const meta = await this.meta(name);
    const entry = meta?.versions.find((v) => v.id === versionId);
    const ifc = await this.getIfc(name, versionId);
    await this.saveIfc(name, ifc, `Restored: ${entry?.note ?? 'earlier version'}`);
  }

  async delete(name: string): Promise<void> {
    const meta = await this.meta(name);
    for (const v of meta?.versions ?? []) await this.remove(`${enc(name)}.v${v.id}.ifc`);
    await this.remove(`${enc(name)}.ifc`);
    await this.remove(`${enc(name)}.frag`);
    await this.remove(`${enc(name)}.json`);
  }
}
