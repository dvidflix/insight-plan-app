import { useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cancelGenerate, updateFourD, useScenarioStore } from '../state/scenarioStore';
import { useModelsStore } from '../state/modelsStore';
import { useHeaderSlotStore } from '../state/headerSlotStore';
import { useScenarioView } from '../scenarios/useScenarioView';
import { ScenarioNotice, ScenarioPanelBody, ScenarioSync } from '../components/scenarios/ScenarioParts';
import { GenerateStatus } from '../components/scenarios/GenerateSummary';
import { ModelsGanttPanel } from '../components/ModelConfigPanel';
import { ListSetupButton } from '../components/ViewPicker';
import { PALE, PackagePreview } from '../components/scenarios/Generate3/PackagePreview';
import { PackageList, STEPS, StepTools, Timeline } from '../components/scenarios/Generate3/Steps';
import { AdvancedPanel } from '../components/scenarios/Generate3/Advanced';
import { ObjectOrderDialog } from '../components/scenarios/Generate3/ObjectOrder';
import { RecipeEditorDialog } from '../components/scenarios/Generate3/RecipeEditor';
import { Versions } from '../components/scenarios/Generate3/Versions';
import { ReadinessChip } from '../components/scenarios/Generate3/Readiness';
import { useG3, useWorkPackages, type G3Step } from '../components/scenarios/Generate3/useWorkPackages';
import { ObjectSequenceStep } from '../components/scenarios/Generate3/ObjectSequence';
import { usePackageListView } from '../components/scenarios/Generate3/useListView';

/** Generate 3: a schedule from the model in three guided steps (the header's tabs): work packages, sequence, methods & Generate. The model is on the
    left (the shared 3D view shows through, each package in its colour) with the step's tools under it, the packages in the middle, a rough timeline on
    the right, and Generate always at the bottom. Recipes, crews, rates and rules are not shown: each package's method stands for them. Advanced is a
    panel inside this view (Generate3/Advanced.tsx) with the few settings of the package picked; it never leads to the classic Generate view. The
    packages are saved with the scenario, and Update 4D builds from them. */

const goTo = (page: string) => window.dispatchEvent(new CustomEvent('ip-goto-page', { detail: page }));

function Prerequisite() {
  const { ready } = useScenarioView();
  const models = useModelsStore((s) => s.models.length);
  if (!models) {
    return (
      <div className="g3-first">
        <h2>Start with the model</h2>
        <p className="scn-dim hint">Generate makes a schedule from the objects of a 3D model. Load the model first.</p>
        <button type="button" className="btn primary" onClick={() => goTo('model')}>Go to Models</button>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="g3-first g3-first--wide">
        <h2>Open a scenario</h2>
        <p className="scn-dim hint">The work packages, their order and their methods are saved with a scenario. Open one, or make a new one, then come back here.</p>
        <div className="scn-panel scn-panel__body"><ScenarioPanelBody tab="scenario" /></div>
      </div>
    );
  }
  return null;
}

function Builder() {
  const wp = useWorkPackages();
  const lv = usePackageListView(wp);
  // 3D draws each package in its list colour (colour rules from List setup), and the ones the search or filters leave out pale.
  const { matched, colors } = lv;
  const shown = useMemo(() => wp.packages.map((p) => ({ ...p, color: matched && !matched.has(p.id) ? PALE : colors.get(p.id) ?? p.color })), [wp.packages, matched, colors]);
  const step = useG3((s) => s.step);
  const setStep = useG3((s) => s.setStep);
  const busyText = useScenarioStore((s) => s.busy);
  const busy = !!busyText;
  const generating = busyText === 'Updating 4D…';
  const advanced = useG3((s) => s.advanced);
  const setAdvanced = useG3((s) => s.setAdvanced);
  const viewRef = useRef<HTMLDivElement>(null);
  const holding = wp.packages.filter((p) => (wp.contents.objects.get(p.id)?.length ?? 0) > 0).length;
  return (
    <div className="g3">
      <ScenarioNotice />
      {/* The 3D view shows through the model area of the step (the camera frames the model there). */}
      <PackagePreview key={step === 4 ? 'split' : 'cols'} view={viewRef} packages={shown} contents={wp.contents} paint={step !== 4} />
      {step === 4 ? <ObjectSequenceStep wp={wp} view={viewRef} /> : (
        <div className="g3-cols">
          <section className="g3-left" aria-label="Model">
            <div className="g3-view" ref={viewRef} />
            <StepTools wp={wp} />
          </section>
          <section className="g3-centre" aria-label="Work packages"><PackageList wp={wp} lv={lv} /></section>
          <section className="g3-right" aria-label="Timeline preview"><Timeline wp={wp} lv={lv} /></section>
          <AdvancedPanel wp={wp} />
        </div>
      )}
      <ObjectOrderDialog wp={wp} />
      <RecipeEditorDialog wp={wp} />
      <footer className="g3-foot">
        {step > 1 && <button type="button" className="btn" onClick={() => setStep((step - 1) as G3Step)}>‹ {STEPS[step - 2].label.replace(/^\d+ - /, '')}</button>}
        {step < STEPS.length && <button type="button" className="btn" disabled={!wp.packages.length} onClick={() => setStep((step + 1) as G3Step)} title={wp.packages.length ? (step === 3 ? 'Optional: order the objects one by one' : '') : 'Make work packages first'}>{step === 3 ? 'Optional' : 'Next'}: {STEPS[step].label.replace(/^\d+ - /, '')} ›</button>}
        <Versions wp={wp} />
        <span className="g3-foot__status"><ReadinessChip wp={wp} /><GenerateStatus noCheck /></span>
        <button type="button" className="btn primary g3-generate" disabled={busy || holding === 0} onClick={() => void updateFourD()}
          title={holding ? `Make the schedule from the ${holding} work packages and load it into 4D and Programmes` : 'Make work packages first (step 1)'}>{generating ? 'Generating…' : busy ? `${busyText}` : 'Generate schedule'}</button>
        {generating && <button type="button" className="btn" onClick={cancelGenerate} title="Stop waiting: the programme in 4D stays the one from before">Cancel</button>}
        <button type="button" className={`btn g3-foot__adv${advanced ? ' is-on' : ''}`} aria-pressed={advanced} onClick={() => setAdvanced(!advanced)} title={advanced ? 'Close Advanced' : 'Open Advanced: the settings of the package picked (method, days, crew, when it starts, extras), beside the packages'}>Advanced</button>
      </footer>
    </div>
  );
}

export function Generate3Page({ picker }: { /** The page picker with the search box and the step tabs: the page's own header. */ picker?: ReactNode }) {
  const { ready } = useScenarioView();
  const models = useModelsStore((s) => s.models.length);
  const building = ready && models > 0;
  const step = useG3((s) => s.step);
  // The header (page picker, search, steps) runs the full width in the viewer's header slot: the docks start below it.
  const headerSlot = useHeaderSlotStore((h) => h.el);
  const bar = <div className="filterbar schedule-toolbar gen-head"><div className="schedule-toolbar__left">{picker}</div><div className="schedule-toolbar__right"><ListSetupButton always /></div></div>;
  return (
    <div className={`scn-page gen-page g3-page${building ? ' gen-page--preview' : ''}`}>
      <ScenarioSync />
      {/* The Gantt as a dock panel here too, so choosing it in the Navigation Bar or the Panels menu docks it in this view. */}
      {step !== 4 && <ModelsGanttPanel />}
      {headerSlot ? createPortal(bar, headerSlot) : bar}
      <main className="gen-main g3-main">{building ? <Builder /> : <Prerequisite />}</main>
    </div>
  );
}
