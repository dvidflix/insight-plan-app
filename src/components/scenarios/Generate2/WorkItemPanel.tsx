import { useMemo } from 'react';
import { useScenarioStore } from '../../../state/scenarioStore';
import { useRecipeStore } from '../../../state/recipeStore';
import { useSearchSetsStore } from '../../../state/searchSetsStore';
import { useViewerEngine } from '../../../viewer/ViewerEngineContext';
import { guidsOfSet, pourRowsOfGroup } from '../../../scenarios/stepPours';
import { inheritRecipes } from '../../../prs/recipeInheritance';
import type { PourFact } from '../../../prs/match';
import { daysText, overrideOf, planWorkItem, sourceText, withItemLimit, withItemOverride, type ItemOverride, type PlannedActivity, type WorkItemPlan } from '../../../prs/activityPlan';
import { useRuleContext } from '../rules/RuleParts';
import { useEditableGrid } from '../../useEditableGrid';
import { useIndexTick } from '../../modelFields';
import { useGenerate2Tab } from './Generate2Tabs';

/** Under a work item of Generate 2's tree: the activities it will be generated with, and for each its crew, its days and how many may run at once,
    with where each value comes from (prs/activityPlan.ts). The crew, the days and the recipe can be changed here for this work item only; the change
    is kept with the scenario and beats every other value when it is generated. The tables of crews, rates and recipes stay under Advanced. */

const norm = (s: string) => s.trim().toUpperCase();
const num = (v: string): number | null => (v.trim() === '' || !Number.isFinite(Number(v.replace(',', '.'))) ? null : Number(v.replace(',', '.')));

/** The objects of each set (the pour table's rows the set holds), by upper-case set name. */
export function useSetFacts(groups: string[]): Map<string, PourFact[]> {
  const rows = useScenarioStore((s) => s.rows);
  const ctx = useRuleContext();
  const sets = useSearchSetsStore((s) => s.sets);
  const engine = useViewerEngine();
  const tick = useIndexTick();
  const key = groups.map(norm).join('\u0001');
  return useMemo(() => {
    const indexes = engine.getIndexes();
    const byKey = new Map(ctx.facts.map((f) => [f.key, f]));
    return new Map(groups.map((g) => [norm(g), pourRowsOfGroup(g, rows, ctx.membership, sets, (set) => guidsOfSet(indexes, set)).flatMap((r) => byKey.get(r.key) ?? [])]));
  }, [key, rows, ctx.facts, ctx.membership, sets, engine, tick]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The plan of each set, by upper-case set name. */
export function usePlans(groups: string[]): Map<string, WorkItemPlan> {
  const ctx = useRuleContext();
  const facts = useSetFacts(groups);
  const recipes = useRecipeStore((s) => s.recipes);
  const sets = useSearchSetsStore((s) => s.sets);
  const crewSheet = useScenarioStore((s) => s.crews);
  const inherited = useMemo(() => inheritRecipes(recipes, sets), [recipes, sets]);
  return useMemo(() => new Map(groups.map((g) => [norm(g), planWorkItem({ group: g, recipes: inherited, rules: ctx.rules, crewSheet, facts: facts.get(norm(g)) ?? [], membership: ctx.membership })])), [facts, inherited, ctx.rules, ctx.membership, crewSheet]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function WorkItemPanel({ group, plan }: { group: string; plan: WorkItemPlan }) {
  const ctx = useRuleContext();
  const recipes = useRecipeStore((s) => s.recipes);
  const open = useGenerate2Tab((s) => s.open);
  const o = overrideOf(ctx.rules, group);
  const crews = ctx.rules.crewTemplates.filter((c) => c.enabled !== false);
  const chains = recipes.filter((r) => r.enabled !== false && r.chain !== false);
  const change = (fn: (o: ItemOverride) => ItemOverride) => ctx.change((r) => withItemOverride(r, group, fn));
  const setTask = (phase: string, patch: { crew?: string; days?: number }) => change((x) => ({ ...x, tasks: { ...x.tasks, [phase]: { ...x.tasks?.[phase], ...patch } } }));
  const ownLimit = (phase: string) => ctx.rules.limits.find((l) => l.group && norm(l.group) === norm(group) && norm(l.phase) === norm(phase));
  const rows = plan.activities;
  const grid = useEditableGrid({
    widthsKey: 'generate2.plan',
    rows,
    get: (col, a) => (col === 'days' ? String(o.tasks?.[a.phase]?.days ?? '') : col === 'max' ? String(ownLimit(a.phase)?.max ?? '') : ''),
    write: (col, cells) => {
      if (col === 'days') change((x) => {
        const tasks = { ...x.tasks };
        for (const [at, text] of cells) { const p = rows[at].phase; const d = num(text); tasks[p] = { ...tasks[p], days: d !== null && d >= 0 ? d : undefined }; }
        return { ...x, tasks };
      });
      if (col === 'max') ctx.change((r) => cells.reduce((acc, [at, text]) => withItemLimit(acc, group, rows[at].phase, text), r));
    },
  });
  const crewCell = (a: PlannedActivity) => {
    const mine = o.tasks?.[a.phase]?.crew ?? '';
    return (
      <td className="xl__cell">
        <select value={mine} disabled={crews.length === 0} aria-label={`Crew of ${a.name}`}
          title={crews.length === 0 ? 'No named crews in this scenario yet: add them with Manage crews & rates' : 'The crew for this activity of this work item only'}
          onChange={(e) => setTask(a.phase, { crew: e.target.value || undefined })}>
          <option value="">{a.crew && !mine ? a.crew.label : a.crew && mine ? 'Back to the default' : 'No default crew: set one'}</option>
          {crews.map((c) => <option key={c.id} value={c.id}>{c.subcontractor ? `${c.subcontractor} · ${c.id}` : c.id} ({c.trades.map((t) => `${t.trade} ${t.size}`).join(', ') || 'no people'})</option>)}
        </select>
      </td>
    );
  };
  const chip = (text: string, warn = false, title?: string) => <span className={`source-chip${warn ? ' source-chip--warn' : ''}`} title={title}>{text}</span>;
  return (
    <div className="g2-plan">
      <div className="rel-bar g2-plan__bar">
        <label className="g2-plan__recipe">
          <span>Built with</span>
          <select value={o.recipe ?? ''} aria-label="Recipe" title="The recipe that makes this work item's activities. Pick another for this work item only" onChange={(e) => change((x) => ({ ...x, recipe: e.target.value || undefined }))}>
            <option value="">{o.recipe ? 'Back to the default recipe' : plan.recipe ? `${plan.recipe.id} (${sourceText(plan.recipe.source)})` : 'The generator’s own activities (no recipe)'}</option>
            {chains.map((r) => <option key={r.id} value={r.id}>{r.id}{r.name ? ` · ${r.name}` : ''}{r.group.trim() ? ` (for ${r.group})` : ''}</option>)}
          </select>
        </label>
        {plan.recipe && <button type="button" className="link-btn" onClick={() => { try { localStorage.setItem('recipes.pick', JSON.stringify(recipes.find((r) => r.id === plan.recipe!.id)?.group ?? '')); } catch { /* the list opens where it was */ } open('recipes'); }} title="Open the recipe under Advanced to change it for every work item that uses it">Edit recipe</button>}
        <span className="scn-dim g2-plan__qty">{plan.objects.toLocaleString()} object{plan.objects === 1 ? '' : 's'} in the order table{plan.volume > 0 ? ` · ${plan.volume.toLocaleString(undefined, { maximumFractionDigits: 1 })} m³` : ''}</span>
      </div>
      {plan.objects === 0 && <div className="scn-dim xl__note">None of this set’s objects is in the order table, so the days below are for no object in particular. The order table holds the objects the generator builds activities for.</div>}
      {plan.others.map((x) => <div key={x.recipe} className="scn-status scn-status--warn seq__warn" role="status">{x.objects.toLocaleString()} of its objects get {x.recipe ? `recipe ${x.recipe}` : 'the generator’s own activities'} instead: another group of objects fits them with a higher priority. Pick a recipe above to build them all the same.</div>)}
      {rows.length === 0 ? (
        <div className="scn-dim scn-editor__help">No recipe fits these objects, so the generator gives them its own activities. Pick a recipe above to choose them.</div>
      ) : (
        <table className="xl xgrid g2-plan__grid" {...grid.grid}>
          <colgroup><col style={{ width: 36 }} /><col style={{ width: 170 }} /><col style={{ width: 220 }} /><col style={{ width: 90 }} /><col style={{ width: 200 }} /><col style={{ width: 80 }} /></colgroup>
          <thead><tr><th className="xl__corner" aria-label="Row" /><th>Activity</th><th title="The crew each object's activity gets; pick one to change it for this work item">Crew</th><th title="Working days of each object's activity: type a number to fix it for this work item">Days</th><th title="Where the crew and the days come from">From</th><th title="At most this many of the activity at the same time, for this work item (empty: the scenario's limit, if any)">Max at once</th></tr></thead>
          <tbody>
            {rows.map((a, at) => {
              const fixed = o.tasks?.[a.phase]?.days;
              const lim = ownLimit(a.phase);
              return (
                <tr key={a.phase} data-line={at}>
                  <th className="xl__row" scope="row">{at + 1}</th>
                  <td className="xl__cell xl__ro" title={a.phase !== a.name ? `Activity ${a.phase}` : undefined}>{a.name}</td>
                  {crewCell(a)}
                  <td className={`xl__cell xgrid__cell${grid.sel('days', at)}`} data-col="days" data-row={at}>
                    <input {...grid.cell('days', at)} className="xl__num" type="text" inputMode="decimal" value={fixed ?? ''} placeholder={a.days ? daysText(a.days) : a.daysNote ? 'at Generate' : ''} spellCheck={false}
                      title={fixed !== undefined ? 'Fixed for this work item. Empty it to go back to the default' : a.days ? `${daysText(a.days)} by default (${a.days.how}). Type a number to fix it for this work item` : a.daysNote ? `The days are ${a.daysNote}` : undefined}
                      onChange={(e) => { const d = num(e.target.value); setTask(a.phase, { days: d !== null && d >= 0 ? d : undefined }); }} />{grid.handle('days', at)}
                  </td>
                  <td className="xl__cell xl__ro g2-plan__from">
                    {a.crew ? chip(`crew: ${sourceText(a.crew.source, a.name)}`) : chip('no default crew', true, 'No crew rule, recipe or Crews sheet row gives this activity a crew: it is generated without labour. Pick a crew in the row')}
                    {a.days ? chip(`days: ${sourceText(a.days.source)}`, false, a.days.how) : a.daysNote ? chip('days: at Generate', false, `The days are ${a.daysNote}`) : null}
                  </td>
                  <td className={`xl__cell xgrid__cell${grid.sel('max', at)}`} data-col="max" data-row={at}>
                    <input {...grid.cell('max', at)} className="xl__num" type="text" value={String(lim?.max ?? '')} placeholder={!lim && a.limit ? a.limit : ''} spellCheck={false}
                      title={lim ? 'For this work item. Empty it to go back to the scenario’s limit' : a.limit ? `The scenario’s limit is ${a.limit}. Type a number for this work item` : 'No limit. Type how many may run at once (a number, or a parameter’s name)'}
                      onChange={(e) => ctx.change((r) => withItemLimit(r, group, a.phase, e.target.value))} />{grid.handle('max', at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {crews.length === 0 && rows.length > 0 && <div className="scn-dim xl__note">This scenario has no named crews yet, so a crew cannot be picked here. <button type="button" className="link-btn" onClick={() => open('crews')}>Manage crews & rates</button></div>}
    </div>
  );
}
