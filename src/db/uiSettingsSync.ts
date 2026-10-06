import { addDbSyncer, dbRoot, useProjectDbStore } from '../state/projectDbStore';
import { PERSISTED_CONFIG_PREFIXES } from '../utils/persistedState';
import { fetchSettings, saveSetting } from './api';

/** Keeps the app's layout settings (which columns, their order and widths,
    group / sort / colour rules, zoom, panel sizes, view settings…) in the
    project database while one is open, so they follow the project to another
    PC or browser. They are the browser's saved settings (localStorage keys under
    these prefixes), mirrored into the database's ip_setting table as "ui:<key>".

    - A change is written to the database a moment later.
    - Opening a project (or Reload from database) pulls them in. The first time
      (the database has none), the browser's go into it; after that the database
      wins for the keys it has, and the browser's keys it lacks are added to it.
    - Panels read their settings when they start, so after a pull the ones
      using usePersistedState and the saved stores re-read at once (the
      "ip-ui-settings" event); anything else shows the new values after a reload.

    Link groups, trade capacities and the scenarios' start date have tables of
    their own (dbSync.ts) and are left out here. */

export const UI_SETTINGS_EVENT = 'ip-ui-settings';

const PREFIXES = [...PERSISTED_CONFIG_PREFIXES, 'models.', 'views.', 'tables.', 'programmes.'];
const SKIP = new Set(['sequence.linkGroups', 'app.browserDataImported', 'app.sidePane']);
const DB_PREFIX = 'ui:';
const FLUSH_MS = 900;

const synced = (key: string) => !SKIP.has(key) && PREFIXES.some((p) => key.startsWith(p));

let applying = false;
const dirty = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): Promise<unknown> {
  timer = null;
  const root = dbRoot();
  const keys = [...dirty];
  dirty.clear();
  if (!root) return Promise.resolve();
  return Promise.all(keys.map((key) =>
    saveSetting(root, DB_PREFIX + key, localStorage.getItem(key)).catch((e) =>
      useProjectDbStore.setState({ error: `Saving settings to the project database failed: ${e instanceof Error ? e.message : e}` }),
    ),
  ));
}

/** Writes what changed to the project database now (a scene switch does this before it reloads the page, which would
    otherwise drop the pending write and let the database's older values come back). */
export async function flushUiSettings(): Promise<void> {
  if (timer) clearTimeout(timer);
  await flush();
}

function markDirty(key: string) {
  if (applying || !synced(key) || !dbRoot()) return;
  dirty.add(key);
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, FLUSH_MS);
}

// Watch the browser's own saves (every persisted setting goes through them).
try {
  const proto = Storage.prototype;
  const set = proto.setItem;
  const remove = proto.removeItem;
  proto.setItem = function (this: Storage, key: string, value: string) {
    set.call(this, key, value);
    if (this === window.localStorage) markDirty(key);
  };
  proto.removeItem = function (this: Storage, key: string) {
    remove.call(this, key);
    if (this === window.localStorage) markDirty(key);
  };
} catch {
  // storage unavailable: nothing to mirror
}

/** The saved stores (zustand persist) re-read their key. */
const stores = import.meta.glob('../state/*.ts', { eager: true }) as Record<string, Record<string, unknown>>;
function rehydrate(keys: Set<string>) {
  for (const mod of Object.values(stores)) {
    for (const value of Object.values(mod)) {
      const persist = (value as { persist?: { getOptions?: () => { name?: string }; rehydrate?: () => unknown } } | null)?.persist;
      const name = persist?.getOptions?.().name;
      if (name && keys.has(name)) void persist?.rehydrate?.();
    }
  }
}

export interface UiSettingsResult {
  /** Settings the database changed here. */
  applied: number;
}

addDbSyncer({
  pull: async (root) => {
    const settings = await fetchSettings(root);
    const inDb = new Map<string, string>();
    for (const [k, v] of Object.entries(settings)) if (k.startsWith(DB_PREFIX) && typeof v === 'string') inDb.set(k.slice(DB_PREFIX.length), v);

    // This browser's, to seed the database (first time) or to add what it lacks.
    const local: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && synced(key)) local.push(key);
    }
    for (const key of local) if (!inDb.has(key)) await saveSetting(root, DB_PREFIX + key, localStorage.getItem(key));

    // The database wins for the keys it has.
    const changed = new Set<string>();
    applying = true;
    try {
      for (const [key, value] of inDb) {
        if (!synced(key) || localStorage.getItem(key) === value) continue;
        localStorage.setItem(key, value);
        changed.add(key);
      }
    } finally {
      applying = false;
    }
    if (changed.size) {
      rehydrate(changed);
      window.dispatchEvent(new CustomEvent(UI_SETTINGS_EVENT, { detail: { keys: [...changed] } }));
    }
  },
});
