import { useMemo, useState } from 'react';
import { setRules, useScenarioStore } from '../../state/scenarioStore';
import { useScenarioView } from '../../scenarios/useScenarioView';
import { validateRules } from '../../prs/match';
import { addRebarRate } from '../../prs/convert';
import { RuleList } from './rules/RuleList';
import { RulePresets } from './rules/RulePresets';
import { GENERATOR_KINDS, SECTION_KIND, type RuleKind } from './rules/kinds';

/** Scenario panel > Rules: everything a scenario adds to the generator's own programme, in one list of rules (extra activities, manual
    links, crews, rates, settings, groups, level tasks, sequences, level links, contact links), each with its type. Saved with the
    scenario; exported and imported as a Programme Rules file (docs/programme-rules). */

/** The Rules tab: the file bar, the problems, and the list of rules. */
export function ScenarioRulesEditor() {
  const extras = useScenarioStore((s) => s.extras);
  const rules = useScenarioStore((s) => s.rules);
  const unsaved = useScenarioStore((s) => s.rules !== s.savedRules || s.extras !== s.savedExtras || s.relations !== s.savedRelations || s.crews !== s.savedCrews);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const problems = useMemo(() => validateRules(rules, extras.map((e) => e.TaskID)), [rules, extras]);

  const [focus, setFocus] = useState<{ kind: RuleKind; id: string; n: number } | null>(null);

  return (
    <div className="scn-rules">
      {(unsaved || problems.length > 0) && (
        <div className="scn-rules__bar">
          <span className="scn-rules__title">
            {unsaved && <span className="scn-chip scn-chip--warn">unsaved</span>}
            {problems.length > 0 && (
              <button type="button" className="scn-chip scn-chip--warn" onClick={() => setShowProblems(!showProblems)} title="Rules that name something that is not there">
                {problems.length} problem{problems.length === 1 ? '' : 's'}
              </button>
            )}
          </span>
        </div>
      )}
      {note && <div className={`scn-rules__note${note.ok ? '' : ' is-error'}`} role="status">{note.text}</div>}
      {showProblems && problems.length > 0 && (
        <ul className="scn-rules__problems">
          {problems.map((p, i) => (
            <li key={i}>
              <button type="button" className="link-btn" onClick={() => setFocus({ kind: SECTION_KIND[p.section] ?? 'group', id: p.id, n: Date.now() })}>{p.id || p.section}</button> {p.text}
              {p.fix === 'rebarRate' && (
                <button type="button" className="btn btn--small primary" style={{ marginLeft: 8 }} title="Adds a Rebar rate of 0.25 t per m³ of concrete (change it in Rates) and puts it on the Rebar phase of every object"
                  onClick={() => { setRules(addRebarRate(useScenarioStore.getState().rules)); setNote({ ok: true, text: 'Added the rebar rate REBAR-0.25 (0.25 t per m³) to the Rates and to the Rebar phase of every object. Save, then Update 4D.' }); }}>Fix: add rebar rate 0.25 t/m³</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <RulePresets />
      <RuleList focus={focus} only={GENERATOR_KINDS} storeKey="scenarios.generatorKinds" />
    </div>
  );
}

/** Rules as a dock panel of its own (4D Sequencing): the same editor, with the room of a panel, and a word when no
    scenario is open. Opening or saving the scenario is done in the Scenarios panel. */
export function ScenarioRulesDock() {
  const { ready, scenario } = useScenarioView();
  if (!ready) {
    return <div className="scn-rules scn-rules--empty">Open a scenario in the Scenarios panel to give it extra activities, links and crews{scenario ? '' : '.'}</div>;
  }
  return (
    <div className="scn-rules scn-rules--dock">
      <ScenarioRulesEditor />
    </div>
  );
}
