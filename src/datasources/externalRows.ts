import type { DataTableScope } from '../state/dataTableStore';
import type { ElementSummary } from '../viewer/types';
import type { MatchGroup } from './matchGroups';
import type { DataTable } from './parsers';
import { tableOf, useDataSourcesStore, type DataSourceMeta } from './store';

/** The Data table lists the rows of an external table when its scope is "src:" + source id + "|" + table name. */
export const scopeOf = (sourceId: string, table: string): DataTableScope => `src:${sourceId}|${table}`;

export function parseScope(scope: string): { sourceId: string; table: string } | null {
  if (!scope.startsWith('src:')) return null;
  const rest = scope.slice(4);
  const bar = rest.indexOf('|');
  return bar < 0 ? null : { sourceId: rest.slice(0, bar), table: rest.slice(bar + 1) };
}

const NO_GROUPS: MatchGroup[] = [];
const cache = new WeakMap<DataTable, ElementSummary[]>();

/** The rows of a table as pseudo-objects (the row's place in `localId`, each column a property under its own name), so the Data
    table's columns, filters, grouping, sorting and colours work on them as they do on model objects. */
export function pseudoObjects(table: DataTable, sourceName: string): ElementSummary[] {
  let list = cache.get(table);
  if (!list) {
    list = table.rows.map((row, i) => {
      const props: Record<string, unknown> = {};
      table.columns.forEach((c, j) => { if (row[j] !== null && row[j] !== undefined) props[c] = row[j]; });
      return { localId: i, guid: '', name: '', category: '', fileName: sourceName, props };
    });
    cache.set(table, list);
  }
  return list;
}

export interface ExternalTable {
  source: DataSourceMeta;
  name: string;
  table: DataTable;
  groups: MatchGroup[];
}

/** The external table the scope names, once its source has been read; null for the model's objects. */
export function useExternalTable(scope: string): ExternalTable | null {
  const parsed = parseScope(scope);
  const source = useDataSourcesStore((s) => (parsed ? s.sources.find((x) => x.id === parsed.sourceId) ?? null : null));
  const tables = useDataSourcesStore((s) => (parsed ? s.data[parsed.sourceId] : undefined));
  if (!parsed || !source || !tables) return null;
  const table = tables[parsed.table] ?? tableOf(source, tables)?.table;
  if (!table) return null;
  return { source, name: tables[parsed.table] ? parsed.table : tableOf(source, tables)!.name, table, groups: source.matchGroups?.[parsed.table] ?? NO_GROUPS };
}
