/** Workspaces: tabs along the top, like Blender's. Each one keeps how the app is set up, exactly, and follows every change
    you make while you are in it (no Save button): the page, the Programmes view, the panels (where they sit, which tab shows,
    their sizes), columns, filters, view settings, and the second windows that are open (what they show and where they are on
    the screen). Opening the app again puts back the one you were in.

    The first is Inputs, the second Custom; more can be added (a copy of the one you are in). Like scenes (state/scenes.ts),
    which this builds on, the layout is a snapshot of the browser's layout keys: switching writes the other workspace's keys
    back and reloads the page, which is what makes every panel read its saved state again. Unlike scenes, a workspace holds only
    layout: viewpoints, topics, programmes and the rest are the same in all of them.

    Where it is kept: the short list (names, page, view, windows) in localStorage, where the app reads it before it starts;
    the layout snapshots in IndexedDB, one per workspace. */

import { useSyncExternalStore } from 'react';
import { applyLayoutKeys, captureLayoutKeys, isLayoutKey, reloadSaved } from './scenes';
import { IS_SATELLITE } from './satellite';
import { closeSatelliteWindows, openSatelliteWindow, satelliteWindows, WINDOWS_EVENT, type WindowInfo } from './windowSync';

export interface Workspace {
  id: string;
  name: string;
  /** The page it opens on (App's PageId). */
  page: string;
  /** The Programmes view it opens on. */
  tab: string | null;
  /** The second windows it opens. */
  windows: WindowInfo[];
  /** The first one, Inputs: it stays. */
  fixed?: boolean;
}

interface List {
  items: Workspace[];
  activeId: string;
}

const KEY = 'profiles.workspaces';
const EVENT = 'ip-workspaces';

// ---- IndexedDB: one layout snapshot per workspace ----

const IDB_NAME = 'insight-plan-workspaces';
const IDB_STORE = 'layouts';
let dbPromise: Promise<IDBDatabase> | null = null;
const idb = () =>
  (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB is not available.'));
  }));
async function idbRun<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, mode);
    const req = run(tx.objectStore(IDB_STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? new Error('Saving the workspace failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('Saving the workspace failed.'));
  });
}
const putLayout = (id: string, layout: Record<string, string>) => idbRun('readwrite', (s) => s.put(layout, id));
const getLayout = (id: string) => idbRun<Record<string, string> | undefined>('readonly', (s) => s.get(id));
const delLayout = (id: string) => idbRun('readwrite', (s) => s.delete(id));

// ---- The list (localStorage) ----

const rawSet = typeof Storage === 'undefined' ? null : Storage.prototype.setItem;

function read(): List | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null') as List | null;
    return parsed && Array.isArray(parsed.items) && parsed.items.some((w) => w.id === parsed.activeId) ? parsed : null;
  } catch {
    return null;
  }
}

let cache: List | null = read();
function write(list: List) {
  cache = list;
  try {
    (rawSet ?? Storage.prototype.setItem).call(localStorage, KEY, JSON.stringify(list));
  } catch {
    // the list stays in memory for this session
  }
  window.dispatchEvent(new Event(EVENT));
}

export const workspaces = {
  list: (): List | null => cache,
  active: (): Workspace | null => cache?.items.find((w) => w.id === cache!.activeId) ?? null,
};

/** What the app opens on: the page and Programmes view of the workspace it was last in (null: no workspaces yet). */
export function initialView(): { page: string; tab: string | null } | null {
  if (IS_SATELLITE) return null;
  const w = workspaces.active();
  return w ? { page: w.page, tab: w.tab } : null;
}

/** The workspace list as React sees it. */
export function useWorkspaces(): List | null {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(EVENT, cb);
      return () => window.removeEventListener(EVENT, cb);
    },
    () => cache,
  );
}

// ---- Following the changes ----

let switching = false;
/** Windows are only noted once the ones the workspace had are opened again (else the start-up would empty its list). */
let windowsReady = false;
let timer: number | undefined;
let pending: Promise<void> = Promise.resolve();
/** Windows the browser blocked when the workspace was opened: a click on the bar opens them. */
let blocked: WindowInfo[] = [];
export const blockedWindows = () => blocked;

/** Saves the layout and the open windows into the workspace you are in. */
async function sync(): Promise<void> {
  window.clearTimeout(timer);
  if (switching || !cache) return;
  const list = cache;
  const id = list.activeId;
  await putLayout(id, captureLayoutKeys());
  if (switching || !windowsReady) return;
  const windows = satelliteWindows();
  const current = cache.items.find((w) => w.id === id);
  if (current && JSON.stringify(current.windows) !== JSON.stringify(windows)) write({ ...cache, items: cache.items.map((w) => (w.id === id ? { ...w, windows } : w)) });
}

function schedule() {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { pending = sync().catch(() => undefined); }, 600);
}

/** The page and Programmes view the app is on now (App calls it as they change). */
export function noteView(page: string, tab: string | null) {
  if (IS_SATELLITE || !cache || switching) return;
  const w = workspaces.active();
  if (!w || (w.page === page && w.tab === tab)) return;
  write({ ...cache, items: cache.items.map((x) => (x.id === w.id ? { ...x, page, tab } : x)) });
}

/** Opens the windows of the workspace; the ones the browser blocks are kept for a click. */
function openWindows(windows: WindowInfo[]) {
  blocked = windows.filter((w) => !openSatelliteWindow(w.view, w));
  window.dispatchEvent(new Event(EVENT));
}
/** From a click on the bar: opens the windows the browser blocked. */
export function openBlockedWindows() {
  const todo = blocked;
  blocked = [];
  openWindows(todo);
}

const newId = () => `ws-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Runs first, from main.tsx: the first launch makes Inputs and Custom from how the app is set up now; from then on the
    workspace you are in follows every change. */
export function startWorkspaces() {
  if (IS_SATELLITE) return;
  try {
    if (!cache) {
      let start = 'inputs';
      try { start = localStorage.getItem('app.startPage') || 'inputs'; } catch { /* the default */ }
      const inputs: Workspace = { id: newId(), name: 'Inputs', page: 'inputs', tab: null, windows: [], fixed: true };
      const custom: Workspace = { id: newId(), name: 'Custom', page: start === 'inputs' ? 'model' : start, tab: null, windows: [] };
      const layout = captureLayoutKeys();
      void putLayout(inputs.id, layout).catch(() => undefined);
      void putLayout(custom.id, layout).catch(() => undefined);
      write({ items: [inputs, custom], activeId: start === 'inputs' ? inputs.id : custom.id });
    }
    // Any write to a layout key schedules a save of the workspace you are in.
    const rawRemove = Storage.prototype.removeItem;
    const note = (storage: Storage, key: string) => {
      if (storage === localStorage && key !== KEY && !switching && isLayoutKey(key)) schedule();
    };
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      set.call(this, key, value);
      note(this, key);
    };
    Storage.prototype.removeItem = function (key: string) {
      rawRemove.call(this, key);
      note(this, key);
    };
    window.addEventListener(WINDOWS_EVENT, schedule);
    // Closing the app saves it as it is, then closes the second windows (they open again with the workspace).
    window.addEventListener('pagehide', () => {
      void sync().catch(() => undefined);
      if (!switching) closeSatelliteWindows();
    });
    // The second windows of the workspace the app opens in.
    window.setTimeout(() => {
      const w = workspaces.active();
      if (w?.windows.length) openWindows(w.windows);
      windowsReady = true;
    }, 400);
  } catch {
    // workspaces are off: the browser keeps its own layout
  }
}

// ---- The tabs ----

const uniqueName = (list: List, base: string) => {
  let name = base;
  for (let n = 2; list.items.some((w) => w.name.toLowerCase() === name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
};

export const workspaceActions = {
  /** Goes to a workspace: the one you are in is saved, then the page reloads with the other's layout. */
  async switchTo(id: string) {
    if (!cache || cache.activeId === id || !cache.items.some((w) => w.id === id)) return;
    await pending;
    await sync();
    const target = cache.items.find((w) => w.id === id)!;
    const layout = await getLayout(id);
    switching = true;
    closeSatelliteWindows();
    write({ ...cache, activeId: id });
    if (layout) applyLayoutKeys(layout);
    try { localStorage.setItem('app.startPage', target.page); } catch { /* the workspace's own page is read from the list */ }
    void reloadSaved();
  },

  /** A new workspace: a copy of how the app is now, and you are in it. */
  async add(name: string) {
    if (!cache) return;
    await pending;
    await sync();
    const here = workspaces.active();
    const list = cache;
    const ws: Workspace = { id: newId(), name: uniqueName(list, name.trim() || 'Workspace'), page: here?.page ?? 'model', tab: here?.tab ?? null, windows: satelliteWindows() };
    await putLayout(ws.id, captureLayoutKeys());
    write({ items: [...list.items, ws], activeId: ws.id });
  },

  rename(id: string, name: string) {
    if (!cache || !name.trim()) return;
    write({ ...cache, items: cache.items.map((w) => (w.id === id && !w.fixed ? { ...w, name: name.trim() } : w)) });
  },

  async remove(id: string) {
    if (!cache) return;
    const w = cache.items.find((x) => x.id === id);
    if (!w || w.fixed) return;
    if (cache.activeId === id) await workspaceActions.switchTo(cache.items.find((x) => x.fixed)?.id ?? cache.items[0].id);
    if (!cache) return;
    await delLayout(id).catch(() => undefined);
    write({ ...cache, items: cache.items.filter((x) => x.id !== id) });
  },
};
