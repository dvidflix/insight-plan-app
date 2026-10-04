export type XerTables = Record<string, Record<string, string>[]>;

/** Parses a P6 .xer (tab-delimited) export into raw tables: {TASK: [...rows], TASKPRED: [...], ...}.
    Each row is a plain object keyed by the XER column name, values left as raw strings
    (date/number coercion happens in normalize.ts). */
export function parseXer(text: string): XerTables {
  const tables: XerTables = {};
  let currentTable: string | null = null;
  let currentFields: string[] = [];

  const lines = text.split(/\r\n|\r|\n/);
  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('%T')) {
      currentTable = line.slice(2).trim();
      tables[currentTable] = tables[currentTable] ?? [];
      currentFields = [];
    } else if (line.startsWith('%F')) {
      currentFields = line.split('\t').slice(1);
    } else if (line.startsWith('%R')) {
      if (!currentTable) continue;
      const values = line.split('\t').slice(1);
      const row: Record<string, string> = {};
      currentFields.forEach((field, i) => {
        row[field] = values[i] ?? '';
      });
      tables[currentTable].push(row);
    }
    // %E (end of file) and the leading ERMHDR line are ignored.
  }
  return tables;
}
