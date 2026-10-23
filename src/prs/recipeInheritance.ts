import type { SearchSet } from '../viewer/searchSets';
import { folderAndAncestors, folderKey, folderParts, isInFolder } from '../viewer/setTree';
import type { Recipe } from './recipes';

/** A recipe can be for a folder of search sets (its group is the folder's path, "Top / Next"): every set inside the folder that has no recipe of its own
    gets it, from the nearest folder above it that has one. A recipe for a set (its group is the set's name) always wins over a folder's. The recipes stay
    the scenario's own: this only makes the copies the generator reads, one per set, and nothing is written on the sets. */

const norm = (s: string) => s.trim().toUpperCase();
const isChain = (r: Recipe) => r.enabled !== false && r.chain !== false;

/** The paths of the folders that have a recipe, from the recipes' groups: a group is a folder when no set has that name and some set is inside it. */
function folderRecipes(recipes: readonly Recipe[], sets: readonly SearchSet[]): Recipe[] {
  const names = new Set(sets.map((s) => norm(s.name)));
  return recipes.filter((r) => r.group.trim() && !names.has(norm(r.group)) && sets.some((s) => isInFolder(s.group ?? '', r.group)));
}

/** The recipes with each folder recipe replaced by a copy for every set that inherits it (the folder recipes themselves are left out: the folder is no
    group). The same array when no recipe is for a folder. */
export function inheritRecipes(recipes: Recipe[], sets: readonly SearchSet[]): Recipe[] {
  const folders = folderRecipes(recipes, sets);
  if (!folders.length) return recipes;
  const isFolder = new Set(folders);
  const rest = recipes.filter((r) => !isFolder.has(r));
  const own = new Set(rest.filter((r) => r.group.trim()).map((r) => `${isChain(r) ? 'chain' : 'values'}|${norm(r.group)}`));
  const copies: Recipe[] = [];
  for (const s of sets) {
    if (s.kind === 'selection') continue;
    for (const kind of ['chain', 'values'] as const) {
      if (own.has(`${kind}|${norm(s.name)}`)) continue;
      // The nearest folder above the set that has a recipe of this kind.
      for (const path of folderAndAncestors(folderKey(s.group ?? ''))) {
        const hit = folders.find((r) => norm(folderKey(r.group)) === norm(path) && (isChain(r) ? 'chain' : 'values') === kind && r.enabled !== false);
        if (!hit) continue;
        copies.push({ ...hit, id: `${hit.id} @ ${s.name}`, group: s.name, folder: undefined });
        break;
      }
    }
  }
  return [...rest, ...copies];
}

/** The names of the sets that get a recipe from a folder (they must be rule groups for the generator to find them). */
export const inheritingSetNames = (recipes: Recipe[], sets: readonly SearchSet[]): string[] => {
  const folders = folderRecipes(recipes, sets);
  return folders.length ? sets.filter((s) => s.kind !== 'selection' && folders.some((r) => isInFolder(s.group ?? '', r.group))).map((s) => s.name) : [];
};

/** The folders a recipe can be for: every folder path that holds sets, with the folders between. */
export const recipeFolderChoices = (sets: readonly Pick<SearchSet, 'group'>[]): string[] => [...new Set(sets.flatMap((s) => folderAndAncestors(folderKey(s.group ?? '')).filter((p) => folderParts(p).length > 0)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
