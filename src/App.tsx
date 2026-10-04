import { DuplicateTabButton, DuplicateTabSync } from './components/DuplicateTab';
import { FullScreenOnStart } from './components/FullScreenOnStart';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ViewerEngineProvider } from './viewer/ViewerEngineContext';
import { useViewerEngine } from './viewer/ViewerEngineContext';
import { SettingsSync } from './components/SettingsMenu';
import { CustomFieldsSync } from './components/CustomFieldsSync';
import { SeaTablePanel } from './components/SeaTablePanel';
import { SidePaneHost } from './components/SidePane';
import { AutoLinkGenerator } from './components/schedule/AutoLinkGenerator';
import { ViewerWorkspace } from './viewer/ViewerWorkspace';
import { SchedulePage, type TabId as ScheduleTabId } from './pages/SchedulePage';
import { takePendingTab, useScheduleLayoutsStore } from './state/scheduleLayoutsStore';
import { SequencePanel } from './pages/SequencePage';
import { ScenariosPage } from './pages/ScenariosPage';
import { TimelinesPage } from './pages/TimelinesPage';
import { WikiPage } from './pages/WikiPage';
import { SequenceLabelOverlay } from './components/sequence/SequenceLabelOverlay';
import { SequenceTimelineStatusBar } from './components/sequence/SequenceTimelineStatusBar';
import { useModelsStore } from './state/modelsStore';
import { useContextMeshStore, type ContextMeshRow } from './state/contextMeshStore';
import { useActiveSchedule, useScheduleStore } from './state/scheduleStore';
import { usePendingImportsStore } from './state/pendingImportsStore';
import { inputsSetter, useInputsJobsStore } from './state/inputsJobsStore';
import { IconBook, IconCube, IconDownloadFile, IconEye, IconEyeOff, IconSync, IconFolder, IconGantt, IconSchema, IconSplit, IconTimeline } from './components/icons';
import { FileDrop } from './components/FileDrop';
import { SCHEDULE_ACCEPT, buildScheduleModel, parseScheduleFile, xmlScheduleTables } from './schedule/loadSchedule';
import { buildXerSchedule, indexXerFile, isXer, type ImportProgress, type XerIndex } from './schedule/importSchedule';
import { ProjectPicker } from './components/schedule/ProjectPicker';
import { useAppPrefsStore } from './state/appPrefsStore';
import { useRecordingStore } from './state/recordingStore';
import { DbStatusChip, ProjectDbBar } from './components/ProjectDbPanel';
import { UpdateChip } from './components/UpdateChip';
import { fileSizeOf, rememberFileSize, rememberModelFile } from './state/modelFiles';
import { useModelPlacementStore } from './state/modelPlacementStore';
import modelIcon from './icons/BuildingSMART_RGB_Icon_colour_v3.jpg';
import programmeIcon from './icons/window_15139098.png';
import { FolderHeaderRow, FolderMenuButton, NewFolderButton, dragItemProps } from './components/InputFolders';
import { sectionsOf, useInputFoldersStore } from './state/inputFoldersStore';
import { StoredModelsPanel } from './components/StoredModelsPanel';
import { ExportFieldsPanel } from './components/ExportFieldsPanel';
import { filterXerTables, filterXmlText } from './schedule/exportFilter';
import { ProgrammeDownload, type DownloadFormat } from './components/ProgrammeDownload';
import { fetchXml } from './scenarios/api';
import { storeLoadedIfc } from './viewer/modelStore';
import { useModelStoreState } from './state/modelStoreState';
import { dbRoot, importIntoDb, removeProgramme, toggleHidden, useProjectDbStore } from './state/projectDbStore';
import { programmeTablesUrl, type DbProgramme } from './db/api';
import { tablesToXer } from './schedule/exportXer';
import { exportScheduleXlsx } from './schedule/exportXlsx';
import { downloadBlob } from './utils/download';
import type { ScheduleModel } from './schedule/types';
import { xmlToXer } from './schedule/xmlToXer';

type PageId = 'inputs' | 'model' | 'schedule' | 'scenarios' | 'sequence' | 'timelines' | 'wiki';

const PAGES: { id: PageId; label: string; icon: JSX.Element }[] = [
  { id: 'inputs', label: 'Inputs', icon: <IconFolder /> },
  { id: 'model', label: 'Models', icon: <IconCube /> },
  { id: 'schedule', label: 'Programmes', icon: <IconGantt /> },
  { id: 'scenarios', label: 'Scenarios', icon: <IconSplit /> },
  { id: 'sequence', label: '4D Sequencing', icon: <IconSchema /> },
  { id: 'timelines', label: 'Timelines', icon: <IconTimeline /> },
  { id: 'wiki', label: 'Wiki', icon: <IconBook /> },
];

/** Applies the current theme to the document and to the 3D viewport
    background — rendered inside ViewerEngineProvider so it can reach the engine. */
function ThemeSync() {
  const engine = useViewerEngine();
  useEffect(() => {
    document.documentElement.dataset.theme = 'light';
  }, [engine]);
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
  const [page, setPageRaw] = useState<PageId>('inputs');
  const pageRef = useRef(page);
  pageRef.current = page;
  const setPage = (next: PageId | ((current: PageId) => PageId)) => {
    const from = pageRef.current;
    const to = typeof next === 'function' ? next(from) : next;
    if (to === from || !mayLeave(from, to)) return;
    pageRef.current = to;
    setPageRaw(to);
  };
  // Settings › Window › Show Scenarios tab (off by default — Scenarios is
  // also in 4D Sequencing).
  const showScenariosTab = useAppPrefsStore((s) => s.showScenariosTab);
  const pages = useMemo(() => PAGES.filter((p) => p.id !== 'scenarios' || showScenariosTab), [showScenariosTab]);
  useEffect(() => {
    if (!showScenariosTab && page === 'scenarios') setPage('sequence');
  }, [showScenariosTab, page]);

  // Ctrl+Tab / Ctrl+Shift+Tab step through the top tabs (wrapping round).
  // Alt+PageDown / Alt+PageUp do the same: a normal browser tab keeps Ctrl+Tab
  // for itself, but an installed app window passes it on.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
            <UpdateChip />
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
          {page === 'schedule' && <SchedulePage selectedTab={scheduleTab} onTabChange={setScheduleTab} />}
          {page === 'scenarios' && <ScenariosPage />}
          {page === 'timelines' && <TimelinesPage />}
          {page === 'wiki' && <WikiPage />}
        </div>
        {page === 'sequence' ? <SequenceTimelineStatusBar /> : page === 'inputs' || page === 'scenarios' || page === 'timelines' || page === 'wiki' ? null : <StatusBar page={page} />}
      </div>
      <SidePaneHost />
      <AutoLinkGenerator />
      </div>
    </ViewerEngineProvider>
  );
}

function InputsPage() {
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
  const [sort, setSort] = useState<{ col: 'name' | 'type' | 'items' | 'size'; dir: 'asc' | 'desc' }>({ col: 'name', dir: 'asc' });
  const dbOpen = useProjectDbStore((s) => !!s.db);
  const dbProgrammes = useProjectDbStore((s) => s.programmes);
  const dbLoading = useProjectDbStore((s) => s.loading);

  const toggleSort = (col: 'name' | 'type' | 'items' | 'size') =>
    setSort((x) => (x.col === col ? { col, dir: x.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }));

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

  // Models and programmes in one list.
  const rows = useMemo<InputRow[]>(() => {
    const all: InputRow[] = [
      ...models.map((m): InputRow => ({ kind: 'model', key: m.modelId, name: m.name, items: m.elementCount, hidden: hiddenModelIds.has(m.modelId), size: fileSizeOf(m.name), bounds: boxes.get(m.modelId) ?? null })),
      ...contextMeshes.map((c): InputRow => ({ kind: 'context', key: c.id, name: c.name, items: c.triangles, hidden: c.hidden, size: fileSizeOf(c.name), bounds: c.bounds ? { min: c.bounds.min.map((v, i) => v + [c.offset.x, c.offset.y, c.offset.z][i]) as [number, number, number], max: c.bounds.max.map((v, i) => v + [c.offset.x, c.offset.y, c.offset.z][i]) as [number, number, number] } : null, context: c })),
      ...programmeRows.map((p): InputRow => ({ kind: 'programme', key: p.key, name: p.name, items: p.activities, hidden: p.hidden, size: fileSizeOf(p.db?.sourceFile ?? p.schedule?.sourceFileName ?? p.name), bounds: null, programme: p })),
    ];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return all.sort((a, b) => {
      if (sort.col === 'type') return dir * a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
      if (sort.col === 'items') return dir * (a.items - b.items);
      if (sort.col === 'size') return dir * ((a.size ?? -1) - (b.size ?? -1));
      return dir * a.name.localeCompare(b.name);
    });
  }, [models, programmeRows, contextMeshes, hiddenModelIds, boxes, sort]);

  const folders = useInputFoldersStore((s) => s.folders);
  const folderOf = useInputFoldersStore((s) => s.assign);
  const collapsedFolders = useInputFoldersStore((s) => s.collapsed);
  const sections = useMemo(() => sectionsOf(rows, (r) => r.name, folders, folderOf), [rows, folders, folderOf]);

  const sortArrow = (active: boolean, dir: 'asc' | 'desc') => (active ? (dir === 'asc' ? ' ▲' : ' ▼') : '');

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
        const res = await fetch(programmeTablesUrl(root, p.db.id));
        if (!res.ok) throw new Error(`Could not read the programme from the project database (${res.status}).`);
        const { tables } = (await res.json()) as { tables: Record<string, { columns: string[]; rows: string[][] }> };
        downloadBlob(`${base}.xer`, new Blob([tablesToXer(filterXerTables(tables))], { type: 'text/plain' }));
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

  const handleFile = (file: File) =>
    /\.(ifc|frag)$/i.test(file.name) ? handleModelFile(file) : /\.(glb|gltf)$/i.test(file.name) ? handleContextFile(file) : handleScheduleFile(file);

  const xerPick = xerPicks[0];
  const closeXerPick = () => setXerPicks((q) => q.slice(1));

  return (
    <div className="inputs-page">
      <div className="inputs-panel">
        <div className="inputs-panel__header">
          <span>Models and programmes</span>
          <span className="inputs-panel__count">{rows.length}</span>
        </div>
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
              <table className="inputs-table">
                <thead>
                  <tr>
                    <th className="inputs-table__sortable inputs-table__type" onClick={() => toggleSort('type')} title="Type: model or programme">{sort.col === 'type' ? sortArrow(true, sort.dir).trim() : ''}</th>
                    <th className="inputs-table__sortable" onClick={() => toggleSort('name')}>Name{sortArrow(sort.col === 'name', sort.dir)}</th>
                    <th className="inputs-table__sortable inputs-table__centre" onClick={() => toggleSort('items')} title="Number of elements (models) or activities (programmes)">Items{sortArrow(sort.col === 'items', sort.dir)}</th>
                    <th className="inputs-table__centre" title="Models: the lowest and highest X, Y, Z of the model (project axes, metres)">Min / max XYZ (m)</th>
                    <th className="inputs-table__sortable inputs-table__centre" onClick={() => toggleSort('size')}>File size{sortArrow(sort.col === 'size', sort.dir)}</th>
                    <th style={{ textAlign: 'right', width: 1 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sections.flatMap((section) => {
                    const header = folders.length > 0 && (section.folder !== '' || section.items.length > 0)
                      ? [<FolderHeaderRow key={`folder-${section.folder}`} folder={section.folder} count={section.items.length} colSpan={6} />]
                      : [];
                    return [...header, ...(collapsedFolders.includes(section.folder) && folders.length > 0 ? [] : section.items).map((row) => {
                    const { hidden } = row;
                    const p = row.programme;
                    const db = p?.db ?? null;
                    const loading = db ? dbLoading[db.id] : undefined;
                    return (
                      <tr key={`${row.kind}-${row.key}`} style={hidden ? { opacity: 0.5 } : undefined} className={folders.length > 0 ? 'inputs-in-folder' : undefined} {...dragItemProps(row.name)}>
                        <td className="inputs-table__type">
                          <img className="inputs-table__icon" src={row.kind === 'programme' ? programmeIcon : modelIcon} alt={KIND_LABEL[row.kind]} title={KIND_LABEL[row.kind]} />
                        </td>
                        <td>
                          {row.name}
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
                          {loading !== undefined && <span className="source-chip source-chip--busy">loading {Math.round(loading * 100)}%</span>}
                        </td>
                        <td className="inputs-table__centre">{row.items.toLocaleString()}</td>
                        <td className="inputs-table__bounds inputs-table__centre">
                          {row.bounds ? (
                            <>
                              <div>Min {row.bounds.min.map((v) => v.toFixed(1)).join(', ')}</div>
                              <div>Max {row.bounds.max.map((v) => v.toFixed(1)).join(', ')}</div>
                            </>
                          ) : ''}
                        </td>
                        <td className="inputs-table__centre">{row.size === null ? '' : formatBytes(row.size)}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end', alignItems: 'center' }}>
                            {p ? (
                              <ProgrammeDownload canXml={!!p.db?.scenario && !!p.db?.stem} disabled={!p.db && !p.schedule} onDownload={(f) => void downloadProgramme(p, f)} />
                            ) : <span style={{ width: 44 }} aria-hidden />}
                            <button
                              className="mini-btn mini-btn--icon"
                              onClick={() => (row.context ? (ctx().toggleHidden(row.key), engine.contexts.setVisible(row.key, row.hidden)) : p ? (db ? void toggleHidden(db) : toggleScheduleHidden(row.key)) : toggleModelHidden(row.key))}
                              title={hidden ? 'Show — unload without removing' : 'Hide — unload without removing'}
                              aria-label={hidden ? 'Show' : 'Hide'}
                            >
                              {hidden ? <IconEyeOff /> : <IconEye />}
                            </button>
                            <button
                              className="mini-btn mini-btn--icon"
                              disabled={row.context ? true : p ? !p.schedule : false}
                              onClick={() => (p ? p.schedule && syncSchedule(p.schedule.id) : syncModel(row.key))}
                              title="Sync — show this in the other tabs"
                              aria-label="Sync"
                            >
                              <IconSync />
                            </button>
                            <FolderMenuButton name={row.name} />
                            <button
                              className="mini-btn danger"
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
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                    })];
                  })}
                </tbody>
              </table>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, paddingTop: 10 }}>
                <NewFolderButton />
                <button className="mini-btn mini-btn--icon" onClick={syncAll} title="Sync all" aria-label="Sync all"><IconSync /></button>
              </div>
            </>
          )}
          <StoredModelsPanel />
        </div>
      </div>
      <div className="inputs-side">
        <ProjectDbBar />
        <ExportFieldsPanel />
        <SeaTablePanel />
      </div>
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
  programme?: ProgrammeRow;
  context?: ContextMeshRow;
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
