import type { Recipe } from './recipes';

/** Folders of the recipe list: a recipe has an optional `folder` (a name; empty: not in one). Only the list uses it, the generator ignores it. The order
    of the recipes is the order of the list and, when two recipes of a group tie, the earlier wins, so moving one before another is a real change and is
    only done when a recipe is dropped on another; dropping on a folder only changes its folder. */

const same = (a: string | undefined, b: string | undefined) => (a ?? '').trim().toUpperCase() === (b ?? '').trim().toUpperCase();

/** The folders the recipes are in, by name, in the order they are first met. */
export function foldersOf(recipes: Pick<Recipe, 'folder'>[]): string[] {
  const out: string[] = [];
  for (const r of recipes) { const f = (r.folder ?? '').trim(); if (f && !out.some((o) => same(o, f))) out.push(f); }
  return out;
}

const withFolder = (r: Recipe, folder: string): Recipe => {
  const { folder: _old, ...rest } = r;
  return folder.trim() ? { ...rest, folder: folder.trim() } : rest;
};

/** The recipe at `from` put in `folder` ('' = no folder). With `before` (the index of another recipe) it also goes in front of that recipe. */
export function moveRecipe(recipes: Recipe[], from: number, folder: string, before: number | null = null): Recipe[] {
  if (!recipes[from]) return recipes;
  const moved = withFolder(recipes[from], folder);
  if (before === null || before === from || before === from + 1) return recipes.map((r, i) => (i === from ? moved : r));
  const rest = recipes.filter((_, i) => i !== from);
  rest.splice(before > from ? before - 1 : before, 0, moved);
  return rest;
}

/** Every recipe of the folder `from` put in the folder `to` ('' = no folder: the folder is taken away, its recipes stay). */
export function renameFolder(recipes: Recipe[], from: string, to: string): Recipe[] {
  return recipes.map((r) => (same(r.folder, from) && (r.folder ?? '').trim() ? withFolder(r, to) : r));
}
