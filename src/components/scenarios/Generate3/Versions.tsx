import { useState } from 'react';
import { createScenario, pickScenario, saveOrder, scenarioNamesFor, updateFourD, useScenarioStore } from '../../../state/scenarioStore';

/** Versions (Generate 3): switch between the scenarios of this model, and save what is on screen as a new one. A new version is a copy of the open
    scenario (its work packages, nesting, order, methods and overrides, recipes and rules), saved to the project and generated, so its programme is
    there too; the scenario it was copied from stays as it was. It uses the scenarios' own copy and save (state/scenarioStore), not the Scenarios page. */

/** Resolves once the store says so (or after `ms`, with false). */
function until(test: () => boolean, ms = 60_000): Promise<boolean> {
  return new Promise((resolve) => {
    if (test()) return resolve(true);
    const stop = useScenarioStore.subscribe(() => { if (test()) { stop(); clearTimeout(timer); resolve(true); } });
    const timer = setTimeout(() => { stop(); resolve(false); }, ms);
  });
}

/** The open scenario copied as `name`, saved and generated. An error text, or null. */
export async function saveVersion(name: string): Promise<string | null> {
  const err = await createScenario(name, 'current');
  if (err) return err;
  if (!(await until(() => { const s = useScenarioStore.getState(); return s.loaded?.scenario === name && !s.busy; }))) return `“${name}” was made but did not open in time: open it from the list and press Save.`;
  await saveOrder();
  if (useScenarioStore.getState().message?.kind === 'error') return useScenarioStore.getState().message!.text;
  await updateFourD();
  return null;
}

export function Versions() {
  const project = useScenarioStore((s) => s.project);
  const drafts = useScenarioStore((s) => s.drafts);
  const loaded = useScenarioStore((s) => s.loaded);
  const scenario = useScenarioStore((s) => s.scenario);
  const busy = useScenarioStore((s) => !!s.busy);
  const [working, setWorking] = useState(false);
  const names = scenarioNamesFor(project, drafts, loaded?.stem ?? null);
  const next = () => {
    const base = (scenario ?? 'Scenario').replace(/ v\d+$/, '');
    let k = 2;
    while (names.includes(`${base} v${k}`)) k++;
    return `${base} v${k}`;
  };
  const save = async () => {
    const name = window.prompt('Save what is on screen as a new scenario (it is saved and generated; this one stays as it is). Name:', next())?.trim();
    if (!name) return;
    setWorking(true);
    try {
      const err = await saveVersion(name);
      if (err) window.alert(err);
    } finally {
      setWorking(false);
    }
  };
  return (
    <span className="g3-versions">
      <select value={scenario ?? ''} disabled={busy || working} onChange={(e) => pickScenario(e.target.value)} aria-label="Scenario" title="The scenario open: pick another to switch (unsaved changes are asked about first)">
        {names.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <button type="button" className="btn" disabled={busy || working || !loaded} onClick={() => void save()} title="Save what is on screen as a new scenario, with its generated programme, to compare with this one">{working ? 'Saving the version…' : 'Save as new version…'}</button>
    </span>
  );
}
