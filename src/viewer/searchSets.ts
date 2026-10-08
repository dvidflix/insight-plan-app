import type { ModelIndex } from './ViewerEngine';
import { ATTRIBUTES, NO_VALUE, elementValue } from './bimTables';
import type { ElementSummary } from './types';

/** How a condition compares a property's value. */
export type SearchOp =
  | 'anyOf' | 'noneOf'
  | 'contains' | 'notContains' | 'equals' | 'notEquals' | 'startsWith' | 'endsWith' | 'regex'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'between'
  | 'set' | 'notSet';

export const SEARCH_OPS: { op: SearchOp; label: string; input: 'values' | 'text' | 'number' | 'range' | 'none' }[] = [
  { op: 'anyOf', label: 'is any of', input: 'values' },
  { op: 'noneOf', label: 'is none of', input: 'values' },
  { op: 'contains', label: 'contains', input: 'text' },
  { op: 'notContains', label: "doesn't contain", input: 'text' },
  { op: 'equals', label: 'equals', input: 'text' },
  { op: 'notEquals', label: "doesn't equal", input: 'text' },
  { op: 'startsWith', label: 'starts with', input: 'text' },
  { op: 'endsWith', label: 'ends with', input: 'text' },
  { op: 'regex', label: 'matches (regex)', input: 'text' },
  { op: 'gt', label: '>', input: 'number' },
  { op: 'gte', label: '≥', input: 'number' },
  { op: 'lt', label: '<', input: 'number' },
  { op: 'lte', label: '≤', input: 'number' },
  { op: 'between', label: 'between', input: 'range' },
  { op: 'set', label: 'has a value', input: 'none' },
  { op: 'notSet', label: 'has no value', input: 'none' },
];

export const opInput = (op: SearchOp) => SEARCH_OPS.find((o) => o.op === op)?.input ?? 'text';

export interface SearchCondition {
  id: string;
  /** Property key: "Attributes.Class", "Pset.Prop", … (see bimTables.elementValue). */
  field: string;
  op: SearchOp;
  /** Text / number / regex, or the range's lower end. */
  value: string;
  /** The range's upper end (between). */
  value2?: string;
  /** Picked values (is any of / is none of). */
  values?: string[];
}

/** One object of a selection set: its model (by name; '' = any) and GlobalId, so the
    set survives reloading or re-converting the model. */
export interface SetItem {
  model: string;
  guid: string;
}

export interface SearchSet {
  id: string;
  name: string;
  /** Folder in the list ('' = none). */
  group: string;
  /** A search (conditions, run again each time) or a saved selection (fixed objects). */
  kind?: 'search' | 'selection';
  /** All conditions must hold, or any one. */
  match: 'all' | 'any';
  conditions: SearchCondition[];
  /** Selection sets: the objects. */
  items?: SetItem[];
  /** Selection sets saved before GlobalIds: local ids per model, turned
      into items once that model is loaded (see upgradeLegacyItems). */
  legacy?: Record<string, number[]>;
}

export const isSelectionSet = (s: Pick<SearchSet, 'kind'>) => s.kind === 'selection';

/** GlobalId -> local id, per model index (built once per index). */
const guidMaps = new WeakMap<ModelIndex, Map<string, number>>();
function guidMap(index: ModelIndex) {
  let map = guidMaps.get(index);
  if (!map) {
    map = new Map();
    for (const [id, e] of index.elements) if (e.guid) map.set(e.guid, id);
    guidMaps.set(index, map);
  }
  return map;
}

/** A selection's objects as set items (objects without a GlobalId are left out). */
export function itemsOf(indexes: ReadonlyMap<string, ModelIndex>, ids: Record<string, Iterable<number>>): SetItem[] {
  const out: SetItem[] = [];
  for (const [modelId, list] of Object.entries(ids)) {
    const index = indexes.get(modelId);
    if (!index) continue;
    for (const id of list) {
      const guid = index.elements.get(id)?.guid;
      if (guid) out.push({ model: index.name, guid });
    }
  }
  return out;
}

const itemKey = (i: SetItem) => `${i.model}|${i.guid}`;

/** `a` plus `b`, or `a` without `b`. */
export function mergeItems(a: SetItem[], b: SetItem[], remove = false): SetItem[] {
  if (remove) {
    const drop = new Set(b.map(itemKey));
    return a.filter((i) => !drop.has(itemKey(i)));
  }
  const seen = new Set(a.map(itemKey));
  return [...a, ...b.filter((i) => !seen.has(itemKey(i)) && seen.add(itemKey(i)))];
}

/** A selection set's objects in the loaded models, and how many of its
    items aren't in them (model not loaded, or object gone). */
export function resolveItems(indexes: ReadonlyMap<string, ModelIndex>, items: SetItem[]): { ids: Record<string, number[]>; missing: number } {
  const byName = new Map([...indexes].map(([modelId, index]) => [index.name, { modelId, map: guidMap(index) }]));
  const ids: Record<string, number[]> = {};
  let missing = 0;
  for (const item of items) {
    // Model '' (imported from a file): whichever loaded model has the GlobalId.
    const m = item.model === '' ? [...byName.values()].find((x) => x.map.has(item.guid)) : byName.get(item.model);
    const id = m?.map.get(item.guid);
    if (m && id !== undefined) (ids[m.modelId] ??= []).push(id);
    else missing++;
  }
  return { ids, missing };
}

/** Old selection sets' local ids as items, for the models loaded now; what
    can't be converted yet stays in `legacy`. Null when nothing changed. */
export function upgradeLegacyItems(indexes: ReadonlyMap<string, ModelIndex>, set: SearchSet): SearchSet | null {
  if (!set.legacy) return null;
  const rest: Record<string, number[]> = {};
  const add: Record<string, number[]> = {};
  for (const [modelId, list] of Object.entries(set.legacy)) {
    if (indexes.has(modelId)) add[modelId] = list;
    else rest[modelId] = list;
  }
  if (!Object.keys(add).length) return null;
  return { ...set, items: mergeItems(set.items ?? [], itemsOf(indexes, add)), legacy: Object.keys(rest).length ? rest : undefined };
}

const num = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return v.trim() === '' || Number.isNaN(n) ? null : n;
};

/** The value(s) a condition tests on one object. The class also answers to
    its IFC name ("IfcWall" as well as "Wall"). */
function valuesOf(e: ElementSummary, field: string): string[] {
  const v = elementValue(e, field);
  return field === `${ATTRIBUTES}.Class` ? [v, e.category] : [v];
}

/** A condition as a test on one object; null when it can't run yet (no
    value typed, a bad regex) — such a condition is left out. */
export function conditionTest(c: SearchCondition): ((e: ElementSummary) => boolean) | null {
  const input = opInput(c.op);
  const text = c.value.trim().toLowerCase();
  if (input === 'text' && c.op !== 'equals' && c.op !== 'notEquals' && text === '') return null;
  const some = (e: ElementSummary, f: (v: string) => boolean) => valuesOf(e, c.field).some(f);
  const lower = (e: ElementSummary, f: (v: string) => boolean) => some(e, (v) => f(v.toLowerCase()));
  switch (c.op) {
    case 'anyOf':
    case 'noneOf': {
      if (!c.values?.length) return null;
      const set = new Set(c.values);
      const hit = (e: ElementSummary) => set.has(elementValue(e, c.field));
      return c.op === 'anyOf' ? hit : (e) => !hit(e);
    }
    case 'contains': return (e) => lower(e, (v) => v.includes(text));
    case 'notContains': return (e) => !lower(e, (v) => v.includes(text));
    case 'equals': return (e) => lower(e, (v) => (text === '' ? v === NO_VALUE.toLowerCase() : v === text));
    case 'notEquals': return (e) => !lower(e, (v) => (text === '' ? v === NO_VALUE.toLowerCase() : v === text));
    case 'startsWith': return (e) => lower(e, (v) => v.startsWith(text));
    case 'endsWith': return (e) => lower(e, (v) => v.endsWith(text));
    case 'regex': {
      let re: RegExp;
      try {
        re = new RegExp(c.value.trim(), 'i');
      } catch {
        return null;
      }
      return (e) => some(e, (v) => re.test(v));
    }
    case 'gt': case 'gte': case 'lt': case 'lte': case 'between': {
      const a = num(c.value);
      const b = num(c.value2 ?? '');
      if (a === null && (c.op !== 'between' || b === null)) return null;
      const cmp = (n: number) => {
        if (c.op === 'gt') return n > a!;
        if (c.op === 'gte') return n >= a!;
        if (c.op === 'lt') return n < a!;
        if (c.op === 'lte') return n <= a!;
        return (a === null || n >= a) && (b === null || n <= b);
      };
      return (e) => {
        const n = num(elementValue(e, c.field));
        return n !== null && cmp(n);
      };
    }
    case 'set': return (e) => elementValue(e, c.field) !== NO_VALUE;
    case 'notSet': return (e) => elementValue(e, c.field) === NO_VALUE;
  }
}

/** Why a condition is left out, or null when it runs. */
export function conditionProblem(c: SearchCondition): string | null {
  if (conditionTest(c)) return null;
  if (c.op === 'regex' && c.value.trim()) return 'Not a valid regular expression';
  const input = opInput(c.op);
  if (input === 'values') return 'Pick one or more values';
  if (input === 'number' || input === 'range') return 'Type a number';
  return 'Type a value';
}

/** The objects `set` finds across the loaded models, per model: a
    selection set's own objects, or what a search's conditions match (none
    when no condition can run). */
export function runSearchSet(indexes: ReadonlyMap<string, ModelIndex>, set: Pick<SearchSet, 'match' | 'conditions' | 'kind' | 'items'>): Record<string, number[]> {
  if (isSelectionSet(set)) return resolveItems(indexes, set.items ?? []).ids;
  const tests = set.conditions.map(conditionTest).filter((t): t is (e: ElementSummary) => boolean => t !== null);
  const out: Record<string, number[]> = {};
  if (tests.length === 0) return out;
  const hit = set.match === 'all' ? (e: ElementSummary) => tests.every((t) => t(e)) : (e: ElementSummary) => tests.some((t) => t(e));
  for (const [modelId, index] of indexes) {
    const ids: number[] = [];
    for (const [id, e] of index.elements) if (hit(e)) ids.push(id);
    if (ids.length) out[modelId] = ids;
  }
  return out;
}

export const countIds = (ids: Record<string, number[]>) => Object.values(ids).reduce((n, l) => n + l.length, 0);

/** The objects of `ids` (per model local ids) as elements. */
function elementsOf(indexes: ReadonlyMap<string, ModelIndex>, ids: Record<string, number[]>): ElementSummary[] {
  const out: ElementSummary[] = [];
  for (const [modelId, list] of Object.entries(ids)) {
    const index = indexes.get(modelId);
    if (!index) continue;
    for (const id of list) {
      const e = index.elements.get(id);
      if (e) out.push(e);
    }
  }
  return out;
}

/** A selection's conversion to a search: one "is any of" condition per property, holding the values those objects have
    (all conditions must hold). The search finds the objects again from their properties, whatever model is loaded. */
export function conditionsFromObjects(indexes: ReadonlyMap<string, ModelIndex>, ids: Record<string, number[]>, fields: string[]): SearchCondition[] {
  const elements = elementsOf(indexes, ids);
  return fields.map((field) => ({
    id: crypto.randomUUID(),
    field,
    op: 'anyOf' as const,
    value: '',
    values: [...new Set(elements.map((e) => elementValue(e, field)))],
  }));
}

/** How many objects a conversion finds, and how many of those are the objects it came from. */
export function conversionResult(indexes: ReadonlyMap<string, ModelIndex>, ids: Record<string, number[]>, fields: string[]): { found: number; inSet: number; total: number } {
  const total = countIds(ids);
  if (fields.length === 0) return { found: 0, inSet: 0, total };
  const found = runSearchSet(indexes, { kind: 'search', match: 'all', conditions: conditionsFromObjects(indexes, ids, fields) });
  const own = new Map(Object.entries(ids).map(([m, l]) => [m, new Set(l)]));
  let inSet = 0;
  for (const [m, list] of Object.entries(found)) for (const id of list) if (own.get(m)?.has(id)) inSet++;
  return { found: countIds(found), inSet, total };
}

/** The smallest combination of properties (up to 3) that finds these objects and as few others as possible: each step adds
    the property that cuts the most strays, and it stops once nothing more is cut. Properties the objects don't all have, or
    with many different values (a GlobalId, a name per object), are left out. */
export function suggestFields(indexes: ReadonlyMap<string, ModelIndex>, ids: Record<string, number[]>, fields: string[], maxValues = 12): string[] {
  const elements = elementsOf(indexes, ids);
  if (elements.length === 0) return [];
  const candidates = fields.filter((f) => {
    if (f === `${ATTRIBUTES}.GlobalId`) return false;
    const values = new Set(elements.map((e) => elementValue(e, f)));
    return !values.has(NO_VALUE) && values.size <= maxValues;
  });
  const chosen: string[] = [];
  let best = Infinity;
  while (chosen.length < 3) {
    let pick: string | null = null;
    for (const f of candidates) {
      if (chosen.includes(f)) continue;
      const { found } = conversionResult(indexes, ids, [...chosen, f]);
      if (found < best) { best = found; pick = f; }
    }
    if (!pick) break;
    chosen.push(pick);
    if (best <= elements.length) break;
  }
  return chosen;
}

