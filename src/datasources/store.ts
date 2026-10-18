import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { kindOfFile, readTables, type DataTable, type SourceKind } from './parsers';
import { DEFAULT_TRIGGERS, type IdMatch, type LinkTriggers } from './idMatch';

/** A connection to a file of external data (the first kind of data source: CSV / text, Excel, SQLite). It holds one or more
    tables (a text file has one, a workbook one per sheet, a database one per table). What is remembered is the connection;
    the tables are read again from the file (Refresh, or when the app starts if the browser still has the file's permission). */
export interface DataSourceMeta {
  id: string;
  name: string;
  kind: SourceKind;
  fileName: string;
  /** The table showing (a sheet or database table); null: the first. */
  table: string | null;
  /** When the tables were last read (ms); 0: not read in this session. */
  loadedAt: number;
  /** How each table is coupled to the 3D (ID Match), by table name. */
  matches?: Record<string, IdMatch>;
}

/** The File System Access API's handle to a file, where the browser has one: Refresh can read the file again without asking. */
interface FileHandle {
  getFile(): Promise<File>;
  queryPermission?(d: { mode: 'read' }): Promise<PermissionState>;
  requestPermission?(d: { mode: 'read' }): Promise<PermissionState>;
}

// ---- the remembered handles (IndexedDB: a handle cannot go into localStorage) ----
const IDB_NAME = 'ip-datasources';
const idb = <T,>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> =>
  new Promise((resolve) => {
    try {
      const open = indexedDB.open(IDB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('handles');
      open.onerror = () => resolve(undefined);
      open.onsuccess = () => {
        const req = run(open.result.transaction('handles', mode).objectStore('handles'));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(undefined);
      };
    } catch {
      resolve(undefined);
    }
  });
const saveHandle = (id: string, h: FileHandle) => idb('readwrite', (s) => s.put(h, id));
const loadHandle = (id: string) => idb<FileHandle>('readonly', (s) => s.get(id) as IDBRequest<FileHandle>);
const dropHandle = (id: string) => idb('readwrite', (s) => s.delete(id));

interface DataSourcesState {
  sources: DataSourceMeta[];
  selectedId: string | null;
  /** The tables read in this session, by source id then table name (not remembered). */
  data: Record<string, Record<string, DataTable>>;
  busy: Record<string, boolean>;
  /** Why a source could not be read (not remembered). */
  errors: Record<string, string>;
  /** The triggers between the 3D and the tables (the same for every source). */
  triggers: LinkTriggers;
  setTriggers: (patch: Partial<LinkTriggers>) => void;
  setMatch: (id: string, table: string, match: IdMatch) => void;
  select: (id: string | null) => void;
  setTable: (id: string, table: string) => void;
  add: (file: File, handle?: FileHandle) => Promise<string | null>;
  refresh: (id: string, file?: File, handle?: FileHandle) => Promise<void>;
  /** Reads the sources the browser still allows reading without asking (at start-up). */
  restore: () => Promise<void>;
  remove: (id: string) => void;
  rename: (id: string, name: string) => void;
}

const newId = () => `ds-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export const useDataSourcesStore = create<DataSourcesState>()(
  persist(
    (set, get) => {
      /** Reads `file` into the source's tables. */
      const load = async (meta: DataSourceMeta, file: File) => {
        set((s) => ({ busy: { ...s.busy, [meta.id]: true }, errors: { ...s.errors, [meta.id]: '' } }));
        try {
          const tables = await readTables(meta.kind, file);
          set((s) => ({
            data: { ...s.data, [meta.id]: tables },
            sources: s.sources.map((x) => (x.id === meta.id ? { ...x, loadedAt: Date.now(), table: x.table && x.table in tables ? x.table : null } : x)),
          }));
        } catch (e) {
          set((s) => ({ errors: { ...s.errors, [meta.id]: e instanceof Error ? e.message : String(e) } }));
        } finally {
          set((s) => ({ busy: { ...s.busy, [meta.id]: false } }));
        }
      };
      return {
        sources: [],
        selectedId: null,
        data: {},
        busy: {},
        errors: {},
        triggers: DEFAULT_TRIGGERS,
        setTriggers: (patch) => set((s) => ({ triggers: { ...s.triggers, ...patch } })),
        setMatch: (id, table, match) => set((s) => ({ sources: s.sources.map((x) => (x.id === id ? { ...x, matches: { ...x.matches, [table]: match } } : x)) })),
        select: (selectedId) => set({ selectedId }),
        setTable: (id, table) => set((s) => ({ sources: s.sources.map((x) => (x.id === id ? { ...x, table } : x)) })),
        rename: (id, name) => set((s) => ({ sources: s.sources.map((x) => (x.id === id ? { ...x, name: name.trim() || x.name } : x)) })),
        add: async (file, handle) => {
          const kind = kindOfFile(file.name);
          if (!kind) return null;
          const meta: DataSourceMeta = { id: newId(), name: file.name.replace(/\.[^.]+$/, ''), kind, fileName: file.name, table: null, loadedAt: 0 };
          set((s) => ({ sources: [...s.sources, meta], selectedId: meta.id }));
          if (handle) void saveHandle(meta.id, handle);
          await load(meta, file);
          return meta.id;
        },
        refresh: async (id, file, handle) => {
          const meta = get().sources.find((x) => x.id === id);
          if (!meta) return;
          if (handle) void saveHandle(id, handle);
          let f = file;
          if (!f) {
            const h = await loadHandle(id);
            try {
              if (h && (await h.requestPermission?.({ mode: 'read' })) !== 'denied') f = await h.getFile();
            } catch {
              f = undefined;
            }
          }
          if (!f) {
            set((s) => ({ errors: { ...s.errors, [id]: 'The file cannot be read again from here: choose it again with the file button.' } }));
            return;
          }
          await load(meta, f);
        },
        restore: async () => {
          for (const meta of get().sources) {
            if (get().data[meta.id]) continue;
            const h = await loadHandle(meta.id);
            try {
              if (h && (await h.queryPermission?.({ mode: 'read' })) === 'granted') await load(meta, await h.getFile());
            } catch {
              // it stays unread: Refresh asks again
            }
          }
        },
        remove: (id) => {
          void dropHandle(id);
          set((s) => {
            const { [id]: _data, ...data } = s.data;
            const sources = s.sources.filter((x) => x.id !== id);
            return { sources, data, selectedId: s.selectedId === id ? sources[0]?.id ?? null : s.selectedId };
          });
        },
      };
    },
    { name: 'ip.dataSources', version: 1, partialize: (s) => ({ sources: s.sources, selectedId: s.selectedId, triggers: s.triggers }) },
  ),
);

/** The table showing for a source: the one chosen, else the first. */
export function tableOf(meta: DataSourceMeta, data: Record<string, DataTable> | undefined): { name: string; table: DataTable } | null {
  if (!data) return null;
  const names = Object.keys(data);
  const name = meta.table && data[meta.table] ? meta.table : names[0];
  return name ? { name, table: data[name] } : null;
}

export type { FileHandle };
