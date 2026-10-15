import { create } from 'zustand';
import { FEATURES } from '../features';
import { IS_SATELLITE } from './satellite';
import { useScheduleStore } from './scheduleStore';
import { buildDbSchedule } from '../schedule/importSchedule';
import type { ScheduleModel } from '../schedule/types';
import { programmeRowOps } from '../schedule/nativeOps';
import { withOverrides, useActivityOverridesStore } from './activityOverridesStore';
import { programmeKey } from './unloadedWbsStore';
import {
  applyProgrammeOps,
  blankProgramme,
  copyProgramme,
  deleteProgramme,
  renameProgramme,
  saveBaseline,
  fetchChanges,
  fetchProgrammes,
  importProgramme,
  linkP6Projects,
  openDb,
  programmeTablesUrl,
  setProgrammesHidden,
  type DbProgramme,
  type ImportOptions,
} from '../db/api';

/** The project: a folder holding the buildings' models (for Scenarios) and
    the project database, <folder>/insight-plan.db — the source of truth for
    the project's programmes (in P6's own tables), scenarios, link groups,
    trade capacities and settings, and editable in DBeaver / DB Browser for
    SQLite. With a database open, programmes load from it (Inputs imports
    into it first); edits made elsewhere are noticed (changes, polled) and
    brought in by reloadFromDb. Without one, the app works as before, from
    files, in memory. */

interface ProjectDbState {
  /** The project folder (same setting Scenarios always used). */
  root: string;
  db: { root: string; file: string } | null;
  error: string | null;
  programmes: DbProgramme[];
  /** Programme id → load progress (0–1) while loading. */
  loading: Record<number, number>;
  /** Commits made to the file by other programs, as counted by the server… */
  changes: number;
  /** …and the count when the app last reloaded. */
  seenChanges: number;
  busy: string | null;
}

const ROOT_KEY = 'scenarios.root';
function loadRoot(): string {
  if (FEATURES.browserData) return '';
  try {
    return JSON.parse(localStorage.getItem(ROOT_KEY) ?? '""') as string;
  } catch {
    return '';
  }
}

export const useProjectDbStore = create<ProjectDbState>(() => ({
  root: loadRoot(),
  db: null,
  error: null,
  programmes: [],
  loading: {},
  changes: 0,
  seenChanges: 0,
  busy: null,
}));

useProjectDbStore.subscribe((s, prev) => {
  if (s.root === prev.root) return;
  try {
    localStorage.setItem(ROOT_KEY, JSON.stringify(s.root));
  } catch {
    // not remembered
  }
});

const get = () => useProjectDbStore.getState();
const set = useProjectDbStore.setState;

/** The open database's folder, or null (then everything works from files). */
export const dbRoot = () => get().db?.root ?? null;

/** Other stores' part in open / reload: pull reads their data from the
    database (see db/dbSync.ts). */
interface DbSyncer {
  pull: (root: string, reason: 'open' | 'reload') => Promise<void>;
}
const syncers: DbSyncer[] = [];
export function addDbSyncer(s: DbSyncer) {
  syncers.push(s);
}

export const dbScheduleId = (programmeId: number) => `db-${programmeId}`;

// ---- programmes ----

function replaceSchedule(model: ScheduleModel, hidden: boolean) {
  const store = useScheduleStore.getState();
  const exists = store.schedules.some((s) => s.id === model.id);
  const hiddenIds = new Set(store.hiddenScheduleIds);
  if (hidden) hiddenIds.add(model.id);
  else hiddenIds.delete(model.id);
  useScheduleStore.setState({
    schedules: exists ? store.schedules.map((s) => (s.id === model.id ? model : s)) : [...store.schedules, model],
    // A hidden programme (a saved baseline looked at, say) does not take the selection from the one being worked on.
    selectedId: exists || hidden ? store.selectedId : model.id,
    hiddenScheduleIds: hiddenIds,
  });
}

/** Reads one programme from the database's P6 tables into the app. */
export async function loadProgramme(p: DbProgramme) {
  const db = get().db;
  if (!db) return;
  set((s) => ({ loading: { ...s.loading, [p.id]: 0 } }));
  try {
    const model = await buildDbSchedule(programmeTablesUrl(db.root, p.id), p.name, p.projectIds, (_label, fraction) =>
      set((s) => ({ loading: { ...s.loading, [p.id]: fraction } })),
    );
    if (get().db?.root !== db.root) return;
    model.id = dbScheduleId(p.id);
    model.dbProgrammeId = p.id;
    model.sourceFileName = p.name;
    model.editable = p.editable;
    markSaved(model);
    replaceSchedule(model, p.hidden);
  } finally {
    set((s) => {
      const loading = { ...s.loading };
      delete loading[p.id];
      return { loading };
    });
  }
}

/** Brings the app's programmes in line with the database: drops the ones
    deleted there, applies hidden flags, loads the shown ones not loaded yet
    (all shown ones with `reloadAll`). Hidden ones load when first shown. */
async function syncProgrammes(reloadAll: boolean) {
  const db = get().db;
  if (!db) return;
  const programmes = await fetchProgrammes(db.root);
  set({ programmes });
  // A second window gets the programmes from the window that opened it (state/windowSync.ts): reading them again from the
  // database would take as long a second time, in both windows' memory.
  if (IS_SATELLITE) return;
  const ids = new Set(programmes.map((p) => p.id));
  const store = useScheduleStore.getState();
  for (const s of store.schedules) if (s.dbProgrammeId !== undefined && !ids.has(s.dbProgrammeId)) store.removeSchedule(s.id);
  const loadedIds = new Set(useScheduleStore.getState().schedules.flatMap((s) => (s.dbProgrammeId !== undefined ? [s.dbProgrammeId] : [])));
  const hiddenIds = new Set(useScheduleStore.getState().hiddenScheduleIds);
  for (const p of programmes) {
    if (!loadedIds.has(p.id)) continue;
    if (p.hidden) hiddenIds.add(dbScheduleId(p.id));
    else hiddenIds.delete(dbScheduleId(p.id));
  }
  useScheduleStore.setState({ hiddenScheduleIds: hiddenIds });
  const errors: string[] = [];
  await Promise.all(
    programmes
      .filter((p) => (reloadAll ? loadedIds.has(p.id) || !p.hidden : !loadedIds.has(p.id) && !p.hidden))
      .map((p) => loadProgramme(p).catch((e) => errors.push(`${p.name}: ${e instanceof Error ? e.message : e}`))),
  );
  if (errors.length) throw new Error(errors.join('\n'));
}

async function run(label: string, fn: () => Promise<void>) {
  set({ busy: label, error: null });
  try {
    await fn();
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    set({ busy: null });
  }
}

/** Opens (creating if needed) the project folder's database and loads the
    project from it. The previous project's programmes are unloaded. */
export const openProject = (root = get().root) =>
  run('Opening the project database…', async () => {
    if (!root.trim()) return;
    const store = useScheduleStore.getState();
    const previous = get().db;
    if (previous && previous.root !== root) {
      for (const s of store.schedules) if (s.dbProgrammeId !== undefined) store.removeSchedule(s.id);
    }
    set({ db: null, programmes: [] });
    const res = await openDb(root);
    set({ db: { root: res.root, file: res.file }, changes: res.changes, seenChanges: res.changes });
    await syncProgrammes(false);
    for (const s of syncers) await s.pull(res.root, 'open');
  });

export function closeProject() {
  const store = useScheduleStore.getState();
  for (const s of store.schedules) if (s.dbProgrammeId !== undefined) store.removeSchedule(s.id);
  set({ db: null, programmes: [], error: null });
}

/** "Reload from database": programmes, scenario, link groups, capacities
    and settings, as the file has them now (e.g. after edits in DBeaver). */
export const reloadFromDb = () =>
  run('Reloading from the project database…', async () => {
    const db = get().db;
    if (!db) return;
    await flushEditable();
    const changes = await fetchChanges(db.root).catch(() => get().changes);
    await syncProgrammes(true);
    for (const s of syncers) await s.pull(db.root, 'reload');
    set({ changes, seenChanges: changes });
  });


// ---- programmes edited in place ----

/** An editable programme's edits change its model; they are written to the database a moment after, as the row changes between the
    model as last written and as it is now (schedule/nativeOps.ts). Undo and redo are changes of the model like any other. */
interface EditableSave {
  /** Edits not yet written. */
  pending: boolean;
  error: string | null;
  /** When the last write finished (ms). */
  savedAt: number | null;
}
export const useEditableSaveStore = create<EditableSave>(() => ({ pending: false, error: null, savedAt: null }));

/** Schedule id -> the model as the database has it. */
const written = new Map<string, ScheduleModel>();
const markSaved = (m: ScheduleModel) => {
  if (m.editable) written.set(m.id, m);
  else written.delete(m.id);
};

const SAVE_DELAY_MS = 800;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> = Promise.resolve();

async function writeEditable() {
  const db = get().db;
  // A satellite window's edits reach the window that opened it, which writes them.
  if (!db || IS_SATELLITE) return;
  for (const m of useScheduleStore.getState().schedules) {
    if (!m.editable || m.dbProgrammeId === undefined) continue;
    const base = written.get(m.id);
    if (!base || base === m) continue;
    const ops = programmeRowOps(base, m);
    try {
      if (ops.length) await applyProgrammeOps(db.root, m.dbProgrammeId, ops);
      written.set(m.id, m);
    } catch (e) {
      useEditableSaveStore.setState({ error: `"${m.sourceFileName}" was not saved: ${e instanceof Error ? e.message : String(e)}`, pending: true });
      return;
    }
  }
  const stale = useScheduleStore.getState().schedules.some((m) => m.editable && written.get(m.id) !== m);
  useEditableSaveStore.setState({ pending: stale, error: null, savedAt: Date.now() });
  if (stale) scheduleSave();
}

/** Writes the edits now (before the project is reloaded or closed); resolves when they are written. */
export function flushEditable(): Promise<void> {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  saving = saving.then(writeEditable, writeEditable);
  return saving;
}

function scheduleSave() {
  useEditableSaveStore.setState({ pending: true });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flushEditable(), SAVE_DELAY_MS);
}

useScheduleStore.subscribe((s, prev) => {
  if (s.schedules === prev.schedules) return;
  const ids = new Set(s.schedules.map((m) => m.id));
  for (const id of written.keys()) if (!ids.has(id)) written.delete(id);
  if (s.schedules.some((m) => m.editable && written.has(m.id) && written.get(m.id) !== m)) scheduleSave();
});

/** A copy of a programme the app can edit in place. Edits already made on top of it are made in the copy. */
export const makeEditableCopy = (p: DbProgramme, name: string) =>
  run('Copying the programme…', async () => {
    const db = get().db;
    if (!db) return;
    await flushEditable();
    const source = useScheduleStore.getState().schedules.find((m) => m.dbProgrammeId === p.id);
    const copy = await copyProgramme(db.root, p.id, name);
    set({ programmes: await fetchProgrammes(db.root) });
    await loadProgramme(copy);
    const id = dbScheduleId(copy.id);
    const base = useScheduleStore.getState().schedules.find((m) => m.id === id);
    if (source && base) {
      const o = useActivityOverridesStore.getState();
      const key = programmeKey(source);
      const edited = withOverrides(base, o.byProgramme[key], o.links[key]);
      if (edited !== base) {
        useScheduleStore.setState((st) => ({ schedules: st.schedules.map((m) => (m.id === id ? { ...edited, id, dbProgrammeId: copy.id, editable: true, sourceFileName: base.sourceFileName } : m)) }));
        await flushEditable();
      }
    }
    useScheduleStore.getState().select(id);
  });

/** Keeps the programme as it is now under a name (a baseline): a frozen copy of it, hidden until it is looked at. */
export const saveBaselineOf = (p: DbProgramme, name: string) =>
  run('Saving the baseline…', async () => {
    const db = get().db;
    if (!db) return;
    await flushEditable();
    await saveBaseline(db.root, p.id, name);
    set({ programmes: await fetchProgrammes(db.root) });
  });

export const renameBaseline = (p: DbProgramme, name: string) =>
  run('', async () => {
    const db = get().db;
    if (!db) return;
    await renameProgramme(db.root, p.id, name);
    set((s) => ({ programmes: s.programmes.map((x) => (x.id === p.id ? { ...x, name } : x)) }));
    useScheduleStore.setState((s) => ({ schedules: s.schedules.map((m) => (m.dbProgrammeId === p.id ? { ...m, sourceFileName: name } : m)) }));
  });

/** Deletes a saved baseline (and unloads it). */
export const removeBaseline = (p: DbProgramme) =>
  run('', async () => {
    const db = get().db;
    if (!db) return;
    await deleteProgramme(db.root, p.id);
    useScheduleStore.getState().removeSchedule(dbScheduleId(p.id));
    set((s) => ({ programmes: s.programmes.filter((x) => x.id !== p.id) }));
  });

/** An empty programme to build from scratch. `start` is YYYY-MM-DD. */
export const newProgramme = (name: string, start: string) =>
  run('Creating the programme…', async () => {
    const db = get().db;
    if (!db) return;
    const programme = await blankProgramme(db.root, name, start);
    set({ programmes: await fetchProgrammes(db.root) });
    await loadProgramme(programme);
    useScheduleStore.getState().select(dbScheduleId(programme.id));
  });

/** Imports an XER into the database, then loads it from there. */
export async function importIntoDb(body: Blob, o: Omit<ImportOptions, 'root'>, onProgress?: (label: string, fraction: number) => void): Promise<DbProgramme> {
  const db = get().db;
  if (!db) throw new Error('No project database is open.');
  const programme = await importProgramme(body, { ...o, root: db.root }, (f) => onProgress?.(f < 1 ? 'Uploading' : 'Importing into database', f));
  onProgress?.('Importing into database', 1);
  set({ programmes: await fetchProgrammes(db.root) });
  // A scenario's new programme replaces its previous one (another id).
  const store = useScheduleStore.getState();
  const ids = new Set(get().programmes.map((p) => p.id));
  for (const s of store.schedules) if (s.dbProgrammeId !== undefined && !ids.has(s.dbProgrammeId)) store.removeSchedule(s.id);
  await loadProgramme(programme);
  return programme;
}

/** Adds projects of a P6 Professional database as a programme — read live
    from it (read-only) each time it loads. */
export async function linkP6(path: string, projectIds: string[], name: string) {
  const db = get().db;
  if (!db) throw new Error('No project database is open.');
  const programme = await linkP6Projects(db.root, path, projectIds, name);
  set({ programmes: await fetchProgrammes(db.root) });
  await loadProgramme(programme);
}

/** Shows / hides programmes, remembered in the database. */
export async function setHidden(changes: Record<number, boolean>) {
  const db = get().db;
  if (!db) return;
  await setProgrammesHidden(db.root, changes);
  set((s) => ({ programmes: s.programmes.map((p) => (p.id in changes ? { ...p, hidden: changes[p.id] } : p)) }));
  const loaded = new Set(useScheduleStore.getState().schedules.map((s) => s.dbProgrammeId));
  const hiddenIds = new Set(useScheduleStore.getState().hiddenScheduleIds);
  for (const [id, hidden] of Object.entries(changes)) {
    if (hidden) hiddenIds.add(dbScheduleId(Number(id)));
    else hiddenIds.delete(dbScheduleId(Number(id)));
  }
  useScheduleStore.setState({ hiddenScheduleIds: hiddenIds });
  await Promise.all(get().programmes.filter((p) => p.id in changes && !changes[p.id] && !loaded.has(p.id)).map((p) => loadProgramme(p)));
}

export const toggleHidden = (p: DbProgramme) =>
  run('', () => setHidden({ [p.id]: !p.hidden }));

export const removeProgramme = (p: DbProgramme) =>
  run('', async () => {
    const db = get().db;
    if (!db) return;
    const what = p.sourceFormat === 'p6db' ? 'the link to these P6 projects (the P6 database is not changed)' : 'this programme and its P6 rows';
    if (!window.confirm(`Delete "${p.name}" from the project database?\n\nThis removes ${what}.`)) return;
    await deleteProgramme(db.root, p.id);
    useScheduleStore.getState().removeSchedule(dbScheduleId(p.id));
    set((s) => ({ programmes: s.programmes.filter((x) => x.id !== p.id) }));
  });

// ---- noticing edits made in other programs ----

let pollTimer: ReturnType<typeof setInterval> | null = null;
useProjectDbStore.subscribe((s, prev) => {
  if (s.db === prev.db) return;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  if (!s.db) return;
  const root = s.db.root;
  pollTimer = setInterval(() => {
    if (document.hidden || get().db?.root !== root) return;
    fetchChanges(root)
      .then((changes) => get().db?.root === root && changes !== get().changes && set({ changes }))
      .catch(() => undefined);
  }, 3000);
});

export const hasExternalChanges = (s: Pick<ProjectDbState, 'changes' | 'seenChanges'>) => s.changes !== s.seenChanges;
