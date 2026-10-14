import { resolveTheme, useThemeStore } from './state/themeStore';
import { DuplicateTabButton, DuplicateTabSync } from './components/DuplicateTab';
import { FullScreenOnStart } from './components/FullScreenOnStart';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useDockStore } from './state/dockStore';
import { ViewerEngineProvider } from './viewer/ViewerEngineContext';
import { useViewerEngine } from './viewer/ViewerEngineContext';
import { SettingsSync } from './components/SettingsMenu';
import { CustomFieldsSync } from './components/CustomFieldsSync';
import { SidePaneHost } from './components/SidePane';
import { AutoLinkGenerator } from './components/schedule/AutoLinkGenerator';
import { ScenarioSync } from './components/scenarios/ScenarioParts';
import { ViewerWorkspace } from './viewer/ViewerWorkspace';
import { SchedulePage, type TabId as ScheduleTabId } from './pages/SchedulePage';
import { takePendingTab, useScheduleLayoutsStore } from './state/scheduleLayoutsStore';
import { SequencePanel } from './pages/SequencePage';
import { ScenariosPage } from './pages/ScenariosPage';
import { HelpPage } from './pages/HelpPage';

import { ExternalPage } from './pages/ExternalPage';
import { SequenceLabelOverlay } from './components/sequence/SequenceLabelOverlay';
import { SequenceTimelineStatusBar } from './components/sequence/SequenceTimelineStatusBar';
import { useModelsStore } from './state/modelsStore';
import { useContextMeshStore, type ContextMeshRow } from './state/contextMeshStore';
import { useActiveSchedule, useScheduleStore } from './state/scheduleStore';
import { hasMadeChoice, useProgrammeChoiceStore } from './state/programmeChoiceStore';
import { programmeKey } from './state/unloadedWbsStore';
import { usePendingImportsStore } from './state/pendingImportsStore';
import { inputsSetter, useInputsJobsStore } from './state/inputsJobsStore';
import { IconSidePanel, IconBook, IconInfoOutlined, IconCheckboxUnchecked, IconCube, IconDownloadFile, IconEye, IconEyeOff, IconSync, IconFolder, IconGantt, IconSchema, IconSplit, IconTimeline, IconDashboard, IconExternalData, IconRemove } from './components/icons';
import { FileDrop } from './components/FileDrop';
import { SCHEDULE_ACCEPT, buildScheduleModel, parseScheduleFile, xmlScheduleTables } from './schedule/loadSchedule';
import { buildXerSchedule, indexXerFile, isXer, type ImportProgress, type XerIndex } from './schedule/importSchedule';
import { ProjectPicker } from './components/schedule/ProjectPicker';
import { experimentalOn, useAppPrefsStore } from './state/appPrefsStore';
import { useRecordingStore } from './state/recordingStore';
import { DbStatusChip } from './components/ProjectDbPanel';
import { UpdateChip } from './components/UpdateChip';
import { FEATURES } from './features';
import { fileSizeOf, rememberFileSize, rememberModelFile, uploadOf } from './state/modelFiles';
import { useModelPlacementStore } from './state/modelPlacementStore';
import modelIcon from './icons/BuildingSMART_RGB_Icon_colour_v3.jpg';
import programmeIcon from './icons/window_15139098.png';
import { DEFAULT_INPUT_COLUMNS, buildCombinedGroups, buildGroups, passesFilters, useInputDetailsStore, valuesOfFile, type GroupNode } from './state/inputDetailsStore';
import { pushToSeaTable, DetailValue, GroupHeaderRow, ColumnResizer, InputsColgroup, InputsStatusBar, useInputsTableStyle } from './components/InputDetails';
import { InputsSidePane } from './components/InputsSidePane';
import type { PushFile } from './seatable/filesClient';
import { FileDetails, type FileSummary } from './components/FileDetails';
import { ResizeHandle, useResizableWidth } from './components/ResizeHandle';
import { usePersistedState } from './utils/persistedState';
import { StoredModelsNotes, useStoredModels } from './components/StoredModelsPanel';
import { ModelsRestoreSync } from './components/ModelsRestoreSync';
import type { StoredModel } from './db/modelsApi';
import { filterXerTables, filterXmlText } from './schedule/exportFilter';
import { ProgrammeDownload, type DownloadFormat } from './components/ProgrammeDownload';
import { RowButtonsChooser, useRowButtons, type RowButtonDef } from './components/RowButtonsChooser';
import { fetchXml } from './scenarios/api';
import { storeLoadedIfc } from './viewer/modelStore';
import { useModelStoreState } from './state/modelStoreState';
import { dbRoot, flushEditable, importIntoDb, makeEditableCopy, newProgramme, removeProgramme, toggleHidden, useProjectDbStore } from './state/projectDbStore';
import { programmeExportUrl, programmeTablesUrl, type DbProgramme } from './db/api';
import { encodeXer, tablesToXer } from './schedule/exportXer';
import { summariseIssues, validateXer } from './schedule/xerValidate';
import { exportScheduleXlsx } from './schedule/exportXlsx';
import { downloadBlob } from './utils/download';
import type { ScheduleModel } from './schedule/types';
import { xmlToXer } from './schedule/xmlToXer';

// The team's Wiki and Timelines are left out of the shipped editions altogether (the constant check lets the build drop them).
const shipped = import.meta.env.VITE_EDITION === 'web' || import.meta.env.VITE_EDITION === 'product';
const TimelinesPage = shipped ? () => null : lazy(() => import('./pages/TimelinesPage').then((m) => ({ default: m.TimelinesPage })));
const WikiPage = shipped ? () => null : lazy(() => import('./pages/WikiPage').then((m) => ({ default: m.WikiPage })));

type PageId = 'inputs' | 'model' | 'schedule' | 'scenarios' | 'sequence' | 'timelines' | 'external' | 'dashboards' | 'wiki' | 'help';

/** Ctrl+Alt + key (KeyboardEvent.code) -> the page it opens. */
const PAGE_SHORTCUTS: Record<string, PageId> = { KeyP: 'inputs', KeyQ: 'model', KeyU: 'schedule', KeyW: 'sequence' };

const PAGES: { id: PageId; label: string; icon: JSX.Element }[] = [
  { id: 'inputs', label: 'Inputs', icon: <IconFolder /> },
  { id: 'model', label: 'Models', icon: <IconCube /> },
  { id: 'schedule', label: 'Programmes', icon: <IconGantt /> },
  { id: 'scenarios', label: 'Scenarios', icon: <IconSplit /> },
  { id: 'sequence', label: '4D Sequencing', icon: <IconSchema /> },
  { id: 'timelines', label: 'Timelines', icon: <IconTimeline /> },
  { id: 'external', label: 'External data', icon: <IconExternalData /> },
  { id: 'dashboards', label: 'Dashboards', icon: <IconDashboard /> },
  { id: 'wiki', label: 'Wiki', icon: <IconBook /> },
  { id: 'help', label: 'Help', icon: <IconInfoOutlined /> },
];

/** Applies the current theme to the document and to the 3D viewport
    background — rendered inside ViewerEngineProvider so it can reach the engine. */
function ThemeSync() {
  const engine = useViewerEngine();
  useEffect(() => {
    document.documentElement.dataset.theme = resolveTheme(useThemeStore.getState().choice);
  }, [engine]);
  return null;
}

/** A scene remembers which programme to use (the selected one, and the ones switched off from Inputs). The programmes
    load from the project database after the page starts, one by one (a big one can take a long while), so the choice is
    applied to each as it arrives — until the user picks or hides a programme themselves, after which it is left as it is. */
function ProgrammeChoiceSync() {
  const schedules = useScheduleStore((s) => s.schedules);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const fresh = schedules.filter((m) => !seen.current.has(m.id));
    if (fresh.length === 0) return;
    fresh.forEach((m) => seen.current.add(m.id));
    if (hasMadeChoice()) return;
    const choice = useProgrammeChoiceStore.getState();
    const hide = fresh.filter((m) => choice.hidden.includes(programmeKey(m)));
    const pick = choice.selected ? schedules.find((m) => programmeKey(m) === choice.selected) : undefined;
    if (hide.length === 0 && !pick) return;
    // Straight into the store: this restores the choice, it is not the user making one.
    useScheduleStore.setState((s) => ({
      hiddenScheduleIds: hide.length ? new Set([...s.hiddenScheduleIds, ...hide.map((m) => m.id)]) : s.hiddenScheduleIds,
      selectedId: pick ? pick.id : s.selectedId,
    }));
  }, [schedules]);
  return null;
}

/** Models tab: frames every model ("Fit all models") the first time it is
    opened, and again on arriving whenever the loaded models changed since. */
function FitOnModelsTab({ page }: { page: PageId }) {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const fittedFor = useRef('');
  useEffect(() => {
    const key = models.map((m) => m.modelId).join('|');
    if (page !== 'model' || !key || key === fittedFor.current) return;
    fittedFor.current = key;
    let cancelled = false;
    // After the viewer has been laid out at its on-screen size.
    void engine.ready.then(() => setTimeout(() => { if (!cancelled) void engine.fit(); }, 120));
    return () => { cancelled = true; };
  }, [engine, page, models]);
  return null;
}

/** A 4D video export drives the 4D page's timeline: leaving that page would
    spoil the frames, so it asks first (and stops the export). */
const mayLeave = (from: PageId, to: PageId) => {
  const rec = useRecordingStore.getState();
  if (from !== 'sequence' || to === 'sequence' || rec.phase === 'idle') return true;
  if (!window.confirm('A 4D image / video export is running on this page. Stop it and switch tab?')) return false;
  rec.cancel();
  return true;
};

export default function App() {
  const [page, setPageRaw] = useState<PageId>(() => {
    // Settings › Layout profiles › Open on.
    try {
      const saved = localStorage.getItem('app.startPage');
      return PAGES.some((p) => p.id === saved) ? (saved as PageId) : 'inputs';
    } catch {
      return 'inputs';
    }
  });
  // The External data and Dashboards frames stay loaded once opened.
  const [visited, setVisited] = useState<ReadonlySet<PageId>>(new Set());
  useEffect(() => { setVisited((v) => (v.has(page) ? v : new Set(v).add(page))); }, [page]);
  const pageRef = useRef(page);
  pageRef.current = page;
  const setPage = (next: PageId | ((current: PageId) => PageId)) => {
    const from = pageRef.current;
    const to = typeof next === 'function' ? next(from) : next;
    if (to === from || !mayLeave(from, to)) return;
    pageRef.current = to;
    setPageRaw(to);
  };
  // Other parts of the app move to a page by asking: window.dispatchEvent(new CustomEvent('ip-goto-page', { detail: 'sequence' })).
  useEffect(() => {
    const go = (e: Event) => {
      const id = (e as CustomEvent<PageId>).detail;
      if (PAGES.some((p) => p.id === id)) setPage(id);
    };
    window.addEventListener('ip-goto-page', go);
    return () => window.removeEventListener('ip-goto-page', go);
    // setPage reads the current page from a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Settings › Window › Show Scenarios tab (off by default — Scenarios is
  // also in 4D Sequencing).
  const showScenariosTab = useAppPrefsStore((s) => s.showScenariosTab);
  const scenariosOn = useAppPrefsStore((s) => s.experimental.scenarios);
  const showTimelinesTab = useAppPrefsStore((s) => s.showTimelinesTab);
  const showWikiTab = useAppPrefsStore((s) => s.showWikiTab);
  const showHelpTab = useAppPrefsStore((s) => s.showHelpTab);
  const showExternalTab = useAppPrefsStore((s) => s.showExternalTab);
  const showDashboardsTab = useAppPrefsStore((s) => s.showDashboardsTab);
  const pages = useMemo(
    () => PAGES.filter((p) => (p.id !== 'scenarios' || (scenariosOn && showScenariosTab)) && (p.id !== 'timelines' || (FEATURES.teamPages && showTimelinesTab)) && (p.id !== 'wiki' || (FEATURES.teamPages && showWikiTab)) && (p.id !== 'help' || (FEATURES.help && showHelpTab)) && (p.id !== 'external' || (FEATURES.externalPages && showExternalTab)) && (p.id !== 'dashboards' || (FEATURES.externalPages && showDashboardsTab))),
    [scenariosOn, showScenariosTab, showTimelinesTab, showWikiTab, showHelpTab, showExternalTab, showDashboardsTab],
  );
  useEffect(() => {
    if (((!showScenariosTab || !scenariosOn) && page === 'scenarios') || ((!showTimelinesTab || !FEATURES.teamPages) && page === 'timelines') || ((!showWikiTab || !FEATURES.teamPages) && page === 'wiki') || ((!FEATURES.help || !showHelpTab) && page === 'help') || ((!showExternalTab || !FEATURES.externalPages) && page === 'external') || ((!showDashboardsTab || !FEATURES.externalPages) && page === 'dashboards')) setPage('sequence');
  }, [scenariosOn, showScenariosTab, showTimelinesTab, showWikiTab, showHelpTab, showExternalTab, showDashboardsTab, page]);

  // Ctrl+Tab / Ctrl+Shift+Tab step through the top tabs (wrapping round).
  // Alt+PageDown / Alt+PageUp do the same: a normal browser tab keeps Ctrl+Tab
  // for itself, but an installed app window passes it on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+Alt+P / Q / U / W jump to Inputs / Models / Programmes / 4D Sequencing (by key position).
      if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey) {
        // Ctrl+Alt+9: show / hide Viewpoints on the Models and 4D Sequencing pages.
        if (e.code === 'Digit9' && (pageRef.current === 'model' || pageRef.current === 'sequence')) {
          e.preventDefault();
          // Viewpoints is a dock panel now: the shortcut shows or closes it.
          if (!e.repeat) {
            const dock = useDockStore.getState();
            if (dock.sideOf('viewpoints') === 'closed') dock.reveal('viewpoints');
            else dock.close('viewpoints');
          }
          return;
        }
        const target = PAGE_SHORTCUTS[e.code];
        if (target && pages.some((p) => p.id === target)) {
          e.preventDefault();
          setPage(target);
          return;
        }
      }
      const tab = e.key === 'Tab' && e.ctrlKey && !e.altKey;
      const alt = e.altKey && !e.ctrlKey && (e.key === 'PageDown' || e.key === 'PageUp');
      if (!tab && !alt) return;
      const back = tab ? e.shiftKey : e.key === 'PageUp';
      e.preventDefault();
      setPage((current) => {
        const i = pages.findIndex((p) => p.id === current);
        return pages[(i + (back ? -1 : 1) + pages.length) % pages.length].id;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pages]);
  // Programmes opens on the Gantt.
  const [scheduleTab, setScheduleTab] = useState<ScheduleTabId>('gantt');
  // Applying a layout (Programmes > Layouts) also opens the view it was saved on.
  const layoutRevision = useScheduleLayoutsStore((s) => s.revision);
  useEffect(() => {
    const tab = takePendingTab();
    if (tab) setScheduleTab(tab as ScheduleTabId);
  }, [layoutRevision]);
  const viewerVisible = page === 'model' || page === 'sequence';

  return (
    <ViewerEngineProvider>
      <ThemeSync />
      {FEATURES.browserData && <ModelsRestoreSync />}
      <ProgrammeChoiceSync />
      <FitOnModelsTab page={page} />
      <SettingsSync />
      <CustomFieldsSync />
      <DuplicateTabSync />
      <FullScreenOnStart />
      {/* The side pane runs the full window height, beside the top bar too. */}
      <div className="app-frame">
      <div className="app-shell">
        <header className="app-topbar app-topbar--minimal">
          <div className="app-topbar__center">
            <nav className="app-topbar__nav">
              {pages.map((p) => (
                <button key={p.id} className={p.id === page ? 'active' : ''} onClick={() => setPage(p.id)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {p.icon}
                  {p.label}
                </button>
              ))}
            </nav>
          </div>
          <div className="app-topbar__right">
            {FEATURES.selfUpdate && <UpdateChip />}
            <DuplicateTabButton />
          </div>
        </header>
        <div className="app-body">
          <div
            style={
              viewerVisible
                ? { display: 'flex', flex: 1, minWidth: 0, minHeight: 0 }
                : // Kept at a real pixel size (never display:none) while hidden: the
                  // camera's aspect ratio comes from this container's dimensions, and a
                  // 0x0 box turns that into NaN, which makes camera-controls' animated
                  // fitToItems() transition never numerically converge — it hangs forever
                  // instead of resolving, which broke every model import made from the
                  // Inputs tab (the viewer stays off-screen but keeps a working size).
                  { position: 'fixed', left: -99999, top: 0, width: 1280, height: 800, visibility: 'hidden' }
            }
          >
            <ViewerWorkspace
              layout={page === 'sequence' ? 'sequence' : 'model'}
              paneActive={page === 'model'}
              panel={page === 'sequence' ? <SequencePanel /> : undefined}
              overlay={page === 'sequence' ? <SequenceLabelOverlay /> : undefined}
            />
          </div>
          {page === 'inputs' && <InputsPage />}
          {/* Stays mounted once opened, so its filters, selection and scroll are as left when coming back. */}
          {(page === 'schedule' || visited.has('schedule')) && (
            <div style={page === 'schedule' ? { display: 'contents' } : { position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none' }}>
              <SchedulePage selectedTab={scheduleTab} onTabChange={setScheduleTab} active={page === 'schedule'} />
            </div>
          )}
          {page === 'scenarios' && <ScenariosPage />}
          {page === 'timelines' && <Suspense fallback={null}><TimelinesPage /></Suspense>}
          {page === 'wiki' && <Suspense fallback={null}><WikiPage /></Suspense>}
          {page === 'help' && <HelpPage />}
          {visited.has('external') && <ExternalPage target="seatable" active={page === 'external'} />}
          {visited.has('dashboards') && <ExternalPage target="superset" active={page === 'dashboards'} />}
        </div>
        {page === 'sequence' ? <SequenceTimelineStatusBar /> : page === 'inputs' ? <InputsStatusBar /> : page === 'scenarios' || page === 'timelines' || page === 'wiki' || page === 'help' || page === 'external' || page === 'dashboards' ? null : <StatusBar page={page} />}
      </div>
      <SidePaneHost />
      <AutoLinkGenerator />
      {FEATURES.scenarios && scenariosOn && <ScenarioSync loadOnly />}
      </div>
    </ViewerEngineProvider>
  );
}

/** The buttons on each row of the Inputs table that can be hidden. */
const INPUT_BUTTONS = [
  { id: 'download', glyph: '⤓', label: 'Download (programmes)' },
  { id: 'open', glyph: '☑', label: 'Open a model of the project database' },
  { id: 'export', glyph: '⤓', label: 'Export IFC (models of the project database)' },
  { id: 'hide', glyph: '👁', label: 'Hide / show (unload without removing)' },
  { id: 'edit', glyph: '✎', label: 'Make an editable copy (programmes of the project database)' },
  { id: 'sync', glyph: '⟳', label: 'Sync: show this in the other tabs' },
  { id: 'remove', glyph: '✕', label: 'Remove / delete' },
  { id: 'versions', glyph: '#', label: 'Number of earlier IFC versions' },
] as const satisfies readonly RowButtonDef<string>[];
type InputButton = (typeof INPUT_BUTTONS)[number]['id'];

function InputsPage() {
  const inputBtns = useRowButtons<InputButton>('inputs.hiddenButtons');
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const addModel = useModelsStore((s) => s.addModel);
  const removeModel = useModelsStore((s) => s.removeModel);
  const hiddenModelIds = useModelsStore((s) => s.hiddenModelIds);
  const toggleModelHidden = useModelsStore((s) => s.toggleModelHidden);
  const contextMeshes = useContextMeshStore((s) => s.meshes);
  const ctx = useContextMeshStore.getState;
  // The context meshes follow the models' global offset, which the first IFC sets.
  useEffect(() => {
    engine.contexts.refresh();
  }, [engine, models]);
  const schedules = useScheduleStore((s) => s.schedules);
  const addSchedule = useScheduleStore((s) => s.addSchedule);
  const removeSchedule = useScheduleStore((s) => s.removeSchedule);
  const hiddenScheduleIds = useScheduleStore((s) => s.hiddenScheduleIds);
  const toggleScheduleHidden = useScheduleStore((s) => s.toggleScheduleHidden);
  // Imports in progress, errors and .xer project choices live in a store:
  // an import keeps showing its progress after another tab was open.
  const { modelError, scheduleError, scheduleBusy, xerPicks } = useInputsJobsStore();
  const setModelError = inputsSetter('modelError');
  const setScheduleError = inputsSetter('scheduleError');
  const setScheduleBusy = inputsSetter('scheduleBusy');
  // Multi-project .xer files waiting for the user to choose projects (first one shown).
  const setXerPicks = inputsSetter('xerPicks');
  const pendingModels = usePendingImportsStore((s) => s.models);
  const pendingSchedules = usePendingImportsStore((s) => s.schedules);
  const clearPendingModel = usePendingImportsStore((s) => s.clearModel);
  const clearPendingSchedule = usePendingImportsStore((s) => s.clearSchedule);
  const sortRules = useInputDetailsStore((s) => s.sortRules);
  const detailValues = useInputDetailsStore((s) => s.values);
  const dbOpen = useProjectDbStore((s) => !!s.db);
  const dbProgrammes = useProjectDbStore((s) => s.programmes);
  const dbLoading = useProjectDbStore((s) => s.loading);

  // A click on a column heading sorts by it alone (again: the other way round); the Sort tab sets several keys.
  const toggleSort = (col: string) => {
    const only = sortRules.length === 1 && sortRules[0].field === col ? sortRules[0] : null;
    useInputDetailsStore.getState().setSortRules([{ id: col, field: col, direction: only?.direction === 'up' ? 'down' : 'up' }]);
  };

  // The project database's programmes (loaded or not: hidden ones load when
  // shown), then any loaded from files only.
  const programmeRows = useMemo<ProgrammeRow[]>(() => {
    const fromDb = dbProgrammes.map((p) => {
      const schedule = schedules.find((s) => s.dbProgrammeId === p.id) ?? null;
      return { key: `db-${p.id}`, name: p.name, activities: schedule?.activities.length ?? p.activityCount ?? 0, hidden: p.hidden, schedule, db: p };
    });
    const fileOnly = schedules
      .filter((s) => s.dbProgrammeId === undefined)
      .map((s) => ({ key: s.id, name: s.sourceFileName, activities: s.activities.length, hidden: hiddenScheduleIds.has(s.id), schedule: s, db: null }));
    return [...fromDb, ...fileOnly];
  }, [dbProgrammes, schedules, hiddenScheduleIds]);

  // Each model's box (project axes: X east, Y north, Z up, metres), placement included.
  const offsets = useModelPlacementStore((s) => s.offsets);
  const boxes = useMemo(() => {
    const out = new Map<string, { min: [number, number, number]; max: [number, number, number] }>();
    for (const m of models) {
      const box = engine.modelBox(m.modelId);
      const g = engine.globalOffset();
      if (box) out.set(m.modelId, { min: [box.min.x + g.x, -box.max.z + g.y, box.min.y + g.z], max: [box.max.x + g.x, -box.min.z + g.y, box.max.y + g.z] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, models, offsets]);

  // Models (loaded, and the ones kept in the project database), site context and programmes in one list.
  const storedActions = useStoredModels();
  const storedModels = storedActions.stored;
  const rows = useMemo<InputRow[]>(() => {
    const storedBy = new Map(storedModels.map((m) => [m.name, m]));
    const loadedNames = new Set(models.map((m) => m.name));
    // Uploaded / version: a stored model has its store's time and earlier-IFC count; the rest, the drops remembered here.
    const dropped = (name: string) => { const u = uploadOf(name); return { uploaded: u?.at ?? null, version: u?.version ?? null }; };
    const storedStamp = (m: StoredModel) => ({ uploaded: Date.parse(m.updatedAt) || null, version: m.versions + 1 });
    const all: InputRow[] = [
      ...models.map((m): InputRow => ({ kind: 'model', key: m.modelId, name: m.name, items: m.elementCount, hidden: hiddenModelIds.has(m.modelId), size: fileSizeOf(m.name) ?? storedBy.get(m.name)?.ifcSize ?? null, bounds: boxes.get(m.modelId) ?? null, ...(storedBy.has(m.name) ? storedStamp(storedBy.get(m.name)!) : dropped(m.name)), stored: storedBy.get(m.name) })),
      ...storedModels.filter((m) => !loadedNames.has(m.name)).map((m): InputRow => ({ kind: 'model', key: `stored:${m.name}`, name: m.name, items: 0, hidden: false, size: m.ifcSize, bounds: null, ...storedStamp(m), stored: m, unloaded: true })),
      ...contextMeshes.map((c): InputRow => ({ kind: 'context', key: c.id, name: c.name, items: c.triangles, hidden: c.hidden, size: fileSizeOf(c.name), ...dropped(c.name), bounds: c.bounds ? { min: c.bounds.min.map((v, i) => v + [c.offset.x, c.offset.y, c.offset.z][i]) as [number, number, number], max: c.bounds.max.map((v, i) => v + [c.offset.x, c.offset.y, c.offset.z][i]) as [number, number, number] } : null, context: c })),
      ...programmeRows.map((p): InputRow => ({ kind: 'programme', key: p.key, name: p.name, items: p.activities, hidden: p.hidden, size: fileSizeOf(p.db?.sourceFile ?? p.schedule?.sourceFileName ?? p.name), bounds: null, uploaded: (p.db && Date.parse(p.db.importedAt)) || dropped(p.db?.sourceFile ?? p.schedule?.sourceFileName ?? p.name).uploaded, version: dropped(p.db?.sourceFile ?? p.schedule?.sourceFileName ?? p.name).version ?? 1, programme: p })),
    ];
    const text = (x: string, y: string) => x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
    const compare = (field: string, a: InputRow, b: InputRow) => {
      if (field === 'type') return text(a.kind, b.kind);
      if (field === 'items') return a.items - b.items;
      if (field === 'size') return (a.size ?? -1) - (b.size ?? -1);
      if (field === 'uploaded') return (a.uploaded ?? -1) - (b.uploaded ?? -1);
      if (field === 'version') return (a.version ?? -1) - (b.version ?? -1);
      if (field === 'name') return text(a.name, b.name);
      return text((detailValues[a.name]?.[field] ?? []).join(', '), (detailValues[b.name]?.[field] ?? []).join(', '));
    };
    return all.sort((a, b) => {
      for (const r of sortRules) {
        const c = compare(r.field, a, b);
        if (c) return r.direction === 'up' ? c : -c;
      }
      return text(a.name, b.name);
    });
  }, [models, storedModels, programmeRows, contextMeshes, hiddenModelIds, boxes, sortRules, detailValues]);

  // File details (your own fields per file) and what the list is grouped by.
  const detailFields = useInputDetailsStore((s) => s.fields);
  const columns = useInputDetailsStore((s) => s.columns);
  const collapsedGroups = useInputDetailsStore((s) => s.collapsed);
  const groupRules = useInputDetailsStore((s) => s.groupRules);
  const groupCombine = useInputDetailsStore((s) => s.groupCombine);
  // The columns shown, in order: the list's own and the details read from SeaTable.
  const shownColumns = columns.filter((c) => DEFAULT_INPUT_COLUMNS.includes(c) || detailFields.includes(c));
  const tableStyle = useInputsTableStyle(shownColumns);
  // The filters of the side pane's Filters tab keep only some of the files, plus the open ones (loaded and not hidden), so a filter never takes an open file out of the list.
  const filters = useInputDetailsStore((s) => s.filters);
  const isOpenRow = (r: InputRow) => !r.unloaded && !r.hidden && (r.kind !== 'programme' || !!r.programme?.schedule);
  const formatOfRow = (r: InputRow) => (r.programme?.db?.sourceFormat ?? /\.([a-z0-9]+)$/i.exec(r.name)?.[1] ?? '').toUpperCase();
  const visibleRows = useMemo(
    () => (Object.keys(filters).length === 0 ? rows : rows.filter((r) => isOpenRow(r) || passesFilters({ name: r.name, type: KIND_LABEL[r.kind], format: formatOfRow(r) }, filters, detailValues))),
    [rows, filters, detailValues],
  );
  // Groups, outermost level first.
  const tree = useMemo(() => {
    const rules = groupRules;
    const valuesOf = (field: string, r: InputRow) => valuesOfFile(field, { name: r.name, type: KIND_LABEL[r.kind], format: formatOfRow(r) }, detailValues);
    return rules.length ? (groupCombine ? buildCombinedGroups : buildGroups)(visibleRows, rules, valuesOf) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows, groupRules, groupCombine, detailValues]);
  const closedOf = (n: GroupNode<InputRow>) => collapsedGroups.includes(n.key);
  // The list as header + rows blocks: a group's rows come after its header unless it has groups inside it or is collapsed.
  const sections = useMemo(() => {
    if (!tree) return [{ node: null as GroupNode<InputRow> | null, items: visibleRows }];
    const out: { node: GroupNode<InputRow> | null; items: InputRow[] }[] = [];
    const walk = (nodes: GroupNode<InputRow>[]) => {
      for (const n of nodes) {
        const closed = closedOf(n);
        out.push({ node: n, items: closed || n.children.length ? [] : n.items });
        if (!closed) walk(n.children);
      }
    };
    walk(tree);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, visibleRows, collapsedGroups]);
  // The current row (arrows move it) and the selected ones: click a row, Shift+click (or Shift+arrows)
  // to reach down to another, Ctrl+click to add or remove one. Space hides / shows the selected rows.
  const listedRows = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const rowId = (r: InputRow) => `${r.kind}-${r.key}`;
  // The File details pane (the selected files, else the current one).
  const [detailsOpen, setDetailsOpen] = usePersistedState('inputs.detailsOpen', false);
  const detailsWidth = useResizableWidth('inputs.detailsWidth', 320, 260, 640);
  const detailFiles = useMemo<FileSummary[]>(() => {
    const keys = selectedKeys.size ? selectedKeys : new Set(activeKey ? [activeKey] : []);
    return listedRows.filter((r) => keys.has(rowId(r))).map((r) => ({
      key: rowId(r),
      name: r.name,
      kind: KIND_LABEL[r.kind],
      format: formatOfRow(r),
      items: r.unloaded ? 0 : r.items,
      size: r.size === null ? '—' : formatBytes(r.size),
      uploaded: r.uploaded === null ? '—' : new Date(r.uploaded).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }),
      version: r.version,
      bounds: r.bounds ? `Min ${r.bounds.min.map((v) => v.toFixed(1)).join(', ')} · Max ${r.bounds.max.map((v) => v.toFixed(1)).join(', ')}` : '',
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listedRows, selectedKeys, activeKey]);
  const pickRow = (r: InputRow, mod: { shift?: boolean; ctrl?: boolean } = {}) => {
    setActiveKey(rowId(r));
    const from = listedRows.findIndex((x) => rowId(x) === anchorKey);
    const to = listedRows.findIndex((x) => rowId(x) === rowId(r));
    if (mod.shift && from >= 0 && to >= 0) {
      const range = listedRows.slice(Math.min(from, to), Math.max(from, to) + 1).map(rowId);
      setSelectedKeys(new Set(mod.ctrl ? [...selectedKeys, ...range] : range));
      return;
    }
    setAnchorKey(rowId(r));
    if (mod.ctrl) {
      const next = new Set(selectedKeys);
      if (!next.delete(rowId(r))) next.add(rowId(r));
      setSelectedKeys(next);
    } else setSelectedKeys(new Set([rowId(r)]));
  };
  /** A group's Select button: its files join the selection (all already in it: they leave it). */
  const selectGroup = (items: InputRow[]) => {
    const next = new Set(selectedKeys);
    const allIn = items.every((r) => next.has(rowId(r)));
    for (const r of items) { if (allIn) next.delete(rowId(r)); else next.add(rowId(r)); }
    setSelectedKeys(next);
    if (items.length) { setActiveKey(rowId(items[0])); setAnchorKey(rowId(items[0])); }
  };
  const toggleRowHidden = (row: InputRow) => {
    const db = row.programme?.db ?? null;
    if (row.context) {
      ctx().toggleHidden(row.key);
      engine.contexts.setVisible(row.key, row.hidden);
    } else if (row.programme) {
      if (db) void toggleHidden(db);
      else toggleScheduleHidden(row.key);
    } else toggleModelHidden(row.key);
  };
  /** Space: the selected rows (the current one when none is selected) go off if any is on, otherwise all come back.
      Stored models that are not loaded are opened (one after the other). */
  const flipSelectedRows = () => {
    const keys = selectedKeys.size ? selectedKeys : new Set(activeKey ? [activeKey] : []);
    const picked = listedRows.filter((r) => keys.has(rowId(r)));
    const targets = picked.filter((r) => !r.unloaded);
    const anyShown = targets.some((r) => !r.hidden);
    for (const r of targets) if (r.hidden !== anyShown) toggleRowHidden(r);
    const toOpen = picked.filter((r) => r.unloaded && r.stored).map((r) => r.stored!);
    if (toOpen.length) void (async () => { for (const m of toOpen) await storedActions.open(m); })();
  };
  const onRowsKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== ' ') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) return;
    e.preventDefault();
    if (e.key === ' ') {
      flipSelectedRows();
      return;
    }
    if (!listedRows.length) return;
    const i = listedRows.findIndex((r) => rowId(r) === activeKey);
    const next = i < 0 ? (e.key === 'ArrowDown' ? 0 : listedRows.length - 1) : i + (e.key === 'ArrowDown' ? 1 : -1);
    if (next < 0 || next >= listedRows.length) return;
    pickRow(listedRows[next], { shift: e.shiftKey });
    document.getElementById(`inputs-row-${rowId(listedRows[next])}`)?.scrollIntoView({ block: 'nearest' });
  };

  // What a push to SeaTable's "Insight Plan Files" table sends: every file of this page, and the stored models not loaded now.
  const filesToPush = useMemo<PushFile[]>(() => {
    const MB = 1024 * 1024;
    const formatFor = (r: InputRow) => (r.programme?.db?.sourceFormat ?? /\.([a-z0-9]+)$/i.exec(r.name)?.[1] ?? '').toUpperCase();
    const out: PushFile[] = rows.map((r) => ({
      name: r.name,
      type: KIND_LABEL[r.kind],
      format: formatFor(r),
      items: r.unloaded ? null : r.items,
      sizeMb: r.size === null ? null : Math.round((r.size / MB) * 100) / 100,
      bounds: r.bounds ? `Min ${r.bounds.min.map((v) => v.toFixed(1)).join(', ')} / Max ${r.bounds.max.map((v) => v.toFixed(1)).join(', ')}` : '',
    }));
    const have = new Set(out.map((f) => f.name));
    for (const m of storedModels) if (!have.has(m.name)) out.push({ name: m.name, type: 'Model', format: 'IFC', items: null, sizeMb: Math.round((m.ifcSize / MB) * 100) / 100, bounds: '' });
    return out;
  }, [rows, storedModels]);

  // The Group tab's collapse / expand all.
  const collapseAllGroups = () => {
    const keys: string[] = [];
    const walk = (nodes: GroupNode<InputRow>[]) => nodes.forEach((n) => { keys.push(n.key); walk(n.children); });
    walk(tree ?? []);
    useInputDetailsStore.getState().setCollapsedAll(keys);
  };
  const expandAllGroups = () => {
    useInputDetailsStore.getState().setCollapsedAll([]);
  };

  // The Filters tab counts the values over these.
  useEffect(() => {
    useInputDetailsStore.getState().setFiles(filesToPush);
  }, [filesToPush]);

  // A file uploaded here is pushed to SeaTable once it has landed in the list (when Settings say so).
  const uploaded = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (uploaded.current.size === 0) return;
    const landed = filesToPush.some((f) => uploaded.current.has(f.name));
    if (!landed) return;
    // Wait for the rest of a multi-file upload to arrive; each new file restarts the wait.
    const timer = window.setTimeout(() => {
      uploaded.current.clear();
      if (FEATURES.seatable && experimentalOn('seatableFiles') && useInputDetailsStore.getState().autoPush) void pushToSeaTable(filesToPush, true);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [filesToPush]);

  const sortArrow = (field: string) => {
    const i = sortRules.findIndex((r) => r.field === field);
    return i < 0 ? '' : ` ${sortRules[i].direction === 'up' ? '▲' : '▼'}${sortRules.length > 1 ? i + 1 : ''}`;
  };
  const headerCell = (col: string) => {
    const click = { onClick: () => toggleSort(col) };
    switch (col) {
      case 'type': return <th key={col} className="inputs-table__sortable inputs-table__type" {...click} title="Type: model or programme">{sortArrow(col).trim()}</th>;
      case 'name': return <th key={col} className="inputs-table__sortable" {...click}>Name{sortArrow(col)}</th>;
      case 'items': return <th key={col} className="inputs-table__sortable inputs-table__centre" {...click} title="Number of elements (models) or activities (programmes)">Items{sortArrow(col)}<ColumnResizer col={col} /></th>;
      case 'bounds': return <th key={col} className="inputs-table__centre" title="Models: the lowest and highest X, Y, Z of the model (project axes, metres)">Min / max XYZ (m)<ColumnResizer col={col} /></th>;
      case 'size': return <th key={col} className="inputs-table__sortable inputs-table__centre" {...click}>File size{sortArrow(col)}<ColumnResizer col={col} /></th>;
      case 'uploaded': return <th key={col} className="inputs-table__sortable inputs-table__centre" {...click} title="When the file was uploaded (models kept in the project database: when the current IFC was stored)">Uploaded{sortArrow(col)}<ColumnResizer col={col} /></th>;
      case 'version': return <th key={col} className="inputs-table__sortable inputs-table__centre" {...click} title="Version: 1 is the first upload, each replacement adds one (earlier IFCs of a stored model can be restored)">Version{sortArrow(col)}<ColumnResizer col={col} /></th>;
      default: return <th key={col} className="inputs-table__sortable inputs-table__detail" {...click}>{col}{sortArrow(col)}<ColumnResizer col={col} /></th>;
    }
  };

  // Toggling a model off keeps it loaded (switching back on is instant, no
  // re-parse); ViewerCanvas leaves hidden models out of both views.
  // Remove disposes it in the engine too — its geometry, index and the split
  // view's copy — not just the list entry.
  const removeModelEverywhere = async (modelId: string) => {
    await engine.removeModel(modelId);
    removeModel(modelId);
  };

  /** A programme from the project database goes out as an XER (P6 reads it back); one loaded from a file only, as an Excel workbook. */
  const downloadProgramme = async (p: ProgrammeRow, format: DownloadFormat) => {
    setScheduleError(null);
    const base = p.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'programme';
    try {
      if (p.db && format === 'xml') {
        // The XML the scenario engine wrote (the project database holds P6 tables, not the file).
        const root = dbRoot();
        if (!root || !p.db.scenario || !p.db.stem) throw new Error('This programme has no XML to download: use XER.');
        downloadBlob(`${base}.xml`, new Blob([filterXmlText(await fetchXml(root, p.db.scenario, p.db.stem))], { type: 'application/xml' }));
      } else if (p.db) {
        const root = dbRoot();
        if (!root) throw new Error('Open the project folder first.');
        if (p.db.editable) {
          // A programme edited in place goes out whole: every table and column it has, under the header of the file it came from.
          await flushEditable();
          const res = await fetch(programmeExportUrl(root, p.db.id));
          if (!res.ok) throw new Error(`Could not read the programme from the project database (${res.status}).`);
          const { header, tables } = (await res.json()) as { header: string | null; tables: Record<string, { columns: string[]; rows: string[][] }> };
          const text = tablesToXer(filterXerTables(tables), header);
          // What P6 would refuse is said before the file is written, not after P6 has.
          const problems = validateXer(text).filter((i) => i.severity === 'error');
          if (problems.length && !window.confirm(`P6 may not import this file: ${summariseIssues(validateXer(text))}\n\nDownload it anyway?`)) return;
          downloadBlob(`${base}.xer`, new Blob([encodeXer(text)], { type: 'text/plain' }));
          return;
        }
        const res = await fetch(programmeTablesUrl(root, p.db.id));
        if (!res.ok) throw new Error(`Could not read the programme from the project database (${res.status}).`);
        const { tables } = (await res.json()) as { tables: Record<string, { columns: string[]; rows: string[][] }> };
        downloadBlob(`${base}.xer`, new Blob([encodeXer(tablesToXer(filterXerTables(tables)))], { type: 'text/plain' }));
      } else if (p.schedule) {
        exportScheduleXlsx(p.schedule, `${base}.xlsx`);
      }
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : String(e));
    }
  };

  const syncModel = (modelId: string) => useModelsStore.getState().select(modelId, null);

  const syncSchedule = (scheduleId: string) => useScheduleStore.getState().select(scheduleId);
  const syncAll = () => {
    if (models.length > 0) useModelsStore.getState().select(models[0].modelId, null);
    if (schedules.length > 0) useScheduleStore.getState().select(schedules[0].id);
  };

  const handleModelFile = async (file: File) => {
    setModelError(null);
    rememberFileSize(file);
    try {
      const buffer = await file.arrayBuffer();
      const info = file.name.toLowerCase().endsWith('.frag')
        ? await engine.loadFrag(buffer, file.name)
        : await engine.loadIfc(buffer, file.name);
      addModel(info);
      if (!file.name.toLowerCase().endsWith('.frag')) rememberModelFile(file);
      // With a project folder open, the IFC goes into its model store (and its converted copy after it).
      const root = dbRoot();
      if (root && file.name.toLowerCase().endsWith('.ifc')) {
        void storeLoadedIfc(engine, root, file.name, buffer, info.modelId)
          .then(() => useModelStoreState.getState().refresh(root))
          .catch((e) => setModelError(`${file.name}: not kept in the model store: ${e instanceof Error ? e.message : String(e)}`));
      }
      clearPendingModel(file.name);
    } catch (e) {
      setModelError(e instanceof Error ? e.message : String(e));
    }
  };

  const trackSchedule = (name: string): ImportProgress => (label, fraction) =>
    setScheduleBusy((b) => ({ ...b, [name]: { label, fraction } }));
  const untrackSchedule = (name: string) =>
    setScheduleBusy((b) => {
      const next = { ...b };
      delete next[name];
      return next;
    });

  /** With a project database open, a programme goes into its P6 tables
      and is loaded from there. */
  const importToDb = async (file: File, body: Blob, format: 'xer' | 'xml', projectIds: string[] | null) => {
    try {
      await importIntoDb(body, { name: file.name, file: file.name, format, projectIds }, trackSchedule(file.name));
      clearPendingSchedule(file.name);
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : String(e));
    } finally {
      untrackSchedule(file.name);
    }
  };

  const loadXer = async (file: File, index: XerIndex, projectIds: string[] | null) => {
    if (dbRoot()) return importToDb(file, file, 'xer', projectIds);
    try {
      addSchedule(await buildXerSchedule(file, index, projectIds, trackSchedule(file.name)));
      clearPendingSchedule(file.name);
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : String(e));
    } finally {
      untrackSchedule(file.name);
    }
  };

  const handleScheduleFile = async (file: File) => {
    setScheduleError(null);
    rememberFileSize(file);
    if (isXer(file)) {
      // Large multi-project exports: scanned in a worker, then the user picks projects.
      try {
        const index = await indexXerFile(file, trackSchedule(file.name));
        untrackSchedule(file.name);
        if (index.projects.length > 1) setXerPicks((q) => [...q, { file, index }]);
        else await loadXer(file, index, null);
      } catch (e) {
        untrackSchedule(file.name);
        setScheduleError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    if (dbRoot()) {
      try {
        const xer = xmlToXer(await xmlScheduleTables(file));
        await importToDb(file, new Blob([xer], { type: 'text/plain' }), 'xml', null);
      } catch (e) {
        setScheduleError(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    try {
      const parsed = await parseScheduleFile(file);
      addSchedule(buildScheduleModel(parsed));
      clearPendingSchedule(file.name);
    } catch (e) {
      setScheduleError(e instanceof Error ? e.message : String(e));
    }
  };

  // One drop zone: models by extension, everything else is a programme.
  const handleContextFile = async (file: File) => {
    setModelError(null);
    rememberFileSize(file);
    try {
      ctx().add(await engine.contexts.load(await file.arrayBuffer(), file.name));
    } catch (e) {
      setModelError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleFile = (file: File) => {
    uploaded.current.add(file.name);
    return handleFileByKind(file);
  };
  const handleFileByKind = (file: File) =>
    /\.(ifc|frag)$/i.test(file.name) ? handleModelFile(file) : /\.(glb|gltf)$/i.test(file.name) ? handleContextFile(file) : handleScheduleFile(file);

  const xerPick = xerPicks[0];
  const closeXerPick = () => setXerPicks((q) => q.slice(1));

  return (
    <div className={`inputs-page${detailsOpen ? ' inputs-page--details' : ''}`}>
      <div className="inputs-panel__header inputs-bar">
        <span>Models and programmes</span>
        <span className="inputs-panel__count">{rows.length}</span>
        <span className="inputs-panel__spacer" />
        {dbOpen && (
          <button
            type="button"
            className="mini-btn"
            onClick={() => {
              const name = window.prompt('Name for the new programme:')?.trim();
              if (!name) return;
              const start = window.prompt('Start date (YYYY-MM-DD):', new Date().toISOString().slice(0, 10))?.trim();
              if (start) void newProgramme(name, start);
            }}
            title="Start an empty programme to build in the app, saved to the project database"
          >
            New programme
          </button>
        )}
        {rows.length > 0 && (
          <>
            <button className="mini-btn mini-btn--icon" onClick={syncAll} title="Sync all" aria-label="Sync all"><IconSync /></button>
            <RowButtonsChooser compact buttons={INPUT_BUTTONS} rb={inputBtns} title="Choose which buttons show on each row" />
          </>
        )}
        <div className="schedule-toolbar__segmented layouts-segment">
          <button className={`btn layouts-toggle${detailsOpen ? ' primary' : ''}`} type="button" aria-pressed={detailsOpen} onClick={() => setDetailsOpen(!detailsOpen)} title="Show the selected file's details and edit them: discipline, building, status, notes ...">
            <span className="toolbar-button__icon"><IconSidePanel /></span>
            File details
          </button>
        </div>
      </div>
      <InputsSidePane onCollapseAll={collapseAllGroups} onExpandAll={expandAllGroups} />
      <div className="inputs-panel">
        <div className="inputs-panel__body">
          <FileDrop
            label="Drop files here or click to upload"
            hint={`Models: .ifc, .frag · Site context (terrain, surroundings): .glb · Programmes: P6 .xer / .xml, MS Project .xml (File › Save As › XML), Excel .xlsx / .xls / .csv${dbOpen ? ' — programmes are imported into the project database' : ''}`}
            accept={`.ifc,.frag,.glb,.gltf,${SCHEDULE_ACCEPT},.mpp`}
            multiple
            onFile={handleFile}
          />
          {modelError && <div className="inputs-panel__error">{modelError}</div>}
          {scheduleError && <div className="inputs-panel__error">{scheduleError}</div>}
          {Object.entries(scheduleBusy).map(([name, { label, fraction }]) => (
            <div key={name} className="inputs-panel__busy">
              <span>{label} {name}… {Math.round(fraction * 100)}%</span>
              <progress value={fraction} max={1} />
            </div>
          ))}
          {xerPick && (
            <ProjectPicker
              fileName={xerPick.file.name}
              projects={xerPick.index.projects}
              onCancel={closeXerPick}
              onLoad={(ids) => {
                closeXerPick();
                void loadXer(xerPick.file, xerPick.index, ids);
              }}
            />
          )}
          {(pendingModels.length > 0 || pendingSchedules.length > 0) && (
            <div className="pending-imports">
              <div className="pending-imports__title">Waiting for {pendingModels.length + pendingSchedules.length} file{pendingModels.length + pendingSchedules.length === 1 ? '' : 's'} from an imported configuration</div>
              {[...pendingModels, ...pendingSchedules].map((m) => (
                <div key={m.name} className="pending-imports__item">
                  <span className="pending-imports__name">{m.name}</span>
                  {m.path && <span className="pending-imports__path">{m.path}</span>}
                </div>
              ))}
            </div>
          )}
          {rows.length > 0 && (
            <>
              {/* (A button would also "click" on Space's release: kept from doing so.) */}
              <div style={{ overflowX: 'auto', outline: 'none' }} tabIndex={0} onKeyDown={onRowsKeyDown} onKeyUp={(e) => { if (e.key === ' ' && !/^(INPUT|SELECT|TEXTAREA)$/.test((e.target as HTMLElement).tagName)) e.preventDefault(); }} aria-label="Files: arrow keys move, Shift or Ctrl select several, Space hides or shows the selected">
              <table className="inputs-table inputs-table--aligned" style={tableStyle}>
                <InputsColgroup columns={shownColumns} />
                <thead>
                  <tr>
                    <th aria-label="Open, hide / show" />
                    {shownColumns.map((col) => headerCell(col))}
                    <th style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.flatMap((section) => {
                    const colSpan = 2 + shownColumns.length;
                    const node = section.node;
                    const header = !node
                      ? []
                      : [<GroupHeaderRow key={`group-${node.key}`} collapseKey={node.key} group={node.value} level={node.level} count={node.items.length} colSpan={colSpan} allSelected={node.items.length > 0 && node.items.every((r) => selectedKeys.has(rowId(r)))} onSelect={() => selectGroup(node.items)} />];
                    return [...header, ...section.items.map((row) => {
                    const { hidden } = row;
                    const p = row.programme;
                    const db = p?.db ?? null;
                    const loading = db ? dbLoading[db.id] : undefined;
                    return (
                      <tr
                        key={`${node?.key ?? ""}|${row.kind}-${row.key}`}
                        id={`inputs-row-${rowId(row)}`}
                        style={hidden ? { opacity: 0.5 } : undefined}
                        className={`inputs-row${node ? ' inputs-in-folder' : ''}${selectedKeys.has(rowId(row)) ? ' is-active' : ''}${activeKey === rowId(row) ? ' is-current' : ''}`}
                        onClick={(e) => { if (!(e.target as HTMLElement).closest('button, input, select, a, label')) pickRow(row, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey }); }}
                      >
                        <td>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            {row.unloaded && row.stored ? (
                              inputBtns.shown('open') && <button type="button" className="mini-btn mini-btn--icon" disabled={storedActions.busy === row.name} onClick={() => void storedActions.open(row.stored!)} aria-label="Open" title="Open the model">
                                <IconCheckboxUnchecked width={16} height={16} />
                              </button>
                            ) : (
                              inputBtns.shown('hide') && <button
                                className="mini-btn mini-btn--icon"
                                onClick={() => toggleRowHidden(row)}
                                title={hidden ? 'Show — unload without removing' : 'Hide — unload without removing'}
                                aria-label={hidden ? 'Show' : 'Hide'}
                              >
                                {hidden ? <IconEyeOff /> : <IconEye />}
                              </button>
                            )}
                          </div>
                        </td>
                        {shownColumns.map((col) => {
                          switch (col) {
                            case 'type': return (<td key={col} className="inputs-table__type">
                          <img className="inputs-table__icon" src={row.kind === 'programme' ? programmeIcon : modelIcon} alt={KIND_LABEL[row.kind]} title={KIND_LABEL[row.kind]} />
                        </td>);
                        case 'name': return (<td key={col}>
                          {row.name}
                          {db?.baselineOf != null && <span className="source-chip" title="A baseline saved of another programme: the programme as it was when it was saved. Choose it in the Baselines menu of Programmes to see what moved.">Baseline</span>}
                          {db?.editable && <span className="source-chip" title="Edited in place: your changes are saved to the project database as you make them, and the programme can be exported as an XER.">Editable</span>}
                          {row.context && (
                            <span className="source-chip" title="Site context mesh: not part of 4D. Move it (metres, project axes) to line it up with the models.">
                              glTF
                            </span>
                          )}
                          {row.context && (
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 4, fontSize: 11 }} title="Move the mesh, in metres: X east, Y north, Z up">
                              Move
                              {(['x', 'y', 'z'] as const).map((axis) => (
                                <label key={axis} style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                  {axis.toUpperCase()}
                                  <input
                                    type="number"
                                    step="any"
                                    style={{ width: 64 }}
                                    value={row.context!.offset[axis]}
                                    onChange={(e) => {
                                      const offset = { ...row.context!.offset, [axis]: Number(e.target.value) || 0 };
                                      ctx().setOffset(row.key, offset);
                                      engine.contexts.setOffset(row.key, offset);
                                    }}
                                  />
                                </label>
                              ))}
                            </div>
                          )}
                          {p && (db ? (
                            <span className="source-chip" title={db.sourceFormat === 'p6db' ? `Read live from ${db.sourcePath}` : `In the project database (ip_programme.id = ${db.id})`}>
                              {db.kind === 'scenario' ? 'Scenario' : db.sourceFormat === 'p6db' ? 'P6 database' : db.sourceFormat.toUpperCase()}
                            </span>
                          ) : (
                            dbOpen && <span className="source-chip source-chip--file" title="Loaded from a file before the project database was open, so not in it">file only</span>
                          ))}
                          {row.stored && !row.unloaded && <span className="source-chip" title="Kept in the project database's model store">in database</span>}
                          {row.stored && !row.stored.cached && <span className="source-chip source-chip--file" title="No converted copy yet: opening it converts the IFC (the copy is kept for next time)">converts the IFC</span>}
                          {loading !== undefined && <span className="source-chip source-chip--busy">loading {Math.round(loading * 100)}%</span>}
                        </td>);
                        case 'items': return <td key={col} className="inputs-table__centre">{row.unloaded ? '' : row.items.toLocaleString()}</td>
                        case 'bounds': return (<td key={col} className="inputs-table__bounds inputs-table__centre">
                          {row.bounds ? (
                            <>
                              <div>Min {row.bounds.min.map((v) => v.toFixed(1)).join(', ')}</div>
                              <div>Max {row.bounds.max.map((v) => v.toFixed(1)).join(', ')}</div>
                            </>
                          ) : ''}
                        </td>);
                        case 'size': return <td key={col} className="inputs-table__centre">{row.size === null ? '' : formatBytes(row.size)}</td>
                        case 'uploaded': return <td key={col} className="inputs-table__centre">{row.uploaded === null ? '' : new Date(row.uploaded).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
                        case 'version': return <td key={col} className="inputs-table__centre">{row.version === null ? '' : `v${row.version}`}</td>
                            default: return <td key={col} className="inputs-table__detail"><DetailValue item={row.name} field={col} /></td>;
                          }
                        })}
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                            {row.stored && inputBtns.shown('versions') && row.stored.versions > 0 && <button type="button" className="mini-btn" onClick={() => void storedActions.showVersions(row.stored!)} title={`${row.stored.versions} earlier IFC${row.stored.versions === 1 ? '' : 's'} (kept when an edit or a new file replaces the model)`}>{row.stored.versions}</button>}
                            {row.unloaded && row.stored ? (
                              <>
                                {inputBtns.shown('export') && <button type="button" className="mini-btn mini-btn--icon" disabled={storedActions.busy === row.name} onClick={() => void storedActions.exportIfc(row.stored!)} aria-label="Export IFC" title="Export IFC: download the stored IFC, with the edits made in the app">
                                  <IconDownloadFile width={16} height={16} />
                                </button>}
                                {inputBtns.shown('remove') && <button type="button" className="cols__icon cols__icon--remove" onClick={() => void storedActions.remove(row.stored!)} title="Remove from the project database's model store" aria-label="Remove from the model store"><IconRemove /></button>}
                              </>
                            ) : (<>
                            {row.stored && inputBtns.shown('export') && <button type="button" className="mini-btn mini-btn--icon" disabled={storedActions.busy === row.name} onClick={() => void storedActions.exportIfc(row.stored!)} aria-label="Export IFC" title="Export IFC: download the stored IFC, with the edits made in the app">
                              <IconDownloadFile width={16} height={16} />
                            </button>}
                            {inputBtns.shown('download') && (p ? (
                              <ProgrammeDownload canXml={!!p.db?.scenario && !!p.db?.stem} disabled={!p.db && !p.schedule} onDownload={(f) => void downloadProgramme(p, f)} />
                            ) : <span style={{ width: 44 }} aria-hidden />)}
                            {inputBtns.shown('edit') && db && !db.editable && db.sourceFormat !== 'p6db' && <button
                              type="button"
                              className="mini-btn"
                              onClick={() => {
                                const name = window.prompt('Name for the editable copy:', `${db.name} (editable)`)?.trim();
                                if (name) void makeEditableCopy(db, name);
                              }}
                              title="Make a copy of this programme that you can edit in place: add, change and link activities, saved to the project database and exported to P6 as an XER. This one stays as it is."
                              aria-label="Make an editable copy"
                            >
                              Edit copy
                            </button>}
                            {inputBtns.shown('sync') && <button
                              className="mini-btn mini-btn--icon"
                              disabled={row.context ? true : p ? !p.schedule : false}
                              onClick={() => (p ? p.schedule && syncSchedule(p.schedule.id) : syncModel(row.key))}
                              title="Sync — show this in the other tabs"
                              aria-label="Sync"
                            >
                              <IconSync />
                            </button>}
                            {inputBtns.shown('remove') && <button
                              className="cols__icon cols__icon--remove"
                              onClick={() => {
                                const what = db ? `Delete "${row.name}" from the project database? This cannot be undone.` : `Remove "${row.name}" from the app?`;
                                if (!window.confirm(what)) return;
                                if (row.context) (engine.contexts.remove(row.key), ctx().remove(row.key));
                                else if (p) (db ? void removeProgramme(db) : removeSchedule(row.key));
                                else void removeModelEverywhere(row.key);
                              }}
                              title={db ? 'Delete from the project database' : 'Remove from the app'}
                              aria-label={db ? 'Delete' : 'Remove'}
                            >
                              <IconRemove />
                            </button>}
                            </>)}
                          </div>
                        </td>
                      </tr>
                    );
                    })];
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}
          <StoredModelsNotes actions={storedActions} />
        </div>
      </div>
      {detailsOpen && (
        <div className="inputs-details">
          <ResizeHandle onMouseDown={detailsWidth.startDrag(true)} />
          <div className="panel" style={{ width: detailsWidth.width, flexShrink: 0 }}>
            <FileDetails files={detailFiles} onClose={() => setDetailsOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}

interface InputRow {
  kind: 'model' | 'programme' | 'context';
  key: string;
  name: string;
  /** Elements (model) or activities (programme). */
  items: number;
  hidden: boolean;
  size: number | null;
  bounds: { min: [number, number, number]; max: [number, number, number] } | null;
  /** When the file went in (ms; null when unknown) and its version (1 = the first upload; each replacement adds one). */
  uploaded: number | null;
  version: number | null;
  programme?: ProgrammeRow;
  context?: ContextMeshRow;
  /** The model's entry in the project database's model store, when it has one. */
  stored?: StoredModel;
  /** In the model store but not loaded: opened from its row. */
  unloaded?: boolean;
}

const KIND_LABEL = { model: 'Model', programme: 'Programme', context: 'Site context mesh (glTF)' } as const;

const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

interface ProgrammeRow {
  key: string;
  name: string;
  activities: number;
  hidden: boolean;
  /** Loaded in the app (a hidden database programme may not be yet). */
  schedule: ScheduleModel | null;
  db: DbProgramme | null;
}

function StatusBar({ page }: { page: PageId }) {
  const models = useModelsStore((s) => s.models);
  const selectedModelId = useModelsStore((s) => s.selectedModelId);
  const scheduleModel = useActiveSchedule();
  const scheduleCount = useScheduleStore((s) => s.schedules.length);
  const visibleActivityCount = useScheduleStore((s) => s.visibleActivityCount);
  const activeModel = models.find((m) => m.modelId === selectedModelId) ?? models[0] ?? null;

  if (page === 'schedule') {
    if (!scheduleModel) return <footer className="app-statusbar">No programme loaded<DbStatusChip /></footer>;
    const total = scheduleModel.activities.length;
    return (
      <footer className="app-statusbar">
        <span>
          Programmes loaded: <strong>{scheduleCount}</strong>
        </span>
        <span>
          Project: <strong>{scheduleModel.project.name}</strong>
        </span>
        <span>
          Activities: <strong>{visibleActivityCount !== null && visibleActivityCount !== total ? `${visibleActivityCount} / ${total}` : total}</strong>
        </span>
        <span>
          Critical: <strong>{scheduleModel.activities.filter((a) => a.isCritical).length}</strong>
        </span>
        <span>
          Data date: <strong>{scheduleModel.project.dataDate?.toLocaleDateString() ?? '—'}</strong>
        </span>
        {scheduleModel.computedFloat && <span>Float: recomputed (calendar-aware)</span>}
        <span id="schedule-statusbar-tools" className="app-statusbar__tools" />
        <DbStatusChip />
      </footer>
    );
  }

  return (
    <footer className="app-statusbar">
      <span>
        Models loaded: <strong>{models.length}</strong>
      </span>
      {activeModel && (
        <>
          <span>
            Active: <strong>{activeModel.name}</strong>
          </span>
          <span>
            Elements: <strong>{activeModel.elementCount}</strong>
          </span>
        </>
      )}
      <DbStatusChip />
    </footer>
  );
}
