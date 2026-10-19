import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { detectDelimiter, kindOfFile, parseCsvTable, parseDelimited, parseExcelTables, tableFromRows, uniqueHeaders } from '../../src/datasources/parsers';

describe('data source parsers', () => {
  it('reads quoted cells with delimiters, quotes and line breaks', () => {
    const rows = parseDelimited('a,b\n"x, y","say ""hi"""\n"two\nlines",3\n', ',');
    expect(rows).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['two\nlines', '3']]);
  });

  it('detects the delimiter and handles CRLF and a BOM', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    const t = parseCsvTable('﻿Name\tQty\r\nBeam\t4\r\nSlab\t7\r\n');
    expect(t.columns).toEqual(['Name', 'Qty']);
    expect(t.rows).toEqual([['Beam', '4'], ['Slab', '7']]);
  });

  it('does not take a delimiter that only appears in the data', () => {
    const text = 'Group,Activity ID,Matched On\nSZC,A1,Pour || Level\nSZC,A2,Pour || Level || Name\n';
    expect(detectDelimiter(text)).toBe(',');
    expect(parseCsvTable(text).columns).toEqual(['Group', 'Activity ID', 'Matched On']);
    expect(detectDelimiter('a;b\n1;2,5\n3;4,5')).toBe(';');
  });

  it('makes column names unique and fills blanks', () => {
    expect(uniqueHeaders(['A', 'A', '', null])).toEqual(['A', 'A 2', 'Column 3', 'Column 4']);
  });

  it('can treat the first row as data and drops empty rows', () => {
    const t = tableFromRows([['1', '2'], ['', ''], ['3', '4']], false);
    expect(t.columns).toEqual(['Column 1', 'Column 2']);
    expect(t.rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('reads every sheet of a workbook', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Id', 'Qty'], ['A', 1], ['B', 2]]), 'Items');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['X'], ['y']]), 'Other');
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const tables = parseExcelTables(bytes);
    expect(Object.keys(tables)).toEqual(['Items', 'Other']);
    expect(tables.Items.columns).toEqual(['Id', 'Qty']);
    expect(tables.Items.rows).toEqual([['A', 1], ['B', 2]]);
  });

  it('knows which files each kind of source reads', () => {
    expect(kindOfFile('Plan.CSV')).toBe('csv');
    expect(kindOfFile('book.xlsx')).toBe('excel');
    expect(kindOfFile('data.sqlite3')).toBe('sqlite');
    expect(kindOfFile('model.ifc')).toBeNull();
  });
});
