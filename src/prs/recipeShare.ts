import { normalizeRules } from './rules';
import type { Recipe } from './recipes';

/** Sharing recipes (Generate's recipe editor): a small file of recipes alone, to send to a colleague or keep as a project's standard way of building,
    and reading one back into the open scenario. A recipe in the file whose ID the scenario has already is either taken in place of it, or added
    as a copy with a new ID; nothing else in the scenario changes. */

export const SHARE_KIND = 'insight-plan.recipes';

export interface RecipeShareFile {
  kind: typeof SHARE_KIND;
  version: 1;
  exported: string;
  recipes: Recipe[];
}

export function toShareFile(recipes: readonly Recipe[], now = new Date()): RecipeShareFile {
  return { kind: SHARE_KIND, version: 1, exported: now.toISOString(), recipes: recipes.map((r) => ({ ...r })) };
}

/** The recipes in a shared file's text, read through the rules' own check. Throws with a plain message when it is not such a file. */
export function readShareFile(text: string): Recipe[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not a recipes file (it is not JSON).');
  }
  const d = data as Partial<RecipeShareFile> | null;
  if (!d || d.kind !== SHARE_KIND || !Array.isArray(d.recipes)) throw new Error('That file is not a recipes file exported from Insight Plan.');
  const recipes = normalizeRules({ recipes: d.recipes }).recipes;
  if (!recipes.length) throw new Error('That recipes file holds no recipes.');
  return recipes;
}

const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();
const sameContent = (a: Recipe, b: Recipe) => JSON.stringify({ ...a, id: '' }) === JSON.stringify({ ...b, id: '' });

/** `incoming` taken into `current`: new IDs are added; one whose ID is taken replaces it (`replace`) or is added as a copy with a free ID. One the
    same as what is there already is left out. */
export function mergeRecipes(current: readonly Recipe[], incoming: readonly Recipe[], replace: boolean): { recipes: Recipe[]; added: string[]; replaced: string[]; copied: string[]; same: string[] } {
  const out = [...current];
  const added: string[] = [];
  const replaced: string[] = [];
  const copied: string[] = [];
  const unchanged: string[] = [];
  for (const r of incoming) {
    const at = out.findIndex((x) => same(x.id, r.id));
    if (at < 0) { out.push(r); added.push(r.id); continue; }
    if (sameContent(out[at], r)) { unchanged.push(r.id); continue; }
    if (replace) { out[at] = { ...r, id: out[at].id }; replaced.push(out[at].id); continue; }
    let id = `${r.id} (imported)`;
    for (let k = 2; out.some((x) => same(x.id, id)); k++) id = `${r.id} (imported ${k})`;
    out.push({ ...r, id, name: r.name ? `${r.name} (imported)` : id });
    copied.push(id);
  }
  return { recipes: out, added, replaced, copied, same: unchanged };
}

/** The IDs of `incoming` that the scenario has already with other content (what Import asks about). */
export const clashes = (current: readonly Recipe[], incoming: readonly Recipe[]) =>
  incoming.filter((r) => current.some((x) => same(x.id, r.id) && !sameContent(x, r))).map((r) => r.id);
