/** Workspaces, in the view picker's menu. Each one keeps how the app is set up, exactly, when you save it: the page, the Programmes
    view, the panels (where they sit, which tab shows, their sizes), columns, filters, view settings, and the second windows that are
    open (what they show and where they are on the screen). Nothing is saved behind your back: Save keeps the changes in the workspace
    you are in, Save as new makes another from how the app is now. One workspace can be the one the app starts with; with none, the
    app opens where you left it.

    The first is Inputs, the second Custom; more can be added. Like scenes (state/scenes.ts), which this builds on, the layout is a
    snapshot of the browser's layout keys: switching writes the other workspace's keys back and reloads the page, which is what makes
    every panel read its saved state again. A workspace keeps the layout and the viewer's lists too (viewpoints, search sets, markers,
    topics...), each its own; programmes and the project's other data are the same in all of them.

    Where it is kept: the short list (names, page, view, windows, the default) in localStorage, where the app reads it before it
    starts; the layout snapshots in IndexedDB, one per workspace. */

import { useSyncExternalStore } from 'react';
import { applyLayoutKeys, captureLayoutKeys, isWorkspaceKey, reloadSaved } from './scenes';
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
  /** The workspace the app starts with (absent: where it was left). */
  defaultId?: string | null;
}

const KEY = 'profiles.workspaces';
const EVENT = 'ip-workspaces';
const LIVE_KEY = 'ws.live';
const VIEW_KEY = 'ws.view';
const SESSION_KEY = 'ws.session';
const ENTER_KEY = 'ws.enterDefault';

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

let startView: { page: string; tab: string | null } | null | undefined;
/** The app was just started (a new tab or window, not a reload): it opens on Home. */
let freshStart = false;
/** What the app opens on: the page and Programmes view of the workspace it was switched to, else where it was left (null: no workspaces yet). */
export function initialView(): { page: string; tab: string | null } | null {
  if (IS_SATELLITE) return null;
  if (startView === undefined) {
    startView = null;
    try {
      const raw = sessionStorage.getItem(VIEW_KEY);
      if (raw) {
        startView = JSON.parse(raw);
        sessionStorage.removeItem(VIEW_KEY);
      } else if (freshStart) {
        // The app always starts on Home: from there a scene opens in its default workspace.
        startView = { page: 'home', tab: null };
      } else {
        const live = localStorage.getItem(LIVE_KEY);
        if (live) startView = JSON.parse(live);
      }
    } catch {
      // the workspace's own page below
    }
    if (!startView) {
      const w = workspaces.active();
      if (w) startView = { page: w.page, tab: w.tab };
    }
  }
  return startView ?? null;
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

// ---- Changes since the last save ----

let switching = false;
/** The layout has changed since the workspace was saved (the start-up's own writes do not count). */
let dirty = false;
let quietUntil = 0;
/** Windows the browser blocked when the workspace was opened: a click on the menu opens them. */
let blocked: WindowInfo[] = [];
export const blockedWindows = () => blocked;
/** The workspace you are in has changes that are not saved. */
export const workspaceDirty = () => dirty;

function markDirty() {
  if (dirty || switching || Date.now() < quietUntil) return;
  dirty = true;
  window.dispatchEvent(new Event(EVENT));
}

/** The page and Programmes view the app is on now (App calls it as they change). Kept for the next start; saved with the workspace on Save. */
let live: { page: string; tab: string | null } | null = null;
export function noteView(page: string, tab: string | null) {
  if (IS_SATELLITE || !cache || switching) return;
  live = { page, tab };
  try { localStorage.setItem(LIVE_KEY, JSON.stringify(live)); } catch { /* not kept */ }
  const w = workspaces.active();
  // (Home is the way into a workspace, not a page of one: being there changes nothing in it.)
  if (w && page !== 'home' && (w.page !== page || w.tab !== tab)) markDirty();
}

/** Opens the windows of the workspace; the ones the browser blocks are kept for a click. */
function openWindows(windows: WindowInfo[]) {
  blocked = windows.filter((w) => !openSatelliteWindow(w.view, w));
  window.dispatchEvent(new Event(EVENT));
}
/** From a click in the menu: opens the windows the browser blocked. */
export function openBlockedWindows() {
  const todo = blocked;
  blocked = [];
  openWindows(todo);
}

const newId = () => `ws-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const sameLayout = (a: Record<string, string>, b: Record<string, string>) => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};

/** The page and view a workspace keeps: where you are, but never Home (that is where you pick a scene, not part of the workspace). */
function workPage(view: { page: string; tab: string | null } | null, w: Workspace | null | undefined): { page: string; tab: string | null } {
  if (view && view.page !== 'home') return view;
  if (w && w.page !== 'home') return { page: w.page, tab: w.tab };
  return { page: 'schedule', tab: 'gantt' };
}

/** Goes to a workspace: its layout keys are written back and the page reloads. */
async function enter(id: string) {
  const target = cache!.items.find((w) => w.id === id)!;
  const layout = await getLayout(id);
  switching = true;
  closeSatelliteWindows();
  write({ ...cache!, activeId: id });
  if (layout) applyLayoutKeys(layout);
  try {
    localStorage.setItem('app.startPage', target.page);
    sessionStorage.setItem(VIEW_KEY, JSON.stringify({ page: target.page, tab: target.tab }));
  } catch {
    // the workspace's own page is read from the list
  }
  void reloadSaved();
}

/** Runs first, from main.tsx: the first launch makes Inputs and Custom from how the app is set up now. A new session starts
    with the default workspace, if one is set; otherwise the app opens as it was left. */
export function startWorkspaces() {
  if (IS_SATELLITE) return;
  try {
    quietUntil = Date.now() + 2500;
    if (!cache) {
      let start = 'home';
      try { start = localStorage.getItem('app.startPage') || 'home'; } catch { /* the default */ }
      const custom: Workspace = { id: newId(), name: 'Custom', page: start === 'home' || start === 'inputs' ? 'model' : start, tab: null, windows: [] };
      void putLayout(custom.id, captureLayoutKeys()).catch(() => undefined);
      write({ items: [custom], activeId: custom.id });
    }
    // A workspace saved while Home was showing opens on the Gantt (Home is not a page of a workspace).
    if (cache && cache.items.some((w) => w.page === 'home' && !w.fixed)) {
      write({ ...cache, items: cache.items.map((w) => (w.page === 'home' && !w.fixed ? { ...w, page: 'schedule', tab: w.tab ?? 'gantt' } : w)) });
    }
    // The Inputs / Home workspace of earlier versions is gone: Home is a page of its own now, not a workspace.
    if (cache && cache.items.length > 1 && cache.items.some((w) => w.fixed)) {
      const gone = cache.items.filter((w) => w.fixed);
      const rest = cache.items.filter((w) => !w.fixed);
      for (const w of gone) void delLayout(w.id).catch(() => undefined);
      write({
        ...cache,
        items: rest,
        activeId: rest.some((w) => w.id === cache!.activeId) ? cache.activeId : rest[0].id,
        defaultId: rest.some((w) => w.id === cache!.defaultId) ? cache.defaultId : null,
      });
    }
    // Any write to a layout key means the workspace has changes to save.
    const rawRemove = Storage.prototype.removeItem;
    const note = (storage: Storage, key: string) => {
      if (storage === localStorage && key !== KEY && key !== LIVE_KEY && !switching && isWorkspaceKey(key)) markDirty();
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
    window.addEventListener(WINDOWS_EVENT, markDirty);
    // Closing the app closes the second windows (they open again with the workspace, as it was saved).
    window.addEventListener('pagehide', () => { if (!switching) closeSatelliteWindows(); });

    let fresh = false;
    try {
      fresh = !sessionStorage.getItem(SESSION_KEY);
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {
      // not a new session as far as we know
    }
    // Opening a scene from Home (asked for before the reload) goes to the default workspace, as it was saved: its page and second windows.
    let enterDefault = false;
    try {
      enterDefault = sessionStorage.getItem(ENTER_KEY) === '1';
      sessionStorage.removeItem(ENTER_KEY);
    } catch {
      // no
    }
    const def = enterDefault && cache?.defaultId ? cache.items.find((w) => w.id === cache!.defaultId) : undefined;
    if (def) {
      void (async () => {
        const saved = await getLayout(def.id).catch(() => undefined);
        // Already in it, with the layout as saved: nothing to put back.
        if (cache!.activeId === def.id && saved && sameLayout(saved, captureLayoutKeys())) {
          if (def.windows.length) openWindows(def.windows);
          return;
        }
        await enter(def.id);
      })();
      return;
    }
    // The app starts on Home with no second windows: a scene opened from there goes to the default workspace and opens them.
    freshStart = fresh && !enterDefault;
    if (freshStart) return;
    // The second windows of the workspace the app opens in.
    window.setTimeout(() => {
      const w = workspaces.active();
      if (w?.windows.length) openWindows(w.windows);
    }, 400);
  } catch {
    // workspaces are off: the browser keeps its own layout
  }
}

// ---- The workspaces ----

const uniqueName = (list: List, base: string) => {
  let name = base;
  for (let n = 2; list.items.some((w) => w.name.toLowerCase() === name.toLowerCase()); n++) name = `${base} ${n}`;
  return name;
};

/** Opening a scene from Home: the next load goes to the default workspace (its page, its Programmes view and its second windows), as a new session does.
    False when no workspace is the default: then the app stays where it is. */
export function openDefaultWorkspace(): boolean {
  const def = cache?.defaultId ? cache.items.find((w) => w.id === cache!.defaultId) : undefined;
  if (!def) return false;
  try {
    // The page it opens on (read before the start-up check below can say): the workspace's own page and Programmes view.
    sessionStorage.setItem(VIEW_KEY, JSON.stringify({ page: def.page, tab: def.tab }));
    sessionStorage.setItem(ENTER_KEY, '1');
  } catch { /* it opens where it was */ }
  return true;
}

export const workspaceActions = {
  /** Goes to a workspace: the page reloads with its saved layout. What you changed in the one you leave is lost unless you saved it. */
  async switchTo(id: string) {
    if (!cache || cache.activeId === id || !cache.items.some((w) => w.id === id)) return;
    await enter(id);
  },

  /** Keeps how the app is now in the workspace you are in: its layout, viewer lists, page, Programmes view and second windows. */
  async save() {
    if (!cache) return;
    const w = workspaces.active();
    if (!w) return;
    await putLayout(w.id, captureLayoutKeys());
    const view = workPage(live, w);
    const windows = satelliteWindows();
    dirty = false;
    write({ ...cache, items: cache.items.map((x) => (x.id === w.id ? { ...x, page: view.page, tab: view.tab, windows } : x)) });
  },

  /** A new workspace made from how the app is now; you are in it. */
  async add(name: string) {
    if (!cache) return;
    const list = cache;
    const here = workspaces.active();
    const view = workPage(live, here);
    const ws: Workspace = { id: newId(), name: uniqueName(list, name.trim() || 'Workspace'), page: view.page, tab: view.tab, windows: satelliteWindows() };
    await putLayout(ws.id, captureLayoutKeys());
    dirty = false;
    write({ ...list, items: [...list.items, ws], activeId: ws.id });
  },

  /** The workspace the app starts with (null: it opens as it was left). */
  setDefault(id: string | null) {
    if (!cache) return;
    write({ ...cache, defaultId: id && cache.items.some((w) => w.id === id) ? id : null });
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
    write({ ...cache, defaultId: cache.defaultId === id ? null : cache.defaultId, items: cache.items.filter((x) => x.id !== id) });
  },
};
