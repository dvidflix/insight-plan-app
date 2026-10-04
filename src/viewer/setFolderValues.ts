import type { ModelIndex } from './ViewerEngine';
import { NO_VALUE, elementValue } from './bimTables';
import { runSearchSet, type SearchSet } from './searchSets';
import type { ElementSummary } from './types';

/** A colouring "field" that is a folder of search / selection sets: an
    object's value is the name of the set in that folder that finds it. */
export const SET_FOLDER = 'SetFolder:';
export const isSetFolderField = (field: string) => field.startsWith(SET_FOLDER);
export const setFolderOf = (field: string) => field.slice(SET_FOLDER.length);

/** The value of `field` on an object — a property, or (for a set folder) the
    set that holds it. Sets are tried in list order; the first to find an
    object names it, and objects in none of them have no value. */
export function makeValueOf(field: string, indexes: ReadonlyMap<string, ModelIndex>, sets: SearchSet[]): (e: ElementSummary) => string {
  if (!isSetFolderField(field)) return (e) => elementValue(e, field);
  const folder = setFolderOf(field);
  const named = new Map<ElementSummary, string>();
  for (const set of sets) {
    if ((set.group ?? '') !== folder) continue;
    for (const [modelId, ids] of Object.entries(runSearchSet(indexes, set))) {
      const index = indexes.get(modelId);
      if (!index) continue;
      for (const id of ids) {
        const e = index.elements.get(id);
        if (e && !named.has(e)) named.set(e, set.name);
      }
    }
  }
  return (e) => named.get(e) ?? NO_VALUE;
}
