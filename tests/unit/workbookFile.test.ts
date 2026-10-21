import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { readWorkbook } from '../../src/schedule/workbookFile';
import { applySheets, SHEET_NAMES, toSheets } from '../../src/schedule/workbook';
import { activity, day, model, rel } from './helpers';

describe('the workbook file', () => {
  it('is read back from an .xlsx as the rows it was made from, dates as text', async () => {
    const m = model([activity('1', { code: 'A1', name: 'Dig', type: 'task', durationHours: 16, remainingDurationHours: 16, earlyStart: day(2030, 1, 7), earlyFinish: day(2030, 1, 8) }), activity('2', { code: 'A2', name: 'Pour', type: 'task' })], [rel('1', '2')]);
    const s = toSheets(m);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(s.tasks), SHEET_NAMES.tasks);
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(s.relationships), SHEET_NAMES.relationships);
    const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const back = await readWorkbook(new File([bytes], 'p.xlsx'));
    expect(back.tasks).toHaveLength(2);
    expect(back.relationships).toHaveLength(1);
    expect(back.resources).toBeUndefined();
    // Nothing differs when it comes straight back (and the sheets left out are not treated as empty).
    const r = applySheets(m, back);
    expect('error' in r ? r.error : r.summary).toEqual(['Nothing in the workbook differs from the programme.']);
  });

  it('says when it is not a workbook of this app', async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ a: 1 }]), 'Other');
    const bytes = XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    await expect(readWorkbook(new File([bytes], 'p.xlsx'))).rejects.toThrow(/Tasks/);
  });
});
