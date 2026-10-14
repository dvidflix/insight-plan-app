import type { Recipe, ResourceUse } from './recipes';
import type { ScenarioRules } from './rules';

/** What a recipe needs, read off its tasks (the Recipes panel shows it above the recipe): the days added up, the most people one task needs
    at once (from the crew it names), and the most of each crane, equipment and material type any task uses. */
export interface RecipeNeeds {
  days: number;
  people: number;
  crews: string[];
  cranes: { type: string; count: number }[];
  equipment: { type: string; count: number }[];
  materials: { type: string; count: number }[];
}

function peak(recipe: Recipe, key: 'cranes' | 'equipment' | 'materials'): { type: string; count: number }[] {
  const most = new Map<string, { type: string; count: number }>();
  for (const t of recipe.tasks) {
    if (t.enabled === false) continue;
    for (const u of (t[key] ?? []) as ResourceUse[]) {
      const k = u.type.trim().toUpperCase();
      if (!k) continue;
      const count = u.count ?? 1;
      const have = most.get(k);
      if (!have) most.set(k, { type: u.type.trim(), count });
      else if (count > have.count) have.count = count;
    }
  }
  return [...most.values()];
}

export function recipeNeeds(recipe: Recipe, rules: Pick<ScenarioRules, 'crewTemplates'>): RecipeNeeds {
  const tasks = recipe.tasks.filter((t) => t.enabled !== false);
  const crews = [...new Set(tasks.map((t) => (t.crew ?? '').trim()).filter(Boolean))];
  const people = Math.max(0, ...crews.map((id) => {
    const c = rules.crewTemplates.find((x) => x.id.trim().toUpperCase() === id.toUpperCase());
    return c ? c.trades.reduce((n, t) => n + (t.size || 0), 0) : 0;
  }));
  return {
    days: tasks.reduce((n, t) => n + (t.days ?? 0), 0),
    people,
    crews,
    cranes: peak(recipe, 'cranes'),
    equipment: peak(recipe, 'equipment'),
    materials: peak(recipe, 'materials'),
  };
}
