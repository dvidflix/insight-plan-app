/** A programme read from the project database's P6 tables (columns + rows of text),
    written back out as a Primavera P6 XER file. */
export interface XerTable {
  columns: string[];
  rows: string[][];
}

const cell = (v: string | null | undefined) => String(v ?? '').replace(/[\t\r\n]+/g, ' ');

export function tablesToXer(tables: Record<string, XerTable>): string {
  const today = new Date().toISOString().slice(0, 10);
  const out: string[] = [['ERMHDR', '19.12', today, 'Project', 'admin', 'admin', 'dbxDatabaseNoName', 'Project Management', 'USD'].join('\t')];
  for (const [name, t] of Object.entries(tables)) {
    out.push(`%T\t${name}`, ['%F', ...t.columns].join('\t'));
    for (const r of t.rows) out.push(['%R', ...r.map(cell)].join('\t'));
  }
  out.push('%E');
  return out.join('\r\n') + '\r\n';
}
