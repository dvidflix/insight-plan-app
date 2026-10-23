import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOrderPreview } from '../state/orderPreviewStore';
import { useHeaderSlotStore } from '../state/headerSlotStore';
import { useScenarioView } from '../scenarios/useScenarioView';
import { OrderPreviewEffects } from '../components/scenarios/OrderPreview';
import { ScenarioNotice, ScenarioPanelBody, ScenarioSync } from '../components/scenarios/ScenarioParts';
import { ModelsGanttPanel } from '../components/ModelConfigPanel';
import { ListSetupButton } from '../components/ViewPicker';
import { IconClose } from '../components/icons';
import { WbsBuilder } from '../components/scenarios/Generate2/WbsBuilder';
import { ADVANCED_AREAS, useFollowGenerateTabs, useGenerate2Tab, useShownArea, type AdvancedArea } from '../components/scenarios/Generate2/Generate2Tabs';
import { LabourTab, OrderViewBar, PartsTab } from './ScenariosPage';

/** Generate 2: programme generation on one screen. Build is the search sets library, the work breakdown tree made of them (each work item opens on
    the activities it will get, with their crews, days and limits, which can be changed right there), and the model in 3D beside it; Generate is in the
    tree's bar. The scenario and the full editors of Generate are one Advanced area, closed by default, which covers Build while it is open. It works
    on the same scenario store as Generate (state/scenarioStore.ts), so the two views show the same work. */

function AdvancedPane({ area }: { area: AdvancedArea }) {
  const { ready } = useScenarioView();
  const { open, close } = useGenerate2Tab();
  const meta = ADVANCED_AREAS.find((a) => a.id === area)!;
  return (
    <div className="g2-adv">
      <div className="scn-rules__tabs g2-adv__tabs" role="tablist" aria-label="Advanced">
        {ADVANCED_AREAS.map((a) => (
          <button key={a.id} type="button" role="tab" aria-selected={a.id === area} className={a.id === area ? 'is-active' : ''} disabled={a.needsScenario && !ready} title={a.needsScenario && !ready ? 'Open a scenario first' : a.tip} onClick={() => open(a.id)}>{a.label}</button>
        ))}
        {ready && <button type="button" className="g2-adv__close" aria-label="Close and go back to Build" title="Close and go back to Build (the work breakdown and Generate)" onClick={close}><IconClose /></button>}
      </div>
      <div className="g2-adv__body">
        {area === 'scenario' && (
          <div className="gen-scenario scn-panel scn-panel__body">
            {!ready && <div className="scn-dim hint g2-first">Open a scenario, or make one, to build its work breakdown: the tree and its work items are saved with the scenario.</div>}
            <ScenarioPanelBody tab="scenario" />
          </div>
        )}
        {area === 'crews' && <LabourTab />}
        {area !== 'scenario' && area !== 'crews' && <PartsTab tab={meta.tab} />}
      </div>
    </div>
  );
}

export function Generate2Page({ picker }: { /** The page picker with the search box and the header's cells: the page's own header. */ picker?: ReactNode }) {
  const area = useShownArea();
  const { ready } = useScenarioView();
  useFollowGenerateTabs();
  const show = useOrderPreview((s) => s.show);
  const preview = show && !area && ready;
  const viewRef = useRef<HTMLDivElement>(null);
  // The header (page picker, search, Scenario and Advanced) runs the full width in the viewer's header slot: the docks start below it.
  const headerSlot = useHeaderSlotStore((h) => h.el);
  const bar = <div className="filterbar schedule-toolbar gen-head"><div className="schedule-toolbar__left">{picker}</div><div className="schedule-toolbar__right"><ListSetupButton always /></div></div>;
  return (
    <div className={`scn-page gen-page g2-page${preview ? ' gen-page--preview' : ''}`}>
      <ScenarioSync />
      {/* The Gantt as a dock panel here too, so choosing it in the Navigation Bar or the Panels menu docks it in this view. */}
      <ModelsGanttPanel />
      {headerSlot ? createPortal(bar, headerSlot) : bar}
      <main className="gen-main">
        {area ? <AdvancedPane area={area} /> : ready && (
          <div className={`gen-order gen-order--split g2-split${preview ? ' has-view' : ''}`}>
            <div className="g2-left">
              <ScenarioNotice />
              <WbsBuilder />
            </div>
            {preview && (
              <div className="gen-order__view" ref={viewRef}>
                <OrderPreviewEffects view={viewRef} />
                <OrderViewBar />
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
