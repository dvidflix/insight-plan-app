import { useState } from 'react';
import { setCrews, setExtras, setRelations, setRules, useScenarioStore } from '../../../state/scenarioStore';
import { addPreset, countPreset, DEFAULT_PRESETS, normalizePresets, presetId, withoutJoins, type PresetContent, type RulePreset } from '../../../prs/presets';
import { withJoins } from '../../../prs/joins';
import { usePersistedState } from '../../../utils/persistedState';

/** Presets of the Rules list: a named copy of all the rules, extra activities, manual links and crew overrides. Load replaces what the
    scenario has, Add merges the preset into it (a rule with the same id is replaced), Save keeps the scenario's rules as a preset.
    Kept as a project setting (sequence.rulePresets), so they follow the project; 1HDAB_TOC is the first. */

const current = (): PresetContent => {
  const s = useScenarioStore.getState();
  return { rules: withoutJoins(s.rules), extras: s.extras, relations: s.relations, crews: s.crews }; // (a preset is rules only: no joins)
};

function put(c: PresetContent) {
  setRules(withJoins(c.rules, useScenarioStore.getState().rules.joins)); // the objects joined in this scenario stay
  setExtras(c.extras);
  setRelations(c.relations);
  setCrews(c.crews);
}

export function RulePresets() {
  const [presets, setPresets] = usePersistedState<RulePreset[]>('sequence.rulePresets', DEFAULT_PRESETS, undefined, normalizePresets);
  const [selected, setSelected] = useState('');
  const [naming, setNaming] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const ready = useScenarioStore((s) => !!s.loaded);
  const preset = presets.find((p) => p.id === selected) ?? null;

  const load = (p: RulePreset) => {
    const had = countPreset(current());
    if (had > 0 && !window.confirm(`Replace the ${had} rule${had === 1 ? '' : 's'} of this scenario with the preset "${p.name}"? Use Add to keep them.`)) return;
    put(p.content);
    setNote(`Loaded "${p.name}" (${countPreset(p.content)} rules). Save the scenario to keep them.`);
  };
  const add = (p: RulePreset) => {
    put(addPreset(current(), p.content));
    setNote(`Added "${p.name}" (${countPreset(p.content)} rules; a rule with the same id was replaced). Save the scenario to keep them.`);
  };
  const saveNew = (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    const id = presetId(clean, presets.map((p) => p.id));
    const next: RulePreset = { id, name: clean, savedAt: new Date().toISOString().slice(0, 10), content: current() };
    setPresets([...presets, next]);
    setSelected(id);
    setNaming(null);
    setNote(`Saved "${clean}" (${countPreset(next.content)} rules).`);
  };
  const overwrite = (p: RulePreset) => {
    if (!window.confirm(`Replace the preset "${p.name}" with this scenario's rules?`)) return;
    const content = current();
    setPresets(presets.map((x) => (x.id === p.id ? { ...x, savedAt: new Date().toISOString().slice(0, 10), content, userEdited: true } : x)));
    setNote(`Updated "${p.name}" (${countPreset(content)} rules).`);
  };
  const remove = (p: RulePreset) => {
    if (!window.confirm(`Delete the preset "${p.name}"? The scenarios that used it keep their rules.`)) return;
    setPresets(presets.filter((x) => x.id !== p.id));
    setSelected('');
    setNote(`Deleted "${p.name}".`);
  };

  return (
    <div className="rule-presets">
      <span className="rule-presets__label">Preset</span>
      <select value={selected} onChange={(e) => { setSelected(e.target.value); setNote(''); }} aria-label="Rule preset">
        <option value="">{presets.length ? 'Choose a preset…' : 'No presets yet'}</option>
        {presets.map((p) => <option key={p.id} value={p.id}>{p.name} ({countPreset(p.content)})</option>)}
      </select>
      <button type="button" className="btn btn--small" disabled={!preset || !ready} onClick={() => preset && load(preset)} title="Replace this scenario's rules with the preset">Load</button>
      <button type="button" className="btn btn--small" disabled={!preset || !ready} onClick={() => preset && add(preset)} title="Add the preset's rules to this scenario's (a rule with the same id is replaced)">Add</button>
      <button type="button" className="btn btn--small" disabled={!ready} onClick={() => setNaming(naming === null ? '' : null)} title="Keep this scenario's rules as a new preset">Save as…</button>
      <button type="button" className="btn btn--small" disabled={!preset || !ready} onClick={() => preset && overwrite(preset)} title="Replace the selected preset with this scenario's rules">Update</button>
      <button type="button" className="btn btn--small danger" disabled={!preset} onClick={() => preset && remove(preset)} title="Delete the selected preset">Delete</button>
      {naming !== null && (
        <span className="rule-presets__name">
          <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveNew(naming); if (e.key === 'Escape') setNaming(null); }} placeholder="Preset name" aria-label="Preset name" spellCheck={false} />
          <button type="button" className="btn btn--small primary" disabled={!naming.trim()} onClick={() => saveNew(naming)}>Save</button>
        </span>
      )}
      {(preset?.note || note) && <div className="rule-presets__note scn-dim">{note || preset?.note}{!note && preset?.savedAt ? ` (saved ${preset.savedAt})` : ''}</div>}
    </div>
  );
}
