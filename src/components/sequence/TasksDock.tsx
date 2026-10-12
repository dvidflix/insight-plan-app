import { useMemo } from 'react';
import type { ScheduleModel } from '../../schedule/types';
import type { ColumnCtx, ColumnDef } from '../../schedule/columns';
import { countActiveFilters } from '../../schedule/filterFields';
import { useTasksSettingsStore } from '../../state/tasksSettingsStore';
import { ColumnsPanel } from '../schedule/ColumnsPanel';
import { FiltersPanel } from '../schedule/FiltersPanel';
import { GroupPanel } from '../schedule/GroupPanel';
import { SortPanel } from '../schedule/SortPanel';
import { ColorPanel } from '../schedule/ColorPanel';
import { SidePaneDock } from '../SidePane';
import { IconColumns, IconFilter, IconGroup, IconPalette, IconSort } from '../icons';
import { defaultColumnIds } from './TasksPanel';

const TABS = [
  { id: 'columns', label: 'Columns', icon: <IconColumns /> },
  { id: 'filters', label: 'Filters', icon: <IconFilter /> },
  { id: 'group', label: 'Group', icon: <IconGroup /> },
  { id: 'sort', label: 'Sort', icon: <IconSort /> },
  { id: 'color', label: 'Color', icon: <IconPalette /> },
] as const;

/** The Tasks settings: columns, filters, grouping, sorting and colours of the 4D Tasks list, in the lower part of the
    side pane (like the Scenario panel) while the Tasks tab shows. */
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
  const badge = { columns: 0, filters: countActiveFilters(s.filters), group: s.groupRules.length, sort: s.sortRules.length, color: s.colorRules.length };
  const close = () => {};

  return (
    <SidePaneDock>
      <div className="scn-dock" aria-label="Tasks settings">
        <div className="side-pane__bar scn-dock__bar" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={s.tab === t.id} className={`side-pane__tab${s.tab === t.id ? ' active' : ''}`} title={`Tasks: ${t.label}`} aria-label={`Tasks: ${t.label}`} onClick={() => patch({ tab: t.id })}>
              {t.icon}
              {badge[t.id] ? <span className="side-pane__badge">{badge[t.id]}</span> : null}
            </button>
          ))}
        </div>
        <div className="config-panel__body scn-panel scn-dock__body">
          {s.tab === 'columns' && <ColumnsPanel catalog={catalog} views={[{ id: 'tasks', label: 'Tasks', selected: s.columnIds ?? defaults, defaults, onChange: (columnIds) => patch({ columnIds }) }]} calculated />}
          {s.tab === 'filters' && <FiltersPanel model={model} baseActivities={model.activities} state={s.filters} onChange={(next) => patch({ filters: typeof next === 'function' ? next(useTasksSettingsStore.getState().filters) : next })} />}
          {s.tab === 'group' && <GroupPanel bare fields={catalog} rules={s.groupRules} onChange={(groupRules) => patch({ groupRules })} onClose={close} onCollapseAll={() => patch({ collapseAll: s.collapseAll + 1 })} onExpandAll={() => patch({ expandAll: s.expandAll + 1 })} groupByWbs={s.groupByWbs} onToggleGroupByWbs={() => patch({ groupByWbs: !s.groupByWbs })} />}
          {s.tab === 'sort' && <SortPanel bare fields={catalog} rules={s.sortRules} onChange={(sortRules) => patch({ sortRules })} onClose={close} />}
          {s.tab === 'color' && <ColorPanel bare rules={s.colorRules} onChange={(colorRules) => patch({ colorRules })} onClose={close} wbsPalette={s.wbsPalette} onWbsPaletteChange={(wbsPalette) => patch({ wbsPalette })} fields={catalog} valuesOf={valuesOf} />}
        </div>
      </div>
    </SidePaneDock>
  );
}
