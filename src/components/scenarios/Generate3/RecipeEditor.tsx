import { useMemo, useState } from 'react';
import { setRecipes, useRecipeStore } from '../../../state/recipeStore';
import { useScenarioStore } from '../../../state/scenarioStore';
import { edgesFromFollows, followsText, type Recipe, type RecipeTask } from '../../../prs/recipes';
import { QUANTITY_NAMES } from '../../../prs/recipesWorkbook';
import { STANDARD_METHODS } from '../../../prs/standardMethods';
import { FROM_STD, recipeFromStandard } from '../../../prs/standardRecipe';
import { walkFolder } from '../../../viewer/setTree';
import { useEditableGrid } from '../../useEditableGrid';
import { IconChevronDown, IconChevronRight, IconRemove } from '../../icons';
import { Dialog } from './Controls';
import { useG3, type useWorkPackages } from './useWorkPackages';

/** Edit recipes (Generate 3): the project's recipes in a focused editor that stays in Generate 3. A list on the left (the recipes your packages use
    first), and the recipe picked on the right: its name, which objects it is for, and its activities as a spreadsheet (activity, days or formula,
    crew; what it follows, calendar and priority behind "More columns"). A new recipe can start from a standard method, so the two are easy to map.
    Every change goes to the recipe library, which the open scenario keeps in its rules (state/scenarioStore), so Generate reads it. The full graph
    editor stays in the classic view; nothing here leads there. */

type WP = ReturnType<typeof useWorkPackages>;
const isChain = (r: Recipe) => r.enabled !== false && r.chain !== false;

export function RecipeEditorDialog({ wp }: { wp: WP }) {
  const open = useG3((s) => s.recipeEditor);
  const setOpen = useG3((s) => s.setRecipeEditor);
  const recipes = useRecipeStore((s) => s.recipes);
  const [newFrom, setNewFrom] = useState('');
  const usedBy = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const r of wp.rows) {
      if (!(wp.contents.objects.get(r.pkg.id)?.length)) continue;
      const key = wp.methods.get(r.pkg.id)?.key;
      if (key?.startsWith('recipe:')) (out.get(key.slice(7)) ?? out.set(key.slice(7), []).get(key.slice(7))!).push(r.code);
    }
    return out;
  }, [wp.rows, wp.contents, wp.methods]);
  if (open === null) return null;
  const close = () => setOpen(null);
  const chains = recipes.filter((r) => r.chain !== false);
  const current = chains.find((r) => r.id === open) ?? null;
  const used = chains.filter((r) => usedBy.has(r.id));
  const rest = chains.filter((r) => !usedBy.has(r.id));
  const add = (from: string) => {
    const ids = recipes.map((r) => r.id);
    const std = STANDARD_METHODS.find((m) => `std:${m.id}` === from);
    let made: Recipe;
    if (std) made = recipeFromStandard(std, ids);
    else {
      let id = 'New recipe';
      for (let k = 2; ids.some((t) => t.toUpperCase() === id.toUpperCase()); k++) id = `New recipe ${k}`;
      made = { id, name: id, group: '', tasks: [{ phase: 'Activity 1', name: 'Activity 1', days: 1 }] };
    }
    setRecipes([...recipes, made]);
    setOpen(made.id);
    setNewFrom('');
  };
  const item = (r: Recipe) => (
    <li key={r.id}>
      <button type="button" className={`g3-rcp__item${r.id === open ? ' is-on' : ''}${isChain(r) ? '' : ' is-off'}`} onClick={() => setOpen(r.id)}>
        <b>{r.name?.trim() || r.id}</b>
        <span className="scn-dim">{r.group.trim() ? `for ${r.group}` : 'for every object'} · {r.tasks.length} activit{r.tasks.length === 1 ? 'y' : 'ies'}{usedBy.get(r.id) ? ` · ${usedBy.get(r.id)!.length} package${usedBy.get(r.id)!.length === 1 ? '' : 's'}` : ''}</span>
      </button>
    </li>
  );
  return (
    <Dialog title="Recipes" onClose={close} foot={<button type="button" className="btn primary" onClick={close}>Done</button>}>
      <p className="scn-dim hint">A recipe is this project’s own way to build something: a chain of activities, each with its days and crew. A package uses it when you pick it as its method, or automatically when the recipe is for one of the package’s search sets.</p>
      <div className="g3-rcp">
        <aside className="g3-rcp__list">
          <select value={newFrom} onChange={(e) => { if (e.target.value) add(e.target.value === 'empty' ? '' : e.target.value); }} aria-label="New recipe">
            <option value="">+ New recipe…</option>
            <option value="empty">Empty</option>
            <optgroup label="Like a standard method">{STANDARD_METHODS.map((m) => <option key={m.id} value={`std:${m.id}`}>{m.name}</option>)}</optgroup>
          </select>
          {used.length > 0 && <><div className="g3-rcp__head">Used by your packages</div><ul>{used.map(item)}</ul></>}
          <div className="g3-rcp__head">{used.length ? 'Other recipes' : 'Recipes'}</div>
          {rest.length ? <ul>{rest.map(item)}</ul> : <p className="scn-dim g3-adv__why">{chains.length ? 'None.' : 'No recipes yet. The standard methods are enough to generate; make a recipe when a package needs its own way.'}</p>}
        </aside>
        <section className="g3-rcp__main">
          {current ? <RecipeForm key={current.id} wp={wp} recipe={current} usedBy={usedBy.get(current.id) ?? []} /> : <p className="scn-dim g3-adv__why">Pick a recipe on the left, or make a new one.</p>}
        </section>
      </div>
    </Dialog>
  );
}

function RecipeForm({ wp, recipe, usedBy }: { wp: WP; recipe: Recipe; usedBy: string[] }) {
  const recipes = useRecipeStore((s) => s.recipes);
  const crewTemplates = useScenarioStore((s) => s.rules.crewTemplates);
  const calendars = useScenarioStore((s) => s.rules.calendars);
  const [more, setMore] = useState(false);
  const setOpen = useG3((s) => s.setRecipeEditor);
  const setNames = useMemo(() => walkFolder(wp.sets, '').map((s) => s.name), [wp.sets]);
  const crews = useMemo(() => [...new Set([...crewTemplates.map((c) => c.id), ...STANDARD_METHODS.map((m) => m.crew.id)])], [crewTemplates]);
  const save = (next: Recipe) => setRecipes(recipes.map((r) => (r.id === recipe.id ? next : r)));
  const setTasks = (tasks: RecipeTask[], edges = recipe.edges) => save({ ...recipe, tasks, ...(edges ? { edges } : {}) });
  const rows = recipe.tasks.map((t, i) => ({ t, i }));
  const durText = (t: RecipeTask) => (t.formula?.trim() ? t.formula : t.days !== undefined ? String(t.days) : '');
  const withDur = (t: RecipeTask, text: string): RecipeTask => {
    const v = text.trim();
    const { days: _d, formula: _f, ...rest } = t;
    if (!v) return rest;
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) && /^[\d.,\s]+$/.test(v) ? { ...rest, days: n } : { ...rest, formula: v };
  };
  const write = (col: string, cells: [number, string][]) => {
    let edges = recipe.edges ?? [];
    const tasks = recipe.tasks.map((t, i) => {
      const cell = cells.find(([at]) => at === i);
      if (!cell) return t;
      const v = cell[1];
      if (col === 'name') return { ...t, name: v.trim() || undefined };
      if (col === 'dur') return withDur(t, v);
      if (col === 'crew') return { ...t, crew: v.trim() || undefined };
      if (col === 'calendar') return { ...t, calendar: v.trim() || undefined };
      if (col === 'priority') { const n = Number(v); return { ...t, priority: v.trim() && Number.isFinite(n) ? n : undefined }; }
      if (col === 'follows') { edges = [...edges.filter((e) => e.to.toUpperCase() !== t.phase.toUpperCase()), ...edgesFromFollows(v, t.phase)]; return t; }
      return t;
    });
    setTasks(tasks, edges);
  };
  const textOf = (col: string, t: RecipeTask) => (col === 'name' ? t.name ?? t.phase : col === 'dur' ? durText(t) : col === 'crew' ? t.crew ?? '' : col === 'calendar' ? t.calendar ?? '' : col === 'priority' ? (t.priority === undefined ? '' : String(t.priority)) : col === 'follows' ? followsText(recipe, t.phase) : '');
  const grid = useEditableGrid({ widthsKey: 'generate3.recipe', rows, get: (col, { t }) => textOf(col, t), write });
  /** A cell typed like a spreadsheet's: it is written when left (Enter or Tab), so a formula half typed is not read. */
  const cell = (col: string, at: number, extra?: { list?: string; placeholder?: string; title?: string; num?: boolean }) => {
    const v = textOf(col, rows[at].t);
    return (
      <td className={`xl__cell${extra?.num ? ' xl__num' : ''} xgrid__cell${grid.sel(col, at)}`} data-col={col} data-row={at}>
        <input {...grid.cell(col, at)} list={extra?.list} placeholder={extra?.placeholder} title={extra?.title} defaultValue={v} key={`${col}:${at}:${v}`}
          onBlur={(e) => { if (e.target.value !== v) write(col, [[at, e.target.value]]); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        {grid.handle(col, at)}
      </td>
    );
  };
  const std = recipe.note?.startsWith(FROM_STD) ? recipe.note.slice(FROM_STD.length) : '';
  const remove = () => {
    if (!window.confirm(`Delete the recipe “${recipe.name || recipe.id}”?${usedBy.length ? ` ${usedBy.length} package${usedBy.length === 1 ? ' uses' : 's use'} it and will go back to their automatic method.` : ''}`)) return;
    setRecipes(recipes.filter((r) => r.id !== recipe.id));
    setOpen('');
  };
  const copy = () => {
    let id = `${recipe.id} copy`;
    for (let k = 2; recipes.some((r) => r.id.toUpperCase() === id.toUpperCase()); k++) id = `${recipe.id} copy ${k}`;
    setRecipes([...recipes, { ...recipe, id, name: `${recipe.name || recipe.id} copy`, group: '' }]);
    setOpen(id);
  };
  const addTask = () => {
    let k = recipe.tasks.length + 1;
    while (recipe.tasks.some((t) => t.phase.toUpperCase() === `ACTIVITY ${k}`)) k++;
    setTasks([...recipe.tasks, { phase: `Activity ${k}`, name: `Activity ${k}`, days: 1 }]);
  };
  return (
    <div className="g3-rcp__form">
      <div className="g3-adv__field"><span className="g3-adv__label">Name</span><div className="g3-adv__ctl"><input className="g3-adv__text g3-rcp__wide" defaultValue={recipe.name ?? recipe.id} onBlur={(e) => { if (e.target.value.trim() !== (recipe.name ?? '')) save({ ...recipe, name: e.target.value.trim() || undefined }); }} aria-label="Recipe name" /></div></div>
      <div className="g3-adv__field">
        <span className="g3-adv__label">Used for</span>
        <div className="g3-adv__ctl"><input className="g3-adv__text g3-rcp__wide" list="g3-rcp-sets" defaultValue={recipe.group} placeholder="every object" onBlur={(e) => { if (e.target.value.trim() !== recipe.group) save({ ...recipe, group: e.target.value.trim() }); }} aria-label="Used for" /></div>
        <small className="g3-adv__why">A search set: packages made of it use this recipe automatically. Empty: any package with no other method chosen. A package can also pick it in its row (step 3).</small>
        <datalist id="g3-rcp-sets">{setNames.map((s) => <option key={s} value={s} />)}</datalist>
      </div>
      <div className="g3-rcp__facts">
        <span>{usedBy.length ? `Used by ${usedBy.join(', ')}` : 'No package uses it yet'}</span>
        {std && <span className="source-chip" title="Made from this standard method: compare in See all methods and rates">like {std}</span>}
        {!isChain(recipe) && <span className="source-chip">switched off</span>}
        <label className="g3-rcp__on"><input type="checkbox" checked={recipe.enabled !== false} onChange={(e) => save({ ...recipe, enabled: e.target.checked ? undefined : false })} /> On</label>
      </div>
      <div className="g3-rcp__acts">
        <h4>Activities, in order</h4>
        <button type="button" className="g3-adv__more" aria-expanded={more} onClick={() => setMore(!more)}>{more ? <IconChevronDown /> : <IconChevronRight />} {more ? 'Fewer columns' : 'More columns: follows, calendar, priority'}</button>
      </div>
      <table className="xl xgrid" {...grid.grid}>
        <colgroup><col style={{ width: 40 }} /><col style={{ width: 200 }} /><col style={{ width: 210 }} /><col style={{ width: 140 }} />{more && <><col style={{ width: 150 }} /><col style={{ width: 120 }} /><col style={{ width: 70 }} /></>}<col style={{ width: 32 }} /></colgroup>
        <thead><tr><th className="xl__corner" aria-label="Row" /><th>Activity</th><th title="A number of working days, or a formula of the quantities and parameters">Days or formula</th><th>Crew</th>{more && <><th title="What it waits for: an activity, with a type and lag (Activity:SS+2d), or a share (Activity@80). Empty: the one above">Follows</th><th>Calendar</th><th title="When several recipes fit, the higher wins">Priority</th></>}<th aria-label="Delete" /></tr></thead>
        <tbody>
          {rows.map(({ t }, at) => (
            <tr key={`${t.phase}:${at}`}>
              <th className="xl__row" scope="row">{at + 1}</th>
              {cell('name', at)}
              {cell('dur', at, { placeholder: '1', title: `A number of days, or a formula such as max(1, ${QUANTITY_NAMES[0]} / 20); names: ${QUANTITY_NAMES.join(', ')} and your parameters` })}
              {cell('crew', at, { list: 'g3-rcp-crews', placeholder: 'default' })}
              {more && <>{cell('follows', at, { placeholder: at ? 'the one above' : '' })}{cell('calendar', at, { list: 'g3-rcp-cals', placeholder: 'default' })}{cell('priority', at, { num: true })}</>}
              <td className="xl__check"><button type="button" className="cols__icon cols__icon--remove" aria-label="Delete the activity" title="Delete the activity" onClick={() => setTasks(recipe.tasks.filter((_, j) => j !== at), (recipe.edges ?? []).filter((e) => e.to !== t.phase && e.from !== t.phase))}><IconRemove /></button></td>
            </tr>
          ))}
          <tr className="xl__add"><th className="xl__row">*</th><td colSpan={more ? 7 : 4}><button type="button" onClick={addTask}>+ Add an activity</button></td></tr>
        </tbody>
      </table>
      <datalist id="g3-rcp-crews">{crews.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="g3-rcp-cals">{calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</datalist>
      <small className="g3-adv__why">Activities run one after another unless Follows says otherwise. Days or formula: a number of working days, or a formula worked out for each package from its quantities ({QUANTITY_NAMES.join(', ')}) and the scenario’s parameters.</small>
      <div className="g3-rcp__tools">
        <button type="button" className="btn btn--small" onClick={copy}>Duplicate</button>
        <button type="button" className="btn btn--small btn--danger" onClick={remove}>Delete the recipe</button>
      </div>
    </div>
  );
}
