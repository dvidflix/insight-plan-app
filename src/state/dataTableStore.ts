import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SearchCondition } from '../viewer/searchSets';
import type { GroupRule } from '../components/schedule/GroupPanel';
import type { SortRule } from '../components/schedule/SortPanel';
import type { ColorRule } from '../components/schedule/ColorPanel';

/** Column ids are property keys, as bimTables.elementValue reads them. */
export const COL_NAME = 'Attributes.Name';
export const COL_CLASS = 'Attributes.Class';
export const COL_MODEL = 'Attributes.Model';
export const COL_GUID = 'Attributes.GlobalId';

export type DataTableTab = 'columns' | 'filters' | 'group' | 'sort' | 'color';

/** How a column is summed up in the totals row and on group rows. */
export type DataAgg = 'none' | 'sum' | 'avg' | 'min' | 'max' | 'count';

/** Which rows the table lists: the model's objects (all, those visible in 3D, those selected), or one table of an external data source
    ("src:" + source id + "|" + table name; see datasources/externalRows.ts). */
export type DataTableScope = 'all' | 'visible' | 'selected' | `src:${string}`;

export type DataTablePosition = 'bottom' | 'left' | 'right';

/** Twin columns: a column id starting with this is a property of the object's
    twin in the twin model (TWIN_PREFIX + the property key). */
export const TWIN_PREFIX = 'twin:';

/** Two models that share geometry but no properties: the table lists the
    primary model's objects, each with its twin (the object in the twin model
    whose box agrees, within the tolerance) available as extra columns. */
export interface TwinSetup {
  /** Model names. */
  primary: string | null;
  twin: string | null;
  /** Metres. */
  tolerance: number;
}

/** Everything that sets the table up, kept under a name. */
export interface DataTableConfig {
  columns: string[];
  widths: Record<string, number>;
  filters: SearchCondition[];
  filterMatch: 'all' | 'any';
  /** How the filter rules combine, by their numbers ("(1 and 2) or 3"); empty: all / any of them, as filterMatch says. */
  filterLogic: string;
  groupRules: GroupRule[];
  sortRules: SortRule[];
  colorRules: ColorRule[];
  totals: boolean;
  scope: DataTableScope;
  aggs: Record<string, DataAgg>;
  twin: TwinSetup;
}

/** The setup of one source's table (the model's objects, or an external table), kept while another source shows. */
export type DataTableSetup = Omit<DataTableConfig, 'scope' | 'twin'>;

/** The key a setup is kept under: every model scope shares one, each external table has its own. */
export const setupKey = (scope: DataTableScope): string => (scope.startsWith('src:') ? scope : 'objects');

/** A filter the user keeps under a name, to bring back in the Filters tab. */
export interface SavedFilter {
  id: string;
  name: string;
  match: 'all' | 'any';
  logic?: string;
  filters: SearchCondition[];
}

export interface DataTablePreset {
  id: string;
  name: string;
  config: DataTableConfig;
}

interface DataTableState {
  open: boolean;
  height: number;
  /** Where the table sits: under the 3D view, or beside it on the left / right. */
  position: DataTablePosition;
  /** Its width when beside the view. */
  width: number;
  columns: string[];
  widths: Record<string, number>;
  /** Conditions a row must meet (all, or any), as in Search sets. */
  filters: SearchCondition[];
  filterMatch: 'all' | 'any';
  /** How the rules combine, by their numbers ("(1 and 2) or 3"); empty: all / any of them, as filterMatch says. */
  filterLogic: string;
  /** Grouping levels, outermost first. */
  groupRules: GroupRule[];
  /** Sort keys: the first decides, the next ones break ties. */
  sortRules: SortRule[];
  /** Row colours: the first matching rule wins. */
  colorRules: ColorRule[];
  /** Totals row under the table, and subtotals on group rows. */
  totals: boolean;
  /** Which objects get a row: all of them, those visible in the 3D view, or the selected ones. */
  scope: DataTableScope;
  /** Changes what the table lists: the setup (columns, filters, grouping, sorting, colours) of the one shown is kept and the new one's comes back. */
  setScope: (scope: DataTableScope) => void;
  /** The setups of the sources not showing. */
  setups: Record<string, DataTableSetup>;
  /** Pinned: the table keeps listing these rows ("model:localId") whatever the 3D view shows or selects; null = not pinned. Not remembered. */
  pinnedKeys: Set<string> | null;
  setPinned: (keys: Set<string> | null) => void;
  /** Per column (else sum for numbers, none for text). */
  aggs: Record<string, DataAgg>;
  twin: TwinSetup;
  presets: DataTablePreset[];
  /** The filters kept under a name (Filters tab). */
  savedFilters: SavedFilter[];
  saveFilter: (name: string, match: 'all' | 'any', filters: SearchCondition[], logic: string) => string;
  removeFilter: (id: string) => void;
  /** Keeps the table's setup as a preset (replacing one of that name). */
  savePreset: (name: string) => void;
  applyPreset: (id: string) => void;
  removePreset: (id: string) => void;
  /** The Data table side-pane tab's sub-tab. */
  tab: DataTableTab;
  /** Bumped to bring the Data table tab up in the side pane. */
  configRequest: number;
  /** Collapse / expand every group (from the Group tab); `n` makes each ask new. */
  groupCommand: { kind: 'collapse' | 'expand'; n: number } | null;
  setGroupsCollapsed: (collapsed: boolean) => void;
  setOpen: (v: boolean) => void;
  setHeight: (v: number) => void;
  setWidth_: (v: number) => void;
  setColumns: (v: string[]) => void;
  setWidth: (col: string, w: number) => void;
  patch: (p: Partial<Pick<DataTableState, 'filters' | 'filterMatch' | 'filterLogic' | 'groupRules' | 'sortRules' | 'colorRules' | 'tab' | 'totals' | 'aggs' | 'scope' | 'twin' | 'position'>>) => void;
  /** Opens the side pane on the Data table tab (at `tab`). */
  configure: (tab?: DataTableTab) => void;
}

/** Ids the table used before its columns were property keys. */
const OLD_IDS: Record<string, string> = { '@name': COL_NAME, '@class': COL_CLASS, '@model': COL_MODEL, '@guid': COL_GUID };

/** The Models page's data table: shown or not, its size, columns, filters,
    grouping, sorting and row colours (set in the side pane's Data table tab). */
export const useDataTableStore = create<DataTableState>()(
  persist(
    (set, get) => ({
      open: false,
      height: 300,
      position: 'bottom' as DataTablePosition,
      width: 520,
      columns: [COL_NAME, COL_CLASS, COL_MODEL],
      widths: {},
      filters: [],
      filterMatch: 'all',
      filterLogic: '',
      groupRules: [],
      sortRules: [],
      colorRules: [],
      tab: 'columns',
      totals: true,
      scope: 'all',
      setups: {},
      setScope: (next) => set((s) => {
        const from = setupKey(s.scope);
        const to = setupKey(next);
        if (from === to) return { scope: next };
        const mine: DataTableSetup = {
          columns: s.columns, widths: s.widths, filters: s.filters, filterMatch: s.filterMatch, filterLogic: s.filterLogic, groupRules: s.groupRules,
          sortRules: s.sortRules, colorRules: s.colorRules, totals: s.totals, aggs: s.aggs,
        };
        // An external table starts with no columns: the table shows them all until they are chosen.
        const theirs: DataTableSetup = s.setups[to] ?? { columns: to === 'objects' ? [COL_NAME, COL_CLASS, COL_MODEL] : [], widths: {}, filters: [], filterMatch: 'all', filterLogic: '', groupRules: [], sortRules: [], colorRules: [], totals: true, aggs: {} };
        return { ...structuredClone(theirs), setups: { ...s.setups, [from]: mine }, scope: next, pinnedKeys: null };
      }),
      aggs: {},
      pinnedKeys: null,
      setPinned: (pinnedKeys) => set({ pinnedKeys }),
      twin: { primary: null, twin: null, tolerance: 0.01 },
      presets: [],
      savedFilters: [],
      saveFilter: (name, match, filters, logic) => {
        const id = crypto.randomUUID();
        set((s) => ({ savedFilters: [...s.savedFilters.filter((f) => f.name !== name), { id, name, match, logic, filters: structuredClone(filters) }] }));
        return id;
      },
      removeFilter: (id) => set((s) => ({ savedFilters: s.savedFilters.filter((f) => f.id !== id) })),
      savePreset: (name) => {
        const s = get();
        const config: DataTableConfig = {
          columns: s.columns, widths: s.widths, filters: s.filters, filterMatch: s.filterMatch, filterLogic: s.filterLogic, groupRules: s.groupRules,
          sortRules: s.sortRules, colorRules: s.colorRules, totals: s.totals, scope: s.scope, aggs: s.aggs, twin: s.twin,
        };
        set({ presets: [...s.presets.filter((p) => p.name !== name), { id: crypto.randomUUID(), name, config: structuredClone(config) }] });
      },
      applyPreset: (id) => {
        const p = get().presets.find((x) => x.id === id);
        if (p) set(structuredClone(p.config));
      },
      removePreset: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
      configRequest: 0,
      groupCommand: null,
      setGroupsCollapsed: (collapsed) => set((s) => ({ groupCommand: { kind: collapsed ? 'collapse' : 'expand', n: (s.groupCommand?.n ?? 0) + 1 } })),
      setOpen: (open) => set({ open }),
      setHeight: (height) => set({ height }),
      setWidth_: (width) => set({ width }),
      setColumns: (columns) => set({ columns }),
      setWidth: (col, w) => set((s) => ({ widths: { ...s.widths, [col]: w } })),
      patch: (p) => set(p),
      configure: (tab) => set((s) => ({ configRequest: s.configRequest + 1, ...(tab ? { tab } : {}) })),
    }),
    {
      name: 'models.dataTable',
      version: 1,
      partialize: ({ configRequest: _r, groupCommand: _g, pinnedKeys: _p, setPinned: _sp, ...rest }) => rest,
      // Version 0: built-in columns had their own ids, and one "Group by" column.
      migrate: (old, version) => {
        const s = old as Record<string, unknown>;
        if (version === 0) {
          const fix = (id: string) => OLD_IDS[id] ?? id;
          const columns = ((s.columns as string[] | undefined) ?? []).map(fix);
          const widths = Object.fromEntries(Object.entries((s.widths as Record<string, number> | undefined) ?? {}).map(([k, w]) => [fix(k), w]));
          const groupBy = s.groupBy as string | null | undefined;
          const groupRules: GroupRule[] = groupBy ? [{ id: 'group-migrated', field: fix(groupBy), direction: 'up' }] : [];
          return { ...s, columns, widths, groupRules } as unknown as DataTableState;
        }
        return s as unknown as DataTableState;
      },
    },
  ),
);
