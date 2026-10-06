import * as XLSX from 'xlsx';

/** A grouped grid as it is on screen (the Gantt's label grid, the WBS table): the columns shown, every group header (with its subtotals when
    Σ Totals is on) and every activity row in view order, plus the totals row. Rows under a collapsed group are
    marked hidden, so Excel opens with the same groups folded (and the outline buttons open them). */
export interface GanttExportRow {
  kind: 'group' | 'row' | 'total';
  /** Nesting level: 0 for a top group or an ungrouped row. */
  depth: number;
  /** Folded away by a collapsed group. */
  hidden: boolean;
  /** One value per column (numbers stay numbers in the sheet). */
  cells: (string | number)[];
}

export interface GanttExport {
  columns: string[];
  rows: GanttExportRow[];
}

export function exportGanttXlsx(data: GanttExport, fileName: string, sheetName = 'Gantt') {
  const indent = (row: GanttExportRow, i: number, value: string | number) => (i === 0 ? `${'    '.repeat(row.depth)}${value}` : value);
  const aoa: (string | number)[][] = [data.columns, ...data.rows.map((r) => r.cells.map((c, i) => indent(r, i, c)))];
  const sheet = XLSX.utils.aoa_to_sheet(aoa);

  // Column widths from the longest text (capped), so the sheet reads like the grid.
  sheet['!cols'] = data.columns.map((_, i) => ({ wch: Math.min(60, Math.max(8, ...aoa.map((r) => String(r[i] ?? '').length)) + 2) }));
  // Outline: a row's level is its depth (a group header sits one level above its rows), hidden under folded groups.
  sheet['!rows'] = [
    {},
    ...data.rows.map((r) => ({ level: Math.min(7, r.kind === 'row' ? r.depth : r.depth), hidden: r.hidden })),
  ];

  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  XLSX.writeFile(book, fileName);
}
