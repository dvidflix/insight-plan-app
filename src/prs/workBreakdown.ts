/** The work breakdown as grouping levels (like the Group panel of the N-menu): an ordered list of levels, each with a source (a property of the objects, or a
    folder of search sets), a role and a sort. The objects are grouped by the values of the levels, in order; each group at the last level is a work item, which
    the generator makes activities for from the recipe of its group (scenario-engine/core/work_items.py).

    Roles say what a level's value is for: the group of the work item (what a recipe finds it by), its building, its level or its zone, or nothing (the level
    only structures the breakdown and the order). An object that has no value at the level of the group is left out. A set source gives an object the first
    set of the folder that holds it, in the folder's order, so an object is in one group only.

    Nothing here knows what the objects are: the caller gives the objects, the sets and the values. */

export type LevelRole = 'item' | 'building' | 'level' | 'zone' | 'structure';
/** natural: text, with numbers in their order; number: by the first whole number in the value; listed: the order written in the level, then natural; set: the order of the folder's sets. */
export type LevelSort = 'natural' | 'number' | 'listed' | 'set';
export type LevelSource = { kind: 'property'; property: string } | { kind: 'sets'; folder: string };

export interface GroupingLevel {
  id: string;
  name: string;
  source: LevelSource;
  role: LevelRole;
  sort: LevelSort;
  /** The values in the order they are built (sort "listed"). */
  order?: string[];
  /** Off: the level is left out of the breakdown. */
  enabled?: boolean;
}

export interface BreakdownDefinition {
  levels: GroupingLevel[];
  /** A numeric property to add up for the quantity of a work item; empty: the number of objects. */
  quantityProperty?: string;
}

export const LEVEL_ROLES: { value: LevelRole; label: string; tip: string }[] = [
  { value: 'item', label: 'Work item', tip: 'The group the work item is: a recipe is found by this value' },
  { value: 'building', label: 'Building', tip: 'The building the work item is in' },
  { value: 'level', label: 'Level', tip: 'The level the work item is on' },
  { value: 'zone', label: 'Zone', tip: 'The zone the work item is in' },
  { value: 'structure', label: 'Structure only', tip: 'Only groups and orders the work items' },
];

export const LEVEL_SORTS: { value: LevelSort; label: string; tip: string }[] = [
  { value: 'natural', label: 'By value', tip: 'In text order, with numbers in their order (2 before 10)' },
  { value: 'number', label: 'By the number in the value', tip: 'By the first whole number in each value (L2 before L10)' },
  { value: 'listed', label: 'As listed', tip: 'In the order written for this level; values not listed come after' },
  { value: 'set', label: 'Set order', tip: 'In the order of the sets of the folder' },
];

/** One object of the models, as the breakdown reads it. */
export interface BreakdownObject {
  /** Unique across the models. */
  key: string;
  guid: string;
  name: string;
  /** "Set.Property" -> value, as the model index has it. */
  props: Record<string, unknown>;
}

export interface BreakdownInput {
  definition: BreakdownDefinition;
  objects: BreakdownObject[];
  /** For a set source: the sets of the folder in the folder's order, and the keys of the objects each holds. */
  sets: (folder: string) => { name: string; keys: ReadonlySet<string> }[];
}

export interface WorkItem {
  id: string;
  group: string;
  building?: string;
  level?: string;
  zone?: string;
  name: string;
  quantity: number;
  quantities: Record<string, number>;
  properties: Record<string, string>;
}

export interface BreakdownLeaf {
  /** The value at each enabled level, in order. */
  values: string[];
  keys: string[];
  /** The GlobalIds of the member objects (what 4D links the item's activities to). */
  guids: string[];
  item: WorkItem;
}

export interface BreakdownResult {
  levels: GroupingLevel[];
  leaves: BreakdownLeaf[];
  /** The request's sequence: the items in the order of the levels. */
  sequence: { GUID: string; Index: number }[];
  /** Objects left out: no value at the level of the group. */
  leftOut: number;
}

const text = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
const number = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(text(v).replace(',', '.'));
  return text(v) === '' || !Number.isFinite(n) ? null : n;
};
const firstNumber = (v: string): number => { const m = /[-+]?\d+/.exec(v); return m ? Number(m[0]) : Number.POSITIVE_INFINITY; };
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const key = (v: string) => v.trim().toUpperCase();

export const emptyBreakdown = (): BreakdownDefinition => ({ levels: [] });

/** Whether the definition makes work items: it has an enabled level whose value is the group. */
export const makesItems = (d: BreakdownDefinition | undefined): boolean => !!d && d.levels.some((l) => l.enabled !== false && l.role === 'item' && (l.source.kind === 'property' ? text(l.source.property) !== '' : text(l.source.folder) !== ''));

/** A level id no level of the list has. */
export function freshLevelId(levels: GroupingLevel[]): string {
  let n = levels.length + 1;
  while (levels.some((l) => l.id === `L${n}`)) n++;
  return `L${n}`;
}

/** Cleans a saved definition: levels with a source, known roles and sorts. */
export function normalizeBreakdown(raw: unknown): BreakdownDefinition | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<BreakdownDefinition>;
  const levels: GroupingLevel[] = (Array.isArray(r.levels) ? r.levels : []).filter((l) => l && typeof l === 'object').map((l, i): GroupingLevel => {
    const src = (l as GroupingLevel).source;
    const source: LevelSource = src && src.kind === 'sets' ? { kind: 'sets', folder: text(src.folder) } : { kind: 'property', property: text(src && (src as { property?: unknown }).property) };
    const role = LEVEL_ROLES.some((x) => x.value === l.role) ? l.role : 'structure';
    const sort = LEVEL_SORTS.some((x) => x.value === l.sort) ? l.sort : 'natural';
    return { id: text(l.id) || `L${i + 1}`, name: text(l.name), source, role, sort, ...(Array.isArray(l.order) && l.order.length ? { order: l.order.map(text).filter(Boolean) } : {}), ...(l.enabled === false ? { enabled: false } : {}) };
  });
  if (levels.length === 0 && !text(r.quantityProperty)) return undefined;
  return { levels, ...(text(r.quantityProperty) ? { quantityProperty: text(r.quantityProperty) } : {}) };
}

/** The value an object has at a level ('' for none). */
function valueAt(o: BreakdownObject, level: GroupingLevel, owner: Map<string, string>): string {
  if (level.source.kind === 'property') return text(o.props[level.source.property]);
  return owner.get(o.key) ?? '';
}

/** Compares two values of one level by its sort. */
function compare(level: GroupingLevel, setOrder: string[], a: string, b: string): number {
  if (level.sort === 'number') return firstNumber(a) - firstNumber(b) || natural(a, b);
  if (level.sort === 'listed' || level.sort === 'set') {
    const list = level.sort === 'set' ? setOrder : level.order ?? [];
    const rank = (v: string) => { const i = list.findIndex((x) => key(x) === key(v)); return i < 0 ? Number.POSITIVE_INFINITY : i; };
    const d = rank(a) - rank(b);
    return Number.isNaN(d) || d === 0 ? natural(a, b) : d;
  }
  return natural(a, b);
}

export function buildBreakdown(input: BreakdownInput): BreakdownResult {
  const { definition, objects } = input;
  const levels = definition.levels.filter((l) => l.enabled !== false && (l.source.kind === 'property' ? text(l.source.property) !== '' : text(l.source.folder) !== ''));
  const itemLevels = levels.map((l, i) => ({ l, i })).filter(({ l }) => l.role === 'item');
  if (itemLevels.length === 0) return { levels, leaves: [], sequence: [], leftOut: 0 };

  // A set source gives each object the first set of the folder that holds it.
  const owners = new Map<string, Map<string, string>>();
  const setOrders = new Map<string, string[]>();
  for (const l of levels) {
    if (l.source.kind !== 'sets') continue;
    const sets = input.sets(l.source.folder);
    const owner = new Map<string, string>();
    for (const s of sets) for (const k of s.keys) if (!owner.has(k)) owner.set(k, s.name);
    owners.set(l.id, owner);
    setOrders.set(l.id, sets.map((s) => s.name));
  }

  const groups = new Map<string, { values: string[]; members: BreakdownObject[] }>();
  let leftOut = 0;
  for (const o of objects) {
    const values = levels.map((l) => valueAt(o, l, owners.get(l.id) ?? new Map()));
    if (itemLevels.some(({ i }) => values[i] === '')) { leftOut++; continue; }
    const k = values.map(key).join('\u0001');
    const g = groups.get(k);
    if (g) g.members.push(o);
    else groups.set(k, { values, members: [o] });
  }

  const ordered = [...groups.values()].sort((a, b) => {
    for (let i = 0; i < levels.length; i++) {
      const d = compare(levels[i], setOrders.get(levels[i].id) ?? [], a.values[i], b.values[i]);
      if (d !== 0) return d;
    }
    return 0;
  });

  const quantityProperty = text(definition.quantityProperty);
  const leaves: BreakdownLeaf[] = ordered.map(({ values, members }) => {
    const at = (role: LevelRole) => levels.map((l, i) => (l.role === role && values[i] !== '' ? values[i] : '')).filter(Boolean).join(' - ');
    const group = at('item');
    const sum = quantityProperty ? members.reduce((n, m) => n + (number(m.props[quantityProperty]) ?? 0), 0) : members.length;
    const quantities: Record<string, number> = { count: members.length };
    if (quantityProperty) quantities[quantityProperty] = sum;
    const properties: Record<string, string> = {};
    levels.forEach((l, i) => { if (values[i] !== '' && text(l.name)) properties[l.name] = values[i]; });
    const id = `WI|${values.join('|')}`;
    const item: WorkItem = {
      id, group, name: values.filter(Boolean).join(' / '), quantity: sum, quantities, properties,
      ...(at('building') ? { building: at('building') } : {}), ...(at('level') ? { level: at('level') } : {}), ...(at('zone') ? { zone: at('zone') } : {}),
    };
    return { values, keys: members.map((m) => m.key), guids: members.map((m) => m.guid), item };
  });
  return { levels, leaves, sequence: leaves.map((l, i) => ({ GUID: l.item.id, Index: i + 1 })), leftOut };
}
