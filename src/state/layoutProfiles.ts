/** Layout profiles: the whole arrangement of the app (which tab it starts on, the side panes' tabs, panel and
    column sizes, column choices, group / sort / colour rules, view settings, toggles…) saved under a name,
    exported to / imported from a JSON file, with one of them marked as the Default template.

    Everything the app remembers in the browser is a localStorage key (usePersistedState, the saved zustand
    stores, the resizable panes), so a profile is a snapshot of those keys, minus the ones that hold the
    user's own data (viewpoints, search sets, notes, link groups…): those have their own export (Settings ›
    Preferences › Configuration). Applying a profile writes the keys back and reloads the page, which is what
    makes every panel read its saved size / tab / choice again. */

export const LAYOUT_PROFILE_KIND = 'insight-plan-layout-profile';
const VERSION = 1;
const STORE_KEY = 'profiles.layout';
/** The page the app opens on (Settings › Layout profiles). */
export const START_PAGE_KEY = 'app.startPage';

/** Browser keys that are the user's data, caches or the profiles themselves, not layout. */
const NOT_LAYOUT = new Set([
  STORE_KEY,
  'app.browserDataImported',
  'inputs.fileSizes',
  'models.propEdit.backup',
  'scenarios.root',
  'scenarios.startDate',
  'resources.capacity',
  'sequence.linkGroups',
  'sequence.tags',
  'sequence.appearanceProfiles',
  'sequence.modelPlacement',
  'viewer.viewpoints',
  'viewer.searchSets',
  'viewer.markers',
  'viewer.flythrough',
  'viewer.activityNotes',
  'viewer.ppcReasons',
  'models.topics',
  'models.customFields',
  'timelines.data',
  'schedule.pourMap',
  'schedule.unloadedWbs',
  'schedule.autoLinks',
  'schedule.calcColumns',
  'views.savedAttributes',
  'ip.viewer.selectionSets',
  'ip.viewer.finderQueries',
]);

const isLayoutKey = (key: string) => !NOT_LAYOUT.has(key);

export interface LayoutProfile {
  id: string;
  name: string;
  savedAt: string;
  /** localStorage key → its stored text. */
  settings: Record<string, string>;
}

interface Store {
  profiles: LayoutProfile[];
  defaultId: string | null;
  /** Start from the default template every time the app opens. */
  startFromDefault: boolean;
}

function read(): Store {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as Partial<Store> | null;
    return { profiles: Array.isArray(parsed?.profiles) ? parsed!.profiles : [], defaultId: parsed?.defaultId ?? null, startFromDefault: !!parsed?.startFromDefault };
  } catch {
    return { profiles: [], defaultId: null, startFromDefault: false };
  }
}

function write(store: Store) {
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
  window.dispatchEvent(new Event('ip-layout-profiles'));
}

export const layoutProfiles = {
  /** The saved profiles, which is the default, and whether the app starts from it. */
  get: read,

  /** The current layout: every layout key in the browser. */
  capture(): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && isLayoutKey(key)) out[key] = localStorage.getItem(key) as string;
    }
    return out;
  },

  /** Saves the current layout under a name (replacing the profile of that name). The first one saved becomes the default. */
  save(name: string): LayoutProfile {
    const store = read();
    const existing = store.profiles.find((p) => p.name.toLowerCase() === name.toLowerCase());
    const profile: LayoutProfile = { id: existing?.id ?? `lp-${Date.now().toString(36)}`, name, savedAt: new Date().toISOString(), settings: layoutProfiles.capture() };
    store.profiles = existing ? store.profiles.map((p) => (p === existing ? profile : p)) : [...store.profiles, profile];
    if (!store.defaultId) store.defaultId = profile.id;
    write(store);
    return profile;
  },

  /** Replaces a profile's layout with the current one. */
  update(id: string) {
    const store = read();
    store.profiles = store.profiles.map((p) => (p.id === id ? { ...p, savedAt: new Date().toISOString(), settings: layoutProfiles.capture() } : p));
    write(store);
  },

  remove(id: string) {
    const store = read();
    store.profiles = store.profiles.filter((p) => p.id !== id);
    if (store.defaultId === id) store.defaultId = null;
    write(store);
  },

  rename(id: string, name: string) {
    const store = read();
    store.profiles = store.profiles.map((p) => (p.id === id ? { ...p, name } : p));
    write(store);
  },

  setDefault(id: string | null) {
    const store = read();
    store.defaultId = id;
    if (!id) store.startFromDefault = false;
    write(store);
  },

  setStartFromDefault(on: boolean) {
    const store = read();
    store.startFromDefault = on && !!store.defaultId;
    write(store);
  },

  /** Writes a profile's keys over the layout ones (the user's data is left alone). The page must reload to show it. */
  applySettings(settings: Record<string, string>) {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && isLayoutKey(key)) localStorage.removeItem(key);
    }
    for (const [k, v] of Object.entries(settings)) if (isLayoutKey(k) && typeof v === 'string') localStorage.setItem(k, v);
  },

  /** Applies a saved profile and reloads. */
  apply(id: string) {
    const profile = read().profiles.find((p) => p.id === id);
    if (!profile) return;
    layoutProfiles.applySettings(profile.settings);
    window.location.reload();
  },

  /** Downloads one profile as a JSON file. */
  exportProfile(id: string) {
    const store = read();
    const profile = store.profiles.find((p) => p.id === id);
    if (!profile) return;
    const payload = { kind: LAYOUT_PROFILE_KIND, version: VERSION, name: profile.name, savedAt: profile.savedAt, settings: profile.settings };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `insight-plan-layout-${profile.name.replace(/[\\/:*?"<>|\s]+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  /** Adds the profile in a JSON file to the list (not applied: choose Apply or Set as default). */
  async importProfile(file: File): Promise<LayoutProfile> {
    let parsed: { kind?: string; name?: unknown; settings?: unknown };
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error('Not valid JSON.');
    }
    if (parsed?.kind !== LAYOUT_PROFILE_KIND || !parsed.settings || typeof parsed.settings !== 'object') {
      throw new Error('Not an Insight Plan layout profile file.');
    }
    const settings: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed.settings as Record<string, unknown>)) if (typeof v === 'string' && isLayoutKey(k)) settings[k] = v;
    const store = read();
    const base = typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : file.name.replace(/\.json$/i, '');
    let name = base;
    for (let n = 2; store.profiles.some((p) => p.name.toLowerCase() === name.toLowerCase()); n++) name = `${base} (${n})`;
    const profile: LayoutProfile = { id: `lp-${Date.now().toString(36)}`, name, savedAt: new Date().toISOString(), settings };
    store.profiles = [...store.profiles, profile];
    if (!store.defaultId) store.defaultId = profile.id;
    write(store);
    return profile;
  },
};

/** With "Start from the default template" on, the default's keys go in before the app reads them (this runs
    first, from main.tsx), so every launch opens in that arrangement. */
export function applyDefaultAtStartup() {
  try {
    const store = read();
    if (!store.startFromDefault || !store.defaultId) return;
    const profile = store.profiles.find((p) => p.id === store.defaultId);
    if (profile) layoutProfiles.applySettings(profile.settings);
  } catch {
    // keep the browser's own layout
  }
}
