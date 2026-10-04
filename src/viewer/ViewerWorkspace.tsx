import { useEffect, type ReactNode } from 'react';
import { useViewerEngine } from './ViewerEngineContext';
import { ViewerCanvas } from './ViewerCanvas';
import type { ViewerLayout } from './viewerUI';
import { useViewSettingsStore } from '../state/viewSettingsStore';
import { ModelDataTable } from '../components/ModelDataTable';
import { ModelConfigPanel } from '../components/ModelConfigPanel';
import { useRecordingStore } from '../state/recordingStore';
import { ModelColorSync } from '../components/ModelColorPanel';
import { ViewerToolbar } from '../components/ViewerToolbar';
import { useClashRunner } from './useClashRunner';

/** Combines the persistent 3D viewer shell with an optional side panel (the
    4D sequencing panel) and an optional overlay floated on top of the
    viewer. This component (and therefore the viewer DOM) must stay mounted
    for the app's whole lifetime — see App.tsx, which toggles CSS visibility
    rather than unmounting it when switching tabs. `paneActive`: the Models
    page is showing, so its tabs go in the side pane. */
export function ViewerWorkspace({ layout, panel, overlay, paneActive }: { layout: ViewerLayout; panel?: ReactNode; overlay?: ReactNode; paneActive?: boolean }) {
  const engine = useViewerEngine();
  // Clashes & contacts stay up to date in the background (3D & Related shows them).
  useClashRunner();
  const split = useViewSettingsStore((s) => s.pages[layout === 'model' ? 'model' : 'sequence'].split);
  const compare = useViewSettingsStore((s) => s.pages[layout === 'model' ? 'model' : 'sequence'].compare ?? 'side');
  const inSequence = layout !== 'model';
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

  // The toolbar belongs to the viewer column only: side panels (4D's Gantt /
  // Tasks / Scenarios and the Scenario panel) run from the page header down,
  // and the tools wrap onto a second row when the viewer is narrow.
  return (
    <div style={{ display: 'flex', flex: 1, minWidth: 0, minHeight: 0 }}>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, minHeight: 0 }}>
        <div className="filterbar schedule-toolbar viewer-toolbar-row">
          <div className="schedule-toolbar__left">
            <ViewerToolbar />
          </div>
          <div className="schedule-toolbar__right">
            {inSequence && recPhase !== 'idle' && (
              <button className="btn rec-stop" type="button" onClick={stopRecording} title="Stop the export (Esc)">
                <span className="rec-stop__dot" />
                {recPhase === 'countdown' ? `Starting in ${recCount}…` : `Recording ${recDone}/${recTotal}`}
                <b>Stop export</b>
              </button>
            )}
          </div>
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, display: 'flex' }}>
          <ViewerCanvas layout={effectiveLayout} />
          {overlay}
        </div>
        <ModelDataTable />
      </div>
      {panel}
      {!inSequence && paneActive && <ModelConfigPanel />}
      {/* Models > Colour applies while the Models page shows (4D colours its own way). */}
      {!inSequence && paneActive && <ModelColorSync />}
    </div>
  );
}
