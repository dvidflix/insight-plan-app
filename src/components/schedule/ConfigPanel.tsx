import { useMemo } from 'react';
import type { Activity, ScheduleModel } from '../../schedule/types';
import type { ColumnCtx, ColumnDef } from '../../schedule/columns';
import { countActiveFilters, type FieldFilterState } from '../../schedule/filterFields';
import { ColorPanel, type ColorRule } from './ColorPanel';
import { ColumnsPanel, type ColumnView } from './ColumnsPanel';
import { GroupPanel, type GroupRule } from './GroupPanel';
import { SortPanel, type SortRule } from './SortPanel';
import { GeneratedSchedulesPanel } from './GeneratedSchedulesPanel';
import { FiltersPanel } from './FiltersPanel';
import { DockPanel } from '../Dock';
import { ListConfig } from '../ListConfig';
import { useExperimental } from '../../state/appPrefsStore';

interface ConfigPanelProps {
  /** What the shared panels call this list. */
  label: string;
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
  label, onClose, colorRules, onColorRulesChange, wbsPalette, onWbsPaletteChange, model, catalog, columnViews,
  groupRules, onGroupRulesChange, onCollapseAll, onExpandAll, groupByWbs, onToggleGroupByWbs,
  sortRules, onSortRulesChange, baseActivities, columnCtx, fieldFilters, onFieldFiltersChange,
}: ConfigPanelProps) {

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

  const scenariosOn = useExperimental('scenarios');
  // Columns, filters, group, sort and colour are the shared panels (ListConfig): this list fills them while it is the one set up.
  return (
    <>
      <ListConfig
        id="programmes"
        label={label}
        badges={{ filters: filterCount, group: groupRules.length, sort: sortRules.length, color: colorRules.length }}
        panels={{
          columns: <ColumnsPanel key={columnViews.map((v) => v.id).join()} catalog={catalog} views={columnViews} calculated />,
          filters: <FiltersPanel model={model} baseActivities={baseActivities} state={fieldFilters} onChange={onFieldFiltersChange} />,
          group: <GroupPanel bare fields={catalog} rules={groupRules} onChange={onGroupRulesChange} onClose={onClose} onCollapseAll={onCollapseAll} onExpandAll={onExpandAll} groupByWbs={groupByWbs} onToggleGroupByWbs={onToggleGroupByWbs} />,
          sort: <SortPanel bare fields={catalog} rules={sortRules} onChange={onSortRulesChange} onClose={onClose} />,
          color: <ColorPanel bare rules={colorRules} onChange={onColorRulesChange} onClose={onClose} wbsPalette={wbsPalette} onWbsPaletteChange={onWbsPaletteChange} fields={catalog} valuesOf={columnCtx ? valuesOf : undefined} />,
        }}
      />
      {scenariosOn && (
        <DockPanel id="generated" label="Generated schedules">
          <div className="config-panel__body" style={{ flex: 1, minHeight: 0 }}><GeneratedSchedulesPanel model={model} /></div>
        </DockPanel>
      )}
    </>
  );
}
