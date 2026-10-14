import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { normalizeRules, type PoolRow } from '../prs/rules';
import type { Recipe } from '../prs/recipes';

/** The recipe library: how each kind of object is built (docs/design/recipes.md), kept in this browser and shown in the Recipes panel with or
    without a scenario open. A scenario carries a copy in its rules (state/scenarioStore keeps the two the same), which is what it saves and
    what the generator reads. The pools (how many of each equipment, crane and material type) are part of the library. */

interface RecipeState {
  recipes: Recipe[];
  pools: PoolRow[];
  setRecipes: (recipes: Recipe[]) => void;
  setPools: (pools: PoolRow[]) => void;
}

export const useRecipeStore = create<RecipeState>()(
  persist(
    (set) => ({
      recipes: [],
      pools: [],
      setRecipes: (recipes) => set({ recipes }),
      setPools: (pools) => set({ pools }),
    }),
    {
      name: 'recipes.library',
      version: 1,
      partialize: (s) => ({ recipes: s.recipes, pools: s.pools }),
      // What was saved is read through the rules' own check, so a hand-edited or older entry cannot break the panel.
      merge: (saved, current) => {
        const r = normalizeRules({ recipes: (saved as Partial<RecipeState> | undefined)?.recipes, resourcePools: (saved as Partial<RecipeState> | undefined)?.pools });
        return { ...current, recipes: r.recipes, pools: r.resourcePools };
      },
    },
  ),
);

export const setRecipes = (recipes: Recipe[]) => useRecipeStore.getState().setRecipes(recipes);
export const setPools = (pools: PoolRow[]) => useRecipeStore.getState().setPools(pools);
