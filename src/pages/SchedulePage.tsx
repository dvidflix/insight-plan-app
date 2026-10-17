import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ActivityTable, type ActivityTableHandle } from '../components/schedule/ActivityTable';
import { GanttChart, ZOOMS, type GanttHandle, type Zoom } from '../components/schedule/GanttChart';
import { ResourcesView } from '../components/schedule/ResourcesView';
import { WbsView } from '../components/schedule/WbsView';
import { toggleFullscreen, useFullscreenStore } from '../components/ViewerToolbar';
import { OverflowMenu } from '../components/TablePopovers';
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
import { ConcreteComparison } from '../components/schedule/ConcreteComparison';
import { resolveRuleColor, type ColorRule } from '../components/schedule/ColorPanel';
import { DEFAULT_WBS_PALETTE } from '../schedule/wbsPalette';
import { type GroupRule } from '../components/schedule/GroupPanel';
import { type SortRule } from '../components/schedule/SortPanel';
import { configFocusProps } from '../state/listConfigStore';
import { ConfigPanel } from '../components/schedule/ConfigPanel';
import { useSidePaneStore } from '../state/sidePaneStore';
import { activitySearchText, matchesSearchTokens, searchTokens } from '../schedule/search';
import { exportGanttXlsx } from '../schedule/exportGanttXlsx';
import { makeGanttEditor } from '../schedule/ganttEdit';
import { applyFieldFilters, buildFilterFields, emptyFilterState, type FieldFilterState } from '../schedule/filterFields';
import { useScheduleStore, useVisibleSchedules } from '../state/scheduleStore';
import { usePersistedState } from '../utils/persistedState';
import { LayoutsDock } from '../components/schedule/LayoutsDock';
import { LookaheadView } from '../components/schedule/LookaheadView';
import { BulkEditView } from '../components/schedule/BulkEditView';
import { applyLinkShortcut } from '../schedule/linkShortcuts';
import { nudgeLag } from '../schedule/linkLag';
import { useActivitySelectionStore } from '../state/activitySelectionStore';
import { RenumberView } from '../components/schedule/RenumberView';
import { LinksPane } from '../components/schedule/LinksPane';
import { useSelectedActivityStore } from '../state/selectedActivityStore';
import { AnonymiseView } from '../components/schedule/AnonymiseView';
import { MonteCarloView } from '../components/schedule/MonteCarloView';
import { PpcView } from '../components/schedule/PpcView';
import { ActivityDetails } from '../components/schedule/ActivityDetails';
import { drivingPath } from '../schedule/drivingPath';
import { clearPendingFilters, peekPendingFilters, useScheduleLayoutsStore } from '../state/scheduleLayoutsStore';
import type { Activity, ActivityCodeTypeDef, ScheduleModel } from '../schedule/types';
import { mergeResourceCatalogs } from '../schedule/mergeSchedules';
import { IconCopy, IconDownload, IconFullscreen, IconUndo, IconRedo, IconRelated } from '../components/icons';
import { DockPanel } from '../components/Dock';
import { hasLinkedWindows, onWindowMessage, sendToWindows } from '../state/windowSync';
import { useSelectionSync } from '../schedule/useSelectionSync';
import { useListQuery } from '../state/tableSearchStore';
import { useHeaderSlotStore } from '../state/headerSlotStore';
import { ListSetupButton, ViewPicker, type PageItem } from '../components/ViewPicker';
import { DockGantt } from '../components/sequence/DockGantt';
import { ToolbarLeftSlotContext, ToolbarSlotContext } from '../components/schedule/ToolbarSlot';
import { EditTools } from '../components/schedule/EditTools';
import { LevelStepper } from '../components/schedule/LevelStepper';
import { PlannerView } from '../components/schedule/PlannerView';
import { ActivityPlanningPanel, DictionaryPanel } from '../components/schedule/PlanningPanels';
import { BaselineMenu } from '../components/schedule/BaselineMenu';
import { useChosenBaseline } from '../state/baselines';
import { redo, undo, useProgrammeHistory, useProgrammeHistoryKeys } from '../state/programmeHistory';
import { useAggregateStore } from '../state/aggregateStore';
import { useAppPrefsStore, type ExperimentalId } from '../state/appPrefsStore';

export type TabId = 'planner' | 'explorer' | 'activities' | 'wbs' | 'gantt' | 'resources' | 'heatmap' | 'calendars' | 'codes' | 'network' | 'checks' | 'reports' | 'whatif' | 'compare' | 'concrete' | 'lookahead' | 'ppc' | 'montecarlo' | 'anonymise' | 'bulkedit' | 'renumber';

/** The Views list, in this order. Views marked `experimental` are still being tried out and
    only show when switched on in Settings › Experimental features. */
export const SCHEDULE_TABS: { id: TabId; label: string; experimental?: ExperimentalId }[] = [
  { id: 'gantt', label: 'Gantt' },
  { id: 'planner', label: 'Planner (build and edit)' },
  { id: 'compare', label: 'Schedule Comparison' },
  { id: 'concrete', label: 'Concrete Comparison' },
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
  /** False while the page is kept mounted but hidden: it must not claim the shared side pane. */
  active?: boolean;
  /** The pages the picker at the start of the toolbar can go to (none in a second window: it only changes the view). */
  pages?: PageItem[];
  onPage?: (id: string) => void;
};

/** The two activity views, each with its own filters, grouping, sorting,
    colours and WBS options (Explorer shows both). */
export type ListView = 'table' | 'gantt';

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

export function useViewSettings(view: ListView) {
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

function SchedulePageView({ selectedTab, onTabChange, active = true, pages = [], onPage }: SchedulePageProps) {
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
  // The words the table is narrowed to come from the search box in the top bar ("Filter this table").
  const search = useListQuery('programmes');
  // Layouts and the name/code search belong to the activity views; the other
  // views put their own tools in the toolbar slot instead.
  const fullscreenOn = useFullscreenStore((st) => st.on);
  // The toolbar runs across the whole width above the docks (the header of the viewer workspace), while this page shows.
  const headerSlot = useHeaderSlotStore((h) => h.el);
  const listTools = tab === 'activities' || tab === 'gantt' || tab === 'explorer' || tab === 'planner';
  const [toolbarSlot, setToolbarSlot] = useState<HTMLDivElement | null>(null);
  const [leftSlot, setLeftSlot] = useState<HTMLElement | null>(null);
  // The zoom and view settings live at the right of the status bar (App's footer holds the spot).
  // The zoom and the view settings sit in the toolbar, on the right, before the table tools.
  const [statusSlot, setStatusSlot] = useState<HTMLElement | null>(null);
  useProgrammeHistoryKeys();
  const undoLabel = useProgrammeHistory((h) => h.undos[h.undos.length - 1]?.label ?? null);
  const redoLabel = useProgrammeHistory((h) => h.redos[h.redos.length - 1]?.label ?? null);
  const showTotals = useAggregateStore((s) => s.showTotals);
  const setShowTotals = useAggregateStore((s) => s.setShowTotals);
  const [selectedId, setSelectedIdLocal] = useState<string | null>(null);
  // The activity picked is shared with the other windows (a Gantt on one screen, its details on another).
  const setSelectedId = (id: string | null) => {
    setSelectedIdLocal(id);
    if (hasLinkedWindows()) sendToWindows('activity', id);
  };
  useEffect(() => onWindowMessage<string | null>('activity', (id) => setSelectedIdLocal(id)), []);
  // The search box (Ctrl K) takes you to an activity: its programme, the Gantt, the row picked and in view.
  useEffect(() => {
    const go = (e: Event) => {
      const { id, scheduleId } = (e as CustomEvent<{ id: string; scheduleId?: string }>).detail;
      if (scheduleId) useScheduleStore.setState({ selectedId: scheduleId });
      setSelectedIdLocal(id);
      onTabChange?.('gantt');
      window.setTimeout(() => ganttRef.current?.scrollToRow(id), 250);
    };
    window.addEventListener('ip-goto-activity', go);
    return () => window.removeEventListener('ip-goto-activity', go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Curtain: filters fade rows back instead of removing them. Driving path: the chain driving one activity.
  const [curtain, setCurtain] = usePersistedState('schedule.curtain', false);
  const [drivingTarget, setDrivingTarget] = useState<string | null>(null);
  const [error] = useState<string | null>(null);
  // The Activity pane opens from its toolbar button, not by selecting an activity.
  const [detailsOpen, setDetailsOpen] = usePersistedState('programmes.detailsOpen', false);
  // Predecessors and Successors: together (as the Activity pane used to bring them) or each in a panel of its own.
  const [linksOpen, setLinksOpen] = usePersistedState('programmes.linksOpen', legacy('programmes.detailsOpen', false));
  const [predsOpen, setPredsOpen] = usePersistedState('programmes.predecessorsOpen', false);
  const [succsOpen, setSuccsOpen] = usePersistedState('programmes.successorsOpen', false);
  // The programme's Gantt and Table as panels, to sit beside the 3D view or the 4D Gantt.
  // What the picked activities need (quantity, productivity, resources, codes) and the dictionaries they come from.
  const [planningOpen, setPlanningOpen] = usePersistedState('programmes.planningOpen', false);
  const [dictionaryOpen, setDictionaryOpen] = usePersistedState('programmes.dictionaryOpen', false);
  const [ganttPanelOpen, setGanttPanelOpen] = usePersistedState('programmes.ganttPanelOpen', false);
  const [zoom, setZoom] = usePersistedState<Zoom>('schedule.zoom', 'week');
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
  const [filtersByView, setFiltersByView] = useState<Record<ListView, FieldFilterState>>(() => peekPendingFilters() ?? { table: emptyFilterState(), gantt: emptyFilterState() });
  useEffect(() => clearPendingFilters(), []); // the layout's filters are in the state now
  const fieldFilters = filtersByView[cfgView];
  const setViewFilters = (view: ListView, next: FieldFilterState | ((prev: FieldFilterState) => FieldFilterState)) =>
    setFiltersByView((all) => ({ ...all, [view]: typeof next === 'function' ? next(all[view]) : next }));
  const catalog = useColumnCatalog(model);
  // The saved baseline the programme is shown against (the Baselines menu), when it is one programme from the project database.
  const baselineBase = schedules.length === 1 && schedules[0].dbProgrammeId !== undefined ? schedules[0] : null;
  const chosenBaseline = useChosenBaseline(baselineBase);
  const columnCtx = useMemo(() => (model ? buildColumnContext(model, chosenBaseline) : null), [model, chosenBaseline]);
  const [tableColumnIds, setTableColumnIds] = usePersistedState<string[]>('table.columns', DEFAULT_TABLE_COLUMNS);
  const [ganttColumnIds, setGanttColumnIds] = usePersistedState<string[]>('gantt.columns', DEFAULT_GANTT_COLUMNS);
  const tableColumns = useMemo(() => resolveColumns(catalog, tableColumnIds), [catalog, tableColumnIds]);
  const ganttColumns = useMemo(() => resolveColumns(catalog, ganttColumnIds), [catalog, ganttColumnIds]);
  const [dayFilter, setDayFilter] = useState<DayFilter | null>(null);

  const viewFiltered = useMemo(() => {
    if (!model) return [];
    let list = model.activities;
    // Only where the search box shows, so a leftover search never hides activities elsewhere.
    const tokens = listTools ? searchTokens(search) : [];
    if (tokens.length > 0) {
      list = list.filter((a) => matchesSearchTokens(activitySearchText(a), tokens));
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

  // Declared before the early return below: a hook after it is skipped when the schedule goes away ("Rendered fewer hooks than expected").
  const [shortcutNote, setShortcutNote] = useState<string | null>(null);

  const flash = (text: string) => { setShortcutNote(text); window.setTimeout(() => setShortcutNote((cur) => (cur === text ? null : cur)), 5000); };
  const handleSelect = (activity: Activity) => {
    setSelectedId(activity.id);
  };
  // Activities and the objects linked to them in the 3D model are picked together (schedule/useSelectionSync.ts).
  const [selectionSync, setSelectionSync] = usePersistedState('programmes.selectionSync', true);
  useSelectionSync({ model, selectedId, onPick: handleSelect, active, enabled: selectionSync });


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

  const ganttEditor = makeGanttEditor(schedules.length === 1 ? schedules[0] : null, flash);
  const activityTable = (
    <ActivityTable
      ref={activityTableRef}
      editor={ganttEditor}
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
  // Alt+S / Alt+F on the Gantt: link the picked activities (all in one programme).
  const linkShortcut = (kind: 'SS' | 'FS') => {
    const ids = useActivitySelectionStore.getState().ids;
    const own = schedules.length === 1 ? schedules[0] : schedules.find((m) => ids.size > 0 && [...ids].every((id) => id.startsWith(`${m.id}:`)));
    // A combined display prefixes each id with its programme's; the programme's own are plain.
    const plain = new Set([...ids].map((id) => (own && schedules.length > 1 ? id.slice(own.id.length + 1) : id)));
    const note = own ? applyLinkShortcut(kind, own, plain).message : 'Pick activities of one programme.';
    setShortcutNote(note);
    window.setTimeout(() => setShortcutNote((cur) => (cur === note ? null : cur)), 4000);
  };
  // Dragging the end of a selected link on the Gantt: its lag moves by whole working days.
  const lagChange = (rel: { predId: string; succId: string }, deltaDays: number) => {
    const own = schedules.length === 1 ? schedules[0] : schedules.find((m) => rel.predId.startsWith(`${m.id}:`) && rel.succId.startsWith(`${m.id}:`));
    const cut = (id: string) => (own && schedules.length > 1 ? id.slice(own.id.length + 1) : id);
    const note = own ? nudgeLag(own, cut(rel.predId), cut(rel.succId), deltaDays) : 'Pick links inside one programme.';
    if (!note) return;
    setShortcutNote(note);
    window.setTimeout(() => setShortcutNote((cur) => (cur === note ? null : cur)), 4000);
  };
  const exportGantt = () => {
    const data = ganttRef.current?.getExport();
    if (data) exportGanttXlsx(data, `Gantt ${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  // The Gantt is always ready to edit (one programme at a time): type in a cell, or copy rows to Excel and paste them back.
  const copyGantt = () => {
    (tab === 'activities' ? activityTableRef.current : ganttRef.current)?.copyTable().then((n) => flash(`Copied ${n} rows with their headings. Paste into Excel, change them there, then select the rows (Ctrl+A in Excel), copy, click the Gantt and paste (Ctrl+V): rows are matched by Activity ID.`), () => flash('The browser did not allow copying to the clipboard.'));
  };
  const ganttChart = (
    <GanttChart
      ref={ganttRef}
      editor={ganttEditor}
      activities={ganttList}
      dimmedIds={ganttDimmed}
      highlightedIds={drivingIds ?? undefined}
      relationships={model.relationships}
      selectedId={selectedId}
      rowColor={(a) => resolveRuleColor(ganttSet.colorRules, a, colorLookup)}
      groupByWbs={ganttSet.groupByWbs}
      groupRules={ganttSet.groupRules}
      sortRules={ganttSet.sortRules}
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
      onLinkShortcut={linkShortcut}
      onLagChange={lagChange}
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

  const toolbarEl = (
        <div className="filterbar schedule-toolbar">
          <div className="schedule-toolbar__left">
            <ViewPicker named pages={pages} page="schedule" onPage={(id) => (onPage ? onPage(id) : undefined)} tab={tab} onTab={(t) => onTabChange?.(t)}
            afterSearch={<>
      <span ref={setLeftSlot} className="groupby-panel" style={tab === 'wbs' ? undefined : { display: 'none' }} />
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
            <LevelStepper value={cfg.groupLevel} onChange={cfg.setGroupLevel} />
          </div>
        )}
            {/* The planning tools, in a menu, after the WBS level and the Zoom: they follow them instead of sitting in a place of their own. */}
            {schedules.length === 1 && schedules[0].editable && tab !== 'planner' && (
              <EditTools
                model={schedules[0]}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId(id)}
                onNote={(text) => { setShortcutNote(text); window.setTimeout(() => setShortcutNote((cur) => (cur === text ? null : cur)), 5000); }}
                keys={tab === 'activities' || tab === 'gantt'}
              />
            )}
              </>}
            />
          </div>
  
          <div className="schedule-toolbar__right">
            {baselineBase && <BaselineMenu model={baselineBase} />}
            <span ref={setStatusSlot} className="schedule-toolbar__view" />
            <div ref={setToolbarSlot} className="schedule-toolbar__slot" />
            {dayFilter && (
              <button className="btn btn--small" type="button" onClick={() => setDayFilter(null)} title="Clear day filter">
                Day: {dayFilterLabel} ✕
              </button>
            )}
            {drivingTarget && (
              <button className="btn btn--small" type="button" onClick={() => setDrivingTarget(null)} title="Clear the driving path">
                Driving path to {model.activities.find((x) => x.id === drivingTarget)?.code ?? ''} ✕
              </button>
            )}
            {/* Undo, copy, download, selection sync and full screen: one menu. */}
            <OverflowMenu
              items={[
                { label: 'View', heading: true, hidden: !listTools, onClick: () => {} },
                { label: 'Relationship links', checked: showGanttLinks, hidden: tab !== 'gantt', onClick: () => setShowGanttLinks(!showGanttLinks) },
                { label: 'Critical path', checked: showGanttCritical, hidden: tab !== 'gantt', onClick: () => setShowGanttCritical(!showGanttCritical), title: 'Highlight the critical path' },
                { label: 'Baseline bars', checked: showGanttBaseline, hidden: tab !== 'gantt', onClick: () => setShowGanttBaseline(!showGanttBaseline), title: 'Show the target (baseline) bars' },
                { label: 'Names beside bars', checked: showGanttLabels, hidden: tab !== 'gantt', onClick: () => setShowGanttLabels(!showGanttLabels) },
                { label: 'Curtain', checked: curtain, hidden: !listTools, onClick: () => setCurtain(!curtain), title: 'Filters and the driving path fade the other rows back instead of removing them' },
                { label: 'Totals', icon: <span className="tp__glyph" aria-hidden>Σ</span>, checked: showTotals, hidden: !listTools, onClick: () => setShowTotals(!showTotals), title: 'Totals row and group subtotals; pick how each column sums up in the totals row' },
                { label: '-3', separator: true, onClick: () => {} },
              { label: 'Copy rows', icon: <IconCopy width={16} height={16} />, hidden: !(tab === 'gantt' || tab === 'activities'), onClick: copyGantt, title: 'Copy the rows to the clipboard to paste into Excel. Change them there, copy them back and paste them here (Ctrl+V in the Gantt): rows are matched by Activity ID and only what changed is set' },
                { label: 'Download CSV', icon: <IconDownload width={16} height={16} />, hidden: tab !== 'activities', onClick: () => activityTableRef.current?.download() },
                { label: 'Export to Excel', icon: <IconDownload width={16} height={16} />, hidden: tab !== 'gantt', onClick: exportGantt, title: 'Export the Gantt to Excel as it is shown: its columns, grouping, subtotals and folded groups' },
                { label: '-4', separator: true, onClick: () => {} },
                { label: 'Undo', icon: <IconUndo width={16} height={16} />, disabled: !undoLabel, onClick: () => undo(), title: undoLabel ? 'Undo: ' + undoLabel + ' (Ctrl+Z)' : 'Nothing to undo' },
                { label: 'Redo', icon: <IconRedo width={16} height={16} />, disabled: !redoLabel, onClick: () => redo(), title: redoLabel ? 'Redo: ' + redoLabel + ' (Ctrl+Y)' : 'Nothing to redo' },
                { label: '-2', separator: true, onClick: () => {} },
                { label: 'Sync with 3D', icon: <IconRelated width={16} height={16} />, checked: selectionSync, onClick: () => setSelectionSync(!selectionSync), title: 'Picking activities selects their objects in the 3D model, and objects picked there pick their activities' },
                { label: fullscreenOn ? 'Exit full screen' : 'Full screen', icon: <IconFullscreen width={16} height={16} />, onClick: toggleFullscreen },
              ]}
            />
          <ListSetupButton />
          </div>
        </div>
  );

  return (
    <ToolbarSlotContext.Provider value={toolbarSlot}>
    <ToolbarLeftSlotContext.Provider value={leftSlot}>
    <div className="page">
      {error && <div style={{ color: 'var(--danger)', padding: '0 12px' }}>{error}</div>}
      {shortcutNote && <div className="shortcut-note" role="status">{shortcutNote}</div>}
      {headerSlot && active ? createPortal(toolbarEl, headerSlot) : toolbarEl}

      <div className="page-body">
        {/* Layouts, Activity details, Predecessors and Successors are panels: each sits left, bottom or right, as the Panels menu says. */}
        {listTools && active && (
          <>
            <DockPanel id="layouts" label="Layouts" shown={layoutsOpen} setShown={setLayoutsOpen}>
              <LayoutsDock filters={filtersByView} tab={tab} importContext={model ? { catalog, filterFields } : null} />
            </DockPanel>
            <DockPanel id="details" label="Activity" shown={detailsOpen} setShown={setDetailsOpen}>
              {selected ? (
                <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  <ActivityDetails activity={selected} model={model} drivingTarget={drivingTarget} onDrivingTarget={setDrivingTarget} onSelect={handleSelect} />
                </div>
              ) : <div className="scn-dim" style={{ padding: 10 }}>Click an activity to see its details.</div>}
            </DockPanel>
            <DockPanel id="links" label="Predecessors & successors" shown={linksOpen} setShown={setLinksOpen}>
              {selected ? <LinksPane activity={selected} model={model} dockId="links" onSelect={handleSelect} /> : <div className="scn-dim" style={{ padding: 10 }}>Click an activity to see its links.</div>}
            </DockPanel>
            <DockPanel id="planning" label="Resources & codes" shown={planningOpen} setShown={setPlanningOpen}>
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}><ActivityPlanningPanel model={model} selectedId={selectedId} onNote={flash} /></div>
            </DockPanel>
            <DockPanel id="predecessors" label="Predecessors" shown={predsOpen} setShown={setPredsOpen}>
              {selected ? <LinksPane activity={selected} model={model} kind="predecessor" dockId="predecessors" onSelect={handleSelect} /> : <div className="scn-dim" style={{ padding: 10 }}>Click an activity to see its predecessors.</div>}
            </DockPanel>
            <DockPanel id="successors" label="Successors" shown={succsOpen} setShown={setSuccsOpen}>
              {selected ? <LinksPane activity={selected} model={model} kind="successor" dockId="successors" onSelect={handleSelect} /> : <div className="scn-dim" style={{ padding: 10 }}>Click an activity to see its successors.</div>}
            </DockPanel>
            {/* The one Gantt panel (the same on 4D Sequencing, where it also follows the timeline): this page's filters and driving path apply. */}
            <DockPanel id="gantt" label="Gantt" shown={ganttPanelOpen} setShown={setGanttPanelOpen}>
              {ganttPanelOpen && <DockGantt model={model} activities={ganttList} dimmedIds={ganttDimmed} selectedId={selectedId} highlightedIds={drivingIds ?? new Set<string>()} scrollToId={null} onSelect={handleSelect} onOpen={(a) => { handleSelect(a); setDetailsOpen(true); }} onLinkShortcut={linkShortcut} onLagChange={lagChange} />}
            </DockPanel>
            <DockPanel id="dictionary" label="Dictionary" shown={dictionaryOpen} setShown={setDictionaryOpen}>
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}><DictionaryPanel model={model} onNote={flash} /></div>
            </DockPanel>
          </>
        )}
        <div className="page-body__main" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }} {...configFocusProps('programmes')}>
          <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {tab === 'activities' && activityTable}
          {tab === 'wbs' && <WbsView model={model} activities={filtered} wbsPalette={wbsPalette} />}
          {tab === 'gantt' && ganttChart}
          {tab === 'planner' && (
            <PlannerView
              model={model}
              selectedId={selectedId}
              onSelect={(a) => (a ? handleSelect(a) : setSelectedId(null))}
              onNote={flash}
            />
          )}
          {tab === 'resources' && <ResourcesView model={model} activities={filtered} onSelect={handleSelect} />}
          {tab === 'calendars' && <CalendarsPanel model={model} onSelectActivity={(a) => { handleSelect(a); setDetailsOpen(true); onTabChange?.('activities'); }} />}
          {tab === 'codes' && (
            <ActivityCodesView
              model={model}
              onNote={flash}
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
          {tab === 'concrete' && <ConcreteComparison />}
          </div>
        </div>
        {active && (tab === 'activities' || tab === 'gantt' || tab === 'explorer') && (
          <>
            <ConfigPanel
              label={cfgView === 'gantt' ? 'Gantt page' : 'Programmes table'}
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
      </div>
    </div>
      {statusSlot && createPortal(<>
    {tab === 'gantt' && (
      <>
        <select value={zoom} onChange={(e) => setZoom(e.target.value as Zoom)} title="Zoom: the time scale of the Gantt (Alt + wheel zooms too)" aria-label="Zoom">
          {ZOOMS.map((z) => (
            <option key={z} value={z}>
              {z[0].toUpperCase() + z.slice(1)}
            </option>
          ))}
        </select>
        <button className="btn btn--small" type="button" onClick={() => ganttRef.current?.scrollToToday()} title="Scroll to today">Today</button>
        <button className="btn btn--small" type="button" onClick={() => ganttRef.current?.fit()} title="Fit whole programme in view">Fit</button>
        <button className="icon-btn icon-btn--sm" type="button" onClick={() => ganttRef.current?.zoomOut()} title="Zoom out (Alt + wheel)">−</button>
        <button className="icon-btn icon-btn--sm" type="button" onClick={() => ganttRef.current?.zoomIn()} title="Zoom in (Alt + wheel)">+</button>
      </>
    )}
      </>, statusSlot)}
    </ToolbarLeftSlotContext.Provider>
    </ToolbarSlotContext.Provider>
  );
}
