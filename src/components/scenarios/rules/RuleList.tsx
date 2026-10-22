import { useEffect, useMemo, useState } from 'react';
import { ListConfig } from '../../ListConfig';
import { configFocusProps } from '../../../state/listConfigStore';
import { useListQuery, useTableSearchStore } from '../../../state/tableSearchStore';
import { setCrews, setExtras, setRelations, setRules, useScenarioStore } from '../../../state/scenarioStore';
import { SETTINGS_META } from '../../../prs/rules';
import { groupNamesUsed, replaceGroupName, retireSuperseded } from '../../../prs/replaceGroup';
import { IconSectionChevron } from '../../icons';
import { useSearchSetsStore } from '../../../state/searchSetsStore';
import { useRecipeFolderStore } from '../../../state/recipeFolderStore';
import { useScenarioActivities } from '../ScenarioLinksCrews';
import { SuggestedGroups } from '../SuggestedGroups';
import { LevelLinkRowCard, LevelTaskRowCard, RuleGroupRowCard, SequenceRowCard, addStarterScope, addGroup, addLevelLink, addLevelTask, addSequence, addStarterLevelTasks } from './GroupsEditors';
import { ContactRowCard, SLABS_ON_BELOW, addContact } from './ContactsEditor';
import { SettingsRowCard } from './SettingsEditor';
import { AssignmentsTableCard, ChainsTableCard, CrewsTableCard, RatesTableCard, TradesTableCard } from './RelationalTables';
import { CalendarImport, CalendarRowCard, addCalendar } from './CalendarsEditor';
import { CrewOverrideRowCard, ExtrasTableCard, LinkRowCard, addCrewOverride, addExtra, addLink } from './ManualRows';
import { EntryKeyContext, FreshEntryContext, useRuleContext } from './RuleParts';
import { KINDS, KIND_BY_ID, KIND_ORDER, type RuleKind } from './kinds';

/** The Rules list: every rule of the scenario in one list, each with its type. The chips filter by type, the search looks in the rules'
    own words, "Add rule" starts one from a type, and a row opens to the editor of its type. Rates, groups, sequences, links, crews and
    settings are all rules of one list, in the order the generator applies them within a type (a tie between two rules goes to the
    earlier one). */

interface Entry {
  kind: RuleKind;
  /** Index in its own list (a setting: its position in the settings list). */
  i: number;
  key: string;
  text: string;
  settingKey?: string;
}

const loadKinds = (storeKey: string): Set<RuleKind> => {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey) ?? '[]') as string[];
    return new Set(v.filter((k): k is RuleKind => k in KIND_BY_ID));
  } catch {
    return new Set();
  }
};

const text = (v: unknown) => JSON.stringify(v ?? '').toLowerCase();

/** Whether the rules give any phase its days: a Duration or Productivity row, or an assignment with days or a rate. */
const hasDurations = (r: ReturnType<typeof useRuleContext>['rules']) =>
  r.assignments.some((a) => a.enabled !== false && (a.days !== undefined || !!a.rate)) || r.recipes.some((x) => x.enabled !== false && x.tasks.some((t) => t.days !== undefined || !!t.rate));

export function RuleList({ focus, only, storeKey = 'scenarios.rulesKinds' }: { focus: { kind: RuleKind; id: string; n: number } | null; only?: RuleKind[]; storeKey?: string }) {
  const ctx = useRuleContext();
  const { rules } = ctx;
  const extras = useScenarioStore((s) => s.extras);
  const relations = useScenarioStore((s) => s.relations);
  const crews = useScenarioStore((s) => s.crews);
  const { source, byCode } = useScenarioActivities();
  const [kinds, setKindsState] = useState<Set<RuleKind>>(() => loadKinds(storeKey));
  // The main header's search box narrows this list while it is the active one.
  const q = useListQuery('rules');
  const setQ = (v: string) => useTableSearchStore.getState().setListQuery('rules', v);
  const [picker, setPicker] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [tools, setTools] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [swapFrom, setSwapFrom] = useState('');
  const [swapTo, setSwapTo] = useState('');
  const [settingsPinned, setSettingsPinned] = useState(false);
  const [extrasPinned, setExtrasPinned] = useState(false);
  const [converted, setConverted] = useState<string | null>(null);
  const [tablesPinned, setTablesPinned] = useState<Set<RuleKind>>(new Set());

  const setKinds = (next: Set<RuleKind>) => {
    setKindsState(next);
    try { localStorage.setItem(storeKey, JSON.stringify([...next])); } catch { /* not remembered */ }
  };
  useEffect(() => {
    if (!focus) return;
    setKinds(new Set([focus.kind]));
    setQ(focus.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.n]);

  const allSets = useSearchSetsStore((s) => s.sets);
  const recipeFolder = useRecipeFolderStore((f) => f.folder);
  const setNames = useMemo(() => new Set(allSets.filter((s) => s.group === recipeFolder).map((s) => s.name.toUpperCase())), [allSets, recipeFolder]);
  const retire = useMemo(() => retireSuperseded(rules, [...setNames]), [rules, setNames]);
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    const push = (kind: RuleKind, rows: unknown[]) => rows.forEach((row, i) => out.push({ kind, i, key: `${kind}:${i}`, text: text(row) }));
    if (extras.length || extrasPinned) out.push({ kind: 'extra', i: 0, key: 'extra:all', text: `extra activities ${text(extras)}`.toLowerCase() });
    push('link', relations);
    push('crewOverride', crews);
    if (rules.chains.length || tablesPinned.has('chainTable')) out.push({ kind: 'chainTable', i: 0, key: 'chainTable:all', text: `chains ${text(rules.chains)}`.toLowerCase() });
    if (rules.assignments.length || tablesPinned.has('assignmentTable')) out.push({ kind: 'assignmentTable', i: 0, key: 'assignmentTable:all', text: `assignments ${text(rules.assignments)}`.toLowerCase() });
    if (rules.rates.length || tablesPinned.has('rateTable')) out.push({ kind: 'rateTable', i: 0, key: 'rateTable:all', text: `rates ${text(rules.rates)}`.toLowerCase() });
    if (rules.crewTemplates.length || tablesPinned.has('crewTable')) out.push({ kind: 'crewTable', i: 0, key: 'crewTable:all', text: `crews ${text(rules.crewTemplates)}`.toLowerCase() });
    if (rules.trades.length || tablesPinned.has('tradeTable')) out.push({ kind: 'tradeTable', i: 0, key: 'tradeTable:all', text: `trades ${text(rules.trades)}`.toLowerCase() });
    push('calendar', rules.calendars);
    // All the settings are one rule: it is there once any is set here (or it has been added).
    if (settingsPinned || SETTINGS_META.some((m) => rules.settings[m.key] !== undefined)) {
      out.push({ kind: 'setting', i: 0, key: 'setting:all', text: `settings ${SETTINGS_META.map((m) => `${m.key} ${m.label} ${m.group}`).join(' ')} ${text(rules.settings)}`.toLowerCase() });
    }
    // A group that is a set of the "Recipes sets" folder is edited there (Models > Search sets): only the others are listed.
    rules.groups.forEach((g, i) => { if (!setNames.has(g.id.toUpperCase())) out.push({ kind: 'group', i, key: `group:${i}`, text: text(g) }); });
    push('levelTask', rules.levelTasks);
    push('sequence', rules.sequences);
    push('levelLink', rules.levelLinks);
    push('contact', rules.contacts);
    return out.filter((e) => !only || only.includes(e.kind)).sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || a.i - b.i);
  }, [rules, extras, relations, crews, settingsPinned, extrasPinned, tablesPinned, only, setNames]);

  const counts = useMemo(() => {
    const c = new Map<RuleKind, number>();
    for (const e of entries) c.set(e.kind, (c.get(e.kind) ?? 0) + 1);
    return c;
  }, [entries]);

  const needle = q.trim().toLowerCase();
  const shown = entries.filter((e) => (kinds.size === 0 || kinds.has(e.kind)) && (!needle || e.text.includes(needle) || KIND_BY_ID[e.kind].label.toLowerCase().includes(needle)));

  const unavailable = (kind: RuleKind): string | null => {
    const needs = KIND_BY_ID[kind].needs;
    if (needs === 'groups' && rules.groups.length === 0) return 'Add a group first';
    if (needs === 'levelTasks' && rules.levelTasks.length === 0) return 'Add a level task first';
    if (needs === 'calendars' && rules.calendars.length === 0) return 'Add a calendar first';
    if (kind === 'crewOverride') return useScenarioStore.getState().crewOptions ? null : 'Load a scenario first';
    return null;
  };

  /** Starts a rule of this type, opens it, and makes sure the filter shows it. */
  const start = (kind: RuleKind) => {
    const n = counts.get(kind) ?? 0;
    switch (kind) {
      case 'extra': setExtrasPinned(true); if (!extras.length) addExtra(); break;
      case 'link': addLink(); break;
      case 'crewOverride': addCrewOverride(); break;
      case 'chainTable': case 'assignmentTable': case 'rateTable': case 'crewTable': case 'tradeTable': setTablesPinned(new Set([...tablesPinned, kind])); break;
      case 'calendar': addCalendar(ctx); break;
      case 'setting': setSettingsPinned(true); break;
      case 'group': addGroup(ctx); break;
      case 'levelTask': addLevelTask(ctx); break;
      case 'sequence': addSequence(ctx); break;
      case 'levelLink': addLevelLink(ctx); break;
      case 'contact': addContact(ctx); break;
    }
    setFresh(kind === 'setting' ? 'setting:all' : kind === 'extra' ? 'extra:all' : kind === 'chainTable' || kind === 'assignmentTable' || kind === 'rateTable' || kind === 'crewTable' || kind === 'tradeTable' ? `${kind}:all` : `${kind}:${n}`);
    if (kinds.size && !kinds.has(kind)) setKinds(new Set([...kinds, kind]));
    setQ('');
    setPicker(false);
  };

  const row = (e: Entry) => {
    switch (e.kind) {
      case 'extra': return <ExtrasTableCard ctx={ctx} byCode={byCode} />;
      case 'link': return <LinkRowCard i={e.i} byCode={byCode} />;
      case 'crewOverride': return <CrewOverrideRowCard i={e.i} />;
      case 'chainTable': return <ChainsTableCard ctx={ctx} />;
      case 'assignmentTable': return <AssignmentsTableCard ctx={ctx} />;
      case 'rateTable': return <RatesTableCard ctx={ctx} />;
      case 'crewTable': return <CrewsTableCard ctx={ctx} />;
      case 'tradeTable': return <TradesTableCard ctx={ctx} />;
      case 'calendar': return <CalendarRowCard ctx={ctx} i={e.i} />;
      case 'setting': return <SettingsRowCard ctx={ctx} />;
      case 'group': return <RuleGroupRowCard ctx={ctx} i={e.i} />;
      case 'levelTask': return <LevelTaskRowCard ctx={ctx} i={e.i} />;
      case 'sequence': return <SequenceRowCard ctx={ctx} i={e.i} />;
      case 'levelLink': return <LevelLinkRowCard ctx={ctx} i={e.i} />;
      case 'contact': return <ContactRowCard ctx={ctx} i={e.i} />;
    }
  };

  const toggleKind = (k: RuleKind) => {
    const next = new Set(kinds);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setKinds(next);
  };
  const offered = KINDS.filter((k) => k.id !== 'group' && (!only || only.includes(k.id)));
  const chips = offered.filter((k) => counts.get(k.id) || kinds.has(k.id));
  const hasGroups = !only || only.includes('group');

  return (
    <div className="rule-list-panel" {...configFocusProps('rules')}>
      <ListConfig id="rules" label="Rules" searchable panels={{}} />
      <div className="rule-toolbar">
        <button type="button" className={`btn${picker ? '' : ' primary'}`} aria-expanded={picker} onClick={() => setPicker(!picker)}>{picker ? 'Close' : '+ Add rule'}</button>
        <button type="button" className="btn" aria-expanded={swapping} onClick={() => setSwapping(!swapping)} title="Change the group a rule names (a step, a limit, a level task ...) to another, in every rule at once">Replace group…</button>
      </div>
      {swapping && (
        <div className="rule-legacy" role="group" aria-label="Replace a group">
          <span>Every rule that names</span>
          <input className="rel-cell" list="rule-groups-used" value={swapFrom} onChange={(e) => setSwapFrom(e.target.value)} placeholder="old group (SLABS)" aria-label="Old group" />
          <span>names</span>
          <input className="rel-cell" list="rule-groups-sets" value={swapTo} onChange={(e) => setSwapTo(e.target.value)} placeholder="new group, or A|B for several (Main Slab)" aria-label="New group" />
          <datalist id="rule-groups-used">{groupNamesUsed(rules).map((n) => <option key={n} value={n} />)}</datalist>
          <datalist id="rule-groups-sets">{[...new Set(allSets.map((x) => x.name))].map((n) => <option key={n} value={n} />)}</datalist>
          <button
            type="button" className="btn btn--small primary" disabled={!swapFrom.trim() || !swapTo.trim()}
            onClick={() => {
              const done = replaceGroupName(useScenarioStore.getState().rules, swapFrom, swapTo);
              if (done.count) setRules(done.rules);
              setConverted(done.count ? `${swapFrom.trim()} is now ${swapTo.trim()} in ${done.count} place${done.count === 1 ? '' : 's'}. Save the scenario, then Update 4D.` : `No rule names “${swapFrom.trim()}”.`);
              if (done.count) { setSwapFrom(''); setSwapTo(''); }
            }}
          >Replace</button>
        </div>
      )}

      {(retire.groups.length > 0 || retire.rows > 0) && (
        <details className="rule-legacy" role="status">
          <summary>Old rules left over from a preset: {retire.rows} row{retire.rows === 1 ? '' : 's'}, {retire.groups.length} group{retire.groups.length === 1 ? '' : 's'} (nothing uses them)</summary>
          <span>{retire.groups.length} rule group{retire.groups.length === 1 ? ' is' : 's are'} not a search set and nothing names {retire.groups.length === 1 ? 'it' : 'them'}, and {retire.rows} old chain / assignment row{retire.rows === 1 ? '' : 's'} {retire.rows === 1 ? 'is' : 'are'} replaced by the recipes. They are left over from a preset.</span>
            <button
              type="button" className="btn btn--small"
              title={`Take out what the recipes replaced: ${retire.rows} chain / assignment row${retire.rows === 1 ? '' : 's'} (the generator already ignores them) and the rule groups nothing names: ${retire.groups.join(', ') || 'none'}`}
              onClick={() => {
                if (!window.confirm(`Retire what the recipes replaced?

• ${retire.rows} chain / assignment rows (the Chains and Assignments tables; the generator already uses the recipes instead)
• ${retire.groups.length} rule group${retire.groups.length === 1 ? '' : 's'} that no rule or recipe names:
${retire.groups.join(', ') || '—'}

The search sets stay. Switching the recipes off later would not bring these back.`)) return;
                setRules(retire.rules);
                setConverted(`Retired ${retire.rows} old rows and ${retire.groups.length} unused group${retire.groups.length === 1 ? '' : 's'}. Save the scenario.`);
              }}
            >Retire old rules ({retire.rows} rows, {retire.groups.length} groups)</button>
        </details>
      )}
      {converted && <div className="rule-legacy rule-legacy--done" role="status">{converted}</div>}

      {picker && (
        <div className="rule-picker" role="menu" aria-label="Add a rule">
          {offered.map((k) => {
            const why = unavailable(k.id);
            return (
              <div key={k.id} className={`rule-picker__item rule-picker__item--${k.family}${why ? ' is-off' : ''}`}>
                {(
                  <button type="button" role="menuitem" disabled={!!why} onClick={() => start(k.id)} title={why ?? undefined}>
                    <span className="rule-picker__name">{k.label}</span>
                    <span className="rule-picker__tip">{why ?? k.tip}</span>
                  </button>
                )}
                {k.id === 'calendar' && <CalendarImport ctx={ctx} onDone={() => { setKinds(new Set([...kinds, 'calendar'])); setPicker(false); }} />}
                {k.id === 'group' && <button type="button" className="mini-btn" onClick={() => { addStarterScope(ctx); setPicker(false); }} title="Groups for the types not scheduled, the objects under 0.25 m³ and the stair steps">scope: not scheduled, small, steps</button>}
                
                {k.id === 'levelTask' && rules.groups.some((g) => g.forEach.includes('level')) && <button type="button" className="mini-btn" onClick={() => { addStarterLevelTasks(ctx); setPicker(false); }} title="One for each group made per level">one per group</button>}
                {k.id === 'contact' && <button type="button" className="mini-btn" onClick={() => { addContact(ctx, SLABS_ON_BELOW); setFresh(`contact:${counts.get('contact') ?? 0}`); setPicker(false); }} title="Slabs wait for everything in contact below">slabs on what is below</button>}
              </div>
            );
          })}
        </div>
      )}

      <div className="rule-kinds" role="group" aria-label="Filter by type">
        <button type="button" className={`rule-kind-chip${kinds.size === 0 ? ' is-on' : ''}`} onClick={() => setKinds(new Set())}>All {entries.length}</button>
        {chips.map((k) => (
          <button key={k.id} type="button" className={`rule-kind-chip rule-kind-chip--${k.family}${kinds.has(k.id) ? ' is-on' : ''}`} title={k.tip} aria-pressed={kinds.has(k.id)} onClick={() => toggleKind(k.id)}>
            {k.label} {counts.get(k.id) ?? 0}
          </button>
        ))}
      </div>

      <datalist id="scn-activity-codes">{[...byCode.keys()].sort().map((c) => <option key={c} value={c}>{byCode.get(c)}</option>)}</datalist>
      <datalist id="rule-extra-buildings">{ctx.buildings.map((b) => <option key={b} value={b} />)}</datalist>
      <datalist id="rule-extra-levels">{ctx.levels.map((l) => <option key={l} value={l} />)}</datalist>

      <FreshEntryContext.Provider value={fresh}>
        <div className="rule-rows">
          {entries.length === 0 && (
            <div className="scn-dim rule-empty">
              No rules: every phase takes 1 day and there is no rebar quantity. Add rules above (groups, rates, crews ...), give the Recipes their days, or load a preset (1HDAB_TOC holds this project's as rules).
            </div>
          )}
          {entries.length > 0 && shown.length === 0 && <div className="scn-dim rule-empty">No rule matches.{' '}<button type="button" className="link-btn" onClick={() => { setQ(''); setKinds(new Set()); }}>Show all</button></div>}
          {shown.map((e) => (
            <EntryKeyContext.Provider key={e.key} value={e.key}>
              {row(e)}
            </EntryKeyContext.Provider>
          ))}
        </div>
      </FreshEntryContext.Provider>

      {hasGroups && <div className="rule-footer">
        <button type="button" className="rule-footer__toggle" aria-expanded={tools} onClick={() => setTools(!tools)}>
          <IconSectionChevron className="section-chevron" />
          Generator defaults and tools
        </button>
        {tools && (
          <div className="scn-editor">
            <div className="scn-dim scn-editor__help">What the generator uses where no rule fits. Customise starts a rule from a default so you can change it.</div>
            <SuggestedGroups source={source} />
          </div>
        )}
      </div>}
    </div>
  );
}
