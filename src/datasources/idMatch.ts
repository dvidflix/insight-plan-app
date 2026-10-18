import type { ElementSummary } from '../viewer/types';
import type { ModelIndex } from '../viewer/ViewerEngine';
import { elementValue, NO_VALUE } from '../viewer/bimTables';
import type { DataTable } from './parsers';

/** One rule of an ID Match: a column of the table equals a property of the model's objects. */
export interface MatchCondition {
  /** The table's column. */
  column: string;
  /** The model property, as the Data table names it ("Pset.Prop", "Attributes.Name"). */
  field: string;
}

/** Couples a table to the 3D, as BIMsens's ID Match does: rows and objects are the same thing when their values agree. The
    conditions of a group must all hold (AND); the match holds when any group does (OR), so a federated model whose packages
    name the property differently can be matched with one group per package. */
export interface IdMatch {
  groups: MatchCondition[][];
}

export const EMPTY_MATCH: IdMatch = { groups: [] };

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

/** A value as compared: numbers and text that read the same match, ignoring case and surrounding spaces. */
export const normaliseKey = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim().toLowerCase());

const SEP = '\u0001';

/** The conditions of a group that can be used: both sides named, and the column present in the table. */
export function usableGroups(match: IdMatch | undefined, table: DataTable): { column: number; field: string }[][] {
  return (match?.groups ?? [])
    .map((g) => g.filter((c) => c.column && c.field && table.columns.includes(c.column)).map((c) => ({ column: table.columns.indexOf(c.column), field: c.field })))
    .filter((g) => g.length > 0);
}

const elementKey = (e: ElementSummary, fields: string[]): string | null => {
  const parts: string[] = [];
  for (const f of fields) {
    const v = elementValue(e, f);
    if (v === NO_VALUE || v === '') return null;
    parts.push(normaliseKey(v));
  }
  return parts.join(SEP);
};

const rowKey = (row: (string | number | null)[], columns: number[]): string | null => {
  const parts: string[] = [];
  for (const c of columns) {
    const v = normaliseKey(row[c]);
    if (v === '') return null;
    parts.push(v);
  }
  return parts.join(SEP);
};

/** The objects (per model, local ids) that match any of the given rows. */
export function objectsForRows(match: IdMatch | undefined, table: DataTable, rows: number[], indexes: ReadonlyMap<string, ModelIndex>): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const group of usableGroups(match, table)) {
    const wanted = new Set<string>();
    for (const r of rows) {
      const k = table.rows[r] ? rowKey(table.rows[r], group.map((c) => c.column)) : null;
      if (k !== null) wanted.add(k);
    }
    if (!wanted.size) continue;
    const fields = group.map((c) => c.field);
    for (const [modelId, index] of indexes) {
      for (const [id, e] of index.elements) {
        const k = elementKey(e, fields);
        if (k !== null && wanted.has(k)) {
          const list = (out[modelId] ??= []);
          if (!list.includes(id)) list.push(id);
        }
      }
    }
  }
  return out;
}

/** The rows (indexes into the table) that match any of the given objects. */
export function rowsForObjects(match: IdMatch | undefined, table: DataTable, objects: ElementSummary[]): Set<number> {
  const out = new Set<number>();
  for (const group of usableGroups(match, table)) {
    const fields = group.map((c) => c.field);
    const keys = new Set<string>();
    for (const e of objects) {
      const k = elementKey(e, fields);
      if (k !== null) keys.add(k);
    }
    if (!keys.size) continue;
    const cols = group.map((c) => c.column);
    table.rows.forEach((row, i) => {
      const k = rowKey(row, cols);
      if (k !== null && keys.has(k)) out.add(i);
    });
  }
  return out;
}

/** How many of the table's rows have at least one object in the models (for the match's summary). */
export function matchedRowCount(match: IdMatch | undefined, table: DataTable, indexes: ReadonlyMap<string, ModelIndex>): number {
  let n = 0;
  const all = table.rows.map((_, i) => i);
  const seen = new Set<number>();
  for (const group of usableGroups(match, table)) {
    const fields = group.map((c) => c.field);
    const cols = group.map((c) => c.column);
    const present = new Set<string>();
    for (const index of indexes.values()) for (const e of index.elements.values()) {
      const k = elementKey(e, fields);
      if (k !== null) present.add(k);
    }
    for (const i of all) {
      const k = rowKey(table.rows[i], cols);
      if (k !== null && present.has(k) && !seen.has(i)) { seen.add(i); n++; }
    }
  }
  return n;
}
