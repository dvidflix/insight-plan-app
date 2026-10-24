import { useState } from 'react';
import { createScenario, isDirty, pickScenario, saveOrder, scenarioNamesFor, updateFourD, useScenarioStore } from '../../../state/scenarioStore';
import { CompareDialog } from './Compare';
import { Dialog } from './Controls';
import type { useWorkPackages } from './useWorkPackages';

/** Versions (Generate 3): switch between the scenarios of this model, and save what is on screen as a new one. A new version is a copy of the open
    scenario (its work packages, nesting, order, methods and overrides, object order, recipes and rules), saved to the project and generated, so its
    programme is there too; the scenario it was copied from stays as it was (or, when asked, keeps the unsaved changes too). It uses the scenarios'
    own copy and save (state/scenarioStore), not the Scenarios page. */

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

/** The next free "<name> vN". */
function nextName(scenario: string | null, names: string[]): string {
  const base = (scenario ?? 'Scenario').replace(/ v\d+$/, '');
  let k = 2;
  while (names.includes(`${base} v${k}`)) k++;
  return `${base} v${k}`;
}

export function Versions({ wp }: { wp: ReturnType<typeof useWorkPackages> }) {
  const [compare, setCompare] = useState(false);
  const [saving, setSaving] = useState(false);
  const project = useScenarioStore((s) => s.project);
  const drafts = useScenarioStore((s) => s.drafts);
  const loaded = useScenarioStore((s) => s.loaded);
  const scenario = useScenarioStore((s) => s.scenario);
  const busy = useScenarioStore((s) => !!s.busy);
  const names = scenarioNamesFor(project, drafts, loaded?.stem ?? null);
  return (
    <span className="g3-versions">
      <select value={scenario ?? ''} disabled={busy} onChange={(e) => pickScenario(e.target.value)} aria-label="Version" title="The version (scenario) open: pick another to switch (unsaved changes are asked about first)">
        {names.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
      <button type="button" className="btn" disabled={busy || !loaded} onClick={() => setSaving(true)} title="Copy what is on screen to a new version, with its programme, and switch to it: try another way without changing this one">Save as new version…</button>
      <button type="button" className="btn" disabled={!loaded || names.length < 2} onClick={() => setCompare(true)} title={names.length < 2 ? 'Save a version first: then compare it with this one' : 'This version beside another: length, critical path, activities, objects and volume, and the packages that differ'}>Compare…</button>
      {saving && scenario && <SaveVersionDialog from={scenario} suggested={nextName(scenario, names)} onClose={() => setSaving(false)} />}
      {compare && <CompareDialog wp={wp} onClose={() => setCompare(false)} />}
    </span>
  );
}

function SaveVersionDialog({ from, suggested, onClose }: { from: string; suggested: string; onClose: () => void }) {
  const dirty = useScenarioStore((s) => isDirty(s));
  const [name, setName] = useState(suggested);
  const [keep, setKeep] = useState(true);
  const [state, setState] = useState<{ working: boolean; error: string | null }>({ working: false, error: null });
  const go = async () => {
    setState({ working: true, error: null });
    // With "keep" on, the open version saves its changes first; else they go only to the copy and it stays as last saved.
    if (dirty && keep) {
      await saveOrder();
      const m = useScenarioStore.getState().message;
      if (m?.kind === 'error') { setState({ working: false, error: m.text }); return; }
    }
    const error = await saveVersion(name.trim() || suggested);
    if (error) setState({ working: false, error });
    else onClose();
  };
  const close = () => { if (!state.working) onClose(); };
  return (
    <Dialog title="Save as new version" onClose={close} wide={false}
      foot={<><button type="button" className="btn" disabled={state.working} onClick={close}>Cancel</button><button type="button" className="btn primary" disabled={state.working} onClick={() => void go()}>{state.working ? 'Saving and generating…' : 'Save and switch to it'}</button></>}>
      <p className="scn-dim hint">A copy of “{from}” as it is on screen: its work packages and their nesting, order, methods, days, crews and object order, saved and generated, so its programme is there too. Change the copy freely; switch back with the list beside Generate.</p>
      <form className="g3-first__row" onSubmit={(e) => { e.preventDefault(); if (!state.working) void go(); }}>
        <span className="g3-adv__label">Name</span>
        <input className="g3-adv__text" value={name} autoFocus onChange={(e) => setName(e.target.value)} aria-label="Name of the new version" placeholder={suggested} />
      </form>
      {dirty && (
        <label className="g3-adv__check">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          <span>Save the changes in “{from}” too<small className="g3-adv__why">{keep ? `“${from}” is saved as it is now, then copied.` : `The changes go only to the new version; “${from}” stays as it was last saved.`}</small></span>
        </label>
      )}
      {state.error && <p className="scn-error">{state.error}</p>}
    </Dialog>
  );
}
