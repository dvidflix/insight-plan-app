import * as XLSX from 'xlsx';
import type { ScenarioExtra } from '../scenarios/api';
import type { ExtraTag } from './rules';
import { extrasToTsv, parseExtrasPaste, type ParsedExtras } from './extrasTable';

/** The extra activities as an .xlsx file and back. The columns are the ones the Extra activities table copies to a spreadsheet and reads when
    pasted (ID, Name, Days, Baseline start, Baseline finish, Type, Building, Level, WBS, Level task), so a file, a paste and the table agree, and an
    uploaded row with an ID already in the table replaces it. */

const SHEET = 'Extra activities';

/** A cell as text. */
export function cellText(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** The baseline start and finish columns (Baseline start, Baseline finish): a date typed in Excel is a serial number there, turned back into its own day
    (yyyy-mm-dd) without a time zone in the way. A text date (2029-04-06, 6 Apr 2029) is left for the paste reader. */
const DATE_COLUMNS = [3, 4];

export function sheetToText(rows: unknown[][]): string {
  return rows.map((r) => r.map((v, c) => {
    if (DATE_COLUMNS.includes(c) && typeof v === 'number' && v >= 20000 && v < 80000) {
      const d = XLSX.SSF.parse_date_code(v);
      if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
    }
    return cellText(v);
  }).join('\t')).join('\n');
}

export function writeExtrasWorkbook(extras: ScenarioExtra[], tags: Record<string, ExtraTag>, fileName: string) {
  const rows = extrasToTsv(extras, tags).split('\n').map((l) => l.split('\t'));
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!cols'] = rows[0].map((_, c) => ({ wch: Math.min(48, Math.max(12, ...rows.slice(0, 200).map((r) => (r[c] ?? '').length + 2))) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, SHEET);
  XLSX.writeFile(book, fileName);
}

/** The extras in the first sheet (or the one named Extra activities) of an uploaded workbook. */
export async function readExtrasWorkbook(file: File): Promise<ParsedExtras> {
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const name = book.SheetNames.find((n) => n.toLowerCase() === SHEET.toLowerCase()) ?? book.SheetNames[0];
  const sheet = name ? book.Sheets[name] : undefined;
  if (!sheet) throw new Error('The workbook has no sheet to read.');
  const parsed = parseExtrasPaste(sheetToText(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true })));
  if (!parsed.extras.length) throw new Error('No extra activities found: the first column is the ID, then Name, Days, Baseline start and Baseline finish. Use a file made with Download Excel.');
  return parsed;
}
