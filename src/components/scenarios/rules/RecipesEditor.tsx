import { useResizableWidth } from '../../ResizeHandle';
import { useEffect, useMemo, useRef, useState, useContext } from 'react';
import { createPortal } from 'react-dom';
import { updateFourD, useScenarioStore } from '../../../state/scenarioStore';
import { useScenarioView } from '../../../scenarios/useScenarioView';
import { setRecipes, useRecipeStore } from '../../../state/recipeStore';
import { ACTIVITY_PHASES, COMPONENT_PHASES, POOL_KINDS } from '../../../prs/rules';
import { applyTasksPaste, edgesFromFollows, followsText, normalizeRecipes, parseTasksPaste, tasksToTsv, type Recipe, type RecipeTask } from '../../../prs/recipes';
import { duplicateSets } from '../../../prs/groupSets';
import { useRecipeFolderStore } from '../../../state/recipeFolderStore';
import { recipeNeeds } from '../../../prs/recipeNeeds';
import { usePersistedState } from '../../../utils/persistedState';
import { useSearchSetsStore } from '../../../state/searchSetsStore';
import { useSelectionStore } from '../../../state/selectionStore';
import { useViewerEngine } from '../../../viewer/ViewerEngineContext';
import { useIndexTick } from '../../modelFields';
import { countIds, runSearchSet } from '../../../viewer/searchSets';
import { isInFolder } from '../../../viewer/setTree';
import { recipeFolderChoices } from '../../../prs/recipeInheritance';
import type { ScenarioRules } from '../../../prs/rules';
import { downloadBlob } from '../../../utils/download';
import { IconCopy, IconEye, IconEyeOff, IconDelete, IconRemove } from '../../icons';
import { useEditableGrid } from '../../useEditableGrid';
import { RuleCard, useRuleContext } from './RuleParts';
import { RecipeBarSlot, RecipeGraph } from './RecipeGraph';
import { TaskResources } from './TaskResources';
import { ResourceLink, StepsUsing } from './StepRecipes';
import { RecipeFolderList } from './RecipeFolderList';
import { formulaProblem } from '../../../prs/recipesWorkbook';
import { RecipeGrid } from './RecipeGrid';
import { ScenarioRulesEditor } from '../ScenarioRules';
import { RecipesFromProperty } from './RecipesFromProperty';
import { templateFor } from '../../../prs/recipeMatch';
import { ListConfig } from '../../ListConfig';
import { configFocusProps } from '../../../state/listConfigStore';
import { groupFromSet } from '../../../prs/groupSets';
import { RecipeWorkbookButtons } from './RecipeWorkbookButtons';
import { useListQuery } from '../../../state/tableSearchStore';

/** The Recipes panel: how each kind of object is built (docs/design/recipes.md). A recipe belongs to a rule group and lists its tasks (the
    activities of the object, in order), with the days, rate, crew and calendar of each and what each task follows. The recipes are the
    library of state/recipeStore: they show without a scenario open, and an open scenario carries a copy. A recipes file (Export / Import)
    carries them to another project. Names (groups, rates, crews, calendars) are checked against the open scenario's rules only. */

const AUTO_START = '__best_match__';
const num = (v: string): number | undefined => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

function Cell({ value, onChange, list, width, type = 'text', placeholder, title }: { value: string | number | undefined; onChange: (v: string) => void; list?: string; width?: number; type?: 'text' | 'number'; placeholder?: string; title?: string }) {
  return <input className="rel-cell" type={type} step="any" value={value ?? ''} list={list} placeholder={placeholder} title={title} spellCheck={false} style={width ? { width } : undefined} onChange={(e) => onChange(e.target.value)} />;
}

/** The group a recipe is for: a plain select. The places a group comes from are listed apart, each under its own heading: the search sets of every
    folder (Models > Search sets) and the rule groups of the scenario (Rules > Groups). An unknown value already there stays in the list. */
function GroupSelect({ value, groups, setFolders, ruleGroups, hideRuleGroups, onChange, width }: { value: string; /** Only the search sets are offered (a rule group an old preset left is not): the sets are what feeds a recipe. */ hideRuleGroups?: boolean; groups?: string[]; /** The search sets by folder (any folder: a recipe is linked to a set by its name). */ setFolders?: { folder: string; names: string[] }[]; ruleGroups?: string[]; onChange: (v: string) => void; width?: number }) {
  const has = (list: string[]) => list.some((g) => g.toUpperCase() === value.trim().toUpperCase());
  const uniq = (list: string[]) => [...new Set(list.filter(Boolean))];
  const flat = uniq(groups ?? []);
  const setList = uniq((setFolders ?? []).flatMap((f) => f.names));
  const ruleList = uniq(ruleGroups ?? []).filter((g) => !setList.some((x) => x.toUpperCase() === g.toUpperCase()));
  const folders = recipeFolderChoices((setFolders ?? []).filter((f) => f.names.length > 0).map((f) => ({ group: f.folder })));
  const known = has(flat) || has(setList) || has(ruleList) || has(folders);
  return (
    <select className="rel-cell" value={value} style={width ? { width } : undefined} onChange={(e) => onChange(e.target.value)} aria-label="Applies to" title="The objects the recipe applies to: a search set, or a rule group of the scenario">
      <option value="">Every object</option>
      {value && !known && <option value={value}>{value} (not found)</option>}
      {value && hideRuleGroups && !has(setList) && has(ruleList) && <option value={value}>{value} (an old rule group, not a search set)</option>}
      {flat.map((g) => <option key={g} value={g}>{g}</option>)}
      {(setFolders ?? []).filter((f) => f.names.length > 0).map((f) => <optgroup key={f.folder} label={`Search sets · folder "${f.folder}"`}>{f.names.map((g) => <option key={`${f.folder}|${g}`} value={g}>{g}</option>)}</optgroup>)}
      {folders.length > 0 && <optgroup label="Search set folders · every set inside that has no recipe of its own">{folders.map((g) => <option key={`folder|${g}`} value={g}>{g}</option>)}</optgroup>}
      {ruleList.length > 0 && !hideRuleGroups && <optgroup label="Rule groups · this scenario">{ruleList.map((g) => <option key={g} value={g}>{g}</option>)}</optgroup>}
    </select>
  );
}

/** A value picked from a list (an unknown value already there stays, so nothing is lost). */
function PickCell({ value, options, none, onChange, width }: { value: string | undefined; options: (string | { value: string; label: string })[]; none: string; onChange: (v: string) => void; width?: number }) {
  return (
    <select className="rel-cell" value={value ?? none} style={width ? { width } : undefined} onChange={(e) => onChange(e.target.value)}>
      <option value={none}>{none || '—'}</option>
      {value && !options.some((o) => (typeof o === 'string' ? o : o.value).toUpperCase() === value.toUpperCase()) && <option value={value}>{value}</option>}
      {options.map((o) => { const v = typeof o === 'string' ? o : o.value; return <option key={v} value={v}>{typeof o === 'string' ? o : o.label}</option>; })}
    </select>
  );
}

/** What follows is edited as text ("Decking@80, Under Slab") and turned into edges when the cell is left. */
function FollowsCell({ recipe, phase, onChange }: { recipe: Recipe; phase: string; onChange: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="rel-cell" style={{ width: 190 }} spellCheck={false} list="recipe-phases" placeholder="the task before"
      title='What the task waits for: "Decking@80, Under Slab" = 80 % of Decking done (it starts that far into it) and Under Slab finished. Empty: the task before it, finished.'
      value={draft ?? followsText(recipe, phase)} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null) onChange(draft); setDraft(null); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function RecipeCard({ recipe, recipes, rules, check, onChange, onDelete, onCopy, collapsed, onCollapsed, bare, setNames = [] }: { bare?: boolean; /** The names of the search sets of the recipes folder: they are groups too. */ setNames?: string[]; recipe: Recipe; recipes: Recipe[]; rules: ScenarioRules; check: boolean; onChange: (r: Recipe) => void; onDelete: () => void; onCopy: () => void; collapsed: boolean; onCollapsed: (c: boolean) => void }) {
  const chain = recipe.chain !== false;
  const barSlot = useContext(RecipeBarSlot);
  const [view, setView] = useState<'list' | 'table' | 'graph'>('list');
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [full]);
  // The main header's search box narrows the tasks while the Recipes list is the active one.
  const filter = useListQuery('recipes');
  const [paste, setPaste] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const known = {
    groups: new Set([...rules.groups.map((g) => g.id), ...setNames].map((g) => g.toUpperCase())),
    rates: new Set(rules.rates.map((r) => r.id.toUpperCase())),
    crews: new Set(rules.crewTemplates.map((r) => r.id.toUpperCase())),
    calendars: new Set(rules.calendars.map((r) => r.id.toUpperCase())),
    pools: new Set(rules.resourcePools.map((p) => `${p.kind}|${p.id.toUpperCase()}`)),
  };
  const problems: string[] = [];
  if (check && recipe.group.trim() && !known.groups.has(recipe.group.trim().toUpperCase())) problems.push(`The group "${recipe.group}" does not exist`);
  const seen = new Set<string>();
  for (const t of recipe.tasks) {
    const key = t.phase.trim().toUpperCase();
    if (key && seen.has(key)) problems.push(`The task "${t.phase}" is there twice`);
    seen.add(key);
    if (!key && chain) problems.push('A task needs a phase');
    if (check && t.rate && !known.rates.has(t.rate.trim().toUpperCase())) problems.push(`The rate "${t.rate}" does not exist`);
    if (check && t.density && !known.rates.has(t.density.trim().toUpperCase())) problems.push(`The rebar rate "${t.density}" does not exist`);
    if (check && t.crew && !known.crews.has(t.crew.trim().toUpperCase())) problems.push(`The crew "${t.crew}" does not exist`);
    for (const [list, kind] of [[t.equipment, 'equipment'], [t.cranes, 'crane'], [t.materials, 'material']] as const) {
      for (const u of list ?? []) if (!known.pools.has(`${kind}|${u.type.trim().toUpperCase()}`)) problems.push(`The ${kind} "${u.type}" has no pool (Resources above): it gets no resource`);
    }
    if (check && t.calendar && known.calendars.size && !known.calendars.has(t.calendar.trim().toUpperCase())) problems.push(`The calendar "${t.calendar}" does not exist`);
  }
  for (const t of recipe.tasks) {
    for (const l of t.links ?? []) {
      const target = recipes.find((r) => r.id.trim().toUpperCase() === l.recipe.trim().toUpperCase());
      if (!target) problems.push(`"${t.phase}" is linked to the recipe "${l.recipe}", which does not exist`);
      else if (!target.tasks.some((x) => x.phase.trim().toUpperCase() === l.phase.trim().toUpperCase())) problems.push(`"${t.phase}" is linked to "${l.phase}", which is not a task of ${target.id}`);
    }
  }
  for (const e of recipe.edges ?? []) if (!seen.has(e.from.trim().toUpperCase())) problems.push(`"${e.to}" follows "${e.from}", which is not a task of this recipe`);
  const sameGroup = recipes.filter((r) => r !== recipe && r.enabled !== false && r.chain !== false && chain && r.group.trim().toUpperCase() === recipe.group.trim().toUpperCase());
  if (sameGroup.length) problems.push(`${sameGroup.length} other recipe${sameGroup.length === 1 ? '' : 's'} of this group also define activities: the one of the highest priority is used`);

  const formulaTip = (f: string | undefined) => (f ? formulaProblem(f, (rules.parameters ?? []).map((p) => p.name)) || 'Working days from quantities and parameters' : 'Working days from quantities and parameters');
  const setTask = (i: number, patch: Partial<RecipeTask>) => onChange({ ...recipe, tasks: recipe.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  /** Renaming a phase renames it in the links of the other tasks too. */
  const rename = (i: number, phase: string) => {
    const old = recipe.tasks[i].phase;
    onChange({
      ...recipe,
      tasks: recipe.tasks.map((t, j) => (j === i ? { ...t, phase } : t)),
      edges: (recipe.edges ?? []).map((e) => ({ ...e, from: e.from === old ? phase : e.from, to: e.to === old ? phase : e.to })),
    });
  };
  const follow = (i: number, text: string) => {
    const phase = recipe.tasks[i].phase;
    const edges = [...(recipe.edges ?? []).filter((e) => e.to.trim().toUpperCase() !== phase.trim().toUpperCase()), ...edgesFromFollows(text, phase)];
    onChange({ ...recipe, edges: edges.length ? edges : undefined });
  };
  /** Drag a row by its number to where it should go (it lands before the row it is dropped on). */
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);
  const drop = (to: number) => {
    if (!drag || drag.from === to || drag.from + 1 === to) return setDrag(null);
    const tasks = [...recipe.tasks];
    const [moved] = tasks.splice(drag.from, 1);
    tasks.splice(to > drag.from ? to - 1 : to, 0, moved);
    onChange({ ...recipe, tasks });
    setSelected(to > drag.from ? to - 1 : to);
    setDrag(null);
  };
  const remove = (i: number) => {
    const phase = recipe.tasks[i].phase;
    onChange({ ...recipe, tasks: recipe.tasks.filter((_, j) => j !== i), edges: (recipe.edges ?? []).filter((e) => e.from !== phase && e.to !== phase) });
  };
  const q = filter.trim().toLowerCase();
  const shown = recipe.tasks.map((t, i) => ({ t, i })).filter(({ t }) => !q || JSON.stringify(t).toLowerCase().includes(q));
  // The columns typed in as a spreadsheet's: range, fill down (Ctrl+D, the corner square), copy and paste. One change for all the cells.
  const FILL: Record<string, { field: keyof RecipeTask; numeric?: boolean }> = {
    name: { field: 'name' }, suffix: { field: 'suffix' }, material: { field: 'material' }, days: { field: 'days', numeric: true }, rate: { field: 'rate' },
    density: { field: 'density' }, formula: { field: 'formula' }, crew: { field: 'crew' }, calendar: { field: 'calendar' }, priority: { field: 'priority', numeric: true },
  };
  const grid = useEditableGrid({ widthsKey: 'recipe.tasks',
    rows: shown,
    get: (col, { t }) => { const f = FILL[col]; const v = f ? t[f.field] : undefined; return v === undefined || v === null ? '' : String(v); },
    write: (col, cells) => {
      const f = FILL[col];
      if (!f) return;
      const to = new Map(cells.map(([at, text]) => [shown[at].i, text]));
      onChange({ ...recipe, tasks: recipe.tasks.map((t, j) => { const v = to.get(j); return v === undefined ? t : { ...t, [f.field]: f.numeric ? num(v) : v === '' ? undefined : v }; }) });
    },
  });
  const counts = new Map<string, number>();
  for (const t of recipe.tasks) counts.set(t.phase.trim().toUpperCase(), (counts.get(t.phase.trim().toUpperCase()) ?? 0) + 1);
  /** What is wrong with one task (shown on its row). */
  const rowProblems = (t: RecipeTask): string[] => {
    const out: string[] = [];
    const key = t.phase.trim().toUpperCase();
    if (!key && chain) out.push('A task needs a phase');
    if (key && (counts.get(key) ?? 0) > 1) out.push('The same phase is used twice');
    if (check && t.rate && !known.rates.has(t.rate.trim().toUpperCase())) out.push(`The rate "${t.rate}" does not exist`);
    if (check && t.density && !known.rates.has(t.density.trim().toUpperCase())) out.push(`The rebar rate "${t.density}" does not exist`);
    if (check && t.crew && !known.crews.has(t.crew.trim().toUpperCase())) out.push(`The crew "${t.crew}" does not exist`);
    if (check && t.calendar && known.calendars.size && !known.calendars.has(t.calendar.trim().toUpperCase())) out.push(`The calendar "${t.calendar}" does not exist`);
    for (const [list, kind] of [[t.equipment, 'equipment'], [t.cranes, 'crane'], [t.materials, 'material']] as const) {
      for (const u of list ?? []) if (!known.pools.has(`${kind}|${u.type.trim().toUpperCase()}`)) out.push(`The ${kind} "${u.type}" has no pool: it gets no resource`);
    }
    return out;
  };
  const copyTasks = async () => {
    try {
      await navigator.clipboard.writeText(tasksToTsv(recipe));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setPaste(tasksToTsv(recipe)); // no clipboard: the text is shown to copy by hand
    }
  };
  const applyPaste = (replaceAll: boolean) => {
    const pasted = parseTasksPaste(paste ?? '');
    if (pasted.tasks.length) onChange(applyTasksPaste(recipe, pasted, replaceAll));
    setPaste(null);
  };
  const flag = (i: number, key: 'finishAfter' | 'gates', title: string) => <input type="checkbox" checked={!!recipe.tasks[i][key]} onChange={(e) => setTask(i, { [key]: e.target.checked || undefined })} aria-label={title} title={title} />;

  const viewTabs = chain ? (
    <>
          <span className="scn-rules__file" role="group" aria-label="View">
            <button type="button" className={`btn btn--small${view === 'list' ? ' primary' : ''}`} onClick={() => setView('list')}>Tasks</button>
            <button type="button" className={`btn btn--small${view === 'graph' ? ' primary' : ''}`} onClick={() => setView('graph')} title="The tasks as boxes and arrows">Graph</button>
          </span>
          <details className="scn-more">
            <summary className="btn btn--small" title="Priority, what the recipe does, every column of the tasks">Advanced</summary>
            <div className="scn-more__menu scn-more__menu--wide">
              <label className="scn-dim">Priority <Cell type="number" value={recipe.priority} onChange={(v) => onChange({ ...recipe, priority: num(v) })} width={60} title="Where an object is in several recipes, the highest priority decides" /></label>
              <select className="rel-cell" value={chain ? 'chain' : 'values'} onChange={(e) => onChange({ ...recipe, chain: e.target.value === 'chain' ? undefined : false })} title="Activities: the tasks are the activities the objects get. Values only: it sets the days, rate, crew and calendar of tasks whose activities come from another recipe.">
                <option value="chain">Defines the activities</option>
                <option value="values">Sets values only</option>
              </select>
              <button type="button" className={`btn btn--small${view === 'table' ? ' primary' : ''}`} onClick={() => setView(view === 'table' ? 'list' : 'table')}>All columns</button>
            </div>
          </details>
    </>
  ) : null;
  return (
    <RuleCard
      id={recipe.id}
      onId={(id) => onChange({ ...recipe, id })}
      enabled={recipe.enabled !== false}
      onEnabled={(on) => onChange({ ...recipe, enabled: on ? undefined : false })}
      onCopy={onCopy}
      onDelete={onDelete}
      problem={problems.length ? problems.join('\n') : null}
      collapsed={bare ? false : collapsed}
      onCollapsed={onCollapsed}
      hideHead={bare}
    >
      {/* The view buttons sit in the top row of the Recipes tab (beside Make recipes) in every view; inline only where there is no such row. */}
      {chain && view !== 'graph' && (barSlot ? createPortal(viewTabs, barSlot) : <div className="rel-bar">{viewTabs}</div>)}
      {chain && view === 'list' ? (
        <>
          <table className="xl xgrid xl--tasks" {...grid.grid}>
            <colgroup><col style={{ width: 40 }} /><col style={{ width: 180 }} /><col style={{ width: 170 }} /><col style={{ width: 70 }} /><col style={{ width: 280 }} /><col style={{ width: 130 }} /><col style={{ width: 220 }} /><col style={{ width: 32 }} /></colgroup>
            <thead><tr>
              <th className="xl__corner" aria-label="Row" /><th>Activity</th>
              <th title='What it waits for: "Rebar" (finished), "Decking@80" (80 % done), "Rebar:SS+16" (starts 16 hours after Rebar starts). Empty: the activity above.'>Follows</th>
              <th title="A fixed number of working days">Days</th>
              <th title="Or a formula of the pour's quantities and the parameters, e.g. max(1, Concrete_m3 / Concrete_Rate). It beats the days.">Formula</th>
              <th>Crew</th><th>Resources</th><th aria-label="Delete" />
            </tr></thead>
            <tbody>
              {shown.map(({ t, i }, at) => (
                <tr key={i} data-line={at} className={`${t.enabled === false ? 'is-off' : ''}${selected === i ? ' is-selected' : ''}${drag && drag.over === i && drag.from !== i && drag.from + 1 !== i ? ' is-drop' : ''}`} onClick={() => setSelected(i)}
                  onDragOver={(e) => { if (!drag) return; e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }); }} onDrop={(e) => { e.preventDefault(); drop(i); }}>
                  <th scope="row" className="xl__row rel-grip" draggable title="Drag to move the task"
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); const row = e.currentTarget.closest('tr'); if (row) e.dataTransfer.setDragImage(row, 0, 0); setDrag({ from: i, over: null }); }}
                    onDragEnd={() => setDrag(null)}>{i + 1}</th>
                  <td className="xl__cell"><input list="recipe-phases" value={t.name ?? t.phase} spellCheck={false} onChange={(e) => rename(i, e.target.value)} /></td>
                  <td className="xl__cell"><input value={followsText(recipe, t.phase)} spellCheck={false} onChange={(e) => follow(i, e.target.value)} placeholder={i === 0 ? '' : recipe.tasks[i - 1]?.phase} title='What it waits for: "Rebar", "Decking@80", "Rebar:SS+16"' /></td>
                  <td className={`xl__cell xl__num xgrid__cell${grid.sel('days', at)}`} data-col="days" data-row={at}><input {...grid.cell('days', at)} type="text" inputMode="decimal" value={t.days ?? ''} onChange={(e) => setTask(i, { days: num(e.target.value) })} />{grid.handle('days', at)}</td>
                  <td className={`xl__cell xgrid__cell${grid.sel('formula', at)}`} data-col="formula" data-row={at}><input {...grid.cell('formula', at)} value={t.formula ?? ''} spellCheck={false} placeholder="Rebar_kg / Rebar_Rate" title={formulaTip(t.formula)} onChange={(e) => setTask(i, { formula: e.target.value.trim() === '' ? undefined : e.target.value })} />{grid.handle('formula', at)}</td>
                  <td className={`xl__cell xgrid__cell${grid.sel('crew', at)}`} data-col="crew" data-row={at}><input {...grid.cell('crew', at)} list="recipe-crews" value={t.crew ?? ''} onChange={(e) => setTask(i, { crew: e.target.value || undefined })} />{grid.handle('crew', at)}</td>
                  <td className="xl__cell xl__ro">{[...(t.cranes ?? []), ...(t.equipment ?? []), ...(t.materials ?? [])].map((u, k) => <span key={`${u.type}|${k}`}>{k > 0 && ' · '}<ResourceLink type={u.type} />{(u.count ?? 1) > 1 ? ` ×${u.count}` : ''}</span>)}{!(t.cranes?.length || t.equipment?.length || t.materials?.length) && '—'}</td>
                  <td className="xl__check"><button type="button" className="cols__icon cols__icon--remove" onClick={() => remove(i)} aria-label="Delete task"><IconRemove /></button></td>
                </tr>
              ))}
              <tr className="xl__add"><th className="xl__row">*</th><td colSpan={7}><button type="button" onClick={() => { onChange({ ...recipe, tasks: [...recipe.tasks, { phase: '' }] }); setSelected(recipe.tasks.length); }}>+ Add a task</button></td></tr>
            </tbody>
          </table>
          <datalist id="recipe-crews">{rules.crewTemplates.map((c) => <option key={c.id} value={c.id} />)}</datalist>
          <div className="scn-dim xl__note">Without a Follows, an activity starts when the one above is done. Click an activity to give it cranes, equipment and materials. Drag the number to reorder.</div>
          <StepsUsing recipe={recipe} rules={rules} />
          {selected !== null && recipe.tasks[selected] && <TaskResources task={recipe.tasks[selected]} rules={rules} onPatch={(patch) => setTask(selected, patch)} />}
        </>
      ) : chain && view === 'graph' ? (
        full ? createPortal(
          <div className="rg-full" role="dialog" aria-label={`Recipe ${recipe.id}`}>
            <div className="rg-full__bar"><strong>{recipe.id}</strong><span className="scn-dim">{recipe.group ? `group ${recipe.group}` : 'every object'}</span><button type="button" className="btn btn--small primary" onClick={() => setFull(false)}>Close (Esc)</button></div>
            <div className="rg-full__body"><RecipeGraph recipe={recipe} recipes={recipes} rules={rules} onChange={onChange} onFullscreen={() => setFull(false)} fullscreen /></div>
          </div>, document.body)
        : <RecipeGraph recipe={recipe} recipes={recipes} rules={rules} onChange={onChange} onFullscreen={() => setFull(true)} lead={viewTabs} />
      ) : (
        <>
          <div className="rel-bar">
            <button type="button" className="btn btn--small" onClick={() => onChange({ ...recipe, tasks: [...recipe.tasks, { phase: '' }] })}>+ Task</button>
            <button type="button" className="btn btn--small" onClick={() => void copyTasks()} title="Copy the tasks as text to paste into Excel">{copied ? 'Copied' : 'Copy for Excel'}</button>
            <button type="button" className="btn btn--small" onClick={() => setPaste(paste === null ? '' : null)} title="Paste tasks from Excel (columns as in Copy for Excel)">Paste from Excel</button>
            <span className="scn-dim">{recipe.tasks.length} task{recipe.tasks.length === 1 ? '' : 's'}</span>
          </div>
          {paste !== null && (
            <div className="rel-paste">
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} placeholder="Paste the tasks here (tab separated; a first row of headings is skipped)" spellCheck={false} />
              <div className="rel-bar">
                <button type="button" className="btn btn--small primary" onClick={() => applyPaste(false)} title="A task with the same phase is replaced, new ones are added, the others stay">Add / update</button>
                <button type="button" className="btn btn--small" onClick={() => applyPaste(true)} title="The recipe has exactly the pasted tasks">Replace the tasks</button>
                <button type="button" className="btn btn--small" onClick={() => setPaste(null)}>Cancel</button>
              </div>
            </div>
          )}
          <div className="rel-scroll">
            <table className="rel-table rel-table--grid xgrid" {...grid.grid}>
              <thead>
                <tr className="rel-group">
                  <th colSpan={2} />
                  <th colSpan={chain ? 7 : 1}>{chain ? 'Activity' : 'Task'}</th>
                  <th colSpan={6}>Values</th>
                  <th />
                </tr>
                <tr>
                  <th aria-label="On" />
                  <th>#</th>
                  <th>Phase</th>
                  {chain && <th title="The end of the activity name; empty: the phase">Name</th>}
                  {chain && <th title="The end of the activity ID (-R); empty: the initials of the phase">Suffix</th>}
                  {chain && <th title="Rebar: the pour's rebar tonnes go on the activity. Concrete: its volume.">Material</th>}
                  {chain && <th title='What the task waits for: "Decking@80, Under Slab" = 80 % of Decking done and Under Slab finished. Empty: the task before it.'>Follows</th>}
                  {chain && <th title="With a share below 100 %: the task also cannot finish before what it follows does">Fin. after</th>}
                  {chain && <th title="What follows the object waits for this task, not for its Concrete">Gates</th>}
                  <th>Days</th>
                  <th>Rate</th>
                  <th title="A Rebar rate (tonnes per m³ of concrete)">Rebar rate</th>
                  <th>Crew</th>
                  <th>Calendar</th>
                  <th title="Of the values of this task: a higher number wins">Prio.</th>
                  <th aria-label="Delete" />
                </tr>
              </thead>
              <tbody>
                {shown.map(({ t, i }, at) => {
                  const own = rowProblems(t);
                  return (
                    <tr key={i} data-line={at} className={`${t.enabled === false ? 'is-off' : ''}${own.length ? ' has-problem' : ''}${selected === i ? ' is-selected' : ''}${drag && drag.over === i && drag.from !== i && drag.from + 1 !== i ? ' is-drop' : ''}`} title={own.join('\n') || undefined} onClick={() => setSelected(i)}
                      onDragOver={(e) => { if (!drag) return; e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }); }} onDrop={(e) => { e.preventDefault(); drop(i); }}>
                      <td className="rel-c"><input type="checkbox" checked={t.enabled !== false} onChange={(e) => setTask(i, { enabled: e.target.checked ? undefined : false })} aria-label="Task on" /></td>
                      <td
                        className="scn-dim rel-c rel-grip" draggable title="Drag to move the task"
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); const row = e.currentTarget.closest('tr'); if (row) e.dataTransfer.setDragImage(row, 0, 0); setDrag({ from: i, over: null }); }}
                        onDragEnd={() => setDrag(null)}
                      >{i + 1}</td>
                      <td><Cell value={t.phase} list="recipe-phases" onChange={(v) => rename(i, v)} width={116} /></td>
                      {chain && <td className={`xgrid__cell${grid.sel('name', at)}`} data-col="name" data-row={at}><Cell value={t.name} onChange={(v) => setTask(i, { name: v || undefined })} width={120} />{grid.handle('name', at)}</td>}
                      {chain && <td className={`xgrid__cell${grid.sel('suffix', at)}`} data-col="suffix" data-row={at}><Cell value={t.suffix} onChange={(v) => setTask(i, { suffix: v || undefined })} width={44} />{grid.handle('suffix', at)}</td>}
                      {chain && (
                        <td className={`xgrid__cell${grid.sel('material', at)}`} data-col="material" data-row={at}>
                          <select className="rel-cell" style={{ width: 72 }} value={t.material ?? ''} onChange={(e) => setTask(i, { material: (e.target.value || undefined) as RecipeTask['material'] })}>
                            <option value="">none</option>
                            <option value="rebar">rebar</option>
                            <option value="concrete">concrete</option>
                          </select>
                          {grid.handle('material', at)}
                        </td>
                      )}
                      {chain && <td><FollowsCell recipe={recipe} phase={t.phase} onChange={(text) => follow(i, text)} /></td>}
                      {chain && <td className="rel-c">{flag(i, 'finishAfter', 'Finish after')}</td>}
                      {chain && <td className="rel-c">{flag(i, 'gates', 'Gates what follows')}</td>}
                      <td className={`xgrid__cell${grid.sel('days', at)}`} data-col="days" data-row={at}><Cell type="number" value={t.days} onChange={(v) => setTask(i, { days: num(v) })} width={46} />{grid.handle('days', at)}</td>
                      <td className={`xgrid__cell${grid.sel('rate', at)}`} data-col="rate" data-row={at}><Cell value={t.rate} list="recipe-rates" onChange={(v) => setTask(i, { rate: v || undefined })} width={92} />{grid.handle('rate', at)}</td>
                      <td className={`xgrid__cell${grid.sel('density', at)}`} data-col="density" data-row={at}><Cell value={t.density} list="recipe-rates" onChange={(v) => setTask(i, { density: v || undefined })} width={84} />{grid.handle('density', at)}</td>
                      <td className={`xgrid__cell${grid.sel('crew', at)}`} data-col="crew" data-row={at}><PickCell value={t.crew} options={rules.crewTemplates.map((c) => c.id)} none="" onChange={(v) => setTask(i, { crew: v || undefined })} width={96} />{grid.handle('crew', at)}</td>
                      <td className={`xgrid__cell${grid.sel('calendar', at)}`} data-col="calendar" data-row={at}><PickCell value={t.calendar} options={rules.calendars.map((c) => ({ value: c.id, label: c.name || c.id }))} none="" onChange={(v) => setTask(i, { calendar: v || undefined })} width={72} />{grid.handle('calendar', at)}</td>
                      <td className={`xgrid__cell${grid.sel('priority', at)}`} data-col="priority" data-row={at}><Cell type="number" value={t.priority} onChange={(v) => setTask(i, { priority: num(v) })} width={42} />{grid.handle('priority', at)}</td>
                      <td className="rel-c"><button type="button" className="cols__icon cols__icon--remove" onClick={() => remove(i)} aria-label="Delete task"><IconRemove /></button></td>
                    </tr>
                  );
                })}
                {shown.length === 0 && <tr><td colSpan={15} className="scn-dim">{recipe.tasks.length ? 'No task matches.' : 'No tasks yet: add one, or paste from Excel.'}</td></tr>}
              </tbody>
            </table>
          </div>
          {selected !== null && recipe.tasks[selected] ? <TaskResources task={recipe.tasks[selected]} rules={rules} onPatch={(patch) => setTask(selected, patch)} /> : <div className="scn-dim scn-editor__help">Select a task (click its row) to assign its resources.</div>}
        </>
      )}
    </RuleCard>
  );
}

/** What a recipe needs, at a glance: days, the most people at once, and the cranes, equipment and materials it names. */
function NeedsLine({ recipe, rules, lead, inStatus }: { recipe: Recipe; rules: ScenarioRules; lead?: string; inStatus?: boolean }) {
  const n = recipeNeeds(recipe, rules);
  // With one recipe the line goes to the status bar (when the page has one), else it stays here.
  const [statusEl, setStatusEl] = useState<HTMLElement | null>(null);
  useEffect(() => { setStatusEl(inStatus ? document.getElementById('scn-statusbar-needs') ?? document.getElementById('rec-statusbar-needs') : null); }, [inStatus]);
  const chip = (label: string, items: { type: string; count: number }[]) => items.length > 0 && (
    <span className="scn-chip" title={label}>{label}: {items.map((u) => (u.count > 1 ? `${u.type} ×${u.count}` : u.type)).join(', ')}</span>
  );
  const line = (
    <div className="rel-bar" aria-label="What the recipe needs">
      {lead && <span className="scn-dim rec-sub">{lead}</span>}
      <span className="scn-chip" title="The days of the tasks added up (tasks that run side by side are counted too)">{n.days} day{n.days === 1 ? '' : 's'} of work</span>
      {n.people > 0 && <span className="scn-chip" title="The most people one task needs at once (from its crew)">up to {n.people} people</span>}
      {chip('Cranes', n.cranes)}
      {chip('Equipment', n.equipment)}
      {chip('Materials', n.materials)}
      {n.crews.length > 0 && <span className="scn-chip" title="Crews named by the tasks">Crews: {n.crews.join(', ')}</span>}
      {n.days === 0 && n.people === 0 && !n.cranes.length && !n.equipment.length && !n.materials.length && <span className="scn-dim">Nothing assigned yet: give the tasks days, a crew or resources.</span>}
    </div>
  );
  return statusEl ? createPortal(line, statusEl) : line;
}

const NO_PHASES: never[] = [];

export function RecipesEditor() {
  // The recipe list's width: drag its right edge; remembered.
  const listWidth = useResizableWidth('recipes.listWidth', 280, 200, 640);
  const ctx = useRuleContext();
  const recipes = useRecipeStore((st) => st.recipes);
  const pools = useRecipeStore((st) => st.pools);
  const scenarioOpen = useScenarioStore((st) => !!st.loaded);
  const phases = useScenarioStore((st) => st.crewOptions?.phases) ?? NO_PHASES;
  // The scenario's rules (groups, rates, crews, calendars) with the library's recipes and pools.
  const rules = useMemo<ScenarioRules>(() => ({ ...ctx.rules, recipes, resourcePools: pools }), [ctx.rules, recipes, pools]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const { modelInfo } = useScenarioView();
  const busy = useScenarioStore((st) => st.busy);
  const canUpdate = scenarioOpen && !!modelInfo?.hasSource && !busy;
  const fileRef = useRef<HTMLInputElement>(null);
  // The recipes folded (by their place in the list), for the "collapse all" button.
  const [folded, setFolded] = useState<Set<number>>(new Set());
  const set = setRecipes;
  // One recipe at a time: pick a set of the "Recipes sets" folder (or a group a recipe names) and see its recipe.
  const [picked, setPicked] = usePersistedState<string>('recipes.pick', '');
  const allSets = useSearchSetsStore((st) => st.sets);
  const recipeSetsFolder = useRecipeFolderStore((f) => f.folder);
  const setRecipeFolder = useRecipeFolderStore((f) => f.setFolder);
  const folderNames = useMemo(() => [...new Set([recipeSetsFolder, ...allSets.map((x) => x.group ?? '').filter(Boolean)])].sort((a, b) => a.localeCompare(b)), [allSets, recipeSetsFolder]);
  const folderSets = useMemo(() => allSets.filter((x) => x.group === recipeSetsFolder), [allSets, recipeSetsFolder]);
  // A recipe is linked to a search set by name, whatever folder the set is in: the sets of the recipes folder, and any set a recipe names.
  const usableSets = useMemo(() => {
    const named = new Set(recipes.map((r) => r.group.trim().toUpperCase()).filter(Boolean));
    // The set you made (in another folder) comes before a copy of the same name in the recipes folder: the copy only hides it.
    const elsewhere = new Set(allSets.filter((x) => x.kind !== 'selection' && x.group !== recipeSetsFolder).map((x) => x.name.trim().toUpperCase()));
    const own = folderSets.filter((x) => !elsewhere.has(x.name.trim().toUpperCase()));
    const have = new Set(own.map((x) => x.name.trim().toUpperCase()));
    return [...own, ...allSets.filter((x) => x.kind !== 'selection' && x.group !== recipeSetsFolder && (named.has(x.name.trim().toUpperCase()) || folderSets.some((f) => f.name.trim().toUpperCase() === x.name.trim().toUpperCase())) && !have.has(x.name.trim().toUpperCase()))];
  }, [allSets, folderSets, recipes, recipeSetsFolder]);
  // Every search set to choose from, by folder.
  const setFolders = useMemo(() => {
    const by = new Map<string, string[]>();
    for (const x of allSets) if (x.kind !== 'selection') by.set(x.group ?? '', [...(by.get(x.group ?? '') ?? []), x.name]);
    return [...by.entries()].sort(([a], [b]) => (a === recipeSetsFolder ? -1 : b === recipeSetsFolder ? 1 : a.localeCompare(b))).map(([folder, list]) => ({ folder, names: list.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) }));
  }, [allSets, recipeSetsFolder]);
  const names = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of recipes) if (!seen.has(r.group.trim().toUpperCase())) seen.set(r.group.trim().toUpperCase(), r.group.trim());
    return [...seen.values()];
  }, [recipes]);
  const nameIndex = Math.max(0, names.findIndex((n) => n.toUpperCase() === picked.toUpperCase()));
  const currentName = names[nameIndex] ?? '';
  const current = usableSets.find((x) => x.name.toUpperCase() === currentName.toUpperCase()) ?? allSets.find((x) => x.name.toUpperCase() === currentName.toUpperCase());
  const step = (by: number) => { if (names.length) setPicked(names[(nameIndex + by + names.length) % names.length]); };
  const sameGroup = (r: Recipe) => r.group.trim().toUpperCase() === currentName.toUpperCase();
  // How many objects each set finds in the loaded models, and the set of the selected object (the panel follows the selection).
  const engine = useViewerEngine();
  const tick = useIndexTick();
  const members = useMemo(() => new Map(usableSets.map((x) => [x.id, runSearchSet(engine.getIndexes(), x)])), [usableSets, engine, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const selection = useSelectionStore((st) => st.byModel);
  useEffect(() => {
    const chosen = Object.entries(selection).filter(([, ids]) => ids.length > 0);
    if (!chosen.length) return;
    const hit = usableSets.find((x) => chosen.some(([model, ids]) => ids.some((id) => members.get(x.id)?.[model]?.includes(id))));
    if (hit && hit.name.toUpperCase() !== currentName.toUpperCase()) setPicked(hit.name);
  }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps
  const phaseList = [...new Set([...COMPONENT_PHASES, ...ACTIVITY_PHASES, ...phases])];

  // What a new recipe starts with: Rebar and Concrete, or a copy of the tasks (and links) of a recipe that is there already, so "every wall" or "every slab" starts from the one that is worked out.
  const [startFrom, setStartFrom] = useState(AUTO_START);
  const starter = (forName = ''): { tasks: RecipeTask[]; edges?: Recipe['edges'] } => {
    const from = startFrom === AUTO_START ? templateFor(forName, recipes) : recipes.find((r) => r.id === startFrom);
    if (!from) return { tasks: [{ phase: 'Rebar', suffix: '-R', name: 'Rebar', material: 'rebar' }, { phase: 'Concrete', suffix: '-C', name: 'Concrete', material: 'concrete' }] };
    return { tasks: from.tasks.map((t) => ({ ...t })), ...(from.edges?.length ? { edges: from.edges.map((e) => ({ ...e })) } : {}) };
  };
  /** A recipe for the objects of a set ('' = every object), picked as the one shown. */
  const add = (group: string) => {
    let n = 1;
    let id = group || 'RECIPE';
    while (recipes.some((r) => r.id.toUpperCase() === id.toUpperCase())) id = `${group || 'RECIPE'}-${++n}`;
    set([...recipes, { id, group, ...starter(group) }]);
    setPicked(group);
  };
  // The sets that can still get a recipe: those of the folder with objects in the loaded models (all of them while no model is loaded).
  const modelLoaded = engine.getIndexes().size > 0;
  const free = folderSets.filter((x) => !recipes.some((r) => r.group.trim().toUpperCase() === x.name.toUpperCase()) && (!modelLoaded || countIds(members.get(x.id) ?? {}) > 0));
  /** A recipe for each set that has none yet, in one go (Rebar and Concrete to start with, as + Recipe gives). */
  const addAll = () => {
    const made: Recipe[] = [];
    for (const x of free) {
      let n = 1;
      let id = x.name || 'RECIPE';
      while ([...recipes, ...made].some((r) => r.id.toUpperCase() === id.toUpperCase())) id = `${x.name}-${++n}`;
      made.push({ id, group: x.name, ...starter(x.name) });
    }
    if (!made.length) return;
    set([...recipes, ...made]);
    setPicked(made[0].group);
    setNote({ ok: true, text: `Made ${made.length} recipe${made.length === 1 ? '' : 's'}, one for each set.` });
  };
  /** A recipe for each of these names (the values of a property), each starting with the tasks of the recipe it looks most like. */
  const makeRecipes = (names: string[]) => {
    const made: Recipe[] = [];
    for (const name of names) {
      let n = 1;
      let id = name || 'RECIPE';
      while ([...recipes, ...made].some((r) => r.id.toUpperCase() === id.toUpperCase())) id = `${name}-${++n}`;
      made.push({ id, group: name, ...starter(name) });
    }
    if (!made.length) return;
    set([...recipes, ...made]);
    setGridView(false);
    setPicked(made[0].group);
    setFromProperty(false);
    setNote({ ok: true, text: `Made ${made.length} recipe${made.length === 1 ? '' : 's'}. Set the days, rate or crew of each below; Copy tasks from gives a row the tasks of another.` });
  };
  // A folder named almost like the recipes' one ("Recipes set"): offered to be renamed, as only the exact name is read.
  const nearFolder = folderSets.length === 0 ? allSets.find((x) => x.group && x.group !== recipeSetsFolder && /^recipes?\s*sets?$/i.test(x.group.trim()))?.group ?? null : null;
  const everyFree = !recipes.some((r) => !r.group.trim());
  const copy = (i: number) => {
    const from = recipes[i];
    let id = `${from.id}-2`;
    for (let n = 3; recipes.some((r) => r.id.toUpperCase() === id.toUpperCase()); n++) id = `${from.id}-${n}`;
    set([...recipes.slice(0, i + 1), { ...from, id, tasks: from.tasks.map((t) => ({ ...t })), edges: from.edges?.map((e) => ({ ...e })) }, ...recipes.slice(i + 1)]);
  };

  /** The sets of the "Recipes sets" folder that no recipe is for. */
  const repeated = new Set(duplicateSets(allSets).map((x) => x.id));
  const unusedSets = folderSets.filter((x) => repeated.has(x.id) || (x.kind !== 'selection' && !recipes.some((r) => r.group.trim().toUpperCase() === x.name.toUpperCase())));
  const removeUnused = () => {
    if (!window.confirm(`Delete ${unusedSets.length} search set${unusedSets.length === 1 ? '' : 's'} of the folder "${recipeSetsFolder}" that no recipe is for?

${unusedSets.map((x) => x.name).join(', ')}`)) return;
    for (const x of unusedSets) useSearchSetsStore.getState().remove(x.id);
    setNote({ ok: true, text: `Deleted ${unusedSets.length} set${unusedSets.length === 1 ? '' : 's'}.` });
  };
  const exportFile = () => {
    downloadBlob('recipes.recipes.json', new Blob([JSON.stringify({ version: 1, recipes }, null, 1)], { type: 'application/json' }));
    setNote({ ok: true, text: `Exported ${recipes.length} recipe${recipes.length === 1 ? '' : 's'}.` });
  };
  const importFile = async (file: File) => {
    try {
      const incoming = normalizeRecipes(JSON.parse(await file.text()));
      if (!incoming.recipes.length) return setNote({ ok: false, text: 'No recipes in that file.' });
      const ids = new Set(incoming.recipes.map((r) => r.id.toUpperCase()));
      set([...recipes.filter((r) => !ids.has(r.id.toUpperCase())), ...incoming.recipes]);
      setNote({ ok: true, text: `Imported ${incoming.recipes.length} recipe${incoming.recipes.length === 1 ? '' : 's'} (a recipe with the same ID was replaced).` });
    } catch {
      setNote({ ok: false, text: 'That file is not a recipes file.' });
    }
  };

  // One table of every recipe (a row each, a column per task), or one recipe at a time with its graph.
  const [gridView, setGridView] = usePersistedState('recipes.matrix', false);
  const [listQuery, setListQuery] = useState('');
  const [fromProperty, setFromProperty] = useState(false);
  const [barSlot, setBarSlot] = useState<HTMLElement | null>(null);
  const mine = recipes.map((r, i) => ({ r, i })).filter(({ r }) => sameGroup(r));
  const objects = current ? countIds(members.get(current.id) ?? {}) : null;
  const label = (n: string) => n || 'Every object';

  return (
    <div className={`scn-recipes${!gridView && names.length > 0 ? ' scn-recipes--browse' : ''}`} style={{ ['--rec-list-w' as string]: `${listWidth.width}px` }} {...configFocusProps('recipes')}>
      <ListConfig id="recipes" label="Recipes" searchable panels={{}} />
      <div className="rel-bar rec-top">
        {!gridView && <>
        {mine.length === 1 && (
          <span className="rec-actions">
            <button type="button" className="cols__icon" onClick={() => set(recipes.map((x, j) => (j === mine[0].i ? { ...x, enabled: x.enabled === false ? undefined : false } : x)))} title={mine[0].r.enabled === false ? 'Off: click to use this recipe' : 'On: click to keep the recipe but not use it'} aria-label="Recipe on or off">
              {mine[0].r.enabled === false ? <IconEyeOff /> : <IconEye />}
            </button>
            <button type="button" className="cols__icon" onClick={() => copy(mine[0].i)} title="Duplicate this recipe" aria-label="Duplicate the recipe"><IconCopy /></button>
            <button type="button" className="cols__icon cols__icon--remove" onClick={() => { if (window.confirm(`Delete the recipe "${mine[0].r.id}"?`)) set(recipes.filter((_, j) => j !== mine[0].i)); }} title="Delete this recipe" aria-label="Delete the recipe"><IconDelete /></button>
          </span>
        )}
        </>}
        <button type="button" className={`btn btn--small${recipes.length ? '' : ' primary'}`} aria-pressed={fromProperty} onClick={() => setFromProperty(!fromProperty)} title="Make a recipe for every value of a property of the objects (the app picks the likeliest property for you)">Make recipes</button>
        <button type="button" className={`btn btn--small${recipes.length ? ' primary' : ''}`} disabled={!canUpdate} onClick={() => void updateFourD()} title={scenarioOpen ? 'Regenerate the programme with these recipes and play it in 4D (the scenario is not saved)' : 'Open a scenario first (Scenarios panel)'}>Update 4D</button>
        <RecipeWorkbookButtons onNote={(n) => setNote({ ok: n.ok, text: n.lines.join(' ') })} />
        <details className="scn-more scn-more--end">
          <summary className="btn btn--small" title="Everything else: one recipe at a time, crews and rates, import / export, clean-up">More</summary>
          <div className="scn-more__menu scn-more__menu--list">
        <details className="scn-more">
          <summary className="btn btn--small" title="A recipe for the objects of a set">+ One recipe</summary>
          <div className="scn-more__menu scn-more__menu--list">
            <label className="scn-dim" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 4px 6px' }} title="The Search sets folder whose sets the recipes are for">
              From folder
              <select className="rel-cell" value={recipeSetsFolder} onChange={(e) => setRecipeFolder(e.target.value)}>
                {folderNames.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </label>
            <label className="scn-dim" style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '2px 4px 6px' }} title="A new recipe starts as a copy of this one's tasks">
              Start from
              <select className="rel-cell" value={startFrom} onChange={(e) => setStartFrom(e.target.value)}>
                <option value="">Rebar + Concrete</option>
                <option value={AUTO_START}>Best match by name</option>
                {recipes.filter((r) => r.chain !== false).map((r) => <option key={r.id} value={r.id}>Copy of {r.id}</option>)}
              </select>
            </label>
            {free.length > 1 && <button type="button" className="btn btn--small primary" onClick={(e) => { addAll(); (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }} title="Make a recipe for every set that has none">All {free.length} sets</button>}
            {free.map((x) => <button key={x.id} type="button" className="btn btn--small" onClick={(e) => { add(x.name); (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}>{x.name}</button>)}
            {everyFree && <button type="button" className="btn btn--small" onClick={(e) => { add(''); (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}>Every object</button>}
            {!free.length && nearFolder && <button type="button" className="btn btn--small" onClick={() => { for (const x of allSets) if (x.group === nearFolder) useSearchSetsStore.getState().save({ ...x, group: recipeSetsFolder }); }} title="The sets are in a folder with a similar name: move them into the one recipes read">Use the folder “{nearFolder}” as “{recipeSetsFolder}”</button>}
            {!free.length && !everyFree && <span className="scn-dim">Every set has a recipe. Make another set in Models &gt; Search sets.</span>}
          </div>
        </details>
        <button type="button" className="btn btn--small" aria-pressed={gridView} onClick={() => setGridView(!gridView)} title="Switch between the one table of every recipe and one recipe at a time with its graph">{gridView ? '← Back to the list' : 'Compare all recipes in one table'}</button>
        <details className="scn-more scn-more--end">
          <summary className="btn btn--small" title="Import or export the recipes as a file">⋯</summary>
          <div className="scn-more__menu">
            <button type="button" className="btn btn--small" onClick={() => fileRef.current?.click()}>Import file</button>
            <button type="button" className="btn btn--small" disabled={!recipes.length} onClick={exportFile}>Export file</button>
            <button type="button" className="btn btn--small" disabled={!recipes.length} onClick={() => { if (window.confirm(`Delete all ${recipes.length} recipes?

A backup file of them is downloaded first (Import file brings them back). The sets in "${recipeSetsFolder}" stay.`)) { exportFile(); set([]); } }} title="Start again: downloads a backup, then removes every recipe">Delete all recipes…</button>
            <button type="button" className="btn btn--small" disabled={!unusedSets.length} onClick={removeUnused} title="Delete the sets of the folder Recipes sets that have no recipe, and the ones that repeat a name">Delete unused sets ({unusedSets.length})</button>
          </div>
        </details>
          </div>
        </details>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
        {/* The graph's tools (view tabs, Connect Task ... zoom) join this row while one recipe shows. */}
        <span ref={setBarSlot} className="rec-top__slot" />
      </div>
      {note && <div className={`scn-rules__note${note.ok ? '' : ' is-error'}`} role="status">{note.text}</div>}
      {(fromProperty || !names.length) && <RecipesFromProperty recipes={recipes} folder={recipeSetsFolder} onMake={makeRecipes} onClose={() => setFromProperty(false)} />}
      {!names.length ? (
        <div className="scn-dim scn-editor__help" style={{ margin: 8 }}>No recipes yet: pick a property above and every value of it becomes a recipe. For a single set use + Recipe.</div>
      ) : gridView ? (
        <RecipeGrid recipes={recipes} rules={rules} onChange={set} objects={new Map(usableSets.map((x) => [x.name.trim().toUpperCase(), countIds(members.get(x.id) ?? {})]))} />
      ) : (
        <div className="rec-browse">
          <aside className="rec-list" aria-label="Recipes">
            <div className="rec-list__grip" onMouseDown={listWidth.startDrag(false)} role="separator" aria-orientation="vertical" aria-label="Drag to change the width of the recipe list" title="Drag to change the width" />
            <input className="rel-cell rec-list__search" type="search" value={listQuery} placeholder="Find a recipe…" onChange={(e) => setListQuery(e.target.value)} spellCheck={false} />
            <div className="rec-list__items">
              <RecipeFolderList
                recipes={recipes}
                onChange={set}
                onPick={setPicked}
                entries={recipes.map((r, i) => ({ r, i })).filter(({ r }) => {
                  const q = listQuery.trim().toLowerCase();
                  return !q || `${r.id} ${r.group} ${r.folder ?? ''} ${r.tasks.map((t) => t.phase).join(' ')}`.toLowerCase().includes(q);
                }).map(({ r, i }) => {
                  const found = usableSets.find((x) => x.name.toUpperCase() === r.group.trim().toUpperCase());
                  return {
                    r, i,
                    count: found ? countIds(members.get(found.id) ?? {}) : null,
                    chainText: r.chain === false ? 'sets values only' : r.tasks.filter((t) => t.enabled !== false).map((t) => t.name || t.phase).join(' → ') || 'no activities yet',
                    undecided: r.chain !== false && r.tasks.length > 0 && !r.tasks.some((t) => t.days !== undefined || t.formula || t.rate || t.crew),
                    on: r.group.trim().toUpperCase() === currentName.toUpperCase(),
                  };
                })}
              />
            </div>
          </aside>
          <div className="rec-detail">
          <RecipeBarSlot.Provider value={mine.length === 1 ? barSlot : null}>
          {mine.map(({ r, i }, k) => (

            <div key={i}>
              <div className="rec-head">
                <input className="rec-head__name" value={r.id} spellCheck={false} aria-label="Recipe name" onChange={(e) => set(recipes.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))} />
                <span className="rec-head__for" title="The search set (or group) whose objects get these activities">
                  for <GroupSelect value={r.group} hideRuleGroups setFolders={setFolders} ruleGroups={rules.groups.map((g) => g.id)} width={200} onChange={(group) => set(recipes.map((x, j) => (j === i ? { ...x, group } : x)))} />
                  {objects !== null && <span className="scn-dim"> · {objects.toLocaleString()} object{objects === 1 ? '' : 's'} in the loaded models</span>}
                </span>
              </div>
              <div className="rec-head__source scn-dim">{(() => {
                const g = r.group.trim().toUpperCase();
                if (!g) return 'Applies to every object that has no recipe of its own.';
                const found = usableSets.find((x) => x.name.trim().toUpperCase() === g);
                const inside = found ? [] : allSets.filter((x) => x.kind !== 'selection' && isInFolder(x.group ?? '', r.group));
                if (inside.length) return `The folder "${r.group}" of search sets: every set inside it (${inside.length}) that has no recipe of its own, or in a folder nearer to it, gets this recipe. A recipe for a set, or for a folder inside this one, wins.`;
                if (found) {
                  // What the generator can test of the set: a condition it cannot read is left out, and a set with none is no group (its recipe is not used).
                  const { group: made, lost } = groupFromSet(found, () => 'x');
                  if (found.kind === 'selection') return `"${r.group}" is a selection set (fixed objects): the generator tests conditions, so this recipe is not used. Make it a search set.`;
                  if (made.filters.length === 0) return `The generator cannot test any condition of the search set "${r.group}" (${lost.join('; ') || 'no conditions'}), so this recipe is not used. Use conditions on a pour column (Building, Level, Type …) or on a model property (a property set and its name).`;
                  if (lost.length) return `The generator cannot test part of the search set "${r.group}" and leaves it out (${lost.join('; ')}), so the recipe may apply to more objects than the set finds.`;
                }
                if (found) return `The objects found by the search set "${r.group}" (folder "${found.group}", made in Models › Search sets).${objects === 0 ? ' It finds no objects in the loaded models: check its conditions there, or load the model it is for.' : ''}`;
                if (rules.groups.some((x) => x.id.trim().toUpperCase() === g)) return `The objects of the rule group "${r.group}" of this scenario (Rules › Groups).`;
                return `There is no search set "${r.group}" in any folder and no rule group of that name, so this recipe is not used. Choose one above, or make the set in Models › Search sets.`;
              })()}</div>
              <NeedsLine recipe={r} rules={rules} inStatus={mine.length === 1} />
              <RecipeCard bare={mine.length === 1} setNames={allSets.map((x) => x.name)} recipe={r} recipes={recipes} rules={rules} check={scenarioOpen} onChange={(next) => set(recipes.map((x, j) => (j === i ? next : x)))} onDelete={() => { if (window.confirm(`Delete the recipe "${r.id}"?`)) set(recipes.filter((_, j) => j !== i)); }} onCopy={() => copy(i)}
                collapsed={folded.has(i)} onCollapsed={(c) => setFolded((prev) => { const next = new Set(prev); if (c) next.add(i); else next.delete(i); return next; })} />
            </div>
          ))}
          </RecipeBarSlot.Provider>
          {!mine.length && <div className="scn-dim scn-editor__help">Pick a recipe on the left.</div>}
          </div>
        </div>
      )}
      <datalist id="recipe-groups">{[...new Set(setFolders.flatMap((f) => f.names))].map((g) => <option key={g} value={g} />)}</datalist>
      <datalist id="recipe-phases">{phaseList.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="recipe-rates">{rules.rates.map((r) => <option key={r.id} value={r.id} />)}</datalist>
      <datalist id="recipe-crews">{rules.crewTemplates.map((r) => <option key={r.id} value={r.id} />)}</datalist>
      {POOL_KINDS.map((k) => <datalist key={k.value} id={`recipe-pool-${k.value}`}>{rules.resourcePools.filter((p) => p.kind === k.value).map((p) => <option key={p.id} value={p.id} />)}</datalist>)}
      <datalist id="recipe-calendars">{rules.calendars.map((r) => <option key={r.id} value={r.id} />)}</datalist>
    </div>
  );
}

