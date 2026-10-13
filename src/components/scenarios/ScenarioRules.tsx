import { useMemo, useRef, useState } from 'react';
import { setCrews, setExtras, setRelations, setRules, useScenarioStore } from '../../state/scenarioStore';
import { useScenarioView } from '../../scenarios/useScenarioView';
import { parseOverlay, serializeOverlay } from '../../prs/overlay';
import { downloadBlob } from '../../utils/download';
import { mergeRules, totalRules, isEmptyRules } from '../../prs/rules';
import { validateRules } from '../../prs/match';
import { addRebarRate } from '../../prs/convert';
import { RuleList } from './rules/RuleList';
import { SECTION_KIND, type RuleKind } from './rules/kinds';

/** Scenario panel > Rules: everything a scenario adds to the generator's own programme, in one list of rules (extra activities, manual
    links, crews, rates, settings, groups, level tasks, sequences, level links, contact links), each with its type. Saved with the
    scenario; exported and imported as a Programme Rules file (docs/programme-rules). */

/** The Rules tab: the file bar, the problems, and the list of rules. */
export function ScenarioRulesEditor() {
  const { scenario } = useScenarioView();
  const relations = useScenarioStore((s) => s.relations);
  const crews = useScenarioStore((s) => s.crews);
  const extras = useScenarioStore((s) => s.extras);
  const rules = useScenarioStore((s) => s.rules);
  const unsaved = useScenarioStore((s) => s.rules !== s.savedRules || s.extras !== s.savedExtras || s.relations !== s.savedRelations || s.crews !== s.savedCrews);
  const file = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const problems = useMemo(() => validateRules(rules, extras.map((e) => e.TaskID)), [rules, extras]);

  const exportRules = () => {
    const name = (scenario ?? 'scenario').replace(/[\\/:*?"<>|]+/g, '_');
    downloadBlob(`${name}.rules.prs.xml`, new Blob([serializeOverlay({ extras, links: relations, crews, rules }, `${scenario ?? 'Scenario'} rules`)], { type: 'application/xml' }));
    setNote({ ok: true, text: `Exported ${extras.length} extra activities, ${relations.length} links, ${crews.length} crew rows and ${totalRules(rules)} programme rule${totalRules(rules) === 1 ? '' : 's'}.` });
  };
  const importRules = async (f: File) => {
    try {
      const o = parseOverlay(await f.text());
      // Rows with the same ID (extras, rules) or the same ends and type (links) are replaced; the rest are added.
      const linkKey = (l: { ActivityID1: string; ActivityID2: string; Relation: string }) => `${l.ActivityID1}>${l.ActivityID2}:${l.Relation}`;
      const extraIds = new Set(o.extras.map((e) => e.TaskID.toUpperCase()));
      const linkKeys = new Set(o.links.map(linkKey));
      const crewKey = (c: { Phase: string; PourType: string; Trade: string }) => `${c.Phase}|${c.PourType}|${c.Trade}`;
      const crewKeys = new Set(o.crews.map(crewKey));
      setExtras([...extras.filter((e) => !extraIds.has(e.TaskID.toUpperCase())), ...o.extras]);
      setRelations([...relations.filter((l) => !linkKeys.has(linkKey(l))), ...o.links]);
      setCrews([...crews.filter((c) => !crewKeys.has(crewKey(c))), ...o.crews]);
      if (o.rules && !isEmptyRules(o.rules)) setRules(mergeRules(useScenarioStore.getState().rules, o.rules));
      setNote({ ok: true, text: `Imported ${o.extras.length} extra activities, ${o.links.length} links, ${o.crews.length} crew rows and ${o.rules ? totalRules(o.rules) : 0} programme rules. Save to keep them.` });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
  };
  const [focus, setFocus] = useState<{ kind: RuleKind; id: string; n: number } | null>(null);

  return (
    <div className="scn-rules">
      <div className="scn-rules__bar">
        <span className="scn-rules__title">
          {unsaved && <span className="scn-chip scn-chip--warn">unsaved</span>}
          {problems.length > 0 && (
            <button type="button" className="scn-chip scn-chip--warn" onClick={() => setShowProblems(!showProblems)} title="Rules that name something that is not there">
              {problems.length} problem{problems.length === 1 ? '' : 's'}
            </button>
          )}
        </span>
        <span className="scn-rules__file">
          <button type="button" className="btn btn--small" onClick={exportRules} title="Save the extra activities, links, crews and programme rules as a Programme Rules file (docs/programme-rules)">Export</button>
          <button type="button" className="btn btn--small" onClick={() => file.current?.click()} title="Add the rules of a Programme Rules file to this scenario (rows with the same id are replaced)">Import</button>
          <input ref={file} type="file" accept=".xml,.prs" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importRules(f); e.target.value = ''; }} />
        </span>
      </div>
      {note && <div className={`scn-rules__note${note.ok ? '' : ' is-error'}`} role="status">{note.text}</div>}
      {showProblems && problems.length > 0 && (
        <ul className="scn-rules__problems">
          {problems.map((p, i) => (
            <li key={i}>
              <button type="button" className="link-btn" onClick={() => setFocus({ kind: SECTION_KIND[p.section] ?? 'duration', id: p.id, n: Date.now() })}>{p.id || p.section}</button> {p.text}
              {p.fix === 'rebarRate' && (
                <button type="button" className="btn btn--small primary" style={{ marginLeft: 8 }} title="Adds a Rebar rate of 0.25 t per m³ of concrete (change it in Rates) and puts it on the Rebar phase of every object"
                  onClick={() => { setRules(addRebarRate(useScenarioStore.getState().rules)); setNote({ ok: true, text: 'Added the rebar rate REBAR-0.25 (0.25 t per m³) to the Rates and to the Rebar phase of every object. Save, then Update 4D.' }); }}>Fix: add rebar rate 0.25 t/m³</button>
              )}
            </li>
          ))}
        </ul>
      )}
      <RuleList focus={focus} />
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
