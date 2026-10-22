import type { ModelIndex } from '../viewer/ViewerEngine';
import { runSearchSet, type SearchSet } from '../viewer/searchSets';

/** The pours of a Sequence step: a step owns a group name, and the pours that belong to it are those in that group, by name, in either of the two ways
    a name is a group: a rule group of the scenario (`membership`: the groups each pour is in, from its Building, Level, Pour Type ... facts), or a
    search / selection set of Models › Search sets (the objects it finds in the loaded models, matched to the pours by GlobalId). Either finds a pour. */

const norm = (s: string) => s.trim().toUpperCase();

/** The GlobalIds of the objects a set finds in the loaded models. */
export function guidsOfSet(indexes: ReadonlyMap<string, ModelIndex>, set: Pick<SearchSet, 'match' | 'conditions' | 'kind' | 'items'>): Set<string> {
  const out = new Set<string>();
  for (const [modelId, ids] of Object.entries(runSearchSet(indexes, set))) {
    const index = indexes.get(modelId);
    if (!index) continue;
    for (const id of ids) { const guid = index.elements.get(id)?.guid; if (guid) out.add(guid); }
  }
  return out;
}

/** The pour rows (their `key` is the pour's GlobalId, then an optional #suffix) that belong to `group`, in the order of `rows`. */
export function pourRowsOfGroup<R extends { key: string }, S extends { name: string }>(
  group: string,
  rows: readonly R[],
  membership: ReadonlyMap<string, ReadonlySet<string>>,
  sets: readonly S[],
  guidsOf: (set: S) => ReadonlySet<string>,
): R[] {
  const name = norm(group);
  if (!name) return [];
  const inSet = new Set<string>();
  for (const s of sets) if (norm(s.name) === name) for (const g of guidsOf(s)) inSet.add(g);
  return rows.filter((r) => inSet.has(r.key.split('#')[0]) || [...(membership.get(r.key) ?? [])].some((g) => norm(g) === name));
}
