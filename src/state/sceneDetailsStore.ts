import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { NO_VALUE, type SortRule } from './inputDetailsStore';
import type { Scene } from './scenes';

/** Scene details: what the user says about each scene (Project, Area, Status, Notes ...), so the scenes on Home can be grouped,
    filtered and sorted by it as the files are. A value list per field per scene (a scene can belong to several areas), kept by the
    scene's id. These belong to the scenes themselves, not to the layout a scene snapshots (see NOT_LAYOUT in scenes.ts). */

export const DEFAULT_SCENE_FIELDS = ['Project', 'Area', 'Status', 'Notes'];

/** The ways to group, filter or sort besides the details. */
export const SCENE_BUILT_INS = [
  { id: 'name', label: 'Name' },
  { id: 'programme', label: 'Programme' },
  { id: 'saved', label: 'Last saved' },
];

interface SceneDetailsState {
  fields: string[];
  /** scene id -> field -> values. */
  values: Record<string, Record<string, string[]>>;
  filters: Record<string, string[]>;
  sortRules: SortRule[];
  groupRules: SortRule[];
  groupCombine: boolean;
  /** Collapsed groups, by group key. */
  collapsed: string[];
  setValues: (ids: string[], field: string, values: string[]) => void;
  addField: (name: string) => boolean;
  removeField: (name: string) => void;
  setFilter: (key: string, values: string[]) => void;
  clearFilters: () => void;
  setSortRules: (rules: SortRule[]) => void;
  setGroupRules: (rules: SortRule[]) => void;
  setGroupCombine: (on: boolean) => void;
  toggleCollapsed: (key: string) => void;
  setCollapsedAll: (keys: string[]) => void;
  /** Forgets the details of scenes that no longer exist. */
  prune: (liveIds: string[]) => void;
}

export const useSceneDetailsStore = create<SceneDetailsState>()(
  persist(
    (set, get) => ({
      fields: DEFAULT_SCENE_FIELDS,
      values: {},
      filters: {},
      sortRules: [{ id: 'saved', field: 'saved', direction: 'down' }],
      groupRules: [],
      groupCombine: true,
      collapsed: [],
      setValues: (ids, field, values) => {
        const clean = values.map((v) => v.trim()).filter(Boolean);
        set((s) => {
          const next = { ...s.values };
          for (const id of ids) {
            const mine = { ...(next[id] ?? {}) };
            if (clean.length) mine[field] = clean;
            else delete mine[field];
            next[id] = mine;
          }
          return { values: next };
        });
      },
      addField: (name) => {
        const n = name.trim();
        if (!n || get().fields.some((f) => f.toLowerCase() === n.toLowerCase()) || SCENE_BUILT_INS.some((b) => b.label.toLowerCase() === n.toLowerCase())) return false;
        set((s) => ({ fields: [...s.fields, n] }));
        return true;
      },
      removeField: (name) => set((s) => {
        const filters = { ...s.filters };
        delete filters[name];
        const values = Object.fromEntries(Object.entries(s.values).map(([id, v]) => {
          const { [name]: _gone, ...rest } = v;
          return [id, rest];
        }));
        return { fields: s.fields.filter((f) => f !== name), values, filters, groupRules: s.groupRules.filter((r) => r.field !== name), sortRules: s.sortRules.filter((r) => r.field !== name) };
      }),
      setFilter: (key, values) => set((s) => {
        const filters = { ...s.filters };
        if (values.length) filters[key] = values;
        else delete filters[key];
        return { filters };
      }),
      clearFilters: () => set({ filters: {} }),
      setSortRules: (sortRules) => set({ sortRules }),
      setGroupRules: (groupRules) => set({ groupRules }),
      setGroupCombine: (groupCombine) => set({ groupCombine }),
      toggleCollapsed: (key) => set((s) => ({ collapsed: s.collapsed.includes(key) ? s.collapsed.filter((k) => k !== key) : [...s.collapsed, key] })),
      setCollapsedAll: (collapsed) => set({ collapsed }),
      prune: (liveIds) => set((s) => {
        const stale = Object.keys(s.values).filter((id) => !liveIds.includes(id));
        if (!stale.length) return s;
        const values = { ...s.values };
        for (const id of stale) delete values[id];
        return { values };
      }),
    }),
    { name: 'scenes.details' },
  ),
);

/** A scene's values for a group / filter / sort key (a built-in or a detail field). */
export function valuesOfScene(key: string, s: Scene, details: Record<string, Record<string, string[]>>): string[] {
  if (key === 'name') return [s.name];
  if (key === 'programme') return s.counts?.programme ? [s.counts.programme] : [];
  if (key === 'saved') return [new Date(s.savedAt).toLocaleDateString()];
  return details[s.id]?.[key] ?? [];
}

/** True when the scene passes every active filter (several values pass when one is kept). */
export function sceneMatches(s: Scene, filters: Record<string, string[]>, details: Record<string, Record<string, string[]>>, except?: string): boolean {
  return Object.entries(filters).every(([key, kept]) => {
    if (key === except || kept.length === 0) return true;
    const have = valuesOfScene(key, s, details).filter(Boolean);
    return (have.length ? have : [NO_VALUE]).some((v) => kept.includes(v));
  });
}

/** The scenes in the order of the sort rules; pinned ones stay first. */
export function sortScenes(list: Scene[], rules: SortRule[], details: Record<string, Record<string, string[]>>): Scene[] {
  const text = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  return [...list].sort((a, b) => {
    const pin = Number(!!b.pinned) - Number(!!a.pinned);
    if (pin) return pin;
    for (const r of rules) {
      if (r.field === 'saved') {
        const c = a.savedAt.localeCompare(b.savedAt);
        if (c) return r.direction === 'down' ? -c : c;
        continue;
      }
      const x = valuesOfScene(r.field, a, details).join(', ');
      const y = valuesOfScene(r.field, b, details).join(', ');
      if (!x !== !y) return x ? -1 : 1; // scenes with no value go last either way
      const c = text(x, y);
      if (c) return r.direction === 'down' ? -c : c;
    }
    return b.savedAt.localeCompare(a.savedAt);
  });
}
