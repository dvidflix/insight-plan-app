import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useScenarioStore } from '../../src/state/scenarioStore';
import { normalizeRules } from '../../src/prs/rules';
import { fromSheet } from '../../src/scenarios/pourOrder';
import { ContactRowCard } from '../../src/components/scenarios/rules/ContactsEditor';
import { LevelLinkRowCard, LevelTaskRowCard, RuleGroupRowCard, SequenceRowCard } from '../../src/components/scenarios/rules/GroupsEditors';
import { SettingsRowCard } from '../../src/components/scenarios/rules/SettingsEditor';
import { CrewOverrideRowCard, ExtrasTableCard, LinkRowCard } from '../../src/components/scenarios/rules/ManualRows';
import { ScenarioRulesEditor } from '../../src/components/scenarios/ScenarioRules';
import { EntryKeyContext, FreshEntryContext } from '../../src/components/scenarios/rules/RuleParts';
import { SETTINGS_META } from '../../src/prs/rules';
import { useRuleContext } from '../../src/components/scenarios/rules/RuleParts';

/** Every editor of the Rules panel renders (server side, no browser) with rules in the store and a scenario loaded: this catches a
    component that reads something that is not there. */

const headers = ['Index', 'Pour ID', 'Level', 'Pour Type', 'Concrete Stage', 'Pour Volume m3', 'GUID', 'Building', 'Building Zone'];
const sheet = [
  ['', 'R0', 'L0', 'RAFT', '1', '90', 'R0', 'HVL', ''],
  ['', 'W1', 'L1', 'WALL', '1', '10', 'W1', 'HVL', 'DISCONNECTED'],
  ['', 'S1', 'L1', 'SLAB', '1', '30', 'S1', 'HVL', ''],
];

const rules = normalizeRules({
  version: 1,
  settings: { openEndMaxDistanceM: 0.9, levelGate: false },
  durations: [{ id: 'D1', when: { family: 'wall', levelFrom: 'L0', levelTo: 'L2' }, phases: { Rebar: 9 } }],
  productivity: [{ id: 'P1', when: { group: 'SLABS' }, phase: 'Rebar', basis: 'rebar', manhoursPerUnit: 85, crew: 8, shifts: 2, hoursPerShift: 9.17, rounding: 'ceil', minDays: 1 }],
  rebar: [{ id: 'B1', when: { family: 'raft' }, tonnesPerM3: 0.4 }],
  crews: [{ id: 'C1', when: { group: 'SLABS' }, phase: 'Rebar', trades: [{ trade: 'SF', size: 12 }] }],
  groups: [{ id: 'WALLS', forEach: ['building', 'level'], select: { family: 'wall' } }, { id: 'SLABS', forEach: ['building', 'level'], select: { family: 'slab' } }, { id: 'BIG', forEach: [], treatAs: 'exclude', filters: [{ id: 'c1', field: 'volume', op: 'atLeast', value: '50', conj: 'and' }] }],
  levelTasks: [{ id: 'WALLS', name: 'Walls', group: 'WALLS' }],
  sequences: [{ id: 'UP', steps: [{ group: 'WALLS', perLevel: true }, { group: 'SLABS', perLevel: true }] }],
  contacts: [{ id: 'K1', subject: { family: 'slab' }, contact: 'below', with: {}, predEnd: 'final', succEnd: 'start', replaceBuiltIn: ['slabSupport'] }],
  levelLinks: [{ id: 'LL', activities: 'extras', tasks: ['WALLS'], type: 'FF' }],
  extraTags: { 'HLP-1': { building: 'HVL', level: 'L1' } },
});

/** Server rendering reads a store's initial state, so the state is written there too. */
function put(patch: Partial<ReturnType<typeof useScenarioStore.getState>>) {
  useScenarioStore.setState(patch);
  Object.assign(useScenarioStore.getInitialState(), patch);
}

function load() {
  const order = fromSheet(headers, sheet);
  put({
    scenario: 'S1',
    loaded: { root: 'x', scenario: 'S1', stem: 'HVL', headers, baseStep: new Map() },
    rows: order.rows,
    rules,
    savedRules: rules,
    extras: [{ TaskID: 'HLP-1', Name: 'Level 1 done', DurationDays: 0, BaselineStart: '', BaselineFinish: '2029-01-01' }],
    crewOptions: { trades: [{ code: 'SF', name: 'Steel fixers', capacity: 24 }], phases: ['Rebar', 'Concrete'], defaultCrews: [{ key: 'Rebar', crews: [['SF', 6]] }] },
    engineDefaults: {
      settings: { levelGate: true, openEndMaxDistanceM: 0.3, excludedPourTypes: ['BOSS', 'SCREED'], minPourVolumeM3: 0.25, levelGateMaxDistanceM: 0.05 },
      pourTypes: ['RAFT', 'SLAB', 'WALL'],
    },
  });
}

/** A row card, opened as the one just added would be. */
function open(card: (ctx: ReturnType<typeof useRuleContext>) => ReturnType<typeof createElement>) {
  function Row() {
    return card(useRuleContext());
  }
  return renderToStaticMarkup(createElement(FreshEntryContext.Provider, { value: 'k' }, createElement(EntryKeyContext.Provider, { value: 'k' }, createElement(Row))));
}

describe('the Rules list', () => {
  it('lists the rules by what they are for, with the single list folded below', () => {
    load();
    const html = renderToStaticMarkup(createElement(ScenarioRulesEditor));
    // The common adjustments come first, with the primary action; the other settings are folded away with a count.
    for (const label of ['Common adjustments', 'Update 4D', '+ Manual link', '+ Contact link', '+ Crew override', 'Steps overlap', 'Level gate', 'Advanced generator settings', 'Tools: replace a group']) {
      expect(html).toContain(label);
    }
    expect(html.indexOf('Common adjustments')).toBeLessThan(html.indexOf('Advanced generator settings'));
    expect(html).not.toContain('Extra activities'); // they have a tab of their own
    expect(html).toContain('Reset all settings');
  });

  it('opens each type of rule to its own editor', () => {
    load();
    const none = new Map<string, string>();
    expect(open((ctx) => createElement(RuleGroupRowCard, { ctx, i: 0 }))).toContain('Made per');
    expect(open((ctx) => createElement(LevelTaskRowCard, { ctx, i: 0 }))).toContain('1 task: one for each building and level');
    expect(open((ctx) => createElement(SequenceRowCard, { ctx, i: 0 }))).toContain('WALLS L1 → SLABS L1');
    const group = open((ctx) => createElement(RuleGroupRowCard, { ctx, i: 2 }));
    expect(group).toContain('are left out of the schedule'); // what the objects of a group are treated as
    expect(group).toContain('+ condition'); // the conditions, listed as a 4D group lists them
    expect(group).toContain('Field');
    expect(open((ctx) => createElement(ContactRowCard, { ctx, i: 0 }))).toContain('Objects in contact');
    expect(open((ctx) => createElement(LevelLinkRowCard, { ctx, i: 0 }))).toContain('To the summary bars');
    const extras = open((ctx) => createElement(ExtrasTableCard, { ctx, byCode: none }));
    expect(extras).toContain('Baseline finish'); // one table for all the extra activities
    expect(extras).toContain('Paste from Excel');
    expect(extras).toContain('HLP-1');
    const settings = open((ctx) => createElement(SettingsRowCard, { ctx }));
    expect(settings).toContain('Level gate'); // every setting is in the one table ...
    expect(settings).toContain('Level gate');
    expect(settings).toContain('role="switch"'); // on / off settings are switches
    expect(settings).toContain(`2 of ${SETTINGS_META.length} set here`);
  });

  it('shows a rule closed until it is opened', () => {
    load();
    function Row() {
      return createElement(SequenceRowCard, { ctx: useRuleContext(), i: 0 });
    }
    const html = renderToStaticMarkup(createElement(Row));
    expect(html).toContain('WALLS/level → SLABS/level');
    expect(html).not.toContain('+ step');
  });

  it('renders with nothing loaded and no rules', () => {
    put({ loaded: null, rows: [], rules: normalizeRules(undefined), savedRules: normalizeRules(undefined), engineDefaults: null, crewOptions: null, extras: [] });
    expect(() => renderToStaticMarkup(createElement(ScenarioRulesEditor))).not.toThrow();
    expect(renderToStaticMarkup(createElement(ScenarioRulesEditor))).toContain('Manual link');
  });

  it('opens manual links and crew overrides', () => {
    load();
    put({ relations: [{ ActivityID1: 'A', ActivityID2: 'B', Relation: 'FS', Lag: 8 }], crews: [{ Phase: 'Rebar', PourType: 'SLAB', Trade: 'SF', Crew: '8' }] });
    const wrap = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(FreshEntryContext.Provider, { value: 'k' }, createElement(EntryKeyContext.Provider, { value: 'k' }, el)));
    expect(wrap(createElement(LinkRowCard, { i: 0, byCode: new Map() }))).toContain('A → B');
    expect(wrap(createElement(CrewOverrideRowCard, { i: 0 }))).toContain('People');
  });
});
