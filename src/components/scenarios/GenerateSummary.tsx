import { useMemo, useState } from 'react';
import { needsUpdate, updateFourD, useScenarioStore } from '../../state/scenarioStore';
import { useSearchSetsStore } from '../../state/searchSetsStore';
import { useProjectDbStore } from '../../state/projectDbStore';
import { useScheduleStore } from '../../state/scheduleStore';
import { scenarioFileName } from '../../scenarios/api';
import { useScenarioView } from '../../scenarios/useScenarioView';
import { usePersistedState } from '../../utils/persistedState';
import { SHIPPED_PRESETS, activePresets, applyPreset, normalizeSequencingPresets, presetFromSettings, type SequencingPreset } from '../../prs/sequencingPresets';
import { summariseProgramme } from '../../schedule/programmeSummary';
import { useRuleContext } from './rules/RuleParts';
import { useGenerateTab } from './GenerateTabs';

/** The top of the Work breakdown tab: how the work runs (sequencing presets: a named change to a few switches, which combine) and what the last
    generated programme came to (length, critical share, busiest day of each kind of resource). A preset only sets the engine's own switches, listed
    under Rules: pick one, the programme is regenerated, and the switches can still be fine-tuned there. */

const dateText = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const weeks = (days: number) => (days >= 14 ? `${Math.round(days / 7).toLocaleString()} weeks` : `${days} day${days === 1 ? '' : 's'}`);

export function SequencingPresets() {
  const ctx = useRuleContext();
  const [own, setOwn] = usePersistedState<SequencingPreset[]>('generate.sequencingPresets', [], undefined, normalizeSequencingPresets);
  const [pick, setPick] = useState('');
  const [naming, setNaming] = useState<string | null>(null);
  const setAdvanced = useGenerateTab((s) => s.setAdvanced);
  const busy = useScenarioStore((s) => s.busy);
  const { modelInfo } = useScenarioView();
  const all = [...SHIPPED_PRESETS, ...own];
  const chosen = all.find((p) => p.id === pick) ?? null;
  const active = activePresets(ctx.rules.settings, all);
  const apply = (p: SequencingPreset) => {
    ctx.change((r) => ({ ...r, settings: applyPreset(r.settings, p) }));
    if (modelInfo?.hasSource && !busy) void updateFourD();
  };
  const save = (name: string) => {
    if (!name.trim()) return;
    const made = presetFromSettings(name, ctx.rules.settings, all.map((p) => p.id));
    setOwn([...own, made]);
    setPick(made.id);
    setNaming(null);
  };
  return (
    <div className="gen-presets">
      <div className="rel-bar">
        <span className="rule-presets__label">How the work runs</span>
        <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Sequencing preset" title={chosen?.note}>
          <option value="">Choose a way to run it…</option>
          <optgroup label="Built in">{SHIPPED_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>
          {own.length > 0 && <optgroup label="Yours">{own.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
        </select>
        <button type="button" className="btn btn--small primary" disabled={!chosen} onClick={() => chosen && apply(chosen)} title="Set these switches in this scenario and regenerate. Everything else in the scenario stays as it is">Apply</button>
        <button type="button" className="btn btn--small" onClick={() => setNaming(naming === null ? '' : null)} title="Keep this scenario's sequencing, level-gate and resource switches as a preset of your own">Save as…</button>
        {chosen?.own && <button type="button" className="btn btn--small" onClick={() => { if (window.confirm(`Delete the preset "${chosen.name}"? Scenarios keep their switches.`)) { setOwn(own.filter((p) => p.id !== chosen.id)); setPick(''); } }} title="Delete this preset of yours">Delete</button>}
        <button type="button" className="link-btn" onClick={() => setAdvanced('rules')} title="Every switch, with what it does, on the Rules tab">All switches</button>
      </div>
      {naming !== null && (
        <div className="rel-bar">
          <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(naming); if (e.key === 'Escape') setNaming(null); }} placeholder="Preset name" aria-label="Preset name" spellCheck={false} />
          <button type="button" className="btn btn--small primary" disabled={!naming.trim()} onClick={() => save(naming)}>Save</button>
        </div>
      )}
      <div className="scn-dim xl__note">
        {chosen ? chosen.note : active.length ? `Now: ${active.map((p) => p.name).join('; ')}.` : 'Now: the generator’s own switches. Pick a way to run the work to change a few of them at once; they combine.'}
      </div>
    </div>
  );
}

/** What the generated programme came to, and whether the list or rules have changed since. */
export function ResultSummary() {
  const stem = useScenarioStore((s) => s.loaded?.stem ?? null);
  const scenario = useScenarioStore((s) => s.scenario);
  useSearchSetsStore((s) => s.sets); // (the search sets can make the programme out of date: needsUpdate reads them)
  const stale = useScenarioStore((s) => needsUpdate(s));
  const generation = useScenarioStore((s) => s.generation);
  const busy = useScenarioStore((s) => s.busy);
  const programmes = useProjectDbStore((s) => s.programmes);
  const schedules = useScheduleStore((s) => s.schedules);
  const model = useMemo(() => {
    if (!stem || !scenario) return null;
    const p = programmes.find((x) => x.kind === 'scenario' && x.scenario === scenario && x.stem === stem);
    const file = `${scenarioFileName(stem, scenario)}.xml`;
    return schedules.find((s) => (p && s.dbProgrammeId === p.id) || s.sourceFileName === file) ?? null;
  }, [stem, scenario, programmes, schedules]);
  const sum = useMemo(() => (model ? summariseProgramme(model) : null), [model]);
  if (!stem || !scenario) return null;
  if (!sum || sum.activities === 0) {
    return <div className="scn-dim xl__note">No programme yet: press Generate to make one from this work breakdown and see how long it is.</div>;
  }
  const generated = generation > 0;
  return (
    <div className="gen-result">
      <div className="gen-result__cells">
        <span className="gen-result__cell"><b>{weeks(sum.days)}</b><span className="scn-dim">{dateText(sum.start)} to {dateText(sum.finish)}</span></span>
        <span className="gen-result__cell"><b>{sum.activities.toLocaleString()}</b><span className="scn-dim">activities</span></span>
        <span className="gen-result__cell" title="Activities with no float: delaying one of them delays the finish"><b>{Math.round(sum.criticalShare * 100)}%</b><span className="scn-dim">critical ({sum.critical.toLocaleString()})</span></span>
        {sum.peaks.map((p) => (
          <span key={p.group} className="gen-result__cell" title={`${p.name}: the highest in any week`}><b>{p.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</b><span className="scn-dim">{p.group.toLowerCase()} peak{p.unit ? ` (${p.unit})` : ''}, {p.name}</span></span>
        ))}
      </div>
      {stale && !busy && <div className="scn-status scn-status--warn seq__warn" role="status">{generated ? 'The work breakdown, rules or search sets have changed since this programme was made.' : 'This is the saved programme; the work breakdown, rules or search sets have changed since.'} Press Generate to see the new length.</div>}
    </div>
  );
}
