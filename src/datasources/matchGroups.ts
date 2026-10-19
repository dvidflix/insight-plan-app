import type { ElementSummary } from '../viewer/types';
import {
  clusterMatchRules,
  evalChain,
  evalOp,
  joinKeys,
  matchesObjectFilters,
  newId,
  objectFieldValue,
  splitValues,
  type CompareOp,
  type Conjunction,
  type ObjectFilterRule,
} from '../schedule/linkGroups';
import type { DataTable } from './parsers';

/** A condition on the rows of a table: a column compared with a value. */
export interface RowFilterRule {
  id: string;
  column: string;
  op: CompareOp;
  value: string;
  conj: Conjunction;
  caseSensitive: boolean;
  ignore: boolean;
}

/** A matching rule: a column of the table equals a property of the objects. */
export interface DataMatchRule {
  id: string;
  column: string;
  /** The object's field, as Link Groups name them: `_category`, `_name`, `_guid`, `_file`, or a property set + attribute. */
  objectPropertySet: string;
  objectAttribute: string;
  /** 'and' joins the previous rule (every field must hold for the same row / object pair at once); 'or' starts an alternative. */
  conj: Conjunction;
  /** A field that holds several values ("A || B") is split on these, and one equal value is enough to match. */
  rowSeparators?: string[];
  objectSeparators?: string[];
}

/** One way of coupling a table to the model, as a Link Group couples tasks to objects: which rows, which objects, and the rules
    that pair them. The model is coupled to the table by every group that is not hidden. */
export interface MatchGroup {
  id: string;
  name: string;
  color: string;
  /** Switched off (the eye): ignored by the triggers and the totals. */
  hidden?: boolean;
  rowFilters: RowFilterRule[];
  objectFilters: ObjectFilterRule[];
  matchRules: DataMatchRule[];
}

export const emptyMatchGroup = (name = 'New match'): MatchGroup => ({ id: newId(), name, color: '#7c5cff', rowFilters: [], objectFilters: [], matchRules: [] });

const plain = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, '');

/** A first matching rule for a new group: the column that is named like a property of the objects (a "Pour ID" column and a
    "Pour ID" property), else the first column against the object's name. The user changes it in the editor. */
export function suggestRule(table: DataTable, objectKeys: string[]): DataMatchRule {
  const label = (k: string) => (k.includes('.') ? k.slice(k.indexOf('.') + 1) : k);
  for (const column of table.columns) {
    const key = objectKeys.find((k) => !k.startsWith('_') && plain(label(k)) === plain(column));
    if (key) {
      const dot = key.indexOf('.');
      return { id: newId(), column, objectPropertySet: key.slice(0, dot), objectAttribute: key.slice(dot + 1), conj: 'or' };
    }
  }
  return { id: newId(), column: table.columns[0] ?? '', objectPropertySet: '_name', objectAttribute: '', conj: 'or' };
}

/** Which of the 3D / table triggers are on (as BIMsens's Triggers). */
export interface LinkTriggers {
  /** Selecting objects in 3D narrows the table to their rows. */
  toGrid: boolean;
  /** … and selects those rows (needs toGrid). */
  selectInGrid: boolean;
  /** Selecting rows selects their objects in 3D. */
  toModel: boolean;
  /** … and zooms to them (needs toModel). */
  reframe: boolean;
  /** … and isolates them (needs toModel). */
  isolate: boolean;
}

export const DEFAULT_TRIGGERS: LinkTriggers = { toGrid: true, selectInGrid: true, toModel: true, reframe: true, isolate: false };

type Indexed = ReadonlyMap<string, { elements: ReadonlyMap<number, ElementSummary> }>;

/** What one group couples: its rows, its objects, and which belongs to which. */
export interface GroupLinks {
  groupId: string;
  rows: Set<number>;
  /** Per model, the local ids of the group's objects. */
  objects: Record<string, number[]>;
  objectCount: number;
  /** Row → its objects (model → local ids). Empty when the group has no matching rule (see `unpaired`). */
  rowToObjects: Map<number, Record<string, number[]>>;
  /** Object ("model:id") → its rows. */
  objectToRows: Map<string, number[]>;
  /** No matching rule: the group only picks its rows and its objects, without pairing them. */
  unpaired: boolean;
}

const cellText = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** A column's value on a row, as a text. */
export const rowValue = (table: DataTable, row: number, column: string): string => {
  const c = table.columns.indexOf(column);
  return c < 0 ? '' : cellText(table.rows[row]?.[c]);
};

/** The rows a group's row conditions let through. */
function candidateRows(table: DataTable, rules: RowFilterRule[]): number[] {
  const active = rules.filter((r) => !r.ignore && r.value !== '' && table.columns.includes(r.column));
  const out: number[] = [];
  for (let i = 0; i < table.rows.length; i++) {
    if (evalChain(active, (r) => evalOp(rowValue(table, i, r.column), r.value, r.op, r.caseSensitive))) out.push(i);
  }
  return out;
}

/** Evaluates one group over a table and the loaded models. */
export function computeMatchGroup(table: DataTable, indexes: Indexed, group: MatchGroup): GroupLinks {
  const rows = candidateRows(table, group.rowFilters);
  const candidates: { modelId: string; e: ElementSummary }[] = [];
  for (const [modelId, index] of indexes) for (const e of index.elements.values()) if (matchesObjectFilters(e, group.objectFilters)) candidates.push({ modelId, e });
  const rules = group.matchRules.filter((r) => table.columns.includes(r.column));

  const out: GroupLinks = { groupId: group.id, rows: new Set(), objects: {}, objectCount: 0, rowToObjects: new Map(), objectToRows: new Map(), unpaired: rules.length === 0 };
  const addObject = (modelId: string, id: number) => {
    (out.objects[modelId] ??= []).push(id);
    out.objectCount++;
  };

  if (out.unpaired) {
    // Nothing set up yet (no rule, no condition): it matches nothing, rather than claiming the whole table and model.
    if (!group.rowFilters.length && !group.objectFilters.length) return out;
    for (const r of rows) out.rows.add(r);
    for (const { modelId, e } of candidates) addObject(modelId, e.localId);
    return out;
  }

  const seen = new Set<string>();
  for (const cluster of clusterMatchRules(rules)) {
    // Objects by what they join on, then each row looks its own values up.
    const index = new Map<string, { modelId: string; id: number }[]>();
    for (const { modelId, e } of candidates) {
      const parts = cluster.map((rule) => splitValues(objectFieldValue(e, rule.objectPropertySet, rule.objectAttribute), rule.objectSeparators));
      for (const key of joinKeys(parts)) (index.get(key) ?? index.set(key, []).get(key)!).push({ modelId, id: e.localId });
    }
    for (const r of rows) {
      const parts = cluster.map((rule) => splitValues(rowValue(table, r, rule.column), rule.rowSeparators));
      const hits = new Map<string, { modelId: string; id: number }>();
      for (const key of joinKeys(parts)) for (const h of index.get(key) ?? []) hits.set(`${h.modelId}:${h.id}`, h);
      if (!hits.size) continue;
      out.rows.add(r);
      const byModel = out.rowToObjects.get(r) ?? {};
      for (const [k, h] of hits) {
        const list = (byModel[h.modelId] ??= []);
        if (!list.includes(h.id)) list.push(h.id);
        const rs = out.objectToRows.get(k) ?? out.objectToRows.set(k, []).get(k)!;
        if (!rs.includes(r)) rs.push(r);
        if (!seen.has(k)) { seen.add(k); addObject(h.modelId, h.id); }
      }
      out.rowToObjects.set(r, byModel);
    }
  }
  return out;
}

/** The groups that couple the table to the model (those not switched off), evaluated. */
export function computeLinks(table: DataTable, indexes: Indexed, groups: MatchGroup[]): GroupLinks[] {
  return groups.filter((g) => !g.hidden).map((g) => computeMatchGroup(table, indexes, g));
}

/** Rows and objects over all the groups together (one in several groups counts once). */
export function linkTotals(links: GroupLinks[]): { rows: number; objects: number } {
  const rows = new Set<number>();
  const objects = new Set<string>();
  for (const l of links) {
    for (const r of l.rows) rows.add(r);
    for (const [m, ids] of Object.entries(l.objects)) for (const id of ids) objects.add(`${m}:${id}`);
  }
  return { rows: rows.size, objects: objects.size };
}

/** The objects (per model) the given rows are coupled to, by any group. */
export function objectsForRows(links: GroupLinks[], rows: number[]): Record<string, number[]> {
  const out: Record<string, Set<number>> = {};
  const add = (m: string, ids: number[]) => { const s = (out[m] ??= new Set()); for (const id of ids) s.add(id); };
  for (const l of links) {
    if (l.unpaired) {
      if (rows.some((r) => l.rows.has(r))) for (const [m, ids] of Object.entries(l.objects)) add(m, ids);
      continue;
    }
    for (const r of rows) for (const [m, ids] of Object.entries(l.rowToObjects.get(r) ?? {})) add(m, ids);
  }
  return Object.fromEntries(Object.entries(out).map(([m, s]) => [m, [...s]]));
}

/** The rows the given objects ("model:id" keys) are coupled to, by any group. */
export function rowsForObjects(links: GroupLinks[], objectKeys: Iterable<string>): Set<number> {
  const keys = [...objectKeys];
  const out = new Set<number>();
  for (const l of links) {
    if (l.unpaired) {
      const mine = new Set(Object.entries(l.objects).flatMap(([m, ids]) => ids.map((id) => `${m}:${id}`)));
      if (keys.some((k) => mine.has(k))) for (const r of l.rows) out.add(r);
      continue;
    }
    for (const k of keys) for (const r of l.objectToRows.get(k) ?? []) out.add(r);
  }
  return out;
}

/** The matched row / object pairs of every group (the export). */
export function matchPairs(table: DataTable, indexes: Indexed, groups: MatchGroup[]) {
  const out: { group: string; row: number; objectGuid: string; objectName: string; objectCategory: string }[] = [];
  for (const g of groups) {
    const l = computeMatchGroup(table, indexes, g);
    for (const [r, byModel] of l.rowToObjects) {
      for (const [m, ids] of Object.entries(byModel)) {
        for (const id of ids) {
          const e = indexes.get(m)?.elements.get(id);
          if (e) out.push({ group: g.name, row: r, objectGuid: e.guid, objectName: e.name, objectCategory: e.category });
        }
      }
    }
  }
  return out;
}

/** Everything the Link Group editor's object conditions need, re-exported for the match group editor. */
export type { CompareOp, Conjunction, ObjectFilterRule };
