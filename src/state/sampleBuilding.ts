import type { ViewerEngine } from '../viewer/ViewerEngine';
import { useModelsStore } from './modelsStore';
import { useProjectDbStore } from './projectDbStore';
import { rememberModelFile } from './modelFiles';
import { storeLoadedIfc } from '../viewer/modelStore';
import { createScenario, pickScenario, refreshProject, scenarioNamesFor, useScenarioStore } from './scenarioStore';
import { addModelToProject, fetchDefaultRoot } from '../scenarios/api';

/** "Try the sample building" (Generate's first run): the small model in public/sample (made by scripts/make-sample-ifc.py) is loaded as if the
    user had opened it, in the project folder open (or the default one, Documents\Insight Plan\Default project), added to the project's models, and
    a scenario "Sample plan" is opened for it. Generate then makes the work packages and the programme by itself (useG3 autoRun). */

export const SAMPLE_FILE = 'sample-building.ifc';
export const SAMPLE_STEM = 'sample-building';
export const SAMPLE_PLAN = 'Sample plan';

/** Resolves once `test` is true (false after `ms`). */
function until<T>(store: { getState: () => T; subscribe: (f: () => void) => () => void }, test: (s: T) => boolean, ms = 60_000): Promise<boolean> {
  return new Promise((resolve) => {
    if (test(store.getState())) return resolve(true);
    const stop = store.subscribe(() => { if (test(store.getState())) { stop(); clearTimeout(timer); resolve(true); } });
    const timer = setTimeout(() => { stop(); resolve(false); }, ms);
  });
}

/** Opens the sample; `say` reports each stage. Throws with a plain message when a stage fails. */
export async function openSampleBuilding(engine: ViewerEngine, say: (text: string) => void): Promise<void> {
  // 1. A project folder: the one open, else the default one.
  if (!useProjectDbStore.getState().db) {
    say('Opening the default project folder…');
    const root = useProjectDbStore.getState().root.trim() || (await fetchDefaultRoot());
    useProjectDbStore.setState({ root });
    if (!(await until(useProjectDbStore, (s) => !!s.db || !!s.error, 30_000)) || !useProjectDbStore.getState().db) {
      throw new Error(useProjectDbStore.getState().error ?? 'The project folder did not open.');
    }
  }
  const root = useProjectDbStore.getState().db!.root;
  // 2. The model, in 3D (unless it is loaded already) and in the project's model store.
  const res = await fetch(`${import.meta.env.BASE_URL}sample/${SAMPLE_FILE}`);
  if (!res.ok) throw new Error(`The sample model is missing from this installation (${res.status}).`);
  const buffer = await res.arrayBuffer();
  const file = new File([buffer], SAMPLE_FILE);
  if (!useModelsStore.getState().models.some((m) => m.name === SAMPLE_FILE)) {
    say('Loading the sample building in 3D…');
    const info = await engine.loadIfc(buffer.slice(0), SAMPLE_FILE);
    useModelsStore.getState().addModel(info);
    rememberModelFile(file);
    void storeLoadedIfc(engine, root, SAMPLE_FILE, buffer.slice(0), info.modelId).catch(() => {});
  }
  // 3. The model in the project's models folder, where the generator reads it.
  say('Adding the sample to the project…');
  await addModelToProject(root, SAMPLE_STEM, file);
  await refreshProject(root);
  // 4. Its scenario: opened when there is one, else made.
  const { project, drafts } = useScenarioStore.getState();
  if (scenarioNamesFor(project, drafts, SAMPLE_STEM).includes(SAMPLE_PLAN)) pickScenario(SAMPLE_PLAN);
  else {
    const err = await createScenario(SAMPLE_PLAN, 'base');
    if (err) throw new Error(err);
  }
  say('Opening the plan (the first time, the model is prepared: a few seconds)…');
}
