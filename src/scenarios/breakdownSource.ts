import type { ModelIndex } from '../viewer/ViewerEngine';
import { runSearchSet, type SearchSet } from '../viewer/searchSets';
import { SET_FOLDER, isSetFolderField, makeValueOf } from '../viewer/setFolderValues';
import { NO_VALUE } from '../viewer/bimTables';
import { buildBreakdown, type BreakdownDefinition, type BreakdownObject, type BreakdownResult } from '../prs/workBreakdown';

/** The objects of the loaded models and the sets of the folders, given to the grouping levels (prs/workBreakdown.ts). An object's key is "<model id>:<local id>". */

const numbered = (name: string) => /^\s*\d+/.test(name);
const lead = (name: string) => Number(/^\s*(\d+)/.exec(name)?.[1] ?? 0);

/** The sets of a folder in its order: by the number the names start with when they all do, else as the folder lists them. */
export function setsOfFolder(sets: readonly SearchSet[], folder: string): SearchSet[] {
  const own = sets.filter((s) => s.group === folder);
  return own.every((s) => numbered(s.name)) ? [...own].sort((a, b) => lead(a.name) - lead(b.name) || a.name.localeCompare(b.name, undefined, { numeric: true })) : own;
}

/** The "Set" virtual properties a definition names (a property "SetFolder:<folder>": the name of the first set of the folder that finds the object). */
export const virtualPropertiesOf = (definition: BreakdownDefinition): string[] =>
  [...new Set([...definition.levels.map((l) => (l.source.kind === 'property' ? l.source.property : '')), definition.quantityProperty ?? ''].filter(isSetFolderField))];

export function objectsOf(indexes: ReadonlyMap<string, ModelIndex>, sets: readonly SearchSet[] = [], virtual: string[] = []): BreakdownObject[] {
  const out: BreakdownObject[] = [];
  const readers = virtual.map((field) => [field, makeValueOf(field, indexes, [...sets])] as const);
  for (const [modelId, index] of indexes) {
    for (const [id, e] of index.elements) {
      const props: Record<string, unknown> = { ...e.props, Class: e.category, Name: e.name };
      for (const [field, read] of readers) { const v = read(e); if (v !== NO_VALUE) props[field] = v; }
      out.push({ key: `${modelId}:${id}`, guid: e.guid, name: e.name, props });
    }
  }
  return out;
}

/** What a property is called to a person: a set folder reads "Set › folder". */
export const propertyLabel = (property: string): string => (isSetFolderField(property) ? `Set › ${property.slice(SET_FOLDER.length) || '(no folder)'}` : property);

/** The work items the levels make of the loaded models. */
export function computeBreakdown(definition: BreakdownDefinition, indexes: ReadonlyMap<string, ModelIndex>, sets: readonly SearchSet[]): BreakdownResult {
  return buildBreakdown({
    definition,
    objects: objectsOf(indexes, sets, virtualPropertiesOf(definition)),
    sets: (folder) => setsOfFolder(sets, folder).map((set) => ({
      name: set.name,
      keys: new Set(Object.entries(runSearchSet(indexes, set)).flatMap(([modelId, ids]) => ids.map((id) => `${modelId}:${id}`))),
    })),
  });
}
