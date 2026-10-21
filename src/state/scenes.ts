/** Scenes: the whole arrangement of the app AND the viewer's own data, saved under a name and kept up to date
    as you work (no Save button). A scene remembers the page the app opens on, side-pane tabs, panel and column
    sizes, column choices, group / filter / sort / colour rules, view settings, switches — and owns its
    viewpoints, topics, search sets, markers, fly-throughs and saved view settings.

    Everything the app remembers in the browser is a localStorage key (usePersistedState, the saved zustand
    stores, the resizable panes), so a scene is a snapshot of those keys in two parts: `settings` (layout) and
    `data` (SCENE_DATA, the scene's own lists). The active scene is rewritten from the browser's keys a moment
    after any of them changes. Switching scenes writes the other scene's keys back and reloads the page, which
    is what makes every panel read its saved size / tab / list again.

    Where it is kept: localStorage holds only the short list of scenes (name, time, counts, which is active).
    The snapshots are large (viewpoint thumbnails), so they live in IndexedDB, one per scene. Old layout profiles
    and the first version of scenes kept snapshots in the list itself: they are moved to IndexedDB at start-up.
    A scene from an old layout profile has no `data`: opening it leaves the lists alone. */

import { FREE_MODE } from '../licence/freeMode';
import { FILE_VIEW_KEY, stripView, viewOf, withView } from './fileView';

export const SCENE_KIND = 'insight-plan-scene';
const OLD_PROFILE_KIND = 'insight-plan-layout-profile';
const VERSION = 2;
const STORE_KEY = 'profiles.layout';
/** The page the app opens on. */
export const START_PAGE_KEY = 'app.startPage';

/** The lists a scene owns: each scene has its own, swapped in when the scene is opened. */
const SCENE_DATA = new Set([
  'viewer.viewpoints',
  'viewer.searchSets',
  'viewer.markers',
  'viewer.constructionPlanes',
  'viewer.flythrough',
  'models.topics',
  'views.savedAttributes',
  'ip.viewer.selectionSets',
  'ip.viewer.finderQueries',
]);

/** Layout keys a scene written before they were part of scenes does not have, or has empty (saved before a folder was open): opening it keeps what the browser has
    (the project folder, so an older scene does not open with none). */
const KEEP_WHEN_ABSENT = ['scenarios.root', 'sequence.tags', 'sequence.modelPlacement'];

/** Browser keys that are neither layout nor a scene's lists: the user's other data, caches, or the scenes themselves. */
const NOT_LAYOUT = new Set([
  STORE_KEY,
  'profiles.workspaces',
  'scenes.details',
  'app.browserDataImported',
  'inputs.fileSizes',
  'inputs.fileUploads',
  'models.propEdit.backup',
  'scenarios.startDate',
  'resources.capacity',
  'sequence.linkGroups',
  'sequence.appearanceProfiles',
  'viewer.activityNotes',
  'viewer.ppcReasons',
  'models.customFields',
  'timelines.data',
  'schedule.pourMap',
  'schedule.unloadedWbs',
  'schedule.autoLinks',
  'schedule.calcColumns',
  'schedule.activityOverrides',
  // Home's own arrangement is the same in every scene and workspace.
  'home.view',
  'home.chosen',
  'home.dock',
  'inputs.detailsTab',
  'inputs.detailsOpen',
  'app.fileViewReset1',
]);

/** Which part of a scene a browser key belongs to (exported for the tests). */
export const isDataKey = (key: string) => SCENE_DATA.has(key);
export const isLayoutKey = (key: string) => !NOT_LAYOUT.has(key) && !SCENE_DATA.has(key);

/** What a scene holds: localStorage key → its stored text. */
export interface Snapshot {
  /** Layout. */
  settings: Record<string, string>;
  /** The scene's own lists (viewpoints, topics…). Absent in a scene that came from an old layout profile: its lists are left alone. */
  data?: Record<string, string>;
}

export interface SceneCounts {
  viewpoints: number;
  topics: number;
  markers: number;
  /** What was loaded when it was last saved (the models and programmes themselves are in the project, not in the scene). */
  activities?: number;
  objects?: number;
  models?: number;
  /** The programme loaded (its project name). */
  programme?: string;
  /** The files loaded (models, site context, programmes), by name: what Home lists in the Files panel for the scene. */
  files?: string[];
}

/** A scene as the list knows it (its snapshot is in IndexedDB). */
export interface Scene {
  id: string;
  name: string;
  savedAt: string;
  /** What its lists hold; absent for a scene without lists (from an old layout profile). */
  counts?: SceneCounts;
  /** A small picture of the scene (a JPEG data URL), shown on its tile on Home. */
  thumb?: string;
  /** Kept at the top of Home. */
  pinned?: boolean;
}

interface Store {
  scenes: Scene[];
  activeId: string | null;
}

// ---- IndexedDB: one snapshot per scene ----

const IDB_NAME = 'insight-plan-scenes';
const IDB_STORE = 'snapshots';
let dbPromise: Promise<IDBDatabase> | null = null;

function idb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB is not available.'));
  });
  return dbPromise;
}

async function idbRun<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode);
    const req = run(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? new Error('Saving the scene failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Saving the scene failed (the browser may be out of space).'));
  });
}

const putSnap = (id: string, snap: Snapshot) => idbRun('readwrite', (s) => s.put(snap, id));
const getSnap = (id: string) => idbRun<Snapshot | undefined>('readonly', (s) => s.get(id));
const delSnap = (id: string) => idbRun('readwrite', (s) => s.delete(id));

// ---- The list (localStorage) ----

function read(): Store {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as { scenes?: Scene[]; profiles?: Scene[]; activeId?: string | null } | null;
    const raw = Array.isArray(parsed?.scenes) ? parsed!.scenes! : Array.isArray(parsed?.profiles) ? parsed!.profiles! : [];
    // (An old list still holds snapshots until the start-up move: only the short fields are used.)
    const scenes = raw.map((s): Scene => ({ id: s.id, name: s.name, savedAt: s.savedAt, counts: s.counts, ...(s.thumb ? { thumb: s.thumb } : {}), ...(s.pinned ? { pinned: true } : {}) }));
    return { scenes, activeId: parsed?.activeId && scenes.some((s) => s.id === parsed.activeId) ? parsed.activeId : null };
  } catch {
    return { scenes: [], activeId: null };
  }
}

let rawSetItem: Storage['setItem'] | null = null;

function write(store: Store) {
  (rawSetItem ?? Storage.prototype.setItem).call(localStorage, STORE_KEY, JSON.stringify(store));
  window.dispatchEvent(new Event('ip-scenes'));
}

/** The browser's keys, split into the layout and the scene's lists. */
function capture(): Required<Snapshot> {
  const settings: Record<string, string> = {};
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const value = localStorage.getItem(key) as string;
    if (isDataKey(key)) data[key] = value;
    else if (isLayoutKey(key)) settings[key] = value;
  }
  return { settings, data };
}

/** How many items a saved list holds (a persisted zustand store: { state: { <prop>: [...] } }). */
function countIn(data: Record<string, string> | undefined, key: string, prop: string): number {
  try {
    const list = (JSON.parse(data?.[key] ?? 'null') as { state?: Record<string, unknown> } | null)?.state?.[prop];
    return Array.isArray(list) ? list.length : 0;
  } catch {
    return 0;
  }
}
/** Counts of what is loaded now (activities, objects, models), given by the app; the scene's own lists are counted from its keys. */
let liveCounts: (() => Partial<SceneCounts>) | null = null;
export function setLiveCounts(fn: (() => Partial<SceneCounts>) | null) { liveCounts = fn; }
/** Saves the active scene now (counts and the files list): for when what is loaded has just changed without a layout key changing. */
export function touchScene() { if (!suspended) timer = window.setTimeout(() => void sync().catch(() => undefined), 300); }
const countsOf = (data: Record<string, string> | undefined, live = true): SceneCounts | undefined =>
  data ? { viewpoints: countIn(data, 'viewer.viewpoints', 'records'), topics: countIn(data, 'models.topics', 'topics'), markers: countIn(data, 'viewer.markers', 'markers'), ...(live ? liveCounts?.() : undefined) } : undefined;

// While a scene's keys are being written back (or the page is about to reload), the writes are not autosaved.
let suspended = false;
let timer: number | undefined;
/** Resolves when the start-up move of old snapshots is done: nothing rewrites the list before. */
let ready: Promise<void> = Promise.resolve();

/** Saves the browser's keys into the active scene. */
async function sync(): Promise<void> {
  if (suspended) return;
  window.clearTimeout(timer);
  await ready;
  // The 3D view writes its own state (cameras, what is hidden, the selection ...) into the browser's keys first.
  window.dispatchEvent(new Event('ip-scene-flush'));
  const store = read();
  const id = store.activeId;
  if (!id) return;
  const now = capture();
  await putSnap(id, now);
  const fresh = read();
  fresh.scenes = fresh.scenes.map((s) => (s.id === id ? { ...s, savedAt: new Date().toISOString(), counts: { ...s.counts, ...countsOf(now.data) } as SceneCounts } : s));
  write(fresh);
}

/** Writes a scene's keys over the browser's. Its lists are replaced only when it has any (see Snapshot.data). */
function applyKeys(snap: Snapshot, alsoKeep: string[] = []) {
  suspended = true;
  try {
    const drop = (match: (k: string) => boolean) => {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && match(key)) localStorage.removeItem(key);
      }
    };
    const kept = [...KEEP_WHEN_ABSENT.filter((k) => !snap.settings[k] || snap.settings[k] === '""'), ...alsoKeep].map((k) => [k, localStorage.getItem(k)] as const);
    drop(isLayoutKey);
    for (const [k, v] of Object.entries(snap.settings)) if (isLayoutKey(k) && typeof v === 'string') localStorage.setItem(k, v);
    for (const [k, v] of kept) if (v !== null) localStorage.setItem(k, v);
    if (snap.data) {
      drop(isDataKey);
      for (const [k, v] of Object.entries(snap.data)) if (isDataKey(k) && typeof v === 'string') localStorage.setItem(k, v);
    }
  } catch (e) {
    suspended = false;
    throw e;
  }
}

/** Reloads the page once the project database (if one is open) has the new keys: it would otherwise pull its old values back in.
    Until then (and after) nothing is saved into a scene. */
async function reloadSaved() {
  suspended = true;
  try {
    await (await import('../db/uiSettingsSync')).flushUiSettings();
  } catch {
    // reload anyway
  }
  window.location.reload();
}

/** Keys that belong to the scene, not the workspace: which models and programme are loaded, and the Files view. A workspace never saves or restores them. */
const SCENE_OWNED = [FILE_VIEW_KEY, 'models.loaded', 'programmes.choice', 'viewer.sceneState'];

/** For workspaces (state/workspaces.ts): everything a scene holds, the layout keys and the viewer's lists, in one record (ALL_MARK says
    the lists are in it: a workspace saved before that has only layout, and opening it leaves the lists alone). */
const ALL_MARK = '__workspace.all';
export const captureLayoutKeys = () => {
  const { settings, data } = capture();
  for (const k of SCENE_OWNED) delete settings[k];
  return { ...settings, ...data, [ALL_MARK]: '1' };
};
export const applyLayoutKeys = (saved: Record<string, string>) => {
  const settings: Record<string, string> = {};
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(saved)) {
    if (isDataKey(k)) data[k] = v;
    else if (isLayoutKey(k) && k !== ALL_MARK && !SCENE_OWNED.includes(k)) settings[k] = v;
  }
  applyKeys(saved[ALL_MARK] ? { settings, data } : { settings }, SCENE_OWNED);
};
/** Whether a browser key is part of what a workspace keeps. */
export const isWorkspaceKey = (key: string) => !SCENE_OWNED.includes(key) && (isLayoutKey(key) || isDataKey(key));
export { reloadSaved };

const newId = () => `sc-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const uniqueName = (store: Store, base: string) => {
  let name = base;
  for (let n = 2; store.scenes.some((s) => s.name.toLowerCase() === name.toLowerCase()); n++) name = `${base} (${n})`;
  return name;
};

export const scenes = {
  get: read,

  /** Adds a scene and makes it the active one. With `empty` it has no viewpoints, topics… (the page reloads to show that);
      otherwise it starts as a copy of the scene you are in, so nothing changes on screen. */
  async create(name: string, empty: boolean): Promise<Scene> {
    await ready;
    await sync();
    const store = read();
    const now = capture();
    const snap: Snapshot = { settings: now.settings, data: empty ? {} : now.data };
    const scene: Scene = { id: newId(), name: uniqueName(store, name), savedAt: new Date().toISOString(), counts: countsOf(snap.data) };
    await putSnap(scene.id, snap);
    store.scenes = [...store.scenes, scene];
    store.activeId = scene.id;
    write(store);
    if (empty) {
      applyKeys(snap);
      void reloadSaved();
    }
    return scene;
  },

  /** Opens a scene: the one you are in is saved first, then the page reloads with the other's keys. */
  async activate(id: string) {
    await ready;
    await sync();
    const store = read();
    if (!store.scenes.some((s) => s.id === id) || store.activeId === id) return;
    const snap = await getSnap(id);
    if (!snap) throw new Error('That scene’s saved layout was not found in this browser.');
    store.activeId = id;
    write(store);
    applyKeys(snap);
    void reloadSaved();
  },

  /** Deletes a scene (the only one cannot be deleted); deleting the one you are in opens another. */
  async remove(id: string) {
    await ready;
    const store = read();
    if (store.scenes.length <= 1) return;
    const wasActive = store.activeId === id;
    store.scenes = store.scenes.filter((s) => s.id !== id);
    await delSnap(id).catch(() => undefined);
    if (wasActive) {
      const next = store.scenes[0];
      const snap = await getSnap(next.id);
      store.activeId = next.id;
      write(store);
      if (snap) applyKeys(snap);
      void reloadSaved();
      return;
    }
    write(store);
  },

  async rename(id: string, name: string) {
    await ready;
    const store = read();
    store.scenes = store.scenes.map((s) => (s.id === id ? { ...s, name } : s));
    write(store);
  },

  /** Sets the scene's picture (a data URL), or takes it off (null). */
  async setThumb(id: string, thumb: string | null) {
    await ready;
    const store = read();
    store.scenes = store.scenes.map((s) => {
      if (s.id !== id) return s;
      const { thumb: _old, ...rest } = s;
      return thumb ? { ...rest, thumb } : rest;
    });
    write(store);
  },

  /** The Files view (filters, grouping, sorting, columns) a scene was saved with, read from its snapshot ({} when it has none). */
  async fileView(id: string): Promise<Record<string, unknown>> {
    await ready;
    return viewOf((await getSnap(id))?.settings[FILE_VIEW_KEY]);
  },

  /** Saves the Files view into a scene's snapshot (for a scene other than the one you are in: that one saves itself). */
  async setFileView(id: string, view: Record<string, unknown>) {
    await ready;
    const snap = await getSnap(id);
    if (!snap) return;
    const text = snap.settings[FILE_VIEW_KEY] ?? JSON.stringify({ state: {}, version: 0 });
    await putSnap(id, { ...snap, settings: { ...snap.settings, [FILE_VIEW_KEY]: withView(text, JSON.stringify({ state: view })) } });
  },

  /** The models linked to a scene (by name), read from its snapshot; null when it has no list yet. */
  async linkedOf(id: string): Promise<string[] | null> {
    await ready;
    if (read().activeId === id) await sync();
    const snap = await getSnap(id);
    try { const v = JSON.parse(snap?.settings['models.loaded'] ?? 'null'); return Array.isArray(v) ? (v as string[]) : null; } catch { return null; }
  },

  /** Sets the models linked to a scene other than the one you are in (that one keeps its list in the browser: see sceneModels.ts). */
  async setLinked(id: string, names: string[]) {
    await ready;
    const snap = await getSnap(id);
    if (!snap) return;
    const list = [...new Set(names)];
    await putSnap(id, { ...snap, settings: { ...snap.settings, 'models.loaded': JSON.stringify(list) } });
    const store = read();
    store.scenes = store.scenes.map((s) => (s.id === id ? { ...s, counts: { ...(s.counts ?? { viewpoints: 0, topics: 0, markers: 0 }), models: list.length } } : s));
    write(store);
  },

  /** Adds models (by name) to the ones a scene brings back when it is opened. */
  async addLoaded(id: string, names: string[]) {
    if (!names.length) return;
    await ready;
    const snap = await getSnap(id);
    if (!snap) return;
    let have: string[] = [];
    try { const v = JSON.parse(snap.settings['models.loaded'] ?? 'null'); if (Array.isArray(v)) have = v as string[]; } catch { /* none */ }
    await putSnap(id, { ...snap, settings: { ...snap.settings, 'models.loaded': JSON.stringify([...new Set([...have, ...names])]) } });
  },

  /** Pins the scene to the top of Home, or lets it go. */
  async setPinned(id: string, pinned: boolean) {
    await ready;
    const store = read();
    store.scenes = store.scenes.map((s) => {
      if (s.id !== id) return s;
      const { pinned: _old, ...rest } = s;
      return pinned ? { ...rest, pinned: true } : rest;
    });
    write(store);
  },

  /** Downloads one scene (layout and lists) as a JSON file. */
  async exportScene(id: string) {
    await ready;
    if (read().activeId === id) await sync();
    const scene = read().scenes.find((s) => s.id === id);
    const snap = scene ? await getSnap(id) : undefined;
    if (!scene || !snap) return;
    const payload = { kind: SCENE_KIND, version: VERSION, name: scene.name, savedAt: scene.savedAt, settings: snap.settings, data: snap.data, thumb: scene.thumb };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `insight-plan-scene-${scene.name.replace(/[\\/:*?"<>|\s]+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  /** Adds the scene in a JSON file to the list (not opened). Layout profile files from before are read too. */
  async importScene(file: File): Promise<Scene> {
    let parsed: { kind?: string; name?: unknown; settings?: unknown; data?: unknown; thumb?: unknown };
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error('Not valid JSON.');
    }
    if ((parsed?.kind !== SCENE_KIND && parsed?.kind !== OLD_PROFILE_KIND) || !parsed.settings || typeof parsed.settings !== 'object') {
      throw new Error('Not an Insight Plan scene file.');
    }
    const pick = (src: unknown, ok: (k: string) => boolean) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries((src ?? {}) as Record<string, unknown>)) if (typeof v === 'string' && ok(k)) out[k] = v;
      return out;
    };
    await ready;
    const store = read();
    const base = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : file.name.replace(/\.json$/i, '');
    const snap: Snapshot = {
      settings: pick(parsed.settings, isLayoutKey),
      data: parsed.data && typeof parsed.data === 'object' ? pick(parsed.data, isDataKey) : undefined,
    };
    const scene: Scene = { id: newId(), name: uniqueName(store, base), savedAt: new Date().toISOString(), counts: countsOf(snap.data, false), ...(typeof parsed.thumb === 'string' && parsed.thumb.startsWith('data:image/') && parsed.thumb.length < 200000 ? { thumb: parsed.thumb } : {}) };
    await putSnap(scene.id, snap);
    store.scenes = [...store.scenes, scene];
    write(store);
    return scene;
  },
};

/** Moves the snapshots an older list kept inside itself to IndexedDB, and makes "Scene 1" on the very first launch from
    what the browser already holds (so nothing is lost). */
async function prepare() {
  const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as { scenes?: (Scene & Partial<Snapshot>)[]; profiles?: (Scene & Partial<Snapshot>)[]; activeId?: string | null } | null;
  const old = (Array.isArray(raw?.scenes) ? raw!.scenes! : Array.isArray(raw?.profiles) ? raw!.profiles! : []) as (Scene & Partial<Snapshot>)[];
  for (const s of old) if (s.settings) await putSnap(s.id, { settings: s.settings, data: s.data });
  const store: Store = {
    // (The picture and the pin are kept: they are part of the short list, not of the snapshot.)
    scenes: old.map((s): Scene => ({ id: s.id, name: s.name, savedAt: s.savedAt, counts: s.data ? countsOf(s.data, false) : s.counts, ...(s.thumb ? { thumb: s.thumb } : {}), ...(s.pinned ? { pinned: true } : {}) })),
    activeId: raw?.activeId && old.some((s) => s.id === raw.activeId) ? raw.activeId : null,
  };
  if (!store.activeId) {
    const now = capture();
    const scene: Scene = { id: newId(), name: uniqueName(store, store.scenes.length ? 'Current layout' : 'Scene 1'), savedAt: new Date().toISOString(), counts: countsOf(now.data) };
    await putSnap(scene.id, now);
    store.scenes = [...store.scenes, scene];
    store.activeId = scene.id;
  }
  write(store);
}

/** One-time reset: the Files filters, grouping, sorting and columns used to be shared by every scene; now each scene has its own,
    so the ones saved so far are cleared from all scenes (the details typed against files are kept). */
const FILE_VIEW_RESET = 'app.fileViewReset1';
/** Runs first, from main.tsx: from then on the active scene follows every change to the browser's keys. */
export function startScenes() {
  if (FREE_MODE) return; // saved arrangements are part of the licensed edition
  if (new URLSearchParams(window.location.search).has('satellite')) return; // a second window leaves the scene to the one that opened it
  try {
    if (!localStorage.getItem(FILE_VIEW_RESET)) {
      localStorage.setItem(FILE_VIEW_RESET, '1');
      // The scene you are in: its keys are in the browser, and nothing has read them yet.
      const mine = localStorage.getItem(FILE_VIEW_KEY);
      if (mine) localStorage.setItem(FILE_VIEW_KEY, stripView(mine));
      // The others: their snapshots, once the list is ready.
      void (async () => {
        await Promise.resolve(); // (startScenes below has set `ready` by now)
        await ready;
        for (const s of read().scenes) {
          const snap = await getSnap(s.id);
          const text = snap?.settings[FILE_VIEW_KEY];
          if (snap && text) await putSnap(s.id, { ...snap, settings: { ...snap.settings, [FILE_VIEW_KEY]: stripView(text) } });
        }
      })().catch(() => undefined);
    }
  } catch {
    // leave the saved views as they are
  }
  try {
    // The list is rewritten without snapshots at once when it is short of space; the move itself is async.
    ready = prepare().catch(() => undefined);
    // Any write to a layout / scene key schedules a save of the active scene.
    rawSetItem = Storage.prototype.setItem;
    const rawRemoveItem = Storage.prototype.removeItem;
    const schedule = (storage: Storage, key: string) => {
      if (storage !== localStorage || key === STORE_KEY || suspended || !(isLayoutKey(key) || isDataKey(key))) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void sync().catch(() => undefined), 600);
    };
    Storage.prototype.setItem = function (key: string, value: string) {
      rawSetItem!.call(this, key, value);
      schedule(this, key);
    };
    Storage.prototype.removeItem = function (key: string) {
      rawRemoveItem.call(this, key);
      schedule(this, key);
    };
    window.addEventListener('pagehide', () => void sync().catch(() => undefined));
  } catch {
    // scenes are off: the browser keeps its own layout
  }
}
