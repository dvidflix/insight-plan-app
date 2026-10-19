import { useMemo } from 'react';
import type { ScheduleModel } from '../../schedule/types';
import type { ColumnCtx, ColumnDef } from '../../schedule/columns';
import { countActiveFilters } from '../../schedule/filterFields';
import { useTasksSettingsStore } from '../../state/tasksSettingsStore';
import { ColumnsPanel } from '../schedule/ColumnsPanel';
import { FiltersPanel } from '../schedule/FiltersPanel';
import { GroupPanel } from '../schedule/GroupPanel';
import { ColorPanel } from '../schedule/ColorPanel';
import { ListConfig } from '../ListConfig';
import { defaultColumnIds } from './TasksPanel';

/** The Tasks list's part of the shared settings panels: its columns, filters, grouping, sorting and colours. */
export function TasksDock({ model, catalog, columnCtx }: { model: ScheduleModel; catalog: ColumnDef[]; columnCtx: ColumnCtx }) {
  const s = useTasksSettingsStore();
  const { patch } = s;
  const defaults = useMemo(() => defaultColumnIds(catalog), [catalog]);
  const valuesOf = useMemo(() => {
    const cache = new Map<string, { value: string; count: number }[]>();
    return (fieldId: string) => {
      const hit = cache.get(fieldId);
      if (hit) return hit;
      const col = catalog.find((c) => c.id === fieldId);
      const counts = new Map<string, number>();
      if (col) for (const a of model.activities) {
        const v = col.text(a, columnCtx);
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const list = [...counts].map(([value, count]) => ({ value, count })).sort((x, y) => y.count - x.count || x.value.localeCompare(y.value));
      cache.set(fieldId, list);
      return list;
    };
  }, [catalog, columnCtx, model]);
  const close = () => {};

  return (
    <ListConfig
      id="tasks"
      label="Tasks"
      badges={{ filters: countActiveFilters(s.filters), group: s.groupRules.length, sort: s.sortRules.length, color: s.colorRules.length }}
      panels={{
        columns: <ColumnsPanel catalog={catalog} views={[{ id: 'tasks', label: 'Tasks', selected: s.columnIds ?? defaults, defaults, onChange: (columnIds) => patch({ columnIds }) }]} calculated sort={{ rules: s.sortRules, onChange: (sortRules) => patch({ sortRules }) }} />,
        filters: <FiltersPanel model={model} baseActivities={model.activities} state={s.filters} onChange={(next) => patch({ filters: typeof next === 'function' ? next(useTasksSettingsStore.getState().filters) : next })} />,
        group: <GroupPanel bare fields={catalog} rules={s.groupRules} onChange={(groupRules) => patch({ groupRules })} onClose={close} onCollapseAll={() => patch({ collapseAll: s.collapseAll + 1 })} onExpandAll={() => patch({ expandAll: s.expandAll + 1 })} groupByWbs={s.groupByWbs} onToggleGroupByWbs={() => patch({ groupByWbs: !s.groupByWbs })} />,
        color: <ColorPanel bare rules={s.colorRules} onChange={(colorRules) => patch({ colorRules })} onClose={close} wbsPalette={s.wbsPalette} onWbsPaletteChange={(wbsPalette) => patch({ wbsPalette })} fields={catalog} valuesOf={valuesOf} />,
      }}
    />
  );
}
