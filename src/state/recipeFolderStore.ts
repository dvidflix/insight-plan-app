import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The Search sets folder whose sets the recipes are made for: each set of it is a group of objects, and a recipe names one. It is
    "Recipes sets" unless another folder is chosen (Recipes > + Recipe > From folder). Kept in this browser, like the recipes. */
export const DEFAULT_RECIPE_FOLDER = 'Recipes sets';

interface RecipeFolderState {
  folder: string;
  setFolder: (folder: string) => void;
}

export const useRecipeFolderStore = create<RecipeFolderState>()(
  persist(
    (set) => ({ folder: DEFAULT_RECIPE_FOLDER, setFolder: (folder) => set({ folder }) }),
    { name: 'recipes.setsFolder', version: 1, partialize: (s) => ({ folder: s.folder }) },
  ),
);

/** The folder now (for code outside the components). */
export const recipeFolder = () => useRecipeFolderStore.getState().folder || DEFAULT_RECIPE_FOLDER;
