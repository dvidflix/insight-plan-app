import { useState, type ReactNode } from 'react';
import { useScenarioStore } from '../../../state/scenarioStore';
import { useScenarioActivities } from '../ScenarioLinksCrews';
import { ContactRowCard, SLABS_ON_BELOW, addContact } from './ContactsEditor';
import { LevelLinkRowCard, addLevelLink } from './GroupsEditors';
import { CrewOverrideRowCard, LinkRowCard, addCrewOverride, addLink } from './ManualRows';
import { EntryKeyContext, FreshEntryContext, useRuleContext } from './RuleParts';
import { RuleList } from './RuleList';
import { SettingRows, resetSettings, settingsSet } from './SettingsEditor';
import type { RuleKind } from './kinds';

/** The Rules tab, by what a rule is for, in plain words, instead of one mixed list with a type on each row: links between activities, crews on a phase,
    and the generator's settings (the other build orders are on the Work breakdown tab). Each part says what it does, lists its rules and adds one. (Extra activities and summary bars have their own
    tab. Every rule is still one of the scenario's rules: the old single list, with its tools, is folded at the bottom.) */

/** A rule type is a row: its name, what it is for, and what to do (add one). Its rules, when there are any, are listed under it. */
const Row = ({ id, name, count, help, action, children }: { id: string; name: string; count?: number; help: ReactNode; action?: ReactNode; children?: ReactNode }) => (
  <>
    <tr id={`rules-${id}`} className="rules-table__rule">
      <td className="xl__cell xl__ro rules-table__name">{name}{count ? <span className="scn-chip"> {count}</span> : null}</td>
      <td className="xl__cell xl__ro rules-table__help">{help}</td>
      <td className="xl__cell xl__ro rules-table__action">{action}</td>
    </tr>
    {children && <tr className="rules-table__rows"><td colSpan={3}>{children}</td></tr>}
  </>
);


export function RulesPage() {
  const ctx = useRuleContext();
  const { rules } = ctx;
  const relations = useScenarioStore((s) => s.relations);
  const crews = useScenarioStore((s) => s.crews);
  const crewOptions = useScenarioStore((s) => !!s.crewOptions);
  const { byCode } = useScenarioActivities();
  const [fresh, setFresh] = useState<string | null>(null);
  const keyed = (key: string, node: ReactNode) => <EntryKeyContext.Provider key={key} value={key}>{node}</EntryKeyContext.Provider>;

  return (
    <div className="rules-page gen-pad">
      <datalist id="scn-activity-codes">{[...byCode.keys()].sort().map((c) => <option key={c} value={c}>{byCode.get(c)}</option>)}</datalist>
      <FreshEntryContext.Provider value={fresh}>
        <table className="xl rules-table">
          <colgroup><col style={{ width: 190 }} /><col /><col style={{ width: 300 }} /></colgroup>
          <thead><tr><th>Rule</th><th>Instructions</th><th>Action</th></tr></thead>
          <tbody>
            <Row id="links" name="Manual link" count={relations.length}
              help="Tie one activity to another when the order the generator gives is not what you want. It replaces the generated links into the later activity. With none, the generator links the activities itself, in the order of your work breakdown."
              action={<button type="button" className="btn btn--small primary" onClick={() => { setFresh(`link:${relations.length}`); addLink(); }}>+ Manual link</button>}>
              {relations.length > 0 ? relations.map((_, i) => keyed(`link:${i}`, <LinkRowCard i={i} byCode={byCode} />)) : null}
            </Row>
            <Row id="contacts" name="Contact link" count={rules.contacts.length}
              help="Links made from the objects that touch each other (found by clash detection), for example slabs waiting for what is below."
              action={<><button type="button" className="btn btn--small primary" onClick={() => { setFresh(`contact:${rules.contacts.length}`); addContact(ctx); }}>+ Contact link</button> <button type="button" className="btn btn--small" onClick={() => { setFresh(`contact:${rules.contacts.length}`); addContact(ctx, SLABS_ON_BELOW); }} title="Slabs wait for everything in contact below">Slabs on what is below</button></>}>
              {rules.contacts.length > 0 ? rules.contacts.map((_, i) => keyed(`contact:${i}`, <ContactRowCard ctx={ctx} i={i} />)) : null}
            </Row>
            <Row id="crews" name="Crew override" count={crews.length}
              help="Change how many people of a trade work on a phase (and pour type) of the programme. It replaces the default crew of that phase. With none, every phase has its default crew. The crews and productivity the recipes use are on the Labour tab."
              action={<button type="button" className="btn btn--small primary" disabled={!crewOptions} title={crewOptions ? undefined : 'Open a scenario first'} onClick={() => { setFresh(`crewOverride:${crews.length}`); addCrewOverride(); }}>+ Crew override</button>}>
              {crews.length > 0 ? crews.map((_, i) => keyed(`crewOverride:${i}`, <CrewOverrideRowCard i={i} />)) : null}
            </Row>
            <Row id="settings" name="Generator settings" count={settingsSet(ctx)}
              help="The generator’s own switches and distances, grouped below. A setting changed here is used for this scenario only; the generator’s own value is used for the others."
              action={<button type="button" className="btn btn--small" disabled={settingsSet(ctx) === 0} onClick={() => { if (window.confirm(`Put back the generator's value of the ${settingsSet(ctx)} setting${settingsSet(ctx) === 1 ? '' : 's'} set here?`)) resetSettings(ctx); }}>Reset all</button>} />
            <SettingRows ctx={ctx} />
          </tbody>
        </table>
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
