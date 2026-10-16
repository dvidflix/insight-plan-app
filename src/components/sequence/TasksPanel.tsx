import { useMemo } from 'react';
import type { Activity, ScheduleModel } from '../../schedule/types';
import { resolveColumns, type ColumnCtx, type ColumnDef } from '../../schedule/columns';
import { activityFinishMs, activityStartMs, statusInPeriod } from '../../schedule/linking';
import { alignDown, nextBoundary } from '../../schedule/period';
import { useSequenceTimelineStore, type StepUnit } from '../../state/sequenceTimelineStore';
import { usePersistedState } from '../../utils/persistedState';
import { ActivityTable } from '../schedule/ActivityTable';
import { resolveRuleColor } from '../schedule/ColorPanel';
import { applyFieldFilters, buildFilterFields } from '../../schedule/filterFields';
import { useCalcFilterFields } from '../../schedule/calculatedColumns';
import { spreadColumns } from '../../schedule/periodShare';
import { configFocusProps } from '../../state/listConfigStore';
import { ListTools } from '../ListConfig';
import { useTasksSettingsStore } from '../../state/tasksSettingsStore';

export type TasksMode = 'active' | 'starting' | 'finishing';
type Mode = TasksMode;

const MODES: { id: Mode; label: string; title: string }[] = [
  { id: 'active', label: 'Active', title: 'Activities running at any point in the period' },
  { id: 'starting', label: 'Starting', title: 'Activities that start in the period' },
  { id: 'finishing', label: 'Finishing', title: 'Activities that finish in the period' },
];

const DAY_MS = 86400000;

/** A row-background version of a stage colour: translucent, so text stays readable. */
function tint(color: string | null): string | null {
  if (!color) return null;
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.28)`;
}

export function periodLabel(startMs: number, endMs: number, unit: StepUnit): string {
  const d = new Date(startMs);
  const fmt = (x: Date, o: Intl.DateTimeFormatOptions) => x.toLocaleDateString(undefined, o);
  if (unit.endsWith('h')) {
    const t = (x: Date) => x.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    return `${fmt(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} ${t(d)}–${t(new Date(endMs))}`;
  }
  switch (unit) {
    case 'day': return fmt(d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    case 'week': return `${fmt(d, { day: 'numeric', month: 'short' })} – ${fmt(new Date(endMs - DAY_MS), { day: 'numeric', month: 'short', year: 'numeric' })}`;
    case 'month': return fmt(d, { month: 'long', year: 'numeric' });
    case 'quarter': return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
    default: return String(d.getFullYear());
  }
}

const UNIT_NOUN: Record<StepUnit, string> = {
  '1h': 'Hour', '2h': '2 hours', '3h': '3 hours', '4h': '4 hours', '6h': '6 hours', '8h': '8 hours', '12h': '12 hours',
  day: 'Day', week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year',
};

/** Columns shown the first time: the basics plus a units column for the
    Rebar / Concrete resources when the schedule has them (else the first two). */
export function defaultColumnIds(catalog: ColumnDef[]): string[] {
  const resource = catalog.filter((c) => c.id.startsWith('res:'));
  const preferred = resource.filter((c) => /rebar|concrete/i.test(c.label));
  const picked = (preferred.length ? preferred : resource.slice(0, 2)).map((c) => c.id);
  return ['code', 'name', 'start', 'finish', 'budgetedUnits', ...picked];
}

interface TasksPanelProps {
  model: ScheduleModel;
  catalog: ColumnDef[];
  columnCtx: ColumnCtx;
  selectedId: string | null;
  /** Colour of a task under the 4D Appearance Profiles (null = none). */
  getColor?: (activity: Activity) => string | null;
  onSelect: (activity: Activity) => void;
  onOpen?: (activity: Activity) => void;
}

/** The activities of the 4D cursor's current step (day / week / month /
    quarter / year, whatever the playback unit is), updating as it plays — with
    per-resource unit columns and a totals bar under the list. */
/** The activities listed for a step — shared with the video export. */
export function tasksInPeriod(model: ScheduleModel, period: { start: number; end: number }, basis: 'planned' | 'actual', mode: TasksMode): Activity[] {
  return model.activities.filter((a) => {
    if (a.type === 'wbs-summary') return false;
    const start = activityStartMs(a, basis);
    const finish = activityFinishMs(a, basis);
    if (mode === 'starting') return start !== null && start >= period.start && start < period.end;
    if (mode === 'finishing') return finish !== null && finish >= period.start && finish < period.end;
    return statusInPeriod(a, period.start, period.end, basis) === 'in-progress';
  });
}

export function TasksPanel({ model, catalog, columnCtx, selectedId, getColor, onSelect, onOpen }: TasksPanelProps) {
  const date = useSequenceTimelineStore((s) => s.date);
  const stepUnit = useSequenceTimelineStore((s) => s.stepUnit);
  const basis = useSequenceTimelineStore((s) => s.basis);
  const [mode, setMode] = usePersistedState<Mode>('sequence.tasksMode', 'active');
  // Columns, filters, grouping, sorting and colours are set in the Tasks settings pane (TasksDock).
  const settings = useTasksSettingsStore();
  const calcFields = useCalcFilterFields(model);
  const filterFields = useMemo(() => buildFilterFields(model, calcFields), [model, calcFields]);

  const period = useMemo(() => (date === null ? null : { start: alignDown(date, stepUnit), end: nextBoundary(date, stepUnit) }), [date, stepUnit]);

  const inPeriod = useMemo(() => (period ? tasksInPeriod(model, period, basis, mode) : []), [model, period, basis, mode]);
  const tasks = useMemo(() => applyFieldFilters(inPeriod, filterFields, settings.filters), [inPeriod, filterFields, settings.filters]);

  // Units and costs are the period's share of each task (spread over its working days), not its total every week.
  const columns = useMemo(() => spreadColumns(resolveColumns(catalog, settings.columnIds ?? defaultColumnIds(catalog)), period, basis), [catalog, settings.columnIds, period, basis]);
  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  const ruleColour = (a: Activity) => resolveRuleColor(settings.colorRules, a, (field, act) => catalogById.get(field)?.text(act, columnCtx));

  return (
    <div className="tasks" {...configFocusProps('tasks')}>
      <div className="tasks__head">
        <div className="tasks__period">
          <span className="tasks__unit">{UNIT_NOUN[stepUnit]}</span>
          <strong>{period ? periodLabel(period.start, period.end, stepUnit) : '—'}</strong>
          <span className="tasks__count" title={`${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} in this period`}>· {tasks.length.toLocaleString()}</span>
        </div>
        <div className="tasks__tools">
          <ListTools id="tasks" iconOnly />
          <div className="heat__tabs" role="tablist">
            {MODES.map((m) => (
              <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} title={m.title} className={mode === m.id ? 'active' : ''} onClick={() => setMode(m.id)}>{m.label}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="tasks__table">
        {period === null ? (
          <div className="report-empty">Press play or move the timeline to list tasks.</div>
        ) : (
          <ActivityTable
            activities={tasks}
            selectedId={selectedId}
            groupBy={settings.groupByWbs && settings.groupRules.length === 0 ? 'wbs' : ''}
            groupRules={settings.groupRules}
            sortField={settings.sortRules[0]?.field}
            sortDirection={settings.sortRules[0]?.direction}
            collapseAllSignal={settings.collapseAll}
            expandAllSignal={settings.expandAll}
            wbsPalette={settings.wbsPalette}
            columns={columns}
            catalog={catalog}
            columnCtx={columnCtx}
            persistKey="sequence.tasks"
            getColor={(a) => tint(getColor?.(a) ?? null) ?? ruleColour(a)}
            showTotals
            onSelect={onSelect}
            onOpen={onOpen}
          />
        )}
      </div>
    </div>
  );
}
