import type * as BUI from '@thatopen/ui';
import type * as OBC from '@thatopen/components';
import type { ModelIndex } from './ViewerEngine';
import type { ElementSummary } from './types';

/** Row builders for the Simplebim / BIMvision-style tables: a property
    table that aggregates over the selection (the IFC structure tree is
    components/IfcTree.tsx). Plain data in,
    bim-table rows out — no rendering here. */

// ---- Names -----------------------------------------------------------------

const WORDS = [
  'ANNOTATION', 'ASSEMBLY', 'BAR', 'BEAM', 'BUILDING', 'CABLE', 'CARRIER', 'CASE', 'CIVIL', 'COLUMN', 'COVERING', 'CURTAIN',
  'DISTRIBUTION', 'DOOR', 'DUCT', 'ELECTRIC', 'ELEMENT', 'FASTENER', 'FITTING', 'FIXTURE', 'FLIGHT', 'FLOW', 'FOOTING', 'FURNISHING',
  'GENERIC', 'GEOGRAPHIC', 'LIGHT', 'MECHANICAL', 'MEMBER', 'OPENING', 'PART', 'PILE', 'PIPE', 'PLATE', 'PROJECT', 'PROXY', 'RAILING',
  'RAMP', 'REINFORCING', 'ROOF', 'SANITARY', 'SEGMENT', 'SITE', 'SLAB', 'SPACE', 'STAIR', 'STANDARD', 'STOREY', 'TENDON', 'TERMINAL',
  'TRANSPORT', 'TYPE', 'WALL', 'WINDOW', 'ZONE', 'GROUP', 'SYSTEM', 'EQUIPMENT', 'FACILITY',
].sort((a, b) => b.length - a.length);

const prettyCache = new Map<string, string>();

/** IFCBUILDINGELEMENTPROXY -> "Building Element Proxy". */
export function prettyClass(category: string): string {
  const cached = prettyCache.get(category);
  if (cached) return cached;
  let rest = category.toUpperCase().replace(/^IFC/, '');
  const parts: string[] = [];
  while (rest.length > 0) {
    const word = WORDS.find((w) => rest.startsWith(w));
    if (word) {
      parts.push(word);
      rest = rest.slice(word.length);
    } else {
      parts.push(rest);
      rest = '';
    }
  }
  const out = parts.map((w) => w[0] + w.slice(1).toLowerCase()).join(' ');
  prettyCache.set(category, out);
  return out;
}


// ---- Properties ------------------------------------------------------------

export type PropertyRow = {
  Property: string;
  Value: string;
  Count: string;
  /** Hidden: which property the row is ("Pset.Prop", or "Attributes.Name"). */
  Key: string;
  /** Hidden: the value a click matches ('' when the row is not clickable). */
  Match: string;
};

/** Shown for a property an object doesn't have. */
export const NO_VALUE = '<no value>';

export interface PropertyTable {
  title: string;
  /** Objects the rows describe (whole model when nothing is selected). */
  count: number;
  rows: BUI.TableGroupData<PropertyRow>[];
}

const MAX_VALUE_ROWS = 60;

function tally(values: (string | undefined)[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v === undefined ? NO_VALUE : v;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** One row per property: its value when every object agrees, otherwise
    "<N different values>" with an expandable value | count breakdown — the
    same shape Simplebim shows, but only over the given objects. */
function propertyRow(name: string, values: (string | undefined)[], key: string): BUI.TableGroupData<PropertyRow> {
  const counts = tally(values);
  if (counts.size === 1) {
    const value = [...counts.keys()][0];
    return { data: { Property: name, Value: value, Count: '', Key: key, Match: value } };
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const label = counts.size === values.length ? '<all different values>' : `<${counts.size} different values>`;
  const children: BUI.TableGroupData<PropertyRow>[] = sorted.slice(0, MAX_VALUE_ROWS).map(([value, count]) => ({ data: { Property: '', Value: value, Count: String(count), Key: key, Match: value } }));
  if (sorted.length > MAX_VALUE_ROWS) children.push({ data: { Property: '', Value: `… ${sorted.length - MAX_VALUE_ROWS} more`, Count: '', Key: key, Match: '' } });
  return { data: { Property: name, Value: label, Count: '', Key: key, Match: '' }, children };
}

/** Fields that are not properties of the object but come from elsewhere in the app: the search / selection set that holds it
    ("SetFolder:" + a folder of sets) and the Link Group that links it. Their values come from a resolver the Data table sets
    (see virtualFields.ts), since they need the sets and groups, not just the object. */
export const VIRTUAL_PREFIXES = ['SetFolder:', 'LinkGroups:'];
export const isVirtualField = (key: string) => VIRTUAL_PREFIXES.some((p) => key.startsWith(p));
let virtualResolver: ((e: ElementSummary, key: string) => string[]) | null = null;
export const setVirtualResolver = (fn: ((e: ElementSummary, key: string) => string[]) | null) => { virtualResolver = fn; };
/** Every value of a virtual field on one object (it can be in several sets / groups); empty when it is in none. */
export const virtualValues = (e: ElementSummary, key: string): string[] => (virtualResolver ? virtualResolver(e, key) : []);

/** A property's value for one object, as the table shows it
    (`key` = "Pset.Prop", or "Attributes.Name" / ".Class" / ".GlobalId"). */
export function elementValue(e: ElementSummary, key: string): string {
  if (isVirtualField(key)) {
    const vs = virtualValues(e, key);
    return vs.length ? vs.join(', ') : NO_VALUE;
  }
  let v: string | undefined;
  if (key === `${ATTRIBUTES}.Name`) v = formatValue(e.name);
  else if (key === `${ATTRIBUTES}.Class`) v = prettyClass(e.category);
  else if (key === `${ATTRIBUTES}.GlobalId`) v = formatValue(e.guid);
  else if (key === `${ATTRIBUTES}.Model`) v = formatValue(e.fileName);
  else v = formatValue(e.props[key]);
  return v === undefined ? NO_VALUE : v;
}

/** The objects whose `key` property shows `match`: among `scope` (per model
    local ids), or every loaded object when the scope is empty. */
export function objectsWithValue(indexes: ReadonlyMap<string, ModelIndex>, scope: OBC.ModelIdMap, key: string, match: string): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const hasScope = Object.values(scope).some((ids) => ids.size > 0);
  for (const [modelId, index] of indexes) {
    const ids = hasScope ? [...(scope[modelId] ?? [])] : [...index.elements.keys()];
    for (const id of ids) {
      const e = index.elements.get(id);
      if (e && elementValue(e, key) === match) (out[modelId] ??= []).push(id);
    }
  }
  return out;
}

const formatValue = (v: unknown): string | undefined => (v === undefined || v === null || v === '' ? undefined : String(v));

/** The attribute group's name in the table and in Show / hide properties. */
export const ATTRIBUTES = 'Attributes';
/** The attributes it holds, in table order. */
export const ATTRIBUTE_NAMES = ['Name', 'Class', 'GlobalId'];

/** Property sets / single properties ("Pset.Prop") left out of the table;
    "Attributes" / "Attributes.Name" hide the IFC attributes. */
export interface HiddenProperties {
  psets: ReadonlySet<string>;
  props: ReadonlySet<string>;
}

/** Nothing selected -> every object in every loaded model; one -> just that
    object; several -> the aggregate over exactly those. `hidden` sets and
    properties (and so their values) are left out. */
export function buildProperties(indexes: ReadonlyMap<string, ModelIndex>, selection: OBC.ModelIdMap, hidden?: HiddenProperties): PropertyTable {
  const selected: ElementSummary[] = [];
  const hasSelection = Object.values(selection).some((ids) => ids.size > 0);
  for (const [modelId, index] of indexes) {
    if (hasSelection) {
      for (const id of selection[modelId] ?? []) {
        const e = index.elements.get(id);
        if (e) selected.push(e);
      }
    } else {
      selected.push(...index.elements.values());
    }
  }

  if (selected.length === 0) return { title: 'Properties', count: 0, rows: [] };

  const classes = new Set(selected.map((e) => e.category));
  const classLabel = classes.size === 1 ? prettyClass([...classes][0]) : 'Objects';
  const title =
    selected.length === 1
      ? `Properties: ${selected[0].name || classLabel}`
      : `Properties: ${hasSelection ? classLabel : `All ${classLabel === 'Objects' ? 'objects' : classLabel}`} (${selected.length})`;

  // The IFC attributes, hideable like a property set (as "Attributes").
  const attributes: [string, (e: ElementSummary) => string | undefined][] = [
    ['Name', (e) => formatValue(e.name)],
    ['Class', (e) => prettyClass(e.category)],
    ['GlobalId', (e) => formatValue(e.guid)],
  ];
  const emptyRow = (Property: string): PropertyRow => ({ Property, Value: '', Count: '', Key: '', Match: '' });
  const shownAttributes = hidden?.psets.has(ATTRIBUTES) ? [] : attributes.filter(([name]) => !hidden?.props.has(`${ATTRIBUTES}.${name}`));
  const rows: BUI.TableGroupData<PropertyRow>[] = shownAttributes.length
    ? [{ data: emptyRow(ATTRIBUTES), children: shownAttributes.map(([name, get]) => propertyRow(name, selected.map(get), `${ATTRIBUTES}.${name}`)) }]
    : [];

  // Group "Pset.Prop" keys by set, then aggregate each property over the objects.
  const psets = new Map<string, Map<string, string>>();
  for (const e of selected) {
    for (const key of Object.keys(e.props)) {
      const dot = key.indexOf('.');
      const pset = dot === -1 ? 'Other' : key.slice(0, dot);
      const prop = dot === -1 ? key : key.slice(dot + 1);
      if (hidden && (hidden.psets.has(pset) || hidden.props.has(`${pset}.${prop}`))) continue;
      (psets.get(pset) ?? psets.set(pset, new Map()).get(pset)!).set(prop, key);
    }
  }
  for (const [pset, props] of [...psets].sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.push({
      data: emptyRow(pset),
      children: [...props]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([prop, key]) => propertyRow(prop, selected.map((e) => formatValue(e.props[key])), key)),
    });
  }

  return { title, count: selected.length, rows };
}
