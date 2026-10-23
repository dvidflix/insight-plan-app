import { useEffect, useRef, useState } from 'react';
import { setCrews, setExtras, setRelations, setRules, updateFourD, useScenarioStore } from '../../../state/scenarioStore';
import { useScenarioView } from '../../../scenarios/useScenarioView';
import { addPreset, countPreset, DEFAULT_PRESETS, normalizePresets, presetId, withoutJoins, type PresetContent, type RulePreset } from '../../../prs/presets';
import { withOwn } from '../../../prs/recipeRules';
import { usePersistedState } from '../../../utils/persistedState';

/** Presets of the Rules list: a named copy of all the rules, extra activities, manual links and crew overrides. Load replaces what the
    scenario has, Add merges the preset into it (a rule with the same id is replaced), Save keeps the scenario's rules as a preset.
    Kept as a project setting (sequence.rulePresets), so they follow the project; 1HDAB_TOC is the first. */

const current = (): PresetContent => {
  const s = useScenarioStore.getState();
  return { rules: withoutJoins(s.rules), extras: s.extras, relations: s.relations, crews: s.crews }; // (a preset is rules only: no joins)
};

function put(c: PresetContent) {
  setRules(withOwn(c.rules, useScenarioStore.getState().rules)); // the objects joined in this scenario and its recipes stay
  setExtras(c.extras);
  setRelations(c.relations);
  setCrews(c.crews);
}

export function RulePresets() {
  const [presets, setPresets] = usePersistedState<RulePreset[]>('sequence.rulePresets', DEFAULT_PRESETS, undefined, normalizePresets);
  const [selected, setSelected] = useState('');
  const [naming, setNaming] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [menu]);
  const ready = useScenarioStore((s) => !!s.loaded);
  const busy = useScenarioStore((s) => s.busy);
  const { modelInfo } = useScenarioView();
  const preset = presets.find((p) => p.id === selected) ?? null;

  // Applying or adding a preset changes the rules, so 4D is regenerated at once (as Update 4D does; the scenario is not saved).
  const canUpdate = !!modelInfo?.hasSource && !busy;
  const refresh4D = () => { if (canUpdate) void updateFourD(); };
  const load = (p: RulePreset) => {
    const had = countPreset(current());
    if (had > 0 && !window.confirm(`Replace the ${had} rule${had === 1 ? '' : 's'} of this scenario with the preset "${p.name}"? Use Add to keep them.`)) return;
    put(p.content);
    refresh4D();
    setNote(`Loaded "${p.name}" (${countPreset(p.content)} rules)${canUpdate ? ' and updated 4D' : ''}. Save the scenario to keep them.`);
  };
  const add = (p: RulePreset) => {
    put(addPreset(current(), p.content));
    refresh4D();
    setNote(`Added "${p.name}" (${countPreset(p.content)} rules; a rule with the same id was replaced)${canUpdate ? ' and updated 4D' : ''}. Save the scenario to keep them.`);
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
  // A preset that ships with the app: its saved copy (after an Update, say) can go back to the app's own.
  const shipped = preset ? DEFAULT_PRESETS.find((d) => d.id === preset.id) : undefined;
  const restore = (p: RulePreset, original: RulePreset) => {
    if (!window.confirm(`Put the preset "${p.name}" back to the one that ships with the app (revision ${original.revision})? Your saved changes to it are lost.`)) return;
    setPresets(presets.map((x) => (x.id === p.id ? original : x)));
    setNote(`Restored "${p.name}" to the app's own (${countPreset(original.content)} rules). Load or Add it to a scenario to use it.`);
  };
  const remove = (p: RulePreset) => {
    if (!window.confirm(`Delete the preset "${p.name}"? The scenarios that used it keep their rules.`)) return;
    setPresets(presets.filter((x) => x.id !== p.id));
    setSelected('');
    setNote(`Deleted "${p.name}".`);
  };

  const item = (label: string, onClick: () => void, disabled: boolean, title: string, danger?: boolean) => (
    <button type="button" role="menuitem" className={`rule-presets__item${danger ? ' is-danger' : ''}`} disabled={disabled} title={title} onClick={() => { setMenu(false); onClick(); }}>{label}</button>
  );

  return (
    <div className="rule-presets">
      <span className="rule-presets__label">Preset</span>
      <select value={selected} onChange={(e) => { setSelected(e.target.value); setNote(''); }} aria-label="Rule preset" title={preset?.note}>
        <option value="">{presets.length ? 'Preset…' : 'No presets yet'}</option>
        {presets.map((p) => <option key={p.id} value={p.id}>{p.name} ({countPreset(p.content)})</option>)}
      </select>
      <button type="button" className="btn btn--small primary" disabled={!preset || !ready} onClick={() => preset && load(preset)} title="Replace this scenario's rules with the preset and update 4D">Apply</button>
      <span ref={menuRef} style={{ position: 'relative', display: 'inline-flex' }}>
        <button type="button" className="btn btn--small" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} title="More: add to the scenario's rules, save, update, restore, delete">⋯</button>
        {menu && (
          <div className="rule-presets__menu" role="menu">
            {item('Add to this scenario', () => preset && add(preset), !preset || !ready, "Merge the preset into this scenario's rules (a rule with the same id is replaced)")}
            {item('Save rules as…', () => setNaming(naming === null ? '' : null), !ready, "Keep this scenario's rules as a new preset")}
            {item('Update preset from these rules', () => preset && overwrite(preset), !preset || !ready, "Replace the selected preset with this scenario's rules")}
            {shipped && preset && item("Restore the app's version", () => restore(preset, shipped), !ready, 'Put the selected preset back to the one that ships with the app')}
            {item('Delete preset', () => preset && remove(preset), !preset, 'Delete the selected preset', true)}
          </div>
        )}
      </span>
      {naming !== null && (
        <span className="rule-presets__name">
          <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveNew(naming); if (e.key === 'Escape') setNaming(null); }} placeholder="Preset name" aria-label="Preset name" spellCheck={false} />
          <button type="button" className="btn btn--small primary" disabled={!naming.trim()} onClick={() => saveNew(naming)}>Save</button>
        </span>
      )}
      {note && <div className="rule-presets__note scn-dim">{note}</div>}
    </div>
  );
}
