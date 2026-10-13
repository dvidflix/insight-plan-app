import { DB_FILE, HttpError } from '../db/core';
import { BrowserProjectDb } from './browserDb';
import { FolderModelStore } from './modelStore';
import type { ModelsHost } from './modelsRouter';
import type { DbHost } from './router';

/** Opening and saving the project database in a folder the user chose (a FileSystemDirectoryHandle: their own disk or
    OneDrive folder), or in the browser's private storage. The database is held in memory and written back as a whole
    file a moment after the last change, so the file is a normal SQLite file that DBeaver or the desktop edition can open. */

const SAVE_DELAY_MS = 800;

interface Entry {
  db: BrowserProjectDb;
  folder: FileSystemDirectoryHandle;
  dirty: boolean;
  savedAt: number | null;
  error: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  writing: Promise<void>;
}

export class ProjectFolders implements DbHost, ModelsHost {
  private folders = new Map<string, FileSystemDirectoryHandle>();
  private open = new Map<string, Entry>();
  private opening = new Map<string, Promise<Entry>>();
  private stores = new Map<string, FolderModelStore>();

  /** Makes a project folder available under `root` (the name the app uses for it). */
  setFolder(root: string, folder: FileSystemDirectoryHandle) {
    this.folders.set(root, folder);
  }

  private async entry(rawRoot: unknown): Promise<Entry> {
    const root = String(rawRoot ?? '').trim();
    if (!root) throw new HttpError(400, 'No project folder given.');
    const existing = this.open.get(root);
    if (existing) return existing;
    let pending = this.opening.get(root);
    if (!pending) {
      pending = this.load(root).finally(() => this.opening.delete(root));
      this.opening.set(root, pending);
    }
    return pending;
  }

  private async load(root: string): Promise<Entry> {
    const folder = this.folders.get(root);
    if (!folder) throw new HttpError(400, 'Choose the project folder first (Inputs > Project database).');
    let bytes: Uint8Array | null = null;
    try {
      const file = await (await folder.getFileHandle(DB_FILE)).getFile();
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw new HttpError(400, `The project folder could not be read: ${e instanceof Error ? e.message : e}`);
    }
    const db = await BrowserProjectDb.open(root, bytes);
    const entry: Entry = { db, folder, dirty: false, savedAt: bytes ? Date.now() : null, error: null, timer: null, writing: Promise.resolve() };
    db.onWrite = () => this.changed(entry);
    this.open.set(root, entry);
    // A new project gets its file straight away, so the folder shows it.
    if (!bytes?.length) this.changed(entry);
    return entry;
  }

  /** The model store of the project folder (its IFCs and converted copies, as files). */
  async models(rawRoot: unknown): Promise<FolderModelStore> {
    const root = String(rawRoot ?? '').trim();
    if (!root) throw new HttpError(400, 'No project folder given.');
    let store = this.stores.get(root);
    if (!store) {
      const folder = this.folders.get(root);
      if (!folder) throw new HttpError(400, 'Choose the project folder first (Inputs > Project database).');
      store = new FolderModelStore(folder);
      this.stores.set(root, store);
    }
    return store;
  }

  async database(root: unknown): Promise<BrowserProjectDb> {
    return (await this.entry(root)).db;
  }

  async writeFiles(rawRoot: unknown, files: { name: string; content: string }[]): Promise<string[]> {
    const root = String(rawRoot ?? '').trim();
    const folder = this.folders.get(root);
    if (!folder) throw new HttpError(400, 'Choose the project folder first (Inputs > Project database).');
    const written: string[] = [];
    for (const f of files) {
      const handle = await folder.getFileHandle(f.name, { create: true });
      const out = await handle.createWritable();
      await out.write(f.content);
      await out.close();
      written.push(f.name);
    }
    return written;
  }

  saveStatus(rawRoot: unknown) {
    const e = this.open.get(String(rawRoot ?? '').trim());
    return { dirty: !!e?.dirty, savedAt: e?.savedAt ?? null, error: e?.error ?? null };
  }

  private changed(entry: Entry) {
    entry.dirty = true;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => void this.save(entry), SAVE_DELAY_MS);
  }

  /** Writes the file now. Writes are one at a time; a change made while one runs is written after it. */
  private save(entry: Entry): Promise<void> {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.writing = entry.writing.then(async () => {
      if (!entry.dirty) return;
      entry.dirty = false;
      try {
        const bytes = entry.db.exportFile();
        const handle = await entry.folder.getFileHandle(DB_FILE, { create: true });
        const writable = await handle.createWritable();
        await writable.write(bytes as unknown as BufferSource);
        await writable.close();
        entry.savedAt = Date.now();
        entry.error = null;
      } catch (e) {
        entry.dirty = true;
        entry.error = e instanceof Error ? e.message : String(e);
      }
    });
    return entry.writing;
  }

  /** Saves every project with unsaved changes (before the page is closed or hidden). */
  async flush() {
    await Promise.all([...this.open.values()].map((e) => this.save(e)));
  }

  closeAll() {
    for (const e of this.open.values()) {
      if (e.timer) clearTimeout(e.timer);
      e.db.close();
    }
    this.open.clear();
  }
}
