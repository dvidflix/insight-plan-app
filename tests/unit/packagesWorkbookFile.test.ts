import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { packagesToRows, rowsToPackages, PACKAGES_SHEET, PACKAGE_COLUMNS, type Row } from '../../src/prs/packagesWorkbook';
import { normalizePackages } from '../../src/prs/workPackages';

describe('the packages workbook as a file', () => {
  it('gives the same packages back through an .xlsx', () => {
    const packages = normalizePackages([
      { id: 'P1', name: 'Top', color: '#111', parts: [] },
      { id: 'P2', name: '00', color: '#222', parts: [{ where: { 'P.Code': '007' } }], parent: 'P1', totalDays: 4.5, lagDays: 1, extra: { name: 'Check', days: 2 } },
    ])!;
    const rows = packagesToRows(packages, { objects: () => ({ count: 1, volume: 2 }), method: () => undefined }, []);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows, { header: [...PACKAGE_COLUMNS] }), PACKAGES_SHEET);
    const again = XLSX.read(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    const read = XLSX.utils.sheet_to_json<Row>(again.Sheets[PACKAGES_SHEET], { defval: '', raw: true });
    const back = rowsToPackages(read, packages, [], (n) => Array(n).fill('#000'));
    expect(back.warnings).toEqual([]);
    expect(back.packages).toEqual(packages);
  });
});
