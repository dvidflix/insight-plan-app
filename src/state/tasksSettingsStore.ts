import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GroupRule } from '../components/schedule/GroupPanel';
import type { SortRule } from '../components/schedule/SortPanel';
import type { ColorRule } from '../components/schedule/ColorPanel';
import { emptyFilterState, type FieldFilterState } from '../schedule/filterFields';
import { DEFAULT_WBS_PALETTE } from '../schedule/wbsPalette';

/** What the 4D Tasks list shows and how (the Tasks settings pane at the bottom of the side pane): columns, filters,
    grouping, sorting and row colours. Filters hold sets, so they are kept for the session only; the rest is remembered. */
interface TasksSettingsState {
  /** Column ids in order; null = the defaults for the programme. */
  columnIds: string[] | null;
  groupByWbs: boolean;
  groupRules: GroupRule[];
  sortRules: SortRule[];
  colorRules: ColorRule[];
  wbsPalette: string;
  filters: FieldFilterState;
  /** Bumped by the Group tab's collapse / expand all. */
  collapseAll: number;
  expandAll: number;
  tab: 'columns' | 'filters' | 'group' | 'sort' | 'color';
  patch: (p: Partial<Omit<TasksSettingsState, 'patch'>>) => void;
}

/** Settings kept before this store: the column list (the video export still reads it) and the WBS switch. */
function legacy<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export const useTasksSettingsStore = create<TasksSettingsState>()(
  persist(
    (set) => ({
      columnIds: legacy<string[] | null>('sequence.taskColumns', null),
      groupByWbs: legacy('sequence.tasksGroupByWbs', true),
      groupRules: [],
      sortRules: [],
      colorRules: [],
      wbsPalette: DEFAULT_WBS_PALETTE,
      filters: emptyFilterState(),
      collapseAll: 0,
      expandAll: 0,
      tab: 'columns',
      patch: (p) => set(p),
    }),
    {
      name: 'sequence.tasksSettings',
      partialize: (s) => ({ columnIds: s.columnIds, groupByWbs: s.groupByWbs, groupRules: s.groupRules, sortRules: s.sortRules, colorRules: s.colorRules, wbsPalette: s.wbsPalette, tab: s.tab }),
    },
  ),
);

// The video export reads the column list from its old place.
useTasksSettingsStore.subscribe((s, prev) => {
  if (s.columnIds === prev.columnIds || !s.columnIds) return;
  try {
    localStorage.setItem('sequence.taskColumns', JSON.stringify(s.columnIds));
  } catch {
    // not remembered
  }
});
