import { useRef, useState } from 'react';
import { useModelsStore } from '../../../state/modelsStore';
import { useProjectDbStore } from '../../../state/projectDbStore';
import { createScenario, pickScenario, pickStem, refreshProject, stemsInInputs, useScenarioStore } from '../../../state/scenarioStore';
import { modelFileFor } from '../../../state/modelFiles';
import { useScenarioView } from '../../../scenarios/useScenarioView';
import { addModelToProject, fetchDefaultRoot } from '../../../scenarios/api';
import { openSampleBuilding } from '../../../state/sampleBuilding';
import { useViewerEngine } from '../../../viewer/ViewerEngineContext';
import { FEATURES } from '../../../features';
import { ProjectDbBar } from '../../ProjectDbPanel';
import { useG3 } from './useWorkPackages';

/** What Generate shows until a scenario of the loaded model is open: one card for the single next thing to do, in plain words. Load a model (or
    try the sample building), keep the plan in a project folder, add the model to it, then start or open a plan. Each card leads straight to the
    next; none of them is the classic Generate view's scenario panel (its rules, presets and take-over stay there). */

const goTo = (page: string) => window.dispatchEvent(new CustomEvent('ip-goto-page', { detail: page }));
const when = (t: number | null | undefined) => (t ? new Date(t).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '');

/** Try the sample building: loads it, opens a plan for it, and Generate makes the packages and the programme by itself. */
function SampleButton({ primary = false }: { primary?: boolean }) {
  const engine = useViewerEngine();
  const [state, setState] = useState<{ text: string; error: boolean } | null>(null);
  if (FEATURES.browserData) return null;
  const run = async () => {
    try {
      await openSampleBuilding(engine, (text) => setState({ text, error: false }));
      useG3.setState({ autoRun: true, step: 1 });
    } catch (e) {
      setState({ text: e instanceof Error ? e.message : String(e), error: true });
    }
  };
  const working = !!state && !state.error;
  return (
    <div className="g3-first__row">
      <button type="button" className={`btn${primary ? ' primary' : ''}`} disabled={working} onClick={() => void run()}
        title="A small three-storey model: Generate groups it into work packages and makes its programme, so you can see every step in a minute">{working ? 'Opening the sample…' : 'Try the sample building'}</button>
      {state && <span className={state.error ? 'scn-error' : 'scn-dim'}>{state.text}</span>}
    </div>
  );
}

export function GenerateStart() {
  const models = useModelsStore((s) => s.models);
  const { project, scenario, stem, modelInfo, scenarioNames } = useScenarioView();
  const projectError = useScenarioStore((s) => s.projectError);
  const busy = useScenarioStore((s) => s.busy);
  const message = useScenarioStore((s) => s.message);
  const dbBusy = useProjectDbStore((s) => s.busy);
  const dbError = useProjectDbStore((s) => s.error);

  if (!models.length) {
    return (
      <div className="g3-first">
        <h2>Start with the model</h2>
        <p className="scn-dim hint">Generate makes a programme from the objects of a 3D model (IFC). Load your model in Models, or try the sample building first: it shows every step in about a minute.</p>
        <div className="g3-first__row">
          <button type="button" className="btn primary" onClick={() => goTo('model')}>Go to Models</button>
        </div>
        <SampleButton />
      </div>
    );
  }
  if (!project) {
    return (
      <div className="g3-first g3-first--wide">
        <h2>Choose where the plan is kept</h2>
        <p className="scn-dim hint">The plan (its work packages, order, methods and programmes) is saved in a project folder, with a copy of the model. Use the default folder, or type your project’s folder.</p>
        <DefaultFolderButton />
        {(dbBusy || dbError || projectError) && <p className={dbBusy ? 'scn-dim' : 'scn-error'}>{dbBusy ?? dbError ?? projectError}</p>}
        <div className="g3-first__folder"><ProjectDbBar bare /></div>
      </div>
    );
  }
  if (!stem || !modelInfo) return <AddModel root={project.root} stem={stem} />;
  if (!scenario) return <StartPlan names={scenarioNames} />;
  // A scenario is picked: it is opening (or failed to).
  return (
    <div className="g3-first">
      <h2>Opening “{scenario}”</h2>
      {busy ? <p className="scn-dim hint">{busy} The first time a model is used, it is prepared once (a few seconds for a small model, a few minutes for a large one); after that, plans open at once.</p>
        : message?.kind === 'error' ? <p className="scn-error">{message.text}</p> : <p className="scn-dim hint">Reading the plan…</p>}
      {projectError && <p className="scn-error">{projectError}</p>}
      {!busy && <button type="button" className="btn" onClick={() => useScenarioStore.setState({ scenario: null, loaded: null })}>Back to the plans</button>}
    </div>
  );
}

function DefaultFolderButton() {
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setError(null);
    try {
      useProjectDbStore.setState({ root: await fetchDefaultRoot() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="g3-first__row">
      <button type="button" className="btn primary" onClick={() => void start()} title="Documents\Insight Plan\Default project">Use the default folder</button>
      {error && <span className="scn-error">{error}</span>}
    </div>
  );
}

/** The loaded model is not in the project folder yet: one button copies it there (the generator works on that copy). */
function AddModel({ root, stem }: { root: string; stem: string | null }) {
  const models = useModelsStore((s) => s.models);
  const stems = stemsInInputs(models);
  const [state, setState] = useState<{ busy: boolean; text: string | null; error: boolean }>({ busy: false, text: null, error: false });
  const pickRef = useRef<HTMLInputElement>(null);
  const upload = async (file: File) => {
    if (!stem) return;
    setState({ busy: true, text: 'Adding the model…', error: false });
    try {
      const res = await addModelToProject(root, stem, file, (f) => setState({ busy: true, text: `Adding the model… ${Math.round(f * 100)}%`, error: false }));
      setState({ busy: false, text: res.note, error: false });
      await refreshProject(root);
    } catch (e) {
      setState({ busy: false, text: e instanceof Error ? e.message : String(e), error: true });
    }
  };
  const add = () => {
    const file = stem ? modelFileFor(stem) : null;
    if (file) void upload(file);
    else pickRef.current?.click();
  };
  return (
    <div className="g3-first">
      <h2>Add the model to the project</h2>
      <p className="scn-dim hint"><b>{stem ?? 'The model'}</b> is open in 3D but not in the project folder yet. Adding it keeps a copy there, which the plan is made from.</p>
      {stems.length > 1 && (
        <label className="g3-first__row">
          <span>Model</span>
          <select value={stem ?? ''} onChange={(e) => pickStem(e.target.value)} aria-label="Model to plan">{stems.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </label>
      )}
      <div className="g3-first__row">
        <button type="button" className="btn primary" disabled={state.busy || !stem} onClick={add}>{state.busy ? 'Adding…' : 'Add to the project'}</button>
        {state.text && <span className={state.error ? 'scn-error' : 'scn-dim'}>{state.text}</span>}
      </div>
      <input ref={pickRef} type="file" accept=".ifc" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
    </div>
  );
}

/** No plan open: open one of this model's plans, or start a new one. */
function StartPlan({ names }: { names: string[] }) {
  const project = useScenarioStore((s) => s.project);
  const busy = useScenarioStore((s) => !!s.busy);
  const { stem } = useScenarioView();
  const suggested = (() => { let k = names.length + 1; while (names.includes(`Plan ${k}`)) k++; return `Plan ${k}`; })();
  const [name, setName] = useState(suggested);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setError(await createScenario(name.trim() || suggested, 'base'));
  };
  const generated = (n: string) => project?.scenarios.find((s) => s.name === n)?.models.find((m) => m.stem === stem)?.generated ?? null;
  return (
    <div className="g3-first">
      <h2>{names.length ? 'Open a plan' : 'Start a plan'}</h2>
      <p className="scn-dim hint">A plan (a scenario) holds this model’s work packages, their order and methods, and the programme made from them. Make as many as you like to compare ways of building.</p>
      {names.length > 0 && (
        <ul className="g3-first__plans">
          {names.map((n) => (
            <li key={n}>
              <button type="button" className="btn" disabled={busy} onClick={() => pickScenario(n)}>{n}</button>
              <span className="scn-dim">{generated(n) ? `generated ${when(generated(n))}` : project?.scenarios.some((s) => s.name === n) ? 'saved, not generated' : 'not saved yet'}</span>
            </li>
          ))}
        </ul>
      )}
      <form className="g3-first__row" onSubmit={(e) => { e.preventDefault(); void start(); }}>
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name of the new plan" placeholder={suggested} />
        <button type="submit" className={`btn${names.length ? '' : ' primary'}`} disabled={busy}>{names.length ? 'New plan' : 'Start planning'}</button>
      </form>
      {error && <p className="scn-error">{error}</p>}
    </div>
  );
}
