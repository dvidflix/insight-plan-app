import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityTable, type ActivityTableHandle } from '../components/schedule/ActivityTable';
import { GanttChart, ZOOMS, type GanttHandle, type Zoom } from '../components/schedule/GanttChart';
import { ResourcesView } from '../components/schedule/ResourcesView';
import { WbsView } from '../components/schedule/WbsView';
import { FullscreenButton } from '../components/ViewerToolbar';
import { ChecksView } from '../components/schedule/ChecksView';
import { CalendarHeatmap, type DayFilter } from '../components/schedule/CalendarHeatmap';
import { ExplorerView, type ExplorerPanelDef } from '../components/schedule/ExplorerView';
import { ReportsView } from '../components/reports/ReportsView';
import { HEAT_MODES, activityOnDay, dayToDate } from '../schedule/heatmap';
import { fmtDate } from '../schedule/reports';
import { DEFAULT_GANTT_COLUMNS, DEFAULT_TABLE_COLUMNS, buildColumnContext, resolveColumns } from '../schedule/columns';
import { useCalcFilterFields, useColumnCatalog } from '../schedule/calculatedColumns';
import type { ColumnView } from '../components/schedule/ColumnsPanel';
import { CalendarsPanel } from '../components/schedule/CalendarsPanel';
import { ActivityCodesView } from '../components/schedule/ActivityCodesView';
import { NetworkView } from '../components/schedule/NetworkView';
import { WhatIfPanel } from '../components/schedule/WhatIfPanel';
import { ComparePanel } from '../components/schedule/ComparePanel';
import { resolveRuleColor, type ColorRule } from '../components/schedule/ColorPanel';
import { DEFAULT_WBS_PALETTE } from '../schedule/wbsPalette';
import { type GroupRule } from '../components/schedule/GroupPanel';
import { type SortRule } from '../components/schedule/SortPanel';
import { ConfigPanel } from '../components/schedule/ConfigPanel';
import { ResizeHandle, ResizeHandleH, useResizableHeight, useResizableWidth } from '../components/ResizeHandle';
import { useSidePaneStore } from '../state/sidePaneStore';
import { matchesSearchTokens, searchTokens } from '../schedule/search';
import { exportGanttXlsx } from '../schedule/exportGanttXlsx';
import { applyFieldFilters, buildFilterFields, emptyFilterState, type FieldFilterState } from '../schedule/filterFields';
import { useScheduleStore, useVisibleSchedules } from '../state/scheduleStore';
import { usePersistedState } from '../utils/persistedState';
import { LayoutsDock } from '../components/schedule/LayoutsDock';
import { LookaheadView } from '../components/schedule/LookaheadView';
import { BulkEditView } from '../components/schedule/BulkEditView';
import { RenumberView } from '../components/schedule/RenumberView';
import { LinksPane } from '../components/schedule/LinksPane';
import { useSelectedActivityStore } from '../state/selectedActivityStore';
import { AnonymiseView } from '../components/schedule/AnonymiseView';
import { MonteCarloView } from '../components/schedule/MonteCarloView';
import { PpcView } from '../components/schedule/PpcView';
import { ActivityDetails } from '../components/schedule/ActivityDetails';
import { drivingPath } from '../schedule/drivingPath';
import { takePendingFilters, useScheduleLayoutsStore } from '../state/scheduleLayoutsStore';
import type { Activity, ActivityCodeTypeDef, ScheduleModel } from '../schedule/types';
import { mergeResourceCatalogs } from '../schedule/mergeSchedules';
import { IconDownload, IconGear, IconBookmark, IconChevronDown, IconSidePanel } from '../components/icons';
import { ToolbarSlotContext } from '../components/schedule/ToolbarSlot';
import { useAggregateStore } from '../state/aggregateStore';
import { useAppPrefsStore, type ExperimentalId } from '../state/appPrefsStore';

export type TabId = 'explorer' | 'activities' | 'wbs' | 'gantt' | 'resources' | 'heatmap' | 'calendars' | 'codes' | 'network' | 'checks' | 'reports' | 'whatif' | 'compare' | 'lookahead' | 'ppc' | 'montecarlo' | 'anonymise' | 'bulkedit' | 'renumber';

/** The Views list, in this order. Views marked `experimental` are still being tried out and
    only show when switched on in Settings › Experimental features. */
export const SCHEDULE_TABS: { id: TabId; label: string; experimental?: ExperimentalId }[] = [
  { id: 'gantt', label: 'Gantt' },
  { id: 'compare', label: 'Schedule Comparison' },
  { id: 'wbs', label: 'WBS' },
  { id: 'codes', label: 'Activity Codes' },
  { id: 'resources', label: 'Resources' },
  { id: 'checks', label: 'Quality Checks' },
  { id: 'calendars', label: 'Calendars' },
  { id: 'heatmap', label: 'Calendar Heatmap' },
  { id: 'activities', label: 'Table View' },
  { id: 'lookahead', label: 'Lookahead' },
  { id: 'bulkedit', label: 'Bulk edit' },
  { id: 'renumber', label: 'Renumber to new model' },
  { id: 'reports', label: 'Reports and Analysis' },
  { id: 'explorer', label: 'Schedule Explorer', experimental: 'scheduleExplorer' },
  { id: 'network', label: 'Network View', experimental: 'networkView' },
  { id: 'ppc', label: 'PPC (Plan Complete)', experimental: 'ppcView' },
  { id: 'montecarlo', label: 'Risk (Monte Carlo)', experimental: 'monteCarlo' },
  { id: 'anonymise', label: 'Anonymise', experimental: 'anonymise' },
  { id: 'whatif', label: 'What-If Scenarios', experimental: 'whatIf' },
];

/** Merges each schedule's activity code dictionary by type name, namespacing
    every value/parent id with its source schedule so the parent-child tree
    within one schedule's type never collides with another's. */
function mergeActivityCodeCatalogs(schedules: ScheduleModel[]): ActivityCodeTypeDef[] {
  if (schedules.length <= 1) return schedules[0]?.activityCodeCatalog ?? [];
  const byName = new Map<string, ActivityCodeTypeDef>();
  for (const s of schedules) {
    for (const type of s.activityCodeCatalog ?? []) {
      const entry = byName.get(type.name) ?? { id: type.name, name: type.name, values: [] };
      entry.values = entry.values.concat(
        type.values.map((v) => ({
          ...v,
          id: `${s.id}:${v.id}`,
          parentId: v.parentId ? `${s.id}:${v.parentId}` : null,
        })),
      );
      byName.set(type.name, entry);
    }
  }
  return [...byName.values()];
}

function mergeSchedulesForDisplay(schedules: ScheduleModel[]): ScheduleModel | null {
  if (schedules.length === 0) return null;
  if (schedules.length === 1) return schedules[0];

  const first = schedules[0];
  const names = [...new Set(schedules.map((s) => s.project.name).filter(Boolean))];
  const allActivities = schedules.flatMap((s) =>
    s.activities.map((a) => ({
      ...a,
      id: `${s.id}:${a.id}`,
      wbsPath: `${s.project.name || s.sourceFileName} / ${a.wbsPath || ''}`.replace(/\s*\/\s*$/, ''),
      wbsCodePath: `${s.project.name || s.sourceFileName} / ${a.wbsCodePath || ''}`.replace(/\s*\/\s*$/, ''),
      activityCodes: { ...a.activityCodes },
      resources: a.resources.map((r) => ({ ...r })),
    })),
  );

  const allRelationships = schedules.flatMap((s) =>
    s.relationships.map((r) => ({
      ...r,
      predId: `${s.id}:${r.predId}`,
      succId: `${s.id}:${r.succId}`,
    })),
  );

  const allWbs = schedules.flatMap((s) => s.wbs.map((w) => ({ ...w, id: `${s.id}:${w.id}` })));
  const projectDates = schedules.flatMap((s) => [s.project.dataDate, s.project.planStart, s.project.planFinish]).filter((d): d is Date => !!d);

  return {
    ...first,
    id: 'combined',
    sourceFileName: names.join(', ') || first.sourceFileName,
    sourceFormat: first.sourceFormat,
    project: {
      ...first.project,
      id: 'combined',
      name: names.length > 0 ? `${names.length} schedules` : 'Combined schedule',
      dataDate: projectDates.length > 0 ? new Date(Math.min(...projectDates.map((d) => d.getTime()))) : null,
      planStart: projectDates.length > 0 ? new Date(Math.min(...projectDates.map((d) => d.getTime()))) : null,
      planFinish: projectDates.length > 0 ? new Date(Math.max(...projectDates.map((d) => d.getTime()))) : null,
    },
    activities: allActivities,
    relationships: allRelationships,
    wbs: allWbs,
    activityCodeTypes: [...new Set(schedules.flatMap((s) => s.activityCodeTypes))],
    activityCodeCatalog: mergeActivityCodeCatalogs(schedules),
    resourceNames: [...new Set(schedules.flatMap((s) => s.resourceNames))],
    resourceCatalog: mergeResourceCatalogs(schedules),
    calendars: schedules.flatMap((s) => s.calendars),
  };
}

type SchedulePageProps = {
  selectedTab?: TabId;
  onTabChange?: (tab: TabId) => void;
};

/** The two activity views, each with its own filters, grouping, sorting,
    colours and WBS options (Explorer shows both). */
type ListView = 'table' | 'gantt';

/** Earlier versions shared one set of these between Table and Gantt: each
    view starts from it. */
function legacy<T>(key: string, fallback: T): T {
  try {
    const s = localStorage.getItem(key);
    return s === null ? fallback : (JSON.parse(s) as T);
  } catch {
    return fallback;
  }
}

function useViewSettings(view: ListView) {
  const [groupRules, setGroupRules] = usePersistedState<GroupRule[]>(`${view}.groupRules`, legacy('schedule.groupRules', []));
  const [sortRules, setSortRules] = usePersistedState<SortRule[]>(`${view}.sortRules`, legacy('schedule.sortRules', []));
  const [colorRules, setColorRules] = usePersistedState<ColorRule[]>(`${view}.colorRules`, legacy('schedule.colorRules', []));
  // "Collapse to level" (All / 0-4): how far the WBS groups are opened.
  const [groupLevel, setGroupLevel] = usePersistedState(`${view}.groupLevel`, legacy('schedule.groupLevel', ''));
  // Group by WBS when no Group rule is set (the Table was only grouped by WBS with a level picked).
  const [groupByWbs, setGroupByWbs] = usePersistedState(`${view}.groupByWbs`, view === 'gantt' ? legacy('schedule.groupByWbs', true) : legacy('schedule.groupLevel', '') !== '');
  return { groupRules, setGroupRules, sortRules, setSortRules, colorRules, setColorRules, groupLevel, setGroupLevel, groupByWbs, setGroupByWbs };
}

/** Remounted when a layout is applied, so every view reads its settings again. */
export function SchedulePage(props: SchedulePageProps = {}) {
  const revision = useScheduleLayoutsStore((s) => s.revision);
  return <SchedulePageView key={revision} {...props} />;
}

function SchedulePageView({ selectedTab, onTabChange }: SchedulePageProps) {
  const schedules = useVisibleSchedules();
  const model = useMemo(() => mergeSchedulesForDisplay(schedules), [schedules]);
  // Experimental views only show when switched on; a saved one that is off falls back to the Gantt.
  const experimental = useAppPrefsStore((s) => s.experimental);
  const visibleTabs = useMemo(() => SCHEDULE_TABS.filter((t) => !t.experimental || experimental[t.experimental]), [experimental]);
  const asked = selectedTab ?? 'activities';
  const tab: TabId = visibleTabs.some((t) => t.id === asked) ? asked : 'gantt';
  const [layoutsOpen, setLayoutsOpen] = usePersistedState('programmes.layoutsOpen', false);
  const activityTableRef = useRef<ActivityTableHandle>(null);
  const ganttRef = useRef<GanttHandle>(null);
  const [search, setSearch] = useState('');
  // Layouts and the name/code search belong to the activity views; the other
  // views put their own tools in the toolbar slot instead.
  const listTools = tab === 'activities' || tab === 'gantt' || tab === 'explorer';
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const showTotals = useAggregateStore((s) => s.showTotals);
  const setShowTotals = useAggregateStore((s) => s.setShowTotals);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Curtain: filters fade rows back instead of removing them. Driving path: the chain driving one activity.
  const [curtain, setCurtain] = usePersistedState('schedule.curtain', false);
  const [drivingTarget, setDrivingTarget] = useState<string | null>(null);
  const [error] = useState<string | null>(null);
  // The Activity pane opens from its toolbar button, not by selecting an activity.
  const [detailsOpen, setDetailsOpen] = usePersistedState('programmes.detailsOpen', false);
  const [zoom, setZoom] = usePersistedState<Zoom>('schedule.zoom', 'week');
  const [ganttSettingsOpen, setGanttSettingsOpen] = useState(false);
  const [showGanttLinks, setShowGanttLinks] = usePersistedState('schedule.showGanttLinks', false);
  const [showGanttCritical, setShowGanttCritical] = usePersistedState('schedule.showGanttCritical', true);
  const [showGanttBaseline, setShowGanttBaseline] = usePersistedState('schedule.showGanttBaseline', false);
  const [showGanttLabels, setShowGanttLabels] = usePersistedState('schedule.showGanttLabels', false);
  const [wbsPalette, setWbsPalette] = usePersistedState('schedule.wbsPalette', DEFAULT_WBS_PALETTE);
  const [collapseAllSignal, setCollapseAllSignal] = useState(0);
  const [expandAllSignal, setExpandAllSignal] = useState(0);
  const tableSet = useViewSettings('table');
  const ganttSet = useViewSettings('gantt');
  // Explorer shows both views: which one the side pane and toolbar set up.
  const [explorerView, setExplorerView] = usePersistedState<ListView>('programmes.explorerConfig', 'table');
  const cfgView: ListView = tab === 'gantt' ? 'gantt' : tab === 'explorer' ? explorerView : 'table';
  const cfg = cfgView === 'gantt' ? ganttSet : tableSet;
  // The Table groups like the Gantt: by the Group rules, else by WBS when that is on.
  const tableGroupBy = tableSet.groupRules[0]?.field ?? (tableSet.groupByWbs ? 'wbs' : '');
  const [filtersByView, setFiltersByView] = useState<Record<ListView, FieldFilterState>>(() => takePendingFilters() ?? { table: emptyFilterState(), gantt: emptyFilterState() });
  const fieldFilters = filtersByView[cfgView];
  const setViewFilters = (view: ListView, next: FieldFilterState | ((prev: FieldFilterState) => FieldFilterState)) =>
    setFiltersByView((all) => ({ ...all, [view]: typeof next === 'function' ? next(all[view]) : next }));
  const catalog = useColumnCatalog(model);
  const columnCtx = useMemo(() => (model ? buildColumnContext(model) : null), [model]);
  const [tableColumnIds, setTableColumnIds] = usePersistedState<string[]>('table.columns', DEFAULT_TABLE_COLUMNS);
  const [ganttColumnIds, setGanttColumnIds] = usePersistedState<string[]>('gantt.columns', DEFAULT_GANTT_COLUMNS);
  const tableColumns = useMemo(() => resolveColumns(catalog, tableColumnIds), [catalog, tableColumnIds]);
  const ganttColumns = useMemo(() => resolveColumns(catalog, ganttColumnIds), [catalog, ganttColumnIds]);
  const [dayFilter, setDayFilter] = useState<DayFilter | null>(null);
  const detailsWidth = useResizableWidth('schedule.detailsWidth', 300, 240, 600);
  const linksHeight = useResizableHeight('schedule.linksHeight', 240, 120, 640);

  const viewFiltered = useMemo(() => {
    if (!model) return [];
    let list = model.activities;
    // Only where the search box shows, so a leftover search never hides activities elsewhere.
    const tokens = listTools ? searchTokens(search) : [];
    if (tokens.length > 0) {
      list = list.filter((a) => matchesSearchTokens(a.code, tokens) || matchesSearchTokens(a.name, tokens));
    }
    return list;
  }, [model, search, listTools]);

  const calcFilterFields = useCalcFilterFields(model);
  const filterFields = useMemo(() => (model ? buildFilterFields(model, calcFilterFields) : []), [model, calcFilterFields]);
  // The calendar heatmap counts these (so its own day filter doesn't blank it out).
  const tableFieldFiltered = useMemo(() => applyFieldFilters(viewFiltered, filterFields, filtersByView.table), [viewFiltered, filterFields, filtersByView.table]);
  const ganttFieldFiltered = useMemo(() => applyFieldFilters(viewFiltered, filterFields, filtersByView.gantt), [viewFiltered, filterFields, filtersByView.gantt]);
  const onDay = (list: Activity[]) => (dayFilter ? list.filter((a) => activityOnDay(a, dayFilter.mode, dayFilter.day)) : list);
  const tableFiltered = useMemo(() => onDay(tableFieldFiltered), [tableFieldFiltered, dayFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  const ganttFiltered = useMemo(() => onDay(ganttFieldFiltered), [ganttFieldFiltered, dayFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  // The rest of the page (count, resources, calendar) follows the view being set up.
  const fieldFiltered = cfgView === 'gantt' ? ganttFieldFiltered : tableFieldFiltered;
  const filtered = cfgView === 'gantt' ? ganttFiltered : tableFiltered;

  const selected = filtered.find((a) => a.id === selectedId) ?? (tab === 'explorer' ? [...tableFiltered, ...ganttFiltered].find((a) => a.id === selectedId) : undefined) ?? (selectedId ? model?.activities.find((a) => a.id === selectedId) : undefined) ?? null;
  const linksShown = detailsOpen && (tab === 'activities' || tab === 'gantt' || tab === 'explorer');

  const drivingIds = useMemo(() => (model && drivingTarget ? drivingPath(model, drivingTarget).ids : null), [model, drivingTarget]);
  // The curtain: every activity stays in the list; those the filters (or the driving path) leave out fade back.
  const dimmedFor = (kept: Activity[]) => {
    if (!curtain || !model) return undefined;
    const keep = new Set(kept.map((x) => x.id));
    const out = new Set<string>();
    for (const x of model.activities) if (!keep.has(x.id) || (drivingIds && !drivingIds.has(x.id))) out.add(x.id);
    return out;
  };
  const tableDimmed = useMemo(() => dimmedFor(tableFiltered), [curtain, model, tableFiltered, drivingIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const ganttDimmed = useMemo(() => dimmedFor(ganttFiltered), [curtain, model, ganttFiltered, drivingIds]); // eslint-disable-line react-hooks/exhaustive-deps
  const tableList = curtain && model ? model.activities : tableFiltered;
  const ganttList = curtain && model ? model.activities : ganttFiltered;

  const setVisibleActivityCount = useScheduleStore((s) => s.setVisibleActivityCount);
  useEffect(() => {
    setVisibleActivityCount(filtered.length);
    return () => setVisibleActivityCount(null);
  }, [filtered.length, setVisibleActivityCount]);

  // Tell the 3D view which activity is selected, so it can select its predecessors and successors.
  const selectedActivityId = selected?.id ?? null;
  useEffect(() => {
    useSelectedActivityStore.getState().set(model, selectedActivityId);
  }, [model, selectedActivityId]);

  const handleSelect = (activity: Activity) => {
    setSelectedId(activity.id);
  };

  if (!model) {
    return (
      <div className="page">
        <div className="empty-input-state">
          <div className="empty-input-state__title">No schedule inputs loaded</div>
          <div className="empty-input-state__text">Use the Inputs tab to add P6 exports.</div>
        </div>
        {error && <div style={{ color: 'var(--danger)', padding: '0 12px' }}>{error}</div>}
      </div>
    );
  }

  // Colour rules can test any column (Configuration > Color).
  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  const colorLookup = (fieldId: string, a: Activity) => (columnCtx ? catalogById.get(fieldId)?.text(a, columnCtx) : undefined);

  const activityTable = (
    <ActivityTable
      ref={activityTableRef}
      activities={tableList}
      dimmedIds={tableDimmed}
      markedIds={drivingIds ?? undefined}
      selectedId={selectedId}
      groupBy={tableGroupBy}
      wbsLevel={tableSet.groupLevel}
      columns={tableColumns}
      catalog={catalog}
      columnCtx={columnCtx!}
      getColor={(a) => resolveRuleColor(tableSet.colorRules, a, colorLookup)}
      groupRules={tableSet.groupRules}
      aggregatable
      sortField={tableSet.sortRules[0]?.field}
      sortDirection={tableSet.sortRules[0]?.direction}
      collapseAllSignal={collapseAllSignal}
      expandAllSignal={expandAllSignal}
      wbsPalette={wbsPalette}
      onSelect={handleSelect}
    />
  );
  const exportGantt = () => {
    const data = ganttRef.current?.getExport();
    if (data) exportGanttXlsx(data, `Gantt ${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const ganttChart = (
    <GanttChart
      ref={ganttRef}
      activities={ganttList}
      dimmedIds={ganttDimmed}
      highlightedIds={drivingIds ?? undefined}
      relationships={model.relationships}
      selectedId={selectedId}
      getColor={(a) => resolveRuleColor(ganttSet.colorRules, a, colorLookup)}
      groupByWbs={ganttSet.groupByWbs}
      groupRules={ganttSet.groupRules}
      catalog={catalog}
      aggregatable
      wbsLevel={ganttSet.groupLevel}
      wbsPalette={wbsPalette}
      showLinks={showGanttLinks}
      showCritical={showGanttCritical}
      showBaseline={showGanttBaseline}
      showLabels={showGanttLabels}
      dataDate={model.project.dataDate}
      collapseAllSignal={collapseAllSignal}
      expandAllSignal={expandAllSignal}
      zoom={zoom}
      columns={ganttColumns}
      columnCtx={columnCtx!}
      onSelect={handleSelect}
    />
  );
  const tableView: ColumnView = { id: 'table', label: 'Table View', selected: tableColumnIds, defaults: DEFAULT_TABLE_COLUMNS, onChange: setTableColumnIds };
  const ganttView: ColumnView = { id: 'gantt', label: 'Gantt', selected: ganttColumnIds, defaults: DEFAULT_GANTT_COLUMNS, onChange: setGanttColumnIds };
  const columnViews = tab === 'gantt' ? [ganttView] : tab === 'explorer' ? [tableView, ganttView] : [tableView];
  const dayFilterLabel = dayFilter
    ? `${fmtDate(dayToDate(dayFilter.day))} · ${HEAT_MODES.find((m) => m.id === dayFilter.mode)?.label}`
    : '';

  const explorerPanels: ExplorerPanelDef[] = [
    { id: 'activities', title: 'Activity table', render: () => activityTable, onExport: () => activityTableRef.current?.download() },
    { id: 'gantt', title: 'Timeline (Gantt)', render: () => ganttChart, onExport: exportGantt },
    { id: 'resources', title: 'Resources', render: () => <ResourcesView model={model} activities={filtered} onSelect={handleSelect} /> },
    {
      id: 'heatmap', title: 'Calendar',
      render: () => <CalendarHeatmap activities={fieldFiltered} dayFilter={dayFilter} onDayFilter={setDayFilter} catalog={catalog} columnCtx={columnCtx ?? undefined} onSelectActivity={(a) => { handleSelect(a); setDetailsOpen(true); onTabChange?.('activities'); }} />,
    },
  ];

  return (
    <ToolbarSlotContext.Provider value={toolbarSlot}>
    <div className="page">
      {error && <div style={{ color: 'var(--danger)', padding: '0 12px' }}>{error}</div>}
      <div className="filterbar schedule-toolbar">
        <div className="schedule-toolbar__left">
          <div className="workspaces-picker" aria-label="Views selector">
            <label className="workspaces-picker__label" htmlFor="schedule-layout-select">
              Views
            </label>
            <div className="workspaces-picker__select-wrap">
              <select id="schedule-layout-select" value={tab} onChange={(e) => onTabChange?.(e.target.value as TabId)}>
                {visibleTabs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              <span className="workspaces-picker__chevron">
                <IconChevronDown />
              </span>
            </div>
          </div>
          {listTools && (
            <>
            <input
              className="filterbar__search"
              type="search"
              placeholder="Search name/code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            </>
          )}
          {(tab === 'activities' || tab === 'gantt' || tab === 'explorer') && (
            <div className="groupby-panel">
              {tab === 'explorer' && (
                <>
                  <span className="groupby-panel__title">Set up:</span>
                  <select value={explorerView} onChange={(e) => setExplorerView(e.target.value as ListView)} title="Which view the side pane (columns, filters, group, sort, colour) and the level below set up">
                    <option value="table">Activity table</option>
                    <option value="gantt">Gantt</option>
                  </select>
                </>
              )}
              <span className="groupby-panel__title">Level:</span>
              <select value={cfg.groupLevel} onChange={(e) => cfg.setGroupLevel(e.target.value)} title="Collapse the WBS groups to this level (All: everything open)">
                <option value="">All</option>
                {['0', '1', '2', '3', '4', '5', '6', '7', '8'].map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div ref={setToolbarSlot} className="schedule-toolbar__slot" />
          {dayFilter && (
            <button className="btn btn--small" type="button" onClick={() => setDayFilter(null)} title="Clear day filter">
              Day: {dayFilterLabel} ✕
            </button>
          )}
          {tab === 'gantt' && (
            <>
              <span className="groupby-panel__title">Zoom: </span>
              <select value={zoom} onChange={(e) => setZoom(e.target.value as Zoom)}>
                {ZOOMS.map((z) => (
                  <option key={z} value={z}>
                    {z[0].toUpperCase() + z.slice(1)}
                  </option>
                ))}
              </select>
              <button className="btn btn--small" type="button" onClick={() => ganttRef.current?.scrollToToday()} title="Scroll to today">Today</button>
              <button className="btn btn--small" type="button" onClick={() => ganttRef.current?.fit()} title="Fit whole programme in view">Fit</button>
              <button className="btn btn--small" type="button" onClick={() => ganttRef.current?.zoomOut()} title="Zoom out (Ctrl + wheel)">−</button>
              <button className="btn btn--small" type="button" onClick={() => ganttRef.current?.zoomIn()} title="Zoom in (Ctrl + wheel)">+</button>
              <div style={{ position: 'relative' }}>
                <button className="icon-btn" title="Gantt settings" onClick={() => setGanttSettingsOpen((v) => !v)}>
                  <IconGear />
                </button>
                {ganttSettingsOpen && (
                  <div
                    style={{
                      position: 'absolute', top: '110%', left: 0, zIndex: 20, width: 220,
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 10,
                    }}
                  >
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 6 }}>Gantt</div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
                      <input type="checkbox" checked={showGanttLinks} onChange={(e) => setShowGanttLinks(e.target.checked)} />
                      Show relationship links
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
                      <input type="checkbox" checked={showGanttCritical} onChange={(e) => setShowGanttCritical(e.target.checked)} />
                      Highlight critical path
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
                      <input type="checkbox" checked={showGanttBaseline} onChange={(e) => setShowGanttBaseline(e.target.checked)} />
                      Show target (baseline) bars
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 13 }}>
                      <input type="checkbox" checked={showGanttLabels} onChange={(e) => setShowGanttLabels(e.target.checked)} />
                      Show names beside bars
                    </label>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="schedule-toolbar__right">
          {drivingTarget && (
            <button className="btn btn--small" type="button" onClick={() => setDrivingTarget(null)} title="Clear the driving path">
              Driving path to {model.activities.find((x) => x.id === drivingTarget)?.code ?? ''} ✕
            </button>
          )}
          {listTools && (
            <button
              type="button"
              className={`btn totals-toggle${curtain ? ' primary' : ''}`}
              aria-pressed={curtain}
              onClick={() => setCurtain(!curtain)}
              title="Curtain: filters and the driving path fade the other rows back instead of removing them"
            >
              Curtain
            </button>
          )}
          {(tab === 'activities' || tab === 'gantt' || tab === 'explorer') && (
            <button
              type="button"
              className={`btn totals-toggle${showTotals ? ' primary' : ''}`}
              aria-pressed={showTotals}
              onClick={() => setShowTotals(!showTotals)}
              title="Totals row and group subtotals; pick how each column sums up (sum, average, min, max, dates, spans) in the totals row"
            >
              Σ Totals
            </button>
          )}
          {tab === 'activities' && (
            <button
              className="icon-btn"
              type="button"
              onClick={() => activityTableRef.current?.download()}
              title="Download as CSV"
            >
              <IconDownload />
            </button>
          )}
          {tab === 'gantt' && (
            <button className="icon-btn" type="button" onClick={exportGantt} title="Export the Gantt to Excel as it is shown: its columns, grouping, subtotals and folded groups">
              <IconDownload />
            </button>
          )}
          <FullscreenButton />
          {listTools && (
            <div className="schedule-toolbar__segmented layouts-segment">
              <button className={`btn layouts-toggle${layoutsOpen ? ' primary' : ''}`} type="button" aria-pressed={layoutsOpen} onClick={() => setLayoutsOpen((v) => !v)} title="Save and switch named layouts of this view">
                <span className="toolbar-button__icon"><IconBookmark /></span>
                Layouts
              </button>
              <button className={`btn layouts-toggle layouts-toggle--next${detailsOpen ? ' primary' : ''}`} type="button" aria-pressed={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)} title="Show the selected activity's details: fields and notes, with its predecessors and successors in a pane below">
                <span className="toolbar-button__icon"><IconSidePanel /></span>
                Activity details
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="page-body">
        <div className="page-body__main" style={linksShown ? { display: 'flex', flexDirection: 'column', overflow: 'hidden' } : undefined}>
          <div style={linksShown ? { flex: 1, minHeight: 0, overflow: 'auto' } : { display: 'contents' }}>
          {tab === 'activities' && activityTable}
          {tab === 'wbs' && <WbsView model={model} activities={filtered} wbsPalette={wbsPalette} />}
          {tab === 'gantt' && ganttChart}
          {tab === 'resources' && <ResourcesView model={model} activities={filtered} onSelect={handleSelect} />}
          {tab === 'calendars' && <CalendarsPanel model={model} onSelectActivity={(a) => { handleSelect(a); setDetailsOpen(true); onTabChange?.('activities'); }} />}
          {tab === 'codes' && (
            <ActivityCodesView
              model={model}
              onFilterActivities={(byType) => {
                setViewFilters('table', (prev) => {
                  const selections = { ...prev.selections };
                  for (const [typeName, values] of byType) selections[`code:${typeName}`] = values;
                  return { ...prev, selections };
                });
                onTabChange?.('activities');
              }}
            />
          )}
          {tab === 'network' && <NetworkView model={model} />}
          {tab === 'explorer' && <ExplorerView panels={explorerPanels} />}
          {tab === 'heatmap' && <CalendarHeatmap activities={fieldFiltered} dayFilter={dayFilter} onDayFilter={setDayFilter} catalog={catalog} columnCtx={columnCtx ?? undefined} onSelectActivity={(a) => { handleSelect(a); setDetailsOpen(true); onTabChange?.('activities'); }} />}
          {tab === 'reports' && <ReportsView model={model} />}
          {tab === 'checks' && (
            <ChecksView
              model={model}
              onSelectActivity={(id) => {
                setSelectedId(id);
                onTabChange?.('activities');
              }}
            />
          )}
          {tab === 'lookahead' && <LookaheadView model={model} onSelect={(a) => { handleSelect(a); onTabChange?.('activities'); }} />}
          {tab === 'ppc' && <PpcView model={model} onSelect={(a) => { handleSelect(a); onTabChange?.('activities'); }} />}
          {tab === 'montecarlo' && <MonteCarloView model={model} />}
          {tab === 'bulkedit' && <BulkEditView model={model} />}
          {tab === 'renumber' && <RenumberView model={model} />}
          {tab === 'anonymise' && <AnonymiseView model={model} />}
          {tab === 'whatif' && <WhatIfPanel model={model} />}
          {tab === 'compare' && <ComparePanel current={model} />}
          </div>
          {linksShown && selected && (
            <>
              <ResizeHandleH onMouseDown={linksHeight.startDrag} />
              <LinksPane activity={selected} model={model} height={linksHeight.height} onSelect={handleSelect} />
            </>
          )}
        </div>
        {detailsOpen && (tab === 'activities' || tab === 'gantt' || tab === 'explorer') && (
          <>
            <ResizeHandle onMouseDown={detailsWidth.startDrag(true)} />
            <div className="panel" style={{ width: detailsWidth.width, flexShrink: 0 }}>
              {selected ? (
                <ActivityDetails
                  activity={selected}
                  model={model}
                  drivingTarget={drivingTarget}
                  onDrivingTarget={setDrivingTarget}
                  onSelect={handleSelect}
                  onClose={() => setDetailsOpen(false)}
                />
              ) : (
                <div className="panel-section">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <h3 style={{ margin: 0 }}>Activity</h3>
                    <button type="button" className="btn btn--small" aria-label="Close activity details" onClick={() => setDetailsOpen(false)} style={{ padding: '4px 8px', minWidth: 'auto' }}>✕</button>
                  </div>
                  <div className="scn-dim" style={{ marginTop: 8 }}>Click an activity to see its details.</div>
                </div>
              )}
            </div>
          </>
        )}
        {(tab === 'activities' || tab === 'gantt' || tab === 'explorer') && (
          <>
            <ConfigPanel
              onClose={() => useSidePaneStore.getState().setOpen(false)}
              colorRules={cfg.colorRules}
              onColorRulesChange={cfg.setColorRules}
              wbsPalette={wbsPalette}
              onWbsPaletteChange={setWbsPalette}
              model={model}
              groupRules={cfg.groupRules}
              onGroupRulesChange={cfg.setGroupRules}
              onCollapseAll={() => setCollapseAllSignal((n) => n + 1)}
              onExpandAll={() => setExpandAllSignal((n) => n + 1)}
              groupByWbs={cfg.groupByWbs}
              onToggleGroupByWbs={() => cfg.setGroupByWbs((v) => !v)}
              sortRules={cfg.sortRules}
              onSortRulesChange={cfg.setSortRules}
              catalog={catalog}
              columnViews={columnViews}
              baseActivities={viewFiltered}
              columnCtx={columnCtx ?? undefined}
              fieldFilters={fieldFilters}
              onFieldFiltersChange={(next) => setViewFilters(cfgView, next)}
            />
          </>
        )}
        {listTools && layoutsOpen && <LayoutsDock filters={filtersByView} tab={tab} onClose={() => setLayoutsOpen(false)} />}
      </div>
    </div>
    </ToolbarSlotContext.Provider>
  );
}
