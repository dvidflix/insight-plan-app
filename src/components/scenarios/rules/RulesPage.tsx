import { useState, type ReactNode } from 'react';
import { useScenarioStore } from '../../../state/scenarioStore';
import { useScenarioActivities } from '../ScenarioLinksCrews';
import { ContactRowCard, SLABS_ON_BELOW, addContact } from './ContactsEditor';
import { LevelLinkRowCard, addLevelLink } from './GroupsEditors';
import { CrewOverrideRowCard, LinkRowCard, addCrewOverride, addLink } from './ManualRows';
import { EntryKeyContext, FreshEntryContext, useRuleContext } from './RuleParts';
import { RuleList } from './RuleList';
import { COMMON_SETTINGS, SettingRow, SettingRows, resetSettings, settingCounts, settingsSet } from './SettingsEditor';
import { SETTINGS_META } from '../../../prs/rules';
import { needsUpdate, updateFourD } from '../../../state/scenarioStore';
import { useScenarioView } from '../../../scenarios/useScenarioView';
import type { RuleKind } from './kinds';

/** The Rules tab, by what a rule is for, in plain words, instead of one mixed list with a type on each row: links between activities, crews on a phase,
    and the generator's settings (the other build orders are on the Work breakdown tab). Each part says what it does, lists its rules and adds one. (Extra activities and summary bars have their own
    tab. Every rule is still one of the scenario's rules: the old single list, with its tools, is folded at the bottom.) */

/** What the tab is in the middle of, in one word, beside the primary action. */
function UpdateBar() {
  const busy = useScenarioStore((s) => s.busy);
  const pending = useScenarioStore((s) => needsUpdate(s));
  const { modelInfo } = useScenarioView();
  const updating = !!busy && /^Updating/.test(String(busy));
  const state = updating ? 'Updating…' : pending ? 'Changes pending' : 'Up to date';
  return (
    <div className="rules-bar">
      <h3 className="gen-sec">Rules</h3>
      <span className={`rules-bar__state${pending && !updating ? ' is-pending' : ''}`} role="status">{state}</span>
      <button type="button" className="btn primary rules-bar__go" disabled={!!busy || !modelInfo?.hasSource} onClick={() => void updateFourD()} title="Make the programme again with these rules (about a second) and play it in 4D. Does not save the scenario."><span aria-hidden="true">⟳</span> Update 4D</button>
    </div>
  );
}

export function RulesPage() {
  const ctx = useRuleContext();
  const { rules } = ctx;
  const relations = useScenarioStore((s) => s.relations);
  const crews = useScenarioStore((s) => s.crews);
  const crewOptions = useScenarioStore((s) => !!s.crewOptions);
  const { byCode } = useScenarioActivities();
  const [fresh, setFresh] = useState<string | null>(null);
  const keyed = (key: string, node: ReactNode) => <EntryKeyContext.Provider key={key} value={key}>{node}</EntryKeyContext.Provider>;
  const common = SETTINGS_META.filter((m) => COMMON_SETTINGS.includes(m.key));
  const rest = settingCounts(ctx, true);
  const setHere = settingsSet(ctx);

  return (
    <div className="rules-page gen-pad">
      <datalist id="scn-activity-codes">{[...byCode.keys()].sort().map((c) => <option key={c} value={c}>{byCode.get(c)}</option>)}</datalist>
      <UpdateBar />
      <FreshEntryContext.Provider value={fresh}>
        <section className="rules-sec" id="rules-common">
          <h4 className="gen-sec2">Common adjustments</h4>
          <div className="rules-adds">
            <button type="button" className="btn" onClick={() => { setFresh(`link:${relations.length}`); addLink(); }} title="Tie one activity to another when the order the generator gives is not what you want. It replaces the generated links into the later activity">+ Manual link{relations.length ? ` (${relations.length})` : ''}</button>
            <button type="button" className="btn" onClick={() => { setFresh(`contact:${rules.contacts.length}`); addContact(ctx); }} title="Links made from the objects that touch each other (found by clash detection)">+ Contact link{rules.contacts.length ? ` (${rules.contacts.length})` : ''}</button>
            <button type="button" className="btn" disabled={!crewOptions} onClick={() => { setFresh(`crewOverride:${crews.length}`); addCrewOverride(); }} title={crewOptions ? 'Change how many people of a trade work on a phase. The crews the recipes use are on the Labour tab' : 'Open a scenario first'}>+ Crew override{crews.length ? ` (${crews.length})` : ''}</button>
            <button type="button" className="btn btn--small" onClick={() => { setFresh(`contact:${rules.contacts.length}`); addContact(ctx, SLABS_ON_BELOW); }} title="Slabs wait for everything in contact below">Slabs on what is below</button>
          </div>
          <table className="xl rules-table">
            <colgroup><col /><col style={{ width: 300 }} /></colgroup>
            <tbody>{common.map((m) => <SettingRow key={m.key} ctx={ctx} m={m} />)}</tbody>
          </table>
        </section>

        {relations.length > 0 && <section className="rules-sec"><h4 className="gen-sec2">Manual links <span className="scn-chip">{relations.length}</span></h4>{relations.map((_, i) => keyed(`link:${i}`, <LinkRowCard i={i} byCode={byCode} />))}</section>}
        {rules.contacts.length > 0 && <section className="rules-sec"><h4 className="gen-sec2">Contact links <span className="scn-chip">{rules.contacts.length}</span></h4>{rules.contacts.map((_, i) => keyed(`contact:${i}`, <ContactRowCard ctx={ctx} i={i} />))}</section>}
        {crews.length > 0 && <section className="rules-sec"><h4 className="gen-sec2">Crew overrides <span className="scn-chip">{crews.length}</span></h4>{crews.map((_, i) => keyed(`crewOverride:${i}`, <CrewOverrideRowCard i={i} />))}</section>}

        <details className="rules-all rules-advanced">
          <summary title="The generator's other switches and distances. A setting changed here is used for this scenario only; the generator's own value is used for the others">
            Advanced generator settings ({rest.total} settings{rest.changed ? <>, <b className="rules-advanced__changed">{rest.changed} changed</b></> : ', none changed'})
          </summary>
          <div className="rel-bar"><button type="button" className="btn btn--small" disabled={setHere === 0} onClick={() => { if (window.confirm(`Put back the generator's value of the ${setHere} setting${setHere === 1 ? '' : 's'} set here?`)) resetSettings(ctx); }}>Reset all settings</button></div>
          <table className="xl rules-table">
            <colgroup><col /><col style={{ width: 300 }} /></colgroup>
            <tbody><SettingRows ctx={ctx} /></tbody>
          </table>
        </details>
      </FreshEntryContext.Provider>

      <details className="rules-all">
        <summary title="Replace a group in every rule at once, and retire old rules left over from a preset">Tools: replace a group, retire old rules</summary>
        <RuleList focus={null} only={ONLY} storeKey="scenarios.rulesPageKinds" />
      </details>
    </div>
  );
}

// (Every rule is a row of the table above, so the folded list holds only its tools.)
const ONLY: RuleKind[] = [];

/** Level links (on the Extras tab, under the summary bars): extra activities tied to the summary bars of their own building and level. */
export function LevelLinksSection() {
  const ctx = useRuleContext();
  const [fresh, setFresh] = useState<string | null>(null);
  const links = ctx.rules.levelLinks;
  const none = ctx.rules.levelTasks.length === 0;
  return (
    <section className="rules-sec" id="rules-levellinks">
      <div className="rules-sec__head">
        <h3 className="gen-sec">Level links</h3>
        <div className="rules-sec__add"><button type="button" className="btn btn--small primary" disabled={none} title={none ? 'Add a summary bar first' : undefined} onClick={() => { setFresh(`levelLink:${links.length}`); addLevelLink(ctx); }}>+ Level link</button></div>
      </div>
      <div className="scn-dim seq__explain"><p>Tie activities to the summary bar of their own building and level, for example extra activities that finish with their level.</p></div>
      <FreshEntryContext.Provider value={fresh}>
        {links.length === 0 ? <div className="scn-dim scn-editor__help">None yet.</div> : links.map((_, i) => <EntryKeyContext.Provider key={i} value={`levelLink:${i}`}><LevelLinkRowCard ctx={ctx} i={i} /></EntryKeyContext.Provider>)}
      </FreshEntryContext.Provider>
    </section>
  );
}
