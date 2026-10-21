import * as XLSX from 'xlsx';
import type { ScheduleModel } from './types';
import { README, SHEET_NAMES, toSheets, type Row, type Sheets } from './workbook';

/** The workbook as an .xlsx file: written for the programme, and read back into sheets of rows (see workbook.ts for what a row means). */

const dayText = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function writeWorkbook(model: ScheduleModel, fileName: string) {
  const s = toSheets(model);
  const book = XLSX.utils.book_new();
  const add = (name: string, rows: Row[], headers: string[]) => {
    const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
    sheet['!cols'] = headers.map((h) => ({ wch: Math.min(40, Math.max(12, h.length + 2, ...rows.slice(0, 200).map((r) => String(r[h] ?? '').length + 2))) }));
    XLSX.utils.book_append_sheet(book, sheet, name);
  };
  add(SHEET_NAMES.tasks, s.tasks, s.tasks[0] ? Object.keys(s.tasks[0]) : ['Task Code*', 'Task Name*']);
  add(SHEET_NAMES.relationships, s.relationships, ['From Task Code*', 'To Task Code*', 'Type', 'Lag (d)', 'Soft']);
  add(SHEET_NAMES.resources, s.resources, ['Name*', 'Type', 'Max units']);
  add(SHEET_NAMES.assignments, s.assignments, ['Task Code*', 'Resource*', 'Units at once', 'Quantity', 'Primary']);
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(README.map((line) => [line])), SHEET_NAMES.readme);
  XLSX.writeFile(book, fileName);
}

/** The rows of each sheet of an uploaded workbook (a sheet that is not there is left out, so it is not treated as empty). Dates become year-month-day. */
export async function readWorkbook(file: File): Promise<Sheets> {
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const rows = (name: string): Row[] | undefined => {
    const sheet = book.Sheets[book.SheetNames.find((n) => n.toLowerCase() === name.toLowerCase()) ?? ''];
    if (!sheet) return undefined;
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true }).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? dayText(v) : typeof v === 'number' ? v : String(v ?? '')])));
  };
  const tasks = rows(SHEET_NAMES.tasks);
  if (!tasks) throw new Error(`The workbook has no “${SHEET_NAMES.tasks}” sheet. Use a file made with Download workbook.`);
  return { tasks, relationships: rows(SHEET_NAMES.relationships), resources: rows(SHEET_NAMES.resources), assignments: rows(SHEET_NAMES.assignments) };
}
