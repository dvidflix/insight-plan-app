import { create } from 'zustand';
import { useAggregateStore } from './aggregateStore';
import type { FieldFilterState } from '../schedule/filterFields';

/** Programmes > Layouts: named snapshots of how the activity views are set
    up: which view is open (Table, Gantt, WBS, Explorer…), the columns and
    their widths, group / sort / colour rules, WBS palette, zoom, Gantt
    options, totals (the localStorage keys listed below) plus the field
    filters of the Table and the Gantt. Applying one writes those keys back,
    switches to its view and remounts the page (bump `revision`), which then
    reads them.

    Only VIEW settings are in a layout. The page's other saved settings (pour
    map, auto-links, calculated columns, export choices, unloaded WBS, the
    tools' options…) are the project's, not the view's: a layout never saves,
    restores or clears them. */

const STORE_KEY = 'schedule.layouts';
/** Everything under these prefixes is the Table / Gantt view's own (columns, widths, sort, group, colour, level…). */
const VIEW_PREFIXES = ['table.', 'gantt.'];
/** The view settings the Programmes page keeps under other names. */
const VIEW_KEYS = new Set([
  'schedule.groupRules', 'schedule.sortRules', 'schedule.colorRules', 'schedule.groupLevel', 'schedule.groupByWbs', // before the views had their own
  'schedule.curtain', 'schedule.zoom', 'schedule.aggregates',
  'schedule.showGanttLinks', 'schedule.showGanttCritical', 'schedule.showGanttBaseline', 'schedule.showGanttLabels',
  'schedule.wbsPalette', 'schedule.wbsColumnsHidden', 'schedule.wbsColumnWidths', 'schedule.wbsLevel', 'schedule.wbsResourceOrder', 'schedule.wbsResourceSort',
  'schedule.explorerPanels', 'programmes.explorerConfig',
]);
export const isLayoutKey = (k: string) => k !== STORE_KEY && (VIEW_KEYS.has(k) || VIEW_PREFIXES.some((p) => k.startsWith(p)));

export type SerializedFilters = { combine?: FieldFilterState['combine']; selectModes?: FieldFilterState['selectModes']; selections: Record<string, string[]>; textFilters: FieldFilterState['textFilters']; textModes?: FieldFilterState['textModes']; ranges: FieldFilterState['ranges'] };

export interface ScheduleLayout {
  id: string;
  name: string;
  savedAt: string;
  settings: Record<string, string>;
  /** The Table view's filters (and, in layouts saved before the views had
      their own, the Gantt's too). */
  filters: SerializedFilters;
  /** The Gantt's filters. */
  ganttFilters?: SerializedFilters;
  /** The folder it is filed in (one of LayoutsState.folders); none = loose. */
  folder?: string;
  /** The Programmes view that was open (Table = 'activities', Gantt, WBS…). */
  tab?: string;
}

/** Filters of the two activity views. */
export interface ViewFilters {
  table: FieldFilterState;
  gantt: FieldFilterState;
}

interface LayoutsState {
  /** Their order here is the order shown (within each folder). */
  layouts: ScheduleLayout[];
  /** The folders, in the order shown (empty ones included). */
  folders: string[];
  /** The layout last applied or saved (shown as current). */
  currentId: string | null;
  /** Bumped by apply: SchedulePage is keyed on it. */
  revision: number;
  /** Filters for the page to start with after an apply. */
  pendingFilters: ViewFilters | null;
  /** The view an apply asks the page to open (read once). */
  pendingTab: string | null;
}

function load(): Pick<LayoutsState, 'layouts' | 'folders' | 'currentId'> {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (!(v && Array.isArray(v.layouts))) return { layouts: [], folders: [], currentId: null };
    const layouts = v.layouts as ScheduleLayout[];
    const folders: string[] = Array.isArray(v.folders) ? v.folders : [...new Set(layouts.map((l) => l.folder).filter((f): f is string => !!f))];
    return { layouts, folders, currentId: v.currentId ?? null };
  } catch {
    return { layouts: [], folders: [], currentId: null };
  }
}

export const useScheduleLayoutsStore = create<LayoutsState>(() => ({ ...load(), revision: 0, pendingFilters: null, pendingTab: null }));

useScheduleLayoutsStore.subscribe((s, prev) => {
  if (s.layouts === prev.layouts && s.folders === prev.folders && s.currentId === prev.currentId) return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ layouts: s.layouts, folders: s.folders, currentId: s.currentId }));
  } catch {
    // not remembered
  }
});

const set = useScheduleLayoutsStore.setState;
const get = useScheduleLayoutsStore.getState;

const serialize = (filters: FieldFilterState): SerializedFilters => {
  const selections: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(filters.selections)) selections[k] = [...v];
  return { combine: filters.combine, selectModes: filters.selectModes, selections, textFilters: filters.textFilters, textModes: filters.textModes, ranges: filters.ranges };
};

/** The filter state as plain JSON (sets as lists), and back: for settings that keep filters (layouts, the concrete comparison). */
export const serializeFilters = (f: FieldFilterState): SerializedFilters => serialize(f);
export const deserializeFilters = (f: SerializedFilters): FieldFilterState => deserialize(f);

const deserialize = (f: SerializedFilters): FieldFilterState => {
  const selections: Record<string, Set<string>> = {};
  for (const [k, v] of Object.entries(f.selections)) selections[k] = new Set(v);
  return { combine: f.combine, selectModes: f.selectModes ?? {}, selections, textFilters: f.textFilters ?? {}, textModes: f.textModes ?? {}, ranges: f.ranges ?? {} };
};

function snapshot(filters: ViewFilters, tab?: string): Omit<ScheduleLayout, 'id' | 'name'> {
  const settings: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && isLayoutKey(k)) settings[k] = localStorage.getItem(k) as string;
  }
  return { savedAt: new Date().toISOString(), settings, filters: serialize(filters.table), ganttFilters: serialize(filters.gantt), ...(tab ? { tab } : {}) };
}

export function saveLayout(name: string, filters: ViewFilters, folder?: string, tab?: string) {
  const layout: ScheduleLayout = { id: crypto.randomUUID(), name, ...snapshot(filters, tab), ...(folder ? { folder } : {}) };
  set((s) => ({ layouts: [...s.layouts, layout], currentId: layout.id }));
}

/** Files an imported layout (a P6 .plf, see schedule/plfLayout.ts) under `folder`, made if needed. Its name gets a number when taken. */
export function addImportedLayout(name: string, settings: Record<string, string>, filters: FieldFilterState, folder: string, tab = 'activities'): string {
  let unique = name;
  for (let n = 2; get().layouts.some((l) => l.folder === folder && l.name.toLowerCase() === unique.toLowerCase()); n++) unique = `${name} (${n})`;
  const layout: ScheduleLayout = { id: crypto.randomUUID(), name: unique, savedAt: new Date().toISOString(), settings, filters: serialize(filters), folder, tab };
  set((s) => ({ layouts: [...s.layouts, layout], folders: s.folders.includes(folder) ? s.folders : [...s.folders, folder] }));
  return unique;
}

/** Overwrites a layout with the view as it is now. */
export function updateLayout(id: string, filters: ViewFilters, tab?: string) {
  set((s) => ({ layouts: s.layouts.map((l) => (l.id === id ? { ...l, ...snapshot(filters, tab) } : l)), currentId: id }));
}

export function renameLayout(id: string, name: string) {
  set((s) => ({ layouts: s.layouts.map((l) => (l.id === id ? { ...l, name } : l)) }));
}

export function deleteLayout(id: string) {
  set((s) => ({ layouts: s.layouts.filter((l) => l.id !== id), currentId: s.currentId === id ? null : s.currentId }));
}

// ---- folders and order ----

/** Returns false when the name is empty or taken. */
export function addFolder(name: string): boolean {
  const n = name.trim();
  if (!n || get().folders.some((f) => f.toLowerCase() === n.toLowerCase())) return false;
  set((s) => ({ folders: [...s.folders, n] }));
  return true;
}

export function renameFolder(from: string, to: string): boolean {
  const n = to.trim();
  if (!n) return false;
  if (n !== from && get().folders.some((f) => f.toLowerCase() === n.toLowerCase())) return false;
  set((s) => ({ folders: s.folders.map((f) => (f === from ? n : f)), layouts: s.layouts.map((l) => (l.folder === from ? { ...l, folder: n } : l)) }));
  return true;
}

/** Its layouts stay, loose. */
export function deleteFolder(name: string) {
  set((s) => ({ folders: s.folders.filter((f) => f !== name), layouts: s.layouts.map((l) => (l.folder === name ? { ...l, folder: undefined } : l)) }));
}

/** Puts a folder before / after another. */
export function moveFolder(name: string, target: string, after: boolean) {
  if (name === target) return;
  set((s) => {
    const rest = s.folders.filter((f) => f !== name);
    const at = rest.indexOf(target);
    if (at < 0) return {};
    rest.splice(at + (after ? 1 : 0), 0, name);
    return { folders: rest };
  });
}

/** Files a layout in `folder` (null = loose): before / after `target` (a layout of that folder), else at the end of it. */
export function moveLayout(id: string, folder: string | null, target?: { id: string; after: boolean }) {
  if (target?.id === id) return;
  set((s) => {
    const layouts = [...s.layouts];
    const from = layouts.findIndex((l) => l.id === id);
    if (from < 0) return {};
    const [moved] = layouts.splice(from, 1);
    const item: ScheduleLayout = { ...moved, folder: folder ?? undefined };
    let at = -1;
    if (target) {
      const j = layouts.findIndex((l) => l.id === target.id);
      if (j >= 0) at = j + (target.after ? 1 : 0);
    }
    if (at < 0) {
      layouts.forEach((l, k) => {
        if ((l.folder ?? '') === (folder ?? '')) at = k + 1;
      });
      if (at < 0) at = layouts.length;
    }
    layouts.splice(at, 0, item);
    return { layouts };
  });
}

export function applyLayout(id: string) {
  const layout = get().layouts.find((l) => l.id === id);
  if (!layout) return;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && isLayoutKey(k)) localStorage.removeItem(k);
  }
  // Only view settings: a layout saved before this rule may hold others (pour map…), which are left alone.
  for (const [k, v] of Object.entries(layout.settings)) if (isLayoutKey(k)) localStorage.setItem(k, v);
  void useAggregateStore.persist.rehydrate();
  set((s) => ({
    currentId: id,
    revision: s.revision + 1,
    pendingTab: layout.tab ?? null,
    pendingFilters: { table: deserialize(layout.filters), gantt: deserialize(layout.ganttFilters ?? layout.filters) },
  }));
}

/** The filters an apply left for the page to start with. Reading does not use them up (in development React runs a
    component's start-up code twice and keeps the second result): the page calls clearPendingFilters once it is mounted. */
export function peekPendingFilters(): ViewFilters | null {
  return get().pendingFilters;
}

export function clearPendingFilters() {
  if (get().pendingFilters) set({ pendingFilters: null });
}

/** The view an apply left to open (read once by the app). */
export function takePendingTab(): string | null {
  const t = get().pendingTab;
  if (t) set({ pendingTab: null });
  return t;
}
