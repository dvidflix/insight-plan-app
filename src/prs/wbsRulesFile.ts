import * as XLSX from 'xlsx';
import { WBS_COLUMNS, WBS_README, WBS_README_SHEET, WBS_SHEET, type WbsRow } from './wbsRules';

/** WBS rules as an .xlsx file and back (the sheet is prs/wbsRules.ts rulesToRows / rowsToRules): a WBS rules sheet and a Read me. */

export function writeWbsWorkbook(rows: WbsRow[], fileName: string) {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: [...WBS_COLUMNS] });
  sheet['!cols'] = WBS_COLUMNS.map((h) => ({ wch: Math.min(40, Math.max(h.length + 2, ...rows.map((r) => String(r[h] ?? '').length + 2))) }));
  const readme = XLSX.utils.aoa_to_sheet(WBS_README.map((l) => [l]));
  readme['!cols'] = [{ wch: 140 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, WBS_SHEET);
  XLSX.utils.book_append_sheet(book, readme, WBS_README_SHEET);
  XLSX.writeFile(book, fileName);
}

/** The rows of the WBS rules sheet (or the first sheet) of an uploaded workbook. */
export async function readWbsWorkbook(file: File): Promise<WbsRow[]> {
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const name = book.SheetNames.find((n) => n.toLowerCase() === WBS_SHEET.toLowerCase()) ?? book.SheetNames[0];
  const sheet = name ? book.Sheets[name] : undefined;
  if (!sheet) throw new Error('The workbook has no sheet to read.');
  return XLSX.utils.sheet_to_json<WbsRow>(sheet, { defval: '', raw: false });
}
