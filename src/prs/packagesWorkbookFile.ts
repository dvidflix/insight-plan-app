import * as XLSX from 'xlsx';
import { PACKAGES_README, PACKAGES_README_SHEET, PACKAGES_SHEET, PACKAGE_COLUMNS, type Row } from './packagesWorkbook';

/** Generate 3's work packages as an .xlsx file and back (the table is prs/packagesWorkbook.ts): a Packages sheet and a Read me. */

export function writePackagesWorkbook(rows: Row[], fileName: string) {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: [...PACKAGE_COLUMNS] });
  sheet['!cols'] = PACKAGE_COLUMNS.map((h) => ({ wch: Math.min(48, Math.max(h.length + 2, ...rows.slice(0, 200).map((r) => String(r[h] ?? '').length + 2))) }));
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: PACKAGE_COLUMNS.length - 1 } }) };
  const readme = XLSX.utils.aoa_to_sheet(PACKAGES_README.map((l) => [l]));
  readme['!cols'] = [{ wch: 140 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, PACKAGES_SHEET);
  XLSX.utils.book_append_sheet(book, readme, PACKAGES_README_SHEET);
  XLSX.writeFile(book, fileName);
}

/** The rows of the Packages sheet (or the first sheet) of an uploaded workbook. */
export async function readPackagesWorkbook(file: File): Promise<Row[]> {
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const name = book.SheetNames.find((n) => n.toLowerCase() === PACKAGES_SHEET.toLowerCase()) ?? book.SheetNames[0];
  const sheet = name ? book.Sheets[name] : undefined;
  if (!sheet) throw new Error('The workbook has no sheet to read.');
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: '', raw: true });
}
