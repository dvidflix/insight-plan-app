import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { fetchFileDetails, type PushFile } from '../seatable/filesClient';
export interface SortRule {
  id: string;
  field: string;
  direction: 'up' | 'down';
}

/** The list's own columns (the details of SeaTable come after them). */
export const INPUT_COLUMNS = [
  { id: 'type', label: 'Type', group: 'File' },
  { id: 'name', label: 'Name', group: 'File' },
  { id: 'items', label: 'Items', group: 'File' },
  { id: 'bounds', label: 'Min / max XYZ (m)', group: 'File' },
  { id: 'size', label: 'File size', group: 'File' },
];
export const DEFAULT_INPUT_COLUMNS = INPUT_COLUMNS.map((c) => c.id);


/** File details on the Inputs page, read from SeaTable's "Insight Plan Files"
    table (where they are filled in): a list of values per field per file —
    a file can belong to several buildings — kept by the file's name. The last
    read is kept, so the details still show with SeaTable switched off.
    Also what the list is grouped by. Saved with the project (the "models."
    settings go into the project database). */
interface InputDetailsState {
  /** The detail fields (SeaTable columns), in column order. */
  fields: string[];
  /** The columns shown, in order: the built-in ones (INPUT_COLUMNS) and detail fields. */
  columns: string[];
  /** The list sorted by these, first decides. */
  sortRules: SortRule[];
  /** What the list is grouped by, outermost level first ('type', 'format' or a detail field). Empty = no grouping. */
  groupRules: SortRule[];
  /** Several group levels on one line ("A  |  B  |  C") instead of nested. */
  groupCombine: boolean;
  /** file name -> field -> values. */
  values: Record<string, Record<string, string[]>>;
  /** Collapsed groups, as "<groupBy>:<group>". */
  collapsed: string[];
  /** When the details were last read from SeaTable (ms), and a note on how it went. */
  readAt: number | null;
  /** Column widths (px) the user dragged; the columns not here have their default. */
  widths: Record<string, number>;
  setWidth: (col: string, w: number) => void;
  /** Filters: group id ('type', 'format' or a field) -> the values kept (absent or empty = no filter). */
  filters: Record<string, string[]>;
  /** The files of the Inputs page right now (set by the page, not saved): what the Settings panel counts values over. */
  files: PushFile[];
  setGroupRules: (rules: SortRule[]) => void;
  setGroupCombine: (on: boolean) => void;
  setFilter: (key: string, values: string[]) => void;
  clearFilters: () => void;
  setFiles: (files: PushFile[]) => void;
  setColumns: (ids: string[]) => void;
  setSortRules: (rules: SortRule[]) => void;
  setCollapsedAll: (keys: string[]) => void;
  toggleCollapsed: (key: string) => void;
  /** Reads the details from SeaTable; resolves to a short message (never throws). */
  read: () => Promise<{ ok: boolean; message: string }>;
}

export const useInputDetailsStore = create<InputDetailsState>()(
  persist(
    (set) => ({
      fields: [],
      columns: [...DEFAULT_INPUT_COLUMNS, 'Discipline', 'Building', 'Status'],
      sortRules: [{ id: 'name', field: 'name', direction: 'up' }],
      groupRules: [],
      groupCombine: true,
      values: {},
      collapsed: [],
      readAt: null,
      filters: {},
      files: [],
      widths: {},
      setWidth: (col, w) => set((s) => ({ widths: { ...s.widths, [col]: Math.round(w) } })),
      setGroupRules: (groupRules) => set({ groupRules }),
      setGroupCombine: (groupCombine) => set({ groupCombine }),
      setFilter: (key, values) => set((s) => {
        const filters = { ...s.filters };
        if (values.length) filters[key] = values;
        else delete filters[key];
        return { filters };
      }),
      clearFilters: () => set({ filters: {} }),
      setFiles: (files) => set({ files }),
      setColumns: (columns) => set({ columns }),
      setSortRules: (sortRules) => set({ sortRules }),
      setCollapsedAll: (collapsed) => set({ collapsed }),
      toggleCollapsed: (key) => set((s) => ({ collapsed: s.collapsed.includes(key) ? s.collapsed.filter((k) => k !== key) : [...s.collapsed, key] })),
      read: async () => {
        try {
          const d = await fetchFileDetails();
          if (d.note) return { ok: false, message: d.note };
          const fields = d.fields.map((f) => f.name);
          set((s) => ({ fields, values: d.values, readAt: Date.now(), groupRules: s.groupRules.filter((r) => ['type', 'format', ...fields].includes(r.field)) }));
          const n = Object.keys(d.values).length;
          return { ok: true, message: `Read the details of ${n} file${n === 1 ? '' : 's'} from SeaTable.` };
        } catch (e) {
          return { ok: false, message: e instanceof Error ? e.message : String(e) };
        }
      },
    }),
    {
      name: 'models.fileDetails',
      // Earlier versions kept one group level: groupBy (+ groupDir).
      merge: (saved, current) => {
        const old = saved as { groupBy?: string; groupDir?: 'up' | 'down'; groupRules?: SortRule[] } | undefined;
        const next = { ...current, ...(saved as object) } as InputDetailsState;
        if (old && !old.groupRules && old.groupBy) next.groupRules = old.groupBy === 'none' ? [] : [{ id: old.groupBy, field: old.groupBy, direction: old.groupDir ?? 'up' }];
        // Folders are gone: group and filter by details instead.
        next.groupRules = (next.groupRules ?? []).filter((r) => r.field !== 'folder');
        if (next.filters) delete next.filters.folder;
        return next;
      },
      partialize: (s) => ({ fields: s.fields, columns: s.columns, sortRules: s.sortRules, groupRules: s.groupRules, groupCombine: s.groupCombine, values: s.values, filters: s.filters, widths: s.widths, collapsed: s.collapsed, readAt: s.readAt }),
    },
  ),
);

export const NO_VALUE = '';

/** The ways to group or filter besides the SeaTable details. */
export const BUILT_IN_GROUPS = [
  { id: 'none', label: 'No grouping' },
  { id: 'type', label: 'Type' },
  { id: 'format', label: 'File format' },
];

/** A file's values for a group id (type, format or a detail field). */
export function valuesOfFile(key: string, f: Pick<PushFile, 'name' | 'type' | 'format'>, details: Record<string, Record<string, string[]>>): string[] {
  if (key === 'type') return [f.type];
  if (key === 'format') return [f.format];
  return details[f.name]?.[key] ?? [];
}

/** True when the file passes every active filter (a file with several values passes when one is kept). */
export function passesFilters(f: Pick<PushFile, 'name' | 'type' | 'format'>, filters: Record<string, string[]>, details: Record<string, Record<string, string[]>>, except?: string): boolean {
  return Object.entries(filters).every(([key, kept]) => {
    if (key === except || kept.length === 0) return true;
    const have = valuesOfFile(key, f, details).filter(Boolean);
    return (have.length ? have : [NO_VALUE]).some((v) => kept.includes(v));
  });
}

/** The rows by the values of `keysOf` (a row with several values, like a file in two buildings, is in each group),
    groups in A–Z order and the rows with no value last. */
export function groupSections<T>(items: T[], keysOf: (item: T) => string[]): { folder: string; items: T[] }[] {
  const by = new Map<string, T[]>();
  for (const item of items) {
    const keys = keysOf(item).filter(Boolean);
    for (const k of keys.length ? keys : [NO_VALUE]) (by.get(k) ?? by.set(k, []).get(k)!).push(item);
  }
  const names = [...by.keys()].sort((a, b) => (a === NO_VALUE ? 1 : b === NO_VALUE ? -1 : a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })));
  return names.map((k) => ({ folder: k, items: by.get(k)! }));
}

/** One group of the list, with the groups nested in it (the next level) or, at the last level, just its rows. */
export interface GroupNode<T> {
  /** Unique for the path to it: used to remember it collapsed. */
  key: string;
  field: string;
  value: string;
  level: number;
  /** Every row in it, however deep. */
  items: T[];
  children: GroupNode<T>[];
}

/** The rows grouped by the rules, the first outermost. A row with several values of a field is in each group.
    Each level goes A–Z (Z–A when the rule says so) with the rows with no value last. */
export function buildGroups<T>(items: T[], rules: SortRule[], valuesOf: (field: string, item: T) => string[], level = 0, parent = ''): GroupNode<T>[] {
  const rule = rules[level];
  if (!rule) return [];
  const all = groupSections(items, (i) => valuesOf(rule.field, i)).map((s) => ({ value: s.folder, items: s.items }));
  const sections = rule.direction === 'down' ? [...all.filter((s) => s.value !== NO_VALUE).reverse(), ...all.filter((s) => s.value === NO_VALUE)] : all;
  return sections.map((s) => {
    const key = `${parent}${rule.field}:${s.value}|`;
    return { key, field: rule.field, value: s.value, level, items: s.items, children: buildGroups(s.items, rules, valuesOf, level + 1, key) };
  });
}

/** The text between the values of a combined group's header. */
export const GROUP_DELIMITER = '  |  ';

/** The rows grouped by the rules on ONE line: a group per combination of the fields' values, its header the values
    joined with GROUP_DELIMITER ("Project A  |  Area 1  |  Building 2"). Ordered by the first field, then the next…,
    each A–Z or Z–A as its rule says, rows with no value last. With one rule this is
    the plain grouping. A row with several values of a field is in each combination. */
export function buildCombinedGroups<T>(items: T[], rules: SortRule[], valuesOf: (field: string, item: T) => string[]): GroupNode<T>[] {
  if (rules.length < 2) return buildGroups(items, rules, valuesOf);
  const by = new Map<string, { parts: string[]; items: T[] }>();
  for (const item of items) {
    let combos: string[][] = [[]];
    for (const rule of rules) {
      const vals = valuesOf(rule.field, item).filter(Boolean);
      combos = combos.flatMap((c) => (vals.length ? vals : [NO_VALUE]).map((v) => [...c, v]));
    }
    for (const parts of combos) {
      const key = parts.join('\u0001');
      (by.get(key) ?? by.set(key, { parts, items: [] }).get(key)!).items.push(item);
    }
  }
  const text = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const sorted = [...by.values()].sort((a, b) => {
    for (let i = 0; i < rules.length; i++) {
      const x = a.parts[i];
      const y = b.parts[i];
      if (x === y) continue;
      if (x === NO_VALUE) return 1;
      if (y === NO_VALUE) return -1;
      const c = text(x, y);
      return rules[i].direction === 'down' ? -c : c;
    }
    return 0;
  });
  const field = rules.map((r) => r.field).join('+');
  return sorted.map((g) => ({
    key: `combo:${g.parts.join('\u0001')}|`,
    field,
    value: g.parts.map((p) => (p === NO_VALUE ? '(none)' : p)).join(GROUP_DELIMITER),
    level: 0,
    items: g.items,
    children: [],
  }));
}
