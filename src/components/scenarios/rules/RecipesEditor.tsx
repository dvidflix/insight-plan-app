import { useRef, useState } from 'react';
import { useScenarioStore } from '../../../state/scenarioStore';
import { ACTIVITY_PHASES, COMPONENT_PHASES, POOL_KINDS, type PoolKind, type PoolRow } from '../../../prs/rules';
import { edgesFromFollows, followsText, normalizeRecipes, parseUses, usesText, type Recipe, type RecipeTask, type ResourceUse } from '../../../prs/recipes';
import { splitRecipes, withRecipes } from '../../../prs/recipeRules';
import { downloadBlob } from '../../../utils/download';
import { IconTrash } from '../../icons';
import { RuleCard, useRuleContext, type RuleContext } from './RuleParts';
import { RecipeGraph } from './RecipeGraph';

/** Scenario panel > Rules > Recipes: how each kind of object is built (docs/design/recipes.md). A recipe belongs to a rule group and lists its
    tasks (the activities of the object, in order), with the days, rate, crew and calendar of each and what each task follows. The scenario
    keeps its recipes with its rules; a recipes file (Export / Import) carries them to another scenario or project. */

const num = (v: string): number | undefined => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Number(v));

function Cell({ value, onChange, list, width, type = 'text', placeholder, title }: { value: string | number | undefined; onChange: (v: string) => void; list?: string; width?: number; type?: 'text' | 'number'; placeholder?: string; title?: string }) {
  return <input className="rel-cell" type={type} step="any" value={value ?? ''} list={list} placeholder={placeholder} title={title} spellCheck={false} style={width ? { width } : undefined} onChange={(e) => onChange(e.target.value)} />;
}

function UsesCell({ list, kind, onChange }: { list: ResourceUse[] | undefined; kind: PoolKind; onChange: (next: ResourceUse[] | undefined) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className="rel-cell" style={{ width: 110 }} spellCheck={false} list={`recipe-pool-${kind}`} placeholder={kind === 'crane' ? 'TC1' : kind === 'material' ? 'FWSET 2' : 'PUMP'}
      title="A type of the scenario's pools, then how many when not one; several separated by commas: TC1, MOB50 2"
      value={draft ?? usesText(list)} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== null) { const next = parseUses(draft); onChange(next.length ? next : undefined); } setDraft(null); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
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

function RecipeCard({ recipe, recipes, ctx, onChange, onDelete, onCopy }: { recipe: Recipe; recipes: Recipe[]; ctx: RuleContext; onChange: (r: Recipe) => void; onDelete: () => void; onCopy: () => void }) {
  const { rules } = ctx;
  const chain = recipe.chain !== false;
  const [view, setView] = useState<'table' | 'graph'>('table');
  const known = {
    groups: new Set(rules.groups.map((g) => g.id.toUpperCase())),
    rates: new Set(rules.rates.map((r) => r.id.toUpperCase())),
    crews: new Set(rules.crewTemplates.map((r) => r.id.toUpperCase())),
    calendars: new Set(rules.calendars.map((r) => r.id.toUpperCase())),
    pools: new Set(rules.resourcePools.map((p) => `${p.kind}|${p.id.toUpperCase()}`)),
  };
  const problems: string[] = [];
  if (recipe.group.trim() && !known.groups.has(recipe.group.trim().toUpperCase())) problems.push(`The group "${recipe.group}" does not exist`);
  const seen = new Set<string>();
  for (const t of recipe.tasks) {
    const key = t.phase.trim().toUpperCase();
    if (key && seen.has(key)) problems.push(`The task "${t.phase}" is there twice`);
    seen.add(key);
    if (!key && chain) problems.push('A task needs a phase');
    if (t.rate && !known.rates.has(t.rate.trim().toUpperCase())) problems.push(`The rate "${t.rate}" does not exist`);
    if (t.density && !known.rates.has(t.density.trim().toUpperCase())) problems.push(`The rebar rate "${t.density}" does not exist`);
    if (t.crew && !known.crews.has(t.crew.trim().toUpperCase())) problems.push(`The crew "${t.crew}" does not exist`);
    for (const [list, kind] of [[t.equipment, 'equipment'], [t.cranes, 'crane'], [t.materials, 'material']] as const) {
      for (const u of list ?? []) if (!known.pools.has(`${kind}|${u.type.trim().toUpperCase()}`)) problems.push(`The ${kind} "${u.type}" has no pool (Resources above): it gets no resource`);
    }
    if (t.calendar && known.calendars.size && !known.calendars.has(t.calendar.trim().toUpperCase())) problems.push(`The calendar "${t.calendar}" does not exist`);
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
  const note = [
    chain ? `${recipe.tasks.length} activit${recipe.tasks.length === 1 ? 'y' : 'ies'} for ${recipe.group.trim() ? `the objects of the group ${recipe.group}` : 'every object'}` : `Values only, for ${recipe.group.trim() ? `the group ${recipe.group}` : 'every object'}`,
    sameGroup.length ? `${sameGroup.length} other recipe${sameGroup.length === 1 ? '' : 's'} of this group also define activities: the one of the highest priority is used` : '',
  ].filter(Boolean).join(' · ');

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
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= recipe.tasks.length) return;
    const tasks = [...recipe.tasks];
    [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
    onChange({ ...recipe, tasks });
  };
  const remove = (i: number) => {
    const phase = recipe.tasks[i].phase;
    onChange({ ...recipe, tasks: recipe.tasks.filter((_, j) => j !== i), edges: (recipe.edges ?? []).filter((e) => e.from !== phase && e.to !== phase) });
  };
  const flag = (i: number, key: 'finishAfter' | 'gates', title: string) => <input type="checkbox" checked={!!recipe.tasks[i][key]} onChange={(e) => setTask(i, { [key]: e.target.checked || undefined })} aria-label={title} title={title} />;

  return (
    <RuleCard
      id={recipe.id}
      onId={(id) => onChange({ ...recipe, id })}
      enabled={recipe.enabled !== false}
      onEnabled={(on) => onChange({ ...recipe, enabled: on ? undefined : false })}
      onCopy={onCopy}
      onDelete={onDelete}
      note={note}
      problem={problems.length ? problems.join('\n') : null}
    >
      <div className="rel-bar">
        <label className="scn-dim">Group <Cell value={recipe.group} list="recipe-groups" onChange={(group) => onChange({ ...recipe, group })} width={150} placeholder="every object" title="The rule group whose objects the recipe applies to; empty = every object" /></label>
        <label className="scn-dim">Priority <Cell type="number" value={recipe.priority} onChange={(v) => onChange({ ...recipe, priority: num(v) })} width={60} title="Where an object is in the group of several recipes, the highest priority decides" /></label>
        <select className="rel-cell" value={chain ? 'chain' : 'values'} onChange={(e) => onChange({ ...recipe, chain: e.target.value === 'chain' ? undefined : false })} title="Activities: the tasks are the activities the objects get. Values only: it sets the days, rate, crew and calendar of tasks whose activities come from another recipe.">
          <option value="chain">Defines the activities</option>
          <option value="values">Sets values only</option>
        </select>
        <button type="button" className="btn btn--small" onClick={() => onChange({ ...recipe, tasks: [...recipe.tasks, { phase: '' }] })}>+ Task</button>
        {chain && (
          <span className="scn-rules__file" role="group" aria-label="View">
            <button type="button" className={`btn btn--small${view === 'table' ? ' primary' : ''}`} onClick={() => setView('table')}>Table</button>
            <button type="button" className={`btn btn--small${view === 'graph' ? ' primary' : ''}`} onClick={() => setView('graph')} title="The tasks as boxes and arrows">Graph</button>
          </span>
        )}
      </div>
      {chain && view === 'graph' ? <RecipeGraph recipe={recipe} recipes={recipes} onChange={onChange} /> : (
      <div className="rel-scroll">
        <table className="rel-table">
          <thead>
            <tr>
              <th aria-label="On" />
              <th>#</th>
              <th>Phase</th>
              {chain && <th title="The end of the activity name; empty: the phase">Name</th>}
              {chain && <th title="The end of the activity ID (-R); empty: the initials of the phase">Suffix</th>}
              {chain && <th title="Rebar: the pour's rebar tonnes go on the activity. Concrete: its volume.">Material</th>}
              {chain && <th title="What the task waits for">Follows</th>}
              <th>Days</th>
              <th>Rate</th>
              <th title="A Rebar rate (tonnes per m³ of concrete)">Rebar rate</th>
              <th>Crew</th>
              <th>Calendar</th>
              <th title="Equipment the task uses (types of the Resources pools)">Equipment</th>
              <th title="Cranes the task uses">Cranes</th>
              <th title="Materials the task holds">Materials</th>
              <th title="Of the values of this task: a higher number wins">Priority</th>
              {chain && <th title="With a share below 100 %: the task also cannot finish before what it follows does">Finish after</th>}
              {chain && <th title="What follows the object waits for this task, not for its Concrete">Gates</th>}
              <th aria-label="Move" />
              <th aria-label="Delete" />
            </tr>
          </thead>
          <tbody>
            {recipe.tasks.map((t, i) => (
              <tr key={i} className={t.enabled === false ? 'is-off' : ''}>
                <td><input type="checkbox" checked={t.enabled !== false} onChange={(e) => setTask(i, { enabled: e.target.checked ? undefined : false })} aria-label="Task on" /></td>
                <td className="scn-dim">{i + 1}</td>
                <td><Cell value={t.phase} list="recipe-phases" onChange={(v) => rename(i, v)} width={140} /></td>
                {chain && <td><Cell value={t.name} onChange={(v) => setTask(i, { name: v || undefined })} width={140} /></td>}
                {chain && <td><Cell value={t.suffix} onChange={(v) => setTask(i, { suffix: v || undefined })} width={56} /></td>}
                {chain && (
                  <td>
                    <select className="rel-cell" value={t.material ?? ''} onChange={(e) => setTask(i, { material: (e.target.value || undefined) as RecipeTask['material'] })}>
                      <option value="">none</option>
                      <option value="rebar">rebar</option>
                      <option value="concrete">concrete</option>
                    </select>
                  </td>
                )}
                {chain && <td><FollowsCell recipe={recipe} phase={t.phase} onChange={(text) => follow(i, text)} /></td>}
                <td><Cell type="number" value={t.days} onChange={(v) => setTask(i, { days: num(v) })} width={56} /></td>
                <td><Cell value={t.rate} list="recipe-rates" onChange={(v) => setTask(i, { rate: v || undefined })} width={110} /></td>
                <td><Cell value={t.density} list="recipe-rates" onChange={(v) => setTask(i, { density: v || undefined })} width={100} /></td>
                <td><Cell value={t.crew} list="recipe-crews" onChange={(v) => setTask(i, { crew: v || undefined })} width={100} /></td>
                <td><Cell value={t.calendar} list="recipe-calendars" onChange={(v) => setTask(i, { calendar: v || undefined })} width={90} /></td>
                <td><UsesCell kind="equipment" list={t.equipment} onChange={(v) => setTask(i, { equipment: v })} /></td>
                <td><UsesCell kind="crane" list={t.cranes} onChange={(v) => setTask(i, { cranes: v })} /></td>
                <td><UsesCell kind="material" list={t.materials} onChange={(v) => setTask(i, { materials: v })} /></td>
                <td><Cell type="number" value={t.priority} onChange={(v) => setTask(i, { priority: num(v) })} width={52} /></td>
                {chain && <td>{flag(i, 'finishAfter', 'Finish after')}</td>}
                {chain && <td>{flag(i, 'gates', 'Gates what follows')}</td>}
                <td>
                  <button type="button" className="mini-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up" title="Move up">↑</button>
                  <button type="button" className="mini-btn" onClick={() => move(i, 1)} disabled={i === recipe.tasks.length - 1} aria-label="Move down" title="Move down">↓</button>
                </td>
                <td><button type="button" className="mini-btn" onClick={() => remove(i)} aria-label="Delete task"><IconTrash /></button></td>
              </tr>
            ))}
            {recipe.tasks.length === 0 && <tr><td colSpan={19} className="scn-dim">No tasks yet.</td></tr>}
          </tbody>
        </table>
      </div>
      )}
    </RuleCard>
  );
}

/** The scenario's pools: how many of each type of equipment, crane and material it has (the recipes name the types). */
function PoolsCard({ rows, onRows, maximized, onMaximize }: { rows: PoolRow[]; onRows: (next: PoolRow[]) => void; maximized: boolean; onMaximize: (on: boolean) => void }) {
  const set = (i: number, patch: Partial<PoolRow>) => onRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <details className="scn-pools" open={rows.length > 0}>
      <summary>Resources: equipment, cranes and materials ({rows.length})</summary>
      <div className="rel-bar">
        <button type="button" className="btn btn--small" onClick={() => onRows([...rows, { id: `RES-${rows.length + 1}`, kind: 'equipment', name: '', quantity: 1 }])}>+ Resource</button>
        <button type="button" className={`btn btn--small${maximized ? ' primary' : ''}`} aria-pressed={maximized} onClick={() => onMaximize(!maximized)} title="No pool and no labour trade has a limit: the shortest programme the logic allows. Switch it off to go back to the counts below (they are kept).">Maximize resource availability{maximized ? ': on' : ''}</button>
        <span className="scn-dim">{maximized ? 'Every pool and trade is unlimited in the next Update 4D; the counts below are kept. ' : ''}How many of each type this scenario has. A task names the type; the count is the most that can be in use at once (0: not limited). Each is a resource in the generated programme.</span>
      </div>
      {rows.length > 0 && (
        <table className="rel-table">
          <thead><tr><th aria-label="On" /><th>Kind</th><th title="What a recipe task names">ID</th><th>Name</th><th>Quantity</th><th aria-label="Delete" /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.enabled === false ? 'is-off' : ''}>
                <td><input type="checkbox" checked={r.enabled !== false} onChange={(e) => set(i, { enabled: e.target.checked ? undefined : false })} aria-label="Resource on" /></td>
                <td>
                  <select className="rel-cell" value={r.kind} onChange={(e) => set(i, { kind: e.target.value as PoolKind })}>
                    {POOL_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                </td>
                <td><Cell value={r.id} onChange={(id) => set(i, { id })} width={110} /></td>
                <td><Cell value={r.name} onChange={(name) => set(i, { name })} width={180} placeholder="Tower crane 1" /></td>
                <td><Cell type="number" value={r.quantity} onChange={(v) => set(i, { quantity: num(v) ?? 0 })} width={64} /></td>
                <td><button type="button" className="mini-btn" onClick={() => onRows(rows.filter((_, j) => j !== i))} aria-label="Delete resource"><IconTrash /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </details>
  );
}

export function RecipesEditor() {
  const ctx = useRuleContext();
  const { rules } = ctx;
  const recipes = rules.recipes;
  const phases = useScenarioStore((s) => s.crewOptions?.phases ?? []);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (next: Recipe[]) => ctx.change((r) => ({ ...r, recipes: next }));
  const phaseList = [...new Set([...COMPONENT_PHASES, ...ACTIVITY_PHASES, ...phases])];
  const hasRows = rules.chains.length + rules.assignments.length > 0;

  const add = () => {
    let n = recipes.length + 1;
    while (recipes.some((r) => r.id.toUpperCase() === `RECIPE-${n}`)) n++;
    set([...recipes, { id: `RECIPE-${n}`, group: '', tasks: [{ phase: 'Rebar', suffix: '-R', name: 'Rebar', material: 'rebar' }, { phase: 'Concrete', suffix: '-C', name: 'Concrete', material: 'concrete' }] }]);
  };
  const copy = (i: number) => {
    const from = recipes[i];
    let id = `${from.id}-2`;
    for (let n = 3; recipes.some((r) => r.id.toUpperCase() === id.toUpperCase()); n++) id = `${from.id}-${n}`;
    set([...recipes.slice(0, i + 1), { ...from, id, tasks: from.tasks.map((t) => ({ ...t })), edges: from.edges?.map((e) => ({ ...e })) }, ...recipes.slice(i + 1)]);
  };

  const makeRecipes = () => {
    const split = splitRecipes(rules);
    const lines = split.losses.length ? `\n\nThe recipes cannot hold this exactly:\n- ${split.losses.join('\n- ')}\n\nContinue anyway?` : '';
    if (!window.confirm(`Turn the ${rules.chains.length} chain rows and ${rules.assignments.length} assignments into ${split.recipes.recipes.length} recipes? The generator gives the same programme (the Chains and Assignments tables are then empty).${lines}`)) return;
    ctx.change(() => ({ ...split.rules, recipes: split.recipes.recipes }));
    setNote({ ok: true, text: `Made ${split.recipes.recipes.length} recipes. Update 4D to see the programme (it should not change).` });
  };
  const makeRows = () => {
    if (!window.confirm(`Turn the ${recipes.length} recipes back into chain rows and assignments (the recipes are removed)?`)) return;
    ctx.change((r) => withRecipes({ ...r, recipes: [] }, { version: 1, recipes }));
    setNote({ ok: true, text: 'The recipes are now chain rows and assignments.' });
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

  return (
    <div className="scn-recipes">
      <div className="scn-rules__bar">
        <span className="scn-rules__file">
          <button type="button" className="btn btn--small primary" onClick={add}>+ Recipe</button>
          {hasRows && recipes.length === 0 && <button type="button" className="btn btn--small" onClick={makeRecipes} title="Turn the Chains and Assignments of this scenario into recipes: the programme stays the same">Make recipes from chains and assignments</button>}
          {recipes.length > 0 && <button type="button" className="btn btn--small" onClick={makeRows} title="Put the recipes back as chain rows and assignments">Back to chains and assignments</button>}
          <button type="button" className="btn btn--small" onClick={() => fileRef.current?.click()} title="Add the recipes of a recipes file (a recipe with the same ID is replaced)">Import file</button>
          <button type="button" className="btn btn--small" disabled={!recipes.length} onClick={exportFile} title="Save the recipes as a file to use in another scenario or project">Export file</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importFile(f); }} />
        </span>
      </div>
      {note && <div className={`scn-rules__note${note.ok ? '' : ' is-error'}`} role="status">{note.text}</div>}
      <PoolsCard rows={rules.resourcePools} onRows={(next) => ctx.change((r) => ({ ...r, resourcePools: next }))} maximized={rules.settings.maximizeResources === true} onMaximize={(on) => ctx.change((r) => ({ ...r, settings: { ...r.settings, maximizeResources: on ? true : undefined } }))} />
      {hasRows && recipes.length > 0 && <div className="scn-rules__note">This scenario has chain rows or assignments as well as recipes: both are used, so a group should have its activities from one or the other.</div>}
      {recipes.length === 0 ? (
        <div className="scn-dim scn-editor__help" style={{ margin: 8 }}>
          A recipe says how a kind of object is built: its tasks in order, with the days, rate, crew and calendar of each, for the objects of a rule group. {hasRows ? 'This scenario has Chains and Assignments: turn them into recipes with the button above.' : 'Add a recipe, or import a recipes file.'}
        </div>
      ) : (
        recipes.map((r, i) => (
          <RecipeCard key={i} recipe={r} recipes={recipes} ctx={ctx} onChange={(next) => set(recipes.map((x, j) => (j === i ? next : x)))} onDelete={() => { if (window.confirm(`Delete the recipe "${r.id}"?`)) set(recipes.filter((_, j) => j !== i)); }} onCopy={() => copy(i)} />
        ))
      )}
      <datalist id="recipe-groups">{rules.groups.map((g) => <option key={g.id} value={g.id} />)}</datalist>
      <datalist id="recipe-phases">{phaseList.map((p) => <option key={p} value={p} />)}</datalist>
      <datalist id="recipe-rates">{rules.rates.map((r) => <option key={r.id} value={r.id} />)}</datalist>
      <datalist id="recipe-crews">{rules.crewTemplates.map((r) => <option key={r.id} value={r.id} />)}</datalist>
      {POOL_KINDS.map((k) => <datalist key={k.value} id={`recipe-pool-${k.value}`}>{rules.resourcePools.filter((p) => p.kind === k.value).map((p) => <option key={p.id} value={p.id} />)}</datalist>)}
      <datalist id="recipe-calendars">{rules.calendars.map((r) => <option key={r.id} value={r.id} />)}</datalist>
    </div>
  );
}
