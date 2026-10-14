/** A programme read from the project database's P6 tables (columns + rows of text),
    written back out as a Primavera P6 XER file. */
export interface XerTable {
  columns: string[];
  rows: string[][];
}

const cell = (v: string | null | undefined) => String(v ?? '').replace(/[\t\r\n]+/g, ' ');

export function tablesToXer(tables: Record<string, XerTable>, header?: string | null): string {
  const today = new Date().toISOString().slice(0, 10);
  const out: string[] = [header?.startsWith('ERMHDR') ? header.replace(/[\r\n]+$/, '') : ['ERMHDR', '19.12', today, 'Project', 'admin', 'admin', 'dbxDatabaseNoName', 'Project Management', 'USD'].join('\t')];
  for (const [name, t] of Object.entries(tables)) {
    out.push(`%T\t${name}`, ['%F', ...t.columns].join('\t'));
    for (const r of t.rows) out.push(['%R', ...r.map(cell)].join('\t'));
  }
  out.push('%E');
  return out.join('\r\n') + '\r\n';
}

/** What Windows-1252 puts in bytes 0x80-0x9F (the rest of it is Latin-1). */
const CP1252_HIGH = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ';

/** The XER text as bytes in Windows-1252, the code page P6 writes and reads XER files in (UTF-8 would show a dash or an accent as
    two odd characters in P6). A character outside it becomes "?". */
export function encodeXer(text: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(text.length);
  let n = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const high = CP1252_HIGH.indexOf(ch);
    bytes[n++] = code < 0x80 || (code >= 0xa0 && code <= 0xff) ? code : high >= 0 ? 0x80 + high : 0x3f;
  }
  return bytes.slice(0, n);
}
