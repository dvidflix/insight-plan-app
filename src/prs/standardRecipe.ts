import type { Recipe, RecipeTask } from './recipes';
import { QUANTITY_NAMES } from './recipesWorkbook';
import type { StandardMethod } from './standardMethods';

/** A project recipe made from one of Generate 3's standard methods (the recipe editor's "Like a standard method"), noted as such so the two can be
    compared. */

export const FROM_STD = 'From standard method: ';

/** A recipe made from a standard method: its activities with a formula of the work's volume for the rates per m³ (the model's areas and counts are
    not names a formula can read, so those start as their fewest days, to set). */
export function recipeFromStandard(m: StandardMethod, taken: readonly string[]): Recipe {
  let id = m.name;
  for (let k = 2; taken.some((t) => t.toUpperCase() === id.toUpperCase()); k++) id = `${m.name} ${k}`;
  return {
    id, name: id, group: '', note: `${FROM_STD}${m.name}`,
    tasks: m.tasks.map((t): RecipeTask => (t.per === 'm3'
      ? { phase: t.phase, name: t.name, formula: `max(${t.min}, ceil(${QUANTITY_NAMES[0]} / ${t.rate}))`, crew: m.crew.id }
      : { phase: t.phase, name: t.name, days: t.min, crew: m.crew.id, note: `${t.rate} ${t.per === 'm2' ? 'm² ' : 'objects '}a day in the standard method: set the days` })),
  };
}

