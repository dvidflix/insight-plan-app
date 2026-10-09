import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { plfToLayout } from '../../src/schedule/plfLayout';
import type { ColumnDef } from '../../src/schedule/columns';
import type { FilterFieldDef } from '../../src/schedule/filterFields';

const dir = path.resolve(__dirname, '../../src/layouts');
const col = (id: string, label: string): ColumnDef => ({ id, label, group: 'x', width: 100, text: () => '', sort: () => '' });
const catalog = [
  col('code', 'Activity ID'), col('name', 'Activity Name'), col('durationDays', 'Original Duration (d)'), col('start', 'Start'), col('finish', 'Finish'),
  col('predecessors', 'Predecessors'), col('resources', 'Resources'), col('floatDays', 'Total Float (d)'), col('code:CWA-Unit', 'CWA-Unit'), col('udf:BYLOR - ECS Combined Code', 'BYLOR - ECS Combined Code'),
];
const field = (id: string, label: string, kind: FilterFieldDef['kind'], values: string[] = []): FilterFieldDef => ({
  id, label, group: 'x', kind, hasData: true, values: values.map((v) => ({ value: v, label: v })), activityValues: () => [],
});
const filterFields = [field('name', 'Activity Name', 'text'), field('code', 'Activity ID', 'text'), field('resource', 'Resource', 'select', ['SZC-C', 'SZC-R']), field('type', 'Activity Type', 'select', ['task', 'loe'])];
const read = (f: string) => new TextDecoder('windows-1252').decode(fs.readFileSync(path.join(dir, f))).replace(/\r?\n/g, '');

describe('P6 layouts (.plf)', () => {
  it('reads every layout in src/layouts', () => {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.plf'))) {
      const r = plfToLayout(read(f), { catalog, filterFields }, f);
      expect(r.name, f).toBeTruthy();
    }
  });

  it('turns Activities - Rebar into columns, widths, a sort and an any-of filter', () => {
    const r = plfToLayout(read('Activities - Rebar.plf'), { catalog, filterFields });
    expect(r.name).toBe('Activities - Rebar');
    const ids = JSON.parse(r.settings['table.columns']);
    expect(ids.slice(0, 5)).toEqual(['code', 'name', 'durationDays', 'start', 'finish']);
    expect(ids).toContain('predecessors');
    expect(ids).toContain('code:CWA-Unit');
    expect(ids).toContain('udf:BYLOR - ECS Combined Code');
    expect(JSON.parse(r.settings['table.columnWidths']).code).toBe(151);
    expect(JSON.parse(r.settings['table.sortRules'])).toEqual([]);
    expect(r.filters.combine).toBe('any');
    expect([...r.filters.selections.resource]).toEqual(['SZC-R']);
    expect(r.filters.textFilters.name).toBe('- Rebar');
  });

  it('keeps a descending sort and says what it left out', () => {
    const r = plfToLayout(read('GIVE, GET and SUM.plf'), { catalog, filterFields });
    expect(JSON.parse(r.settings['table.sortRules'])).toMatchObject([{ field: 'name', direction: 'down' }]);
    expect(r.notes.some((n) => n.includes('cannot be expressed'))).toBe(true);
    const sorted = plfToLayout(read('Activities - Concrete and Rebar.plf'), { catalog, filterFields });
    expect(JSON.parse(sorted.settings['table.sortRules']).map((x: any) => x.field)).toEqual(['code']); // the project-name sort has no column here
    expect(sorted.notes.some((n) => n.includes('proj_name'))).toBe(true);
    const synchro = plfToLayout(read('List of Activities - Synchro.plf'), { catalog, filterFields });
    expect(synchro.notes.some((n) => n.includes('several fields'))).toBe(true);
    expect([...synchro.filters.selections.type]).toEqual(['task']);
  });

  it('refuses a layout that is not an Activities one', () => {
    expect(() => plfToLayout('(0||(view_type|VP_RSRC)())', { catalog, filterFields })).toThrow();
  });
});
