import { useEffect, useRef, type ReactNode } from 'react';
import { useViewerEngine } from './ViewerEngineContext';
import { ViewerCanvas } from './ViewerCanvas';
import type { ViewerLayout } from './viewerUI';
import { useViewSettingsStore } from '../state/viewSettingsStore';
import { ModelDataTable } from '../components/ModelDataTable';
import { ModelConfigPanel } from '../components/ModelConfigPanel';
import { useRecordingStore } from '../state/recordingStore';
import { ModelColorSync } from '../components/ModelColorPanel';
import { ColourLegend } from '../components/ColourLegend';
import { ViewerToolbar } from '../components/ViewerToolbar';
import { useClashRunner } from './useClashRunner';
import { useDataTableStore } from '../state/dataTableStore';
import { PanelsButton } from '../components/ViewPicker';
import { useHeaderSlotStore } from '../state/headerSlotStore';
import { DockDropZones, DockPanel, DockSideView } from '../components/Dock';
import { DOCK_DEFAULTS, useDockStore } from '../state/dockStore';
import { ClashPanel } from '../components/ClashPanel';
import { SectionsPanel, SectionsSync } from '../components/SectionsPanel';
import { ViewpointsList } from '../components/ViewpointsList';
import { useModelEdgesStore } from '../state/modelEdgesStore';
import { useModelsStore } from '../state/modelsStore';

/** Combines the persistent 3D viewer shell with an optional side panel (the
    4D sequencing panel) and an optional overlay floated on top of the
    viewer. This component (and therefore the viewer DOM) must stay mounted
    for the app's whole lifetime — see App.tsx, which toggles CSS visibility
    rather than unmounting it when switching tabs. `paneActive`: the Models
    page is showing, so its tabs go in the side pane. */
export function ViewerWorkspace({ layout, panel, overlay, paneActive, center, centerShown, picker, search }: { /** The global search, at the right end of the toolbar. */ search?: React.ReactNode; /** The button that chooses what the main panel shows (at the start of the toolbar). */ picker?: ReactNode; layout: ViewerLayout; panel?: ReactNode; overlay?: ReactNode; paneActive?: boolean; /** A view that takes the place of the 3D view (the Programmes views), with the same docks around it. */ center?: ReactNode; centerShown?: boolean }) {
  const engine = useViewerEngine();
  // The toolbar row grows when its tools wrap onto a second row: the docks' headers and the side pane's tab bar follow
  // it (--toolbar-row-h), so the bars along the top stay level. Hidden (another page showing): the default applies.
  const toolbarRow = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = toolbarRow.current;
    if (!el) return;
    const root = document.documentElement;
    const sync = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h > 0) root.style.setProperty('--toolbar-row-h', `${h}px`);
      else root.style.removeProperty('--toolbar-row-h');
    };
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    sync();
    return () => { ro.disconnect(); root.style.removeProperty('--toolbar-row-h'); };
  }, [centerShown]);
  // Clashes & contacts stay up to date in the background (3D & Related shows them).
  useClashRunner();
  // Models switched off in the Models list (Edges) are drawn without edge lines.
  const edgesOff = useModelEdgesStore((s) => s.off);
  const loaded = useModelsStore((s) => s.models);
  useEffect(() => {
    for (const m of loaded) engine.setModelEdges(m.modelId, !edgesOff[m.name]);
  }, [engine, edgesOff, loaded]);
  const split = useViewSettingsStore((s) => s.pages[layout === 'model' ? 'model' : 'sequence'].split);
  const compare = useViewSettingsStore((s) => s.pages[layout === 'model' ? 'model' : 'sequence'].compare ?? 'side');
  const inSequence = layout !== 'model';
  const vpSide = useDockStore((d) => d.placement.viewpoints ?? DOCK_DEFAULTS.viewpoints);
  const tableOpen = useDataTableStore((s) => s.open);
  const setTableOpen = useDataTableStore((s) => s.setOpen);
  // 4D image / video export in progress (Export tab): stoppable from here
  // while the Configuration pane is hidden for the capture.
  const recPhase = useRecordingStore((s) => s.phase);
  const recCount = useRecordingStore((s) => s.count);
  const recDone = useRecordingStore((s) => s.done);
  const recTotal = useRecordingStore((s) => s.total);
  const stopRecording = useRecordingStore((s) => s.cancel);
  // Either page can show two views side by side, or stacked under the compare slider.
  const twoViews: ViewerLayout = compare === 'slider' ? (inSequence ? 'sequenceSlider' : 'modelSlider') : (inSequence ? 'sequenceSplit' : 'modelSplit');
  const effectiveLayout: ViewerLayout = split ? twoViews : layout;

  // The 4D sequence hides/recolours elements per date. Leaving it must put the
  // model back, or the Models page shows only what the sequence left visible.
  useEffect(() => {
    if (!inSequence) return;
    return () => { void engine.resetOverrides(); };
  }, [inSequence, engine]);

  // The toolbar belongs to the viewer column only: the docks (left, bottom, right: data table, Gantt, Tasks, ...) hold
  // the panels, the side panels (4D's configuration) run from the page header down, and the tools wrap onto a second row
  // when the viewer is narrow.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0, position: 'relative' }}>
      <DockDropZones />
      <SectionsSync />
      {(
        <>
          <DockPanel id="datatable" label="Data table" shown={tableOpen} setShown={setTableOpen}><ModelDataTable /></DockPanel>
          <DockPanel id="clash" label="Clash"><ClashPanel /></DockPanel>
          <DockPanel id="viewpoints" label="Viewpoints">
            <div className="dock-viewpoints">
              <div className="dock-viewpoints__list"><ViewpointsList layout={vpSide === 'bottom' ? 'cards' : 'list'} actions /></div>
            </div>
          </DockPanel>
        </>
      )}
      {/* The toolbar runs across the whole width: the docks on the sides start below it. The Programmes page puts its own here. */}
      <div ref={useHeaderSlotStore.getState().setEl} className="viewer-header" />
      {!centerShown && <div className="filterbar schedule-toolbar viewer-toolbar-row" ref={toolbarRow}>
          <div className="schedule-toolbar__left">
            {!centerShown && <>{picker}<ViewerToolbar /></>}
          </div>
          <div className="schedule-toolbar__right">
            {inSequence && recPhase !== 'idle' && (
              <button className="btn rec-stop" type="button" onClick={stopRecording} title="Stop the export (Esc)">
                <span className="rec-stop__dot" />
                {recPhase === 'countdown' ? `Starting in ${recCount}…` : `Recording ${recDone}/${recTotal}`}
                <b>Stop export</b>
              </button>
            )}
            {search}
            <PanelsButton />
          </div>
        </div>}
      <div style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0 }}>
      <DockSideView side="left" />
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>
            <ViewerCanvas layout={effectiveLayout} />
            {overlay}
            {!centerShown && <SectionsPanel />}
            {/* The 3D view keeps its size underneath (a hidden canvas would lose its aspect ratio). */}
            {center !== undefined && (
              <div style={centerShown ? { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg)', zIndex: 5 } : { position: 'absolute', inset: 0, visibility: 'hidden', pointerEvents: 'none', display: 'flex', flexDirection: 'column' }}>
                {center}
              </div>
            )}
            {/* Models > Colour: what each colour stands for. */}
            {!inSequence && paneActive && <ColourLegend />}
          </div>
          <DockSideView side="bottom" />
          <div ref={useHeaderSlotStore.getState().setFooter} className="viewer-footer" />
        </div>
      <DockSideView side="right" />
      {panel}
      {!inSequence && paneActive && <ModelConfigPanel />}
      {/* Models > Colour applies while the Models page shows (4D colours its own way). */}
      {!inSequence && paneActive && <ModelColorSync />}
      </div>
    </div>
  );
}
