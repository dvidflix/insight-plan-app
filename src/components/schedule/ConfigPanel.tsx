import { useMemo, useState } from 'react';
import type { Activity, ScheduleModel } from '../../schedule/types';
import type { ColumnCtx, ColumnDef } from '../../schedule/columns';
import { countActiveFilters, type FieldFilterState } from '../../schedule/filterFields';
import { ColorPanel, type ColorRule } from './ColorPanel';
import { ColumnsPanel, type ColumnView } from './ColumnsPanel';
import { GroupPanel, type GroupRule } from './GroupPanel';
import { SortPanel, type SortRule } from './SortPanel';
import { GeneratedSchedulesPanel } from './GeneratedSchedulesPanel';
import { FiltersPanel } from './FiltersPanel';
import { SidePane } from '../SidePane';
import { IconBookingsOpen, IconColumns, IconFilter, IconGroup, IconPalette, IconSort } from '../icons';

type TabId = 'columns' | 'filters' | 'group' | 'sort' | 'color' | 'generated';

interface ConfigPanelProps {
  onClose: () => void;

  colorRules: ColorRule[];
  onColorRulesChange: (rules: ColorRule[]) => void;
  wbsPalette: string;
  onWbsPaletteChange: (id: string) => void;

  model: ScheduleModel;
  /** Every column the schedule offers — feeds the column picker and the
      Group/Sort field lists. */
  catalog: ColumnDef[];
  columnViews: ColumnView[];

  groupRules: GroupRule[];
  onGroupRulesChange: (rules: GroupRule[]) => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  groupByWbs?: boolean;
  onToggleGroupByWbs?: () => void;

  sortRules: SortRule[];
  onSortRulesChange: (rules: SortRule[]) => void;

  baseActivities: Activity[];
  /** Column context, to read field values (colour suggestions). */
  columnCtx?: ColumnCtx;
  fieldFilters: FieldFilterState;
  onFieldFiltersChange: (next: FieldFilterState | ((prev: FieldFilterState) => FieldFilterState)) => void;
}

/** The Programmes page's tabs in the side pane, one concern at a time: a tab
    per kind of setting (with a badge showing how much is configured). */
export function ConfigPanel({
  onClose, colorRules, onColorRulesChange, wbsPalette, onWbsPaletteChange, model, catalog, columnViews,
  groupRules, onGroupRulesChange, onCollapseAll, onExpandAll, groupByWbs, onToggleGroupByWbs,
  sortRules, onSortRulesChange, baseActivities, columnCtx, fieldFilters, onFieldFiltersChange,
}: ConfigPanelProps) {
  const [tab, setTab] = useState<TabId>('columns');

  const filterCount = countActiveFilters(fieldFilters);
  // Distinct values of a field over the activities in view, most common first.
  const valuesOf = useMemo(() => {
    const cache = new Map<string, { value: string; count: number }[]>();
    return (fieldId: string) => {
      const hit = cache.get(fieldId);
      if (hit) return hit;
      const col = catalog.find((c) => c.id === fieldId);
      const counts = new Map<string, number>();
      if (col && columnCtx) for (const a of baseActivities) {
        const v = col.text(a, columnCtx);
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const list = [...counts].map(([value, count]) => ({ value, count })).sort((x, y) => y.count - x.count || x.value.localeCompare(y.value));
      cache.set(fieldId, list);
      return list;
    };
  }, [catalog, columnCtx, baseActivities]);

  const tabs: { id: TabId; label: string; icon: React.ReactNode; badge?: number; body: React.ReactNode }[] = [
    { id: 'columns', label: 'Columns', icon: <IconColumns />, body: <ColumnsPanel key={columnViews.map((v) => v.id).join()} catalog={catalog} views={columnViews} calculated /> },
    { id: 'filters', label: 'Filters', icon: <IconFilter />, badge: filterCount, body: (
      <FiltersPanel model={model} baseActivities={baseActivities} state={fieldFilters} onChange={onFieldFiltersChange} />
    ) },
    { id: 'group', label: 'Group', icon: <IconGroup />, badge: groupRules.length, body: (
      <GroupPanel bare fields={catalog} rules={groupRules} onChange={onGroupRulesChange} onClose={onClose} onCollapseAll={onCollapseAll} onExpandAll={onExpandAll} groupByWbs={groupByWbs} onToggleGroupByWbs={onToggleGroupByWbs} />
    ) },
    { id: 'sort', label: 'Sort', icon: <IconSort />, badge: sortRules.length, body: (
      <SortPanel bare fields={catalog} rules={sortRules} onChange={onSortRulesChange} onClose={onClose} />
    ) },
    { id: 'color', label: 'Color', icon: <IconPalette />, badge: colorRules.length, body: (
      <ColorPanel bare rules={colorRules} onChange={onColorRulesChange} onClose={onClose} wbsPalette={wbsPalette} onWbsPaletteChange={onWbsPaletteChange} fields={catalog} valuesOf={columnCtx ? valuesOf : undefined} />
    ) },
    { id: 'generated', label: 'Generated schedules', icon: <IconBookingsOpen />, body: <GeneratedSchedulesPanel model={model} /> },
  ];
  const active = tabs.find((t) => t.id === tab) ?? tabs[0];

  return (
    <SidePane tabs={tabs} active={active.id} onSelect={setTab}>
      {active.body}
    </SidePane>
  );
}
