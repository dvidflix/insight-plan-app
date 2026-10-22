import { useRecipeStore } from '../../../state/recipeStore';
import { useResourceFocus, useStepFocus } from '../../../state/resourceFocusStore';
import { useGenerateTab } from '../GenerateTabs';
import { previewDays } from '../../../prs/recipesWorkbook';
import type { Recipe, RecipeTask, ResourceUse } from '../../../prs/recipes';
import type { PoolRow, ScenarioRules } from '../../../prs/rules';

/** Traceability for the Order: under a step, the activities its objects will be generated with (from the recipe of its group), their days and the
    resources they use, each resource a link to its row on the Resources tab. Above the steps, a check of the recipes against the resources: a task that
    needs more of a resource than the scenario has. (A true peak needs the generated programme; this is the worst one task asks for.) */

const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const KEYS = ['cranes', 'equipment', 'materials'] as const;
const SAMPLE = { Concrete_m3: 150, Rebar_t: 3.5, Rebar_kg: 3500, Footprint_m2: 200, Sides_m2: 120 };

const useOf = (t: RecipeTask): (ResourceUse & { key: (typeof KEYS)[number] })[] => KEYS.flatMap((key) => (t[key] ?? []).map((u) => ({ ...u, key })));

/** The recipes whose activities an object of the group gets (a recipe of no group is for every object). */
export const recipesOfGroup = (recipes: Recipe[], group: string): Recipe[] =>
  recipes.filter((r) => r.enabled !== false && r.chain !== false && (r.group.trim() === '' || same(r.group, group)));

/** Tasks that ask for more of a resource than the scenario has. */
export function resourceWarnings(recipes: Recipe[], pools: PoolRow[]): string[] {
  const out: string[] = [];
  for (const r of recipes) {
    if (r.enabled === false || r.chain === false) continue;
    for (const t of r.tasks) {
      if (t.enabled === false) continue;
      for (const u of useOf(t)) {
        const p = pools.find((x) => x.enabled !== false && same(x.id, u.type));
        const need = u.count ?? 1;
        if (p && p.quantity > 0 && need > p.quantity) out.push(`${r.id} · ${t.name || t.phase} needs ${need} ${p.name || p.id}, the scenario has ${p.quantity}`);
      }
    }
  }
  return out;
}

/** The limits that apply to a task of a step: its phase, for every pour or for this group, and the number they come to (a number, a resource's quantity or a parameter). */
function limitsOf(t: RecipeTask, group: string, pools: PoolRow[], rules: ScenarioRules): { text: string; max: number | null }[] {
  return rules.limits.filter((l) => l.enabled !== false && (same(l.phase, t.phase) || (!!t.name && same(l.phase, t.name))) && (!l.group || same(l.group, group))).map((l) => {
    const m = typeof l.max === 'string' ? l.max.trim() : l.max;
    const num = typeof m === 'number' ? m : Number.isFinite(Number(m)) && m !== '' ? Number(m) : pools.find((p) => same(p.id, m) || (p.name.trim() !== '' && same(p.name, m)))?.quantity ?? rules.parameters?.find((p) => same(p.name, m))?.value ?? null;
    return { text: num && num > 0 ? `max ${num} at once` : 'no limit', max: num };
  });
}

/** Opens the Recipes tab on the recipe of a group (the Recipes tab picks recipes by their group name). */
export function openRecipe(group: string, setTab: (tab: 'recipes') => void) {
  try { localStorage.setItem('recipes.pick', JSON.stringify(group)); } catch { /* the tab just opens where it was */ }
  setTab('recipes');
}

/** Under a recipe: the Sequence steps that build it (steps of its group; a recipe of no group is for every step), each a link that opens the step. */
export function StepsUsing({ recipe, rules }: { recipe: Recipe; rules: Pick<ScenarioRules, 'sequences'> }) {
  const focus = useStepFocus((s) => s.focus);
  const setTab = useGenerateTab((s) => s.setTab);
  const steps = (rules.sequences.find((s) => s.id.toUpperCase() === 'STEPS')?.steps ?? []).map((s, i) => ({ s, n: i + 1 })).filter(({ s }) => s.group.trim() !== '' && (recipe.group.trim() === '' || same(s.group, recipe.group)));
  return (
    <div className="scn-dim xl__note">
      Built in steps: {steps.length === 0 ? 'none yet: add a step for this group on the Sequence tab' : steps.map(({ s, n }, k) => <span key={n}>{k > 0 && ', '}<button type="button" className="link-btn" title="Open this step on the Sequence tab" onClick={() => { focus(s.group); setTab('order'); }}>{n} · {s.group}</button></span>)}
    </div>
  );
}

export function ResourceLink({ type }: { type: string }) {
  const focus = useResourceFocus((s) => s.focus);
  const setTab = useGenerateTab((s) => s.setTab);
  return <button type="button" className="link-btn" title={`Open ${type} on the Resources tab: how many there are and what it limits`} onClick={(e) => { e.stopPropagation(); focus(type); setTab('resources'); }}>{type}</button>;
}

export function StepRecipe({ group, recipes, pools, rules }: { group: string; recipes: Recipe[]; pools: PoolRow[]; rules: ScenarioRules }) {
  const setTab = useGenerateTab((s) => s.setTab);
  const mine = recipesOfGroup(recipes, group);
  if (!group.trim()) return <div className="scn-dim scn-editor__help">Choose the search set or group for this step to see what it will generate.</div>;
  if (mine.length === 0) return <div className="scn-dim scn-editor__help">No recipe for “{group}”: its objects get the default activities. Add a recipe on the Recipes tab to change them.</div>;
  return (
    <div>
      {mine.map((r) => {
        const tasks = r.tasks.filter((t) => t.enabled !== false);
        return (
          <div key={r.id} style={{ marginBottom: 6 }}>
            <div className="rel-bar">
              <strong>Recipe {r.id}</strong>
              <span className="scn-dim">{tasks.length} activit{tasks.length === 1 ? 'y' : 'ies'} for each object{r.group.trim() === '' ? ' (a recipe for every object)' : ''}</span>
              <button type="button" className="link-btn" onClick={() => openRecipe(r.group, setTab)} title="Open this recipe on the Recipes tab to change its activities, days or resources">Edit recipe</button>
            </div>
            <table className="xl">
              <thead><tr><th>Activity</th><th>Duration</th><th>Crew</th><th>Resources (how many exist)</th><th title="At most this many of the activity run at the same time (Resources tab › Limits)">Limit</th></tr></thead>
              <tbody>
                {tasks.map((t, i) => {
                  const days = t.formula ? previewDays(t.formula, rules.parameters ?? [], SAMPLE) : null;
                  const uses = useOf(t);
                  return (
                    <tr key={`${t.phase}|${i}`}>
                      <td className="xl__cell xl__ro">{t.name || t.phase}</td>
                      <td className="xl__cell xl__ro" title={t.formula ? `Formula ${t.formula}; for a sample pour (150 m³)` : undefined}>
                        {t.formula ? (days && 'days' in days ? `${Math.round(days.days * 100) / 100} d (formula)` : 'formula: see Parameters') : t.days ? `${t.days} d` : t.rate ? `rate ${t.rate}` : '—'}
                      </td>
                      <td className="xl__cell xl__ro">{t.crew || '—'}</td>
                      <td className="xl__cell xl__ro">
                        {uses.length === 0 ? '—' : uses.map((u, k) => {
                          const p = pools.find((x) => same(x.id, u.type));
                          const bad = !!p && p.quantity > 0 && (u.count ?? 1) > p.quantity;
                          return <span key={`${u.key}|${u.type}`} className={bad ? 'is-bad' : undefined} title={p ? `${p.name || p.id}: ${p.quantity} available` : 'No pool: this resource does not exist yet'}>{k > 0 && ' · '}<ResourceLink type={u.type} />{(u.count ?? 1) > 1 ? ` ×${u.count}` : ''}{p ? ` (${p.quantity})` : ' (no pool)'}</span>;
                        })}
                      </td>
                      <td className="xl__cell xl__ro">{limitsOf(t, group, pools, rules).map((l) => l.text).join(' · ') || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

/** The recipes against the resources, in one line above the steps. */
export function ResourceCheck() {
  const recipes = useRecipeStore((s) => s.recipes);
  const pools = useRecipeStore((s) => s.pools);
  const warnings = resourceWarnings(recipes, pools);
  if (pools.length === 0 && recipes.length === 0) return null;
  return warnings.length === 0
    ? <div className="scn-dim scn-editor__help" role="status">Resources: no task asks for more than the scenario has.</div>
    : <div className="scn-rules__note is-error" role="status">{warnings.map((w) => <div key={w}>{w}. Raise the quantity on the Resources tab, or use fewer in the recipe.</div>)}</div>;
}
