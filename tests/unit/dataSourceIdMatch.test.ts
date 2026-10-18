import { describe, expect, it } from 'vitest';
import { matchedRowCount, objectsForRows, rowsForObjects, type IdMatch } from '../../src/datasources/idMatch';
import type { DataTable } from '../../src/datasources/parsers';
import type { ElementSummary } from '../../src/viewer/types';
import type { ModelIndex } from '../../src/viewer/ViewerEngine';

const el = (localId: number, props: Record<string, unknown>, name = ''): ElementSummary => ({ localId, guid: `g${localId}`, name, category: 'IFCWALL', fileName: 'm.ifc', props });
const indexOf = (elements: ElementSummary[]) => ({ elements: new Map(elements.map((e) => [e.localId, e])) }) as unknown as ModelIndex;

const table: DataTable = {
  columns: ['Pour', 'Level', 'Status'],
  rows: [['P1', 'L1', 'Done'], ['P2', 'L1', 'Todo'], ['p3', 'L2', 'Todo'], [null, 'L2', 'Todo']],
};
const model = indexOf([el(1, { 'CWA.Pour': 'P1' }), el(2, { 'CWA.Pour': 'P2' }), el(3, { 'CWA.Pour': ' P3 ', 'CWA.Level': 'L2' }), el(4, { 'Other.Pour': 'P1' })]);
const indexes = new Map([['m', model]]);

describe('ID Match', () => {
  const simple: IdMatch = { groups: [[{ column: 'Pour', field: 'CWA.Pour' }]] };

  it('selects the objects of the chosen rows, ignoring case and spaces', () => {
    expect(objectsForRows(simple, table, [0, 2], indexes)).toEqual({ m: [1, 3] });
  });

  it('finds the rows of the chosen objects', () => {
    expect([...rowsForObjects(simple, table, [model.elements.get(2)!, model.elements.get(3)!])].sort()).toEqual([1, 2]);
  });

  it('needs every condition of a group, and any group', () => {
    const both: IdMatch = { groups: [[{ column: 'Pour', field: 'CWA.Pour' }, { column: 'Level', field: 'CWA.Level' }]] };
    expect(objectsForRows(both, table, [0, 2], indexes)).toEqual({ m: [3] });
    const either: IdMatch = { groups: [[{ column: 'Pour', field: 'CWA.Pour' }, { column: 'Level', field: 'CWA.Level' }], [{ column: 'Pour', field: 'Other.Pour' }]] };
    expect(objectsForRows(either, table, [0, 2], indexes)).toEqual({ m: [3, 4] });
  });

  it('does nothing for a match with a column the table lacks, or an empty value', () => {
    expect(objectsForRows({ groups: [[{ column: 'Nope', field: 'CWA.Pour' }]] }, table, [0], indexes)).toEqual({});
    expect(objectsForRows(simple, table, [3], indexes)).toEqual({});
  });

  it('counts the rows that have objects', () => {
    expect(matchedRowCount(simple, table, indexes)).toBe(3);
  });
});
