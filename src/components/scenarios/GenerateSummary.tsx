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
import { duplicateSetNames } from '../../viewer/setTree';
import { MODEL_VERDICT, useModelCheck } from './ScenarioModelCheck';

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
  // Folded by default: its title says what is set now, so it is read at a glance and opened only to change it.
  const [open, setOpen] = usePersistedState<boolean>('generate.presetsOpen', false);
  const now = active.length ? active.map((p) => p.name).join('; ') : 'the generator’s own switches';
  return (
    <details className="gen-order__levels gen-presets" open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary title="A named change to a few of the generator's switches; presets combine">How the work runs <span className="gen-presets__now">{now}</span></summary>
      <div className="rel-bar">
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
        {chosen ? chosen.note : 'Pick a way to run the work to change a few of the generator’s switches at once; they combine.'}
      </div>
    </details>
  );
}

/** The search set names the scenario uses that two sets share: the generator finds a set by its name, so two of the same name are one. */
function useSameNames() {
  const sets = useSearchSetsStore((s) => s.sets);
  const rules = useScenarioStore((s) => s.rules);
  return useMemo(() => {
    const used = new Set([
      ...(rules.recipes ?? []).map((r) => r.group), ...rules.sequences.flatMap((q) => q.steps.map((x) => x.group)), ...rules.levelTasks.map((t) => t.group),
      ...Object.values(rules.extraTags).map((t) => t.attach?.target ?? ''),
    ].map((g) => g.trim().toUpperCase()).filter(Boolean));
    return duplicateSetNames(sets).filter((d) => used.has(d.name.trim().toUpperCase()));
  }, [sets, rules]);
}
const sameNamesText = (names: ReturnType<typeof useSameNames>) =>
  `${names.length === 1 ? 'A search set name is used twice' : `${names.length} search set names are used twice`}: ${names.slice(0, 3).map((d) => `“${d.name}” (in ${d.folders.join(' and ')})`).join('; ')}${names.length > 3 ? '…' : ''}. The generator finds a set by its name, so the sets of the same name are treated as one. Rename one of them in Models › Search sets.`;

/** A warning when search sets that the scenario uses share a name. */
export function SameNameWarning() {
  const names = useSameNames();
  if (!names.length) return null;
  return <div className="scn-status scn-status--warn seq__warn" role="status" style={{ margin: '6px 12px' }}>{sameNamesText(names)}</div>;
}

/** The scenario's generated programme summed up (length, dates, critical share, peaks), and whether it is out of date. */
function useResult() {
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
  return { stem, scenario, stale, generation, busy, sum: sum && sum.activities > 0 ? sum : null };
}

/** What the generated programme came to, and whether the list or rules have changed since. */
export function ResultSummary() {
  const { stem, scenario, stale, generation, busy, sum } = useResult();
  if (!stem || !scenario) return null;
  if (!sum) {
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

/** The one line beside Generate on the Work breakdown tab: whether the model can be generated, what the programme came to and whether it is out of
    date, and any search set names used twice. Each part says more in its tooltip; the model check's details are on tab 1. */
export function GenerateStatus({ noCheck = false }: { /** Leave the model check out (Generate 3 has its own readiness, and the check's details are on classic Generate's tab 1). */ noCheck?: boolean } = {}) {
  const { stem, scenario, stale, generation, busy, sum } = useResult();
  const { check } = useModelCheck(stem);
  const names = useSameNames();
  const setTab = useGenerateTab((s) => s.setTab);
  if (!stem || !scenario) return null;
  const verdict = check ? MODEL_VERDICT[check.verdict] : null;
  const peaks = sum ? sum.peaks.map((p) => `${p.group} peak${p.unit ? ` (${p.unit})` : ''}, ${p.name}: ${p.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`) : [];
  return (
    <span className="gen-status" role="status">
      {!noCheck && verdict && (check!.verdict !== 'ready' || !sum) && (
        <button type="button" className={`scn-chip scn-chip--${verdict.cls === 'ok' ? 'ok' : 'warn'}`} onClick={() => setTab('scenario')} title={`Model check: ${verdict.label}. Click for what it found (tab 1)`}>{verdict.label}</button>
      )}
      {busy
        ? <span className="gen-status__text">{busy}</span>
        : sum
          ? <span className="gen-status__text" title={[`${sum.activities.toLocaleString()} activities, ${sum.critical.toLocaleString()} critical (no float: delaying one delays the finish)`, ...peaks].join('\n')}><b>{weeks(sum.days)}</b> · {dateText(sum.start)} to {dateText(sum.finish)} · {Math.round(sum.criticalShare * 100)}% critical</span>
          : <span className="gen-status__text scn-dim">No programme yet</span>}
      {sum && stale && !busy && <span className="scn-chip scn-chip--warn" title={`${generation > 0 ? 'The work breakdown, rules or search sets have changed since this programme was made' : 'This is the saved programme; the work breakdown, rules or search sets have changed since'}. Press Generate to see the new length`}>out of date</span>}
      {names.length > 0 && <span className="scn-chip scn-chip--warn" title={sameNamesText(names)}>{names.length === 1 ? 'a set name used twice' : `${names.length} set names used twice`}</span>}
    </span>
  );
}
