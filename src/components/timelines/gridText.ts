/** Text <-> cells, for pasting from and copying to Excel / SeaTable. */

/** Tab-separated text as the clipboard carries it from a spreadsheet: rows on
    new lines, cells on tabs, and a cell with a tab, new line or quote wrapped
    in quotes (with doubled quotes inside). */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function toTsv(rows: string[][]): string {
  const q = (v: string) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(q).join('\t')).join('\n');
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number): string | null => {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};
const year = (v: string) => (v.length <= 2 ? 2000 + Number(v) : Number(v));

/** A date typed or pasted, as "YYYY-MM-DD", or null when it isn't one. Day
    first (05/01/2025 is 5 January), as in the UK: also 5-1-25, 5.1.2025,
    2025-01-05, "5 Jan 2025", a time after the date is ignored, and an Excel
    date number (45662). */
export function parseDate(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(t);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})(?:[T\s,].*)?$/.exec(t);
  if (m) return iso(year(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,})\.?,?[\s\-]+(\d{2}|\d{4})(?:[T\s,].*)?$/.exec(t);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return month >= 0 ? iso(year(m[3]), month + 1, Number(m[1])) : null;
  }
  if (/^\d{5}$/.test(t)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400000);
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}

/** "YYYY-MM-DD" as dd/mm/yyyy. */
export const showDate = (isoDate: string | undefined): string => {
  if (!isoDate) return '';
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
};
