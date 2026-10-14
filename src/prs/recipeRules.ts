import { compileRecipes, recipeLosses, recipesFromRules, type RecipesFile } from './recipes';
import { NO_RULES, isEmptyRules, normalizeRules, type ScenarioRules } from './rules';

/** The scenario's recipes next to its rules (the recipes are the scenario's own, like its joined objects: a preset does not bring or take them,
    and they go with the scenario when it is saved, copied and updated in 4D). The file format of a recipes file is RecipesFile (prs/recipes.ts). */

/** The rules as the generator should read them: with recipes, the recipes are the activities, so the chain and assignment rows (what the recipes were
    made from) are left out, or every activity would be there twice. */
export function forGenerator(rules: ScenarioRules): ScenarioRules {
  return (rules.recipes ?? []).some((r) => r.enabled !== false) && (rules.chains.length || rules.assignments.length) ? { ...rules, chains: [], assignments: [] } : rules;
}

/** The scenario's rules with the chains and assignments of its recipes added: what the generator would read. */
export function withRecipes(rules: ScenarioRules, file: RecipesFile): ScenarioRules {
  if (!file.recipes.length) return rules;
  const { chains, assignments } = compileRecipes(file);
  return normalizeRules({ ...rules, recipes: [], chains: [...rules.chains, ...chains], assignments: [...rules.assignments, ...assignments] });
}

/** A scenario's rules as the rules without chains and assignments, and the recipes that stand for them. `losses` says what the recipes cannot
    hold exactly (a group whose chain rows have different priorities, say); with none, `withRecipes(rules, recipes)` is the original. */
export function splitRecipes(rules: ScenarioRules): { rules: ScenarioRules; recipes: RecipesFile; losses: string[] } {
  const recipes = recipesFromRules(rules);
  const losses = recipeLosses(rules, recipes);
  return { rules: normalizeRules({ ...rules, chains: [], assignments: [] }), recipes, losses };
}

/** These rules with the scenario's own recipes, pools and joins (what a preset is loaded, added or saved without). */
export function withOwn(rules: ScenarioRules, own: Pick<ScenarioRules, 'recipes' | 'joins' | 'resourcePools'>): ScenarioRules {
  const next = { ...rules, recipes: own.recipes ?? [], joins: own.joins ?? [], resourcePools: own.resourcePools ?? [] };
  return isEmptyRules(next) ? NO_RULES : next;
}
