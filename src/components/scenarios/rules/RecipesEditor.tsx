import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScenarioStore } from '../../../state/scenarioStore';
import { setRecipes, useRecipeStore } from '../../../state/recipeStore';
import { ACTIVITY_PHASES, COMPONENT_PHASES, POOL_KINDS } from '../../../prs/rules';
import { applyTasksPaste, edgesFromFollows, followsText, normalizeRecipes, parseTasksPaste, tasksToTsv, usesText, type Recipe, type RecipeTask } from '../../../prs/recipes';
import { RECIPE_SETS_FOLDER, duplicateSets } from '../../../prs/groupSets';
import { recipeNeeds } from '../../../prs/recipeNeeds';
import { usePersistedState } from '../../../utils/persistedState';
import { useSearchSetsStore } from '../../../state/searchSetsStore';
import { useSelectionStore } from '../../../state/selectionStore';
import { useViewerEngine } from '../../../viewer/ViewerEngineContext';
import { useIndexTick } from '../../modelFields';
import { countIds, runSearchSet } from '../../../viewer/searchSets';
import type { ScenarioRules } from '../../../prs/rules';
import { downloadBlob } from '../../../utils/download';
import { IconCopy, IconEye, IconEyeOff, IconDelete, IconRemove } from '../../icons';
import { RuleCard, useRuleContext } from './RuleParts';
import { RecipeGraph } from './RecipeGraph';
import { TaskResources } from './TaskResources';
import { ResourcesScreen } from './ResourcesScreen';

/** The Recipes panel: how each kind of object is built (docs/design/recipes.md). A recipe belongs to a rule group and lists its tasks (the
    activities of the object, in order), with the days, rate, crew and calendar of each and what each task follows. The recipes are the
    library of state/recipeStore: they show without a scenario open, and an open scenario carries a copy. A recipes file (Export / Import)
    carries them to another project. Names (groups, rates, crews, calendars) are checked against the open scenario's rules only. */

const num = (v: string): number | undefined => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

function Cell({ value, onChange, list, width, type = 'text', placeholder, title }: { value: string | number | undefined; onChange: (v: string) => void; list?: string; width?: number; type?: 'text' | 'number'; placeholder?: string; title?: string }) {
  return <input className="rel-cell" type={type} step="any" value={value ?? ''} list={list} placeholder={placeholder} title={title} spellCheck={false} style={width ? { width } : undefined} onChange={(e) => onChange(e.target.value)} />;
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

function RecipeCard({ recipe, recipes, rules, check, onChange, onDelete, onCopy, collapsed, onCollapsed, bare }: { bare?: boolean; recipe: Recipe; recipes: Recipe[]; rules: ScenarioRules; check: boolean; onChange: (r: Recipe) => void; onDelete: () => void; onCopy: () => void; collapsed: boolean; onCollapsed: (c: boolean) => void }) {
  const chain = recipe.chain !== false;
  const [view, setView] = useState<'list' | 'table' | 'graph'>('graph');
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!full) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [full]);
  const [filter, setFilter] = useState('');
  const [paste, setPaste] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const known = {
    groups: new Set(rules.groups.map((g) => g.id.toUpperCase())),
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
            <summary className="btn btn--small" title="Group, priority, every column of the tasks">Advanced</summary>
            <div className="scn-more__menu scn-more__menu--wide">
              <label className="scn-dim">Group <Cell value={recipe.group} list="recipe-groups" onChange={(group) => onChange({ ...recipe, group })} width={150} placeholder="every object" title="The set (or group) whose objects the recipe applies to; empty = every object" /></label>
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
      {chain && view !== 'graph' && <div className="rel-bar">{viewTabs}</div>}
      {chain && view === 'list' ? (
        <>
          <table className="rel-table rel-table--grid rel-table--simple">
            <thead><tr><th>#</th><th>Task</th><th>Days</th><th>Crew</th><th>Resources</th><th aria-label="Delete" /></tr></thead>
            <tbody>
              {recipe.tasks.map((t, i) => (
                <tr key={i} className={`${t.enabled === false ? 'is-off' : ''}${selected === i ? ' is-selected' : ''}${drag && drag.over === i && drag.from !== i && drag.from + 1 !== i ? ' is-drop' : ''}`} onClick={() => setSelected(i)}
                  onDragOver={(e) => { if (!drag) return; e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }); }} onDrop={(e) => { e.preventDefault(); drop(i); }}>
                  <td className="scn-dim rel-c rel-grip" draggable title="Drag to move the task"
                    onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); const row = e.currentTarget.closest('tr'); if (row) e.dataTransfer.setDragImage(row, 0, 0); setDrag({ from: i, over: null }); }}
                    onDragEnd={() => setDrag(null)}>{i + 1}</td>
                  <td><Cell value={t.name ?? t.phase} list="recipe-phases" onChange={(v) => rename(i, v)} width={150} /></td>
                  <td><Cell type="number" value={t.days} onChange={(v) => setTask(i, { days: num(v) })} width={52} /></td>
                  <td><PickCell value={t.crew} options={rules.crewTemplates.map((c) => c.id)} none="" onChange={(v) => setTask(i, { crew: v || undefined })} width={110} /></td>
                  <td className="scn-dim">{[usesText(t.cranes), usesText(t.equipment), usesText(t.materials)].filter(Boolean).join(' · ') || '—'}</td>
                  <td className="rel-c"><button type="button" className="cols__icon cols__icon--remove" onClick={() => remove(i)} aria-label="Delete task"><IconRemove /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="rel-bar"><button type="button" className="btn btn--small" onClick={() => { onChange({ ...recipe, tasks: [...recipe.tasks, { phase: '' }] }); setSelected(recipe.tasks.length); }}>+ Task</button><span className="scn-dim">Each task starts when the one above is done. Click a task to give it resources.</span></div>
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
            <input className="rel-filter" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" aria-label="Filter the tasks" />
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
            <table className="rel-table rel-table--grid">
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
                {shown.map(({ t, i }) => {
                  const own = rowProblems(t);
                  return (
                    <tr key={i} className={`${t.enabled === false ? 'is-off' : ''}${own.length ? ' has-problem' : ''}${selected === i ? ' is-selected' : ''}${drag && drag.over === i && drag.from !== i && drag.from + 1 !== i ? ' is-drop' : ''}`} title={own.join('\n') || undefined} onClick={() => setSelected(i)}
                      onDragOver={(e) => { if (!drag) return; e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }); }} onDrop={(e) => { e.preventDefault(); drop(i); }}>
                      <td className="rel-c"><input type="checkbox" checked={t.enabled !== false} onChange={(e) => setTask(i, { enabled: e.target.checked ? undefined : false })} aria-label="Task on" /></td>
                      <td
                        className="scn-dim rel-c rel-grip" draggable title="Drag to move the task"
                        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); const row = e.currentTarget.closest('tr'); if (row) e.dataTransfer.setDragImage(row, 0, 0); setDrag({ from: i, over: null }); }}
                        onDragEnd={() => setDrag(null)}
                      >{i + 1}</td>
                      <td><Cell value={t.phase} list="recipe-phases" onChange={(v) => rename(i, v)} width={116} /></td>
                      {chain && <td><Cell value={t.name} onChange={(v) => setTask(i, { name: v || undefined })} width={120} /></td>}
                      {chain && <td><Cell value={t.suffix} onChange={(v) => setTask(i, { suffix: v || undefined })} width={44} /></td>}
                      {chain && (
                        <td>
                          <select className="rel-cell" style={{ width: 72 }} value={t.material ?? ''} onChange={(e) => setTask(i, { material: (e.target.value || undefined) as RecipeTask['material'] })}>
                            <option value="">none</option>
                            <option value="rebar">rebar</option>
                            <option value="concrete">concrete</option>
                          </select>
                        </td>
                      )}
                      {chain && <td><FollowsCell recipe={recipe} phase={t.phase} onChange={(text) => follow(i, text)} /></td>}
                      {chain && <td className="rel-c">{flag(i, 'finishAfter', 'Finish after')}</td>}
                      {chain && <td className="rel-c">{flag(i, 'gates', 'Gates what follows')}</td>}
                      <td><Cell type="number" value={t.days} onChange={(v) => setTask(i, { days: num(v) })} width={46} /></td>
                      <td><Cell value={t.rate} list="recipe-rates" onChange={(v) => setTask(i, { rate: v || undefined })} width={92} /></td>
                      <td><Cell value={t.density} list="recipe-rates" onChange={(v) => setTask(i, { density: v || undefined })} width={84} /></td>
                      <td><PickCell value={t.crew} options={rules.crewTemplates.map((c) => c.id)} none="" onChange={(v) => setTask(i, { crew: v || undefined })} width={96} /></td>
                      <td><PickCell value={t.calendar} options={rules.calendars.map((c) => ({ value: c.id, label: c.name || c.id }))} none="" onChange={(v) => setTask(i, { calendar: v || undefined })} width={72} /></td>
                      <td><Cell type="number" value={t.priority} onChange={(v) => setTask(i, { priority: num(v) })} width={42} /></td>
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
function NeedsLine({ recipe, rules, lead }: { recipe: Recipe; rules: ScenarioRules; lead?: string }) {
  const n = recipeNeeds(recipe, rules);
  const chip = (label: string, items: { type: string; count: number }[]) => items.length > 0 && (
    <span className="scn-chip" title={label}>{label}: {items.map((u) => (u.count > 1 ? `${u.type} ×${u.count}` : u.type)).join(', ')}</span>
  );
  return (
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
}

const NO_PHASES: never[] = [];

export function RecipesEditor() {
  const ctx = useRuleContext();
  const recipes = useRecipeStore((st) => st.recipes);
  const pools = useRecipeStore((st) => st.pools);
  const scenarioOpen = useScenarioStore((st) => !!st.loaded);
  const phases = useScenarioStore((st) => st.crewOptions?.phases) ?? NO_PHASES;
  // The scenario's rules (groups, rates, crews, calendars) with the library's recipes and pools.
  const rules = useMemo<ScenarioRules>(() => ({ ...ctx.rules, recipes, resourcePools: pools }), [ctx.rules, recipes, pools]);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // The recipes folded (by their place in the list), for the "collapse all" button.
  const [folded, setFolded] = useState<Set<number>>(new Set());
  const set = setRecipes;
  // One recipe at a time: pick a set of the "Recipes sets" folder (or a group a recipe names) and see its recipe.
  const [picked, setPicked] = usePersistedState<string>('recipes.pick', '');
  const allSets = useSearchSetsStore((st) => st.sets);
  const folderSets = useMemo(() => allSets.filter((x) => x.group === RECIPE_SETS_FOLDER), [allSets]);
  const names = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of recipes) if (!seen.has(r.group.trim().toUpperCase())) seen.set(r.group.trim().toUpperCase(), r.group.trim());
    return [...seen.values()];
  }, [recipes]);
  const nameIndex = Math.max(0, names.findIndex((n) => n.toUpperCase() === picked.toUpperCase()));
  const currentName = names[nameIndex] ?? '';
  const current = folderSets.find((x) => x.name.toUpperCase() === currentName.toUpperCase());
  const step = (by: number) => { if (names.length) setPicked(names[(nameIndex + by + names.length) % names.length]); };
  const sameGroup = (r: Recipe) => r.group.trim().toUpperCase() === currentName.toUpperCase();
  // How many objects each set finds in the loaded models, and the set of the selected object (the panel follows the selection).
  const engine = useViewerEngine();
  const tick = useIndexTick();
  const members = useMemo(() => new Map(folderSets.map((x) => [x.id, runSearchSet(engine.getIndexes(), x)])), [folderSets, engine, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const selection = useSelectionStore((st) => st.byModel);
  useEffect(() => {
    const chosen = Object.entries(selection).filter(([, ids]) => ids.length > 0);
    if (!chosen.length) return;
    const hit = folderSets.find((x) => chosen.some(([model, ids]) => ids.some((id) => members.get(x.id)?.[model]?.includes(id))));
    if (hit && hit.name.toUpperCase() !== currentName.toUpperCase()) setPicked(hit.name);
  }, [selection]); // eslint-disable-line react-hooks/exhaustive-deps
  const phaseList = [...new Set([...COMPONENT_PHASES, ...ACTIVITY_PHASES, ...phases])];

  /** A recipe for the objects of a set ('' = every object), picked as the one shown. */
  const add = (group: string) => {
    let n = 1;
    let id = group || 'RECIPE';
    while (recipes.some((r) => r.id.toUpperCase() === id.toUpperCase())) id = `${group || 'RECIPE'}-${++n}`;
    set([...recipes, { id, group, tasks: [{ phase: 'Rebar', suffix: '-R', name: 'Rebar', material: 'rebar' }, { phase: 'Concrete', suffix: '-C', name: 'Concrete', material: 'concrete' }] }]);
    setPicked(group);
  };
  // The sets that can still get a recipe: those of the folder with objects in the loaded models (all of them while no model is loaded).
  const modelLoaded = engine.getIndexes().size > 0;
  const free = folderSets.filter((x) => !recipes.some((r) => r.group.trim().toUpperCase() === x.name.toUpperCase()) && (!modelLoaded || countIds(members.get(x.id) ?? {}) > 0));
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
    if (!window.confirm(`Delete ${unusedSets.length} search set${unusedSets.length === 1 ? '' : 's'} of the folder "${RECIPE_SETS_FOLDER}" that no recipe is for?

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

  const mine = recipes.map((r, i) => ({ r, i })).filter(({ r }) => sameGroup(r));
  const objects = current ? countIds(members.get(current.id) ?? {}) : null;
  const label = (n: string) => n || 'Every object';

  return (
    <div className="scn-recipes">
      <div className="rel-bar rec-top">
        <button type="button" className="btn btn--small" onClick={() => step(-1)} disabled={names.length < 2} aria-label="Previous" title="Previous recipe">◀</button>
        <select className="rel-cell rec-pick" value={currentName} onChange={(e) => setPicked(e.target.value)} aria-label="Recipe for" disabled={!names.length}>
          {!names.length && <option value="">No recipes yet</option>}
          {names.map((n) => <option key={n} value={n}>{label(n)}</option>)}
        </select>
        <button type="button" className="btn btn--small" onClick={() => step(1)} disabled={names.length < 2} aria-label="Next" title="Next recipe">▶</button>
        {mine.length === 1 && (
          <span className="rec-actions">
            <button type="button" className="cols__icon" onClick={() => set(recipes.map((x, j) => (j === mine[0].i ? { ...x, enabled: x.enabled === false ? undefined : false } : x)))} title={mine[0].r.enabled === false ? 'Off: click to use this recipe' : 'On: click to keep the recipe but not use it'} aria-label="Recipe on or off">
              {mine[0].r.enabled === false ? <IconEyeOff /> : <IconEye />}
            </button>
            <button type="button" className="cols__icon" onClick={() => copy(mine[0].i)} title="Duplicate this recipe" aria-label="Duplicate the recipe"><IconCopy /></button>
            <button type="button" className="cols__icon cols__icon--remove" onClick={() => { if (window.confirm(`Delete the recipe "${mine[0].r.id}"?`)) set(recipes.filter((_, j) => j !== mine[0].i)); }} title="Delete this recipe" aria-label="Delete the recipe"><IconDelete /></button>
          </span>
        )}
        <details className="scn-more">
          <summary className="btn btn--small primary" title="A recipe for the objects of a set">+ Recipe</summary>
          <div className="scn-more__menu scn-more__menu--list">
            {free.map((x) => <button key={x.id} type="button" className="btn btn--small" onClick={(e) => { add(x.name); (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}>{x.name}</button>)}
            {everyFree && <button type="button" className="btn btn--small" onClick={(e) => { add(''); (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); }}>Every object</button>}
            {!free.length && !everyFree && <span className="scn-dim">Every set has a recipe. Make another set in Models &gt; Search sets.</span>}
          </div>
        </details>
        <button type="button" className="btn btn--small" onClick={() => setResourcesOpen(true)} title="Crews, rates, equipment, cranes, materials and calendars">Resources…</button>
        <details className="scn-more scn-more--end">
          <summary className="btn btn--small" title="Import or export the recipes as a file">⋯</summary>
          <div className="scn-more__menu">
            <button type="button" className="btn btn--small" onClick={() => fileRef.current?.click()}>Import file</button>
            <button type="button" className="btn btn--small" disabled={!recipes.length} onClick={exportFile}>Export file</button>
            <button type="button" className="btn btn--small" disabled={!unusedSets.length} onClick={removeUnused} title="Delete the sets of the folder Recipes sets that have no recipe, and the ones that repeat a name">Delete unused sets ({unusedSets.length})</button>
          </div>
        </details>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
      </div>
      {note && <div className={`scn-rules__note${note.ok ? '' : ' is-error'}`} role="status">{note.text}</div>}
      {resourcesOpen && <ResourcesScreen onClose={() => setResourcesOpen(false)} />}
      {!names.length ? (
        <div className="scn-dim scn-editor__help" style={{ margin: 8 }}>No recipes yet. Press + Recipe and pick the set of objects it is for (sets are made in Models &gt; Search sets, in the folder "{RECIPE_SETS_FOLDER}").</div>
      ) : (
        <>
          {mine.map(({ r, i }, k) => (

            <div key={i}>
              <NeedsLine recipe={r} rules={rules} lead={k === 0 && objects !== null ? `${objects} object${objects === 1 ? '' : 's'} in the loaded models` : undefined} />
              <RecipeCard bare={mine.length === 1} recipe={r} recipes={recipes} rules={rules} check={scenarioOpen} onChange={(next) => set(recipes.map((x, j) => (j === i ? next : x)))} onDelete={() => { if (window.confirm(`Delete the recipe "${r.id}"?`)) set(recipes.filter((_, j) => j !== i)); }} onCopy={() => copy(i)}
                collapsed={folded.has(i)} onCollapsed={(c) => setFolded((prev) => { const next = new Set(prev); if (c) next.add(i); else next.delete(i); return next; })} />
            </div>
          ))}
        </>
      )}
      <datalist id="recipe-groups">{[...new Set([...folderSets.map((x) => x.name), ...rules.groups.map((g) => g.id)])].map((g) => <option key={g} value={g} />)}</datalist>
      <datalist id="recipe-phases">{phaseList.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="recipe-rates">{rules.rates.map((r) => <option key={r.id} value={r.id} />)}</datalist>
      <datalist id="recipe-crews">{rules.crewTemplates.map((r) => <option key={r.id} value={r.id} />)}</datalist>
      {POOL_KINDS.map((k) => <datalist key={k.value} id={`recipe-pool-${k.value}`}>{rules.resourcePools.filter((p) => p.kind === k.value).map((p) => <option key={p.id} value={p.id} />)}</datalist>)}
      <datalist id="recipe-calendars">{rules.calendars.map((r) => <option key={r.id} value={r.id} />)}</datalist>
    </div>
  );
}

/** The Recipes dock panel (4D Sequencing): the library, with or without a scenario open. */
export function RecipesDock() {
  return (
    <div className="scn-rules scn-rules--dock">
      <RecipesEditor />
    </div>
  );
}
