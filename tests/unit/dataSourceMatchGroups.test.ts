import { describe, expect, it } from 'vitest';
import { suggestRule, computeLinks, computeMatchGroup, emptyMatchGroup, linkTotals, objectsForRows, rowsForObjects, type MatchGroup } from '../../src/datasources/matchGroups';
import type { DataTable } from '../../src/datasources/parsers';
import type { ElementSummary } from '../../src/viewer/types';

const el = (localId: number, props: Record<string, unknown>, name = ''): ElementSummary => ({ localId, guid: `g${localId}`, name, category: 'IFCWALL', fileName: 'm.ifc', props });
const indexOf = (elements: ElementSummary[]) => ({ elements: new Map(elements.map((e) => [e.localId, e])) });

const table: DataTable = {
  columns: ['Pour', 'Level', 'Status'],
  rows: [['P1', 'L1', 'Done'], ['P2', 'L1', 'Todo'], ['p3', 'L2', 'Todo'], [null, 'L2', 'Todo'], ['A || B', 'L3', 'Todo']],
};
const model = indexOf([el(1, { 'CWA.Pour': 'P1' }), el(2, { 'CWA.Pour': 'P2' }), el(3, { 'CWA.Pour': ' P3 ', 'CWA.Level': 'L2' }), el(4, { 'Other.Pour': 'P1' }), el(5, { 'CWA.Pour': 'B' })]);
const indexes = new Map([['m', model]]);

const group = (over: Partial<MatchGroup>): MatchGroup => ({ ...emptyMatchGroup('G'), ...over });
const rule = (column: string, set: string, attr: string, conj: 'and' | 'or' = 'or') => ({ id: `${column}${set}${attr}`, column, objectPropertySet: set, objectAttribute: attr, conj });
const pour = group({ matchRules: [rule('Pour', 'CWA', 'Pour')] });

describe('match groups', () => {
  it('pairs rows and objects by a rule, ignoring case and spaces', () => {
    const l = computeMatchGroup(table, indexes, pour);
    expect([...l.rows].sort()).toEqual([0, 1, 2]);
    expect(l.objectCount).toBe(3);
    expect(objectsForRows([l], [0, 2])).toEqual({ m: [1, 3] });
    expect([...rowsForObjects([l], ['m:2', 'm:3'])].sort()).toEqual([1, 2]);
  });

  it('needs every rule of an and-cluster, and any cluster', () => {
    const both = group({ matchRules: [rule('Pour', 'CWA', 'Pour'), rule('Level', 'CWA', 'Level', 'and')] });
    expect(objectsForRows([computeMatchGroup(table, indexes, both)], [0, 2])).toEqual({ m: [3] });
    const either = group({ matchRules: [rule('Pour', 'CWA', 'Pour'), rule('Pour', 'Other', 'Pour')] });
    expect(objectsForRows([computeMatchGroup(table, indexes, either)], [0])).toEqual({ m: [1, 4] });
  });

  it('filters the rows and the objects of a group', () => {
    const todo = group({ matchRules: pour.matchRules, rowFilters: [{ id: 'f', column: 'Status', op: 'equals', value: 'todo', conj: 'or', caseSensitive: false, ignore: false }] });
    expect([...computeMatchGroup(table, indexes, todo).rows].sort()).toEqual([1, 2]);
    const wall = group({ matchRules: pour.matchRules, objectFilters: [{ id: 'o', propertySet: '_name', attribute: '', op: 'equals', value: 'nothing', conj: 'or', caseSensitive: false, ignore: false }] });
    expect(computeMatchGroup(table, indexes, wall).rows.size).toBe(0);
  });

  it('splits a field that holds several values', () => {
    const split = group({ matchRules: [{ ...rule('Pour', 'CWA', 'Pour'), rowSeparators: ['||'] }] });
    const l = computeMatchGroup(table, indexes, split);
    expect(l.rows.has(4)).toBe(true);
    expect(objectsForRows([l], [4])).toEqual({ m: [5] });
  });

  it('counts a row or object in several groups once, and skips groups that are off', () => {
    const other = group({ name: 'Other', matchRules: [rule('Pour', 'CWA', 'Pour')] });
    expect(linkTotals(computeLinks(table, indexes, [pour, other]))).toEqual({ rows: 3, objects: 3 });
    expect(linkTotals(computeLinks(table, indexes, [pour, { ...other, hidden: true }]))).toEqual({ rows: 3, objects: 3 });
    expect(computeLinks(table, indexes, [{ ...pour, hidden: true }])).toEqual([]);
  });

  it('a group with no rule only picks its rows and objects', () => {
    const plain = group({ rowFilters: [{ id: 'f', column: 'Level', op: 'equals', value: 'L2', conj: 'or', caseSensitive: false, ignore: false }] });
    const l = computeMatchGroup(table, indexes, plain);
    expect(l.unpaired).toBe(true);
    expect([...l.rows].sort()).toEqual([2, 3]);
    expect(Object.keys(objectsForRows([l], [2]))).toEqual(['m']);
  });

  it('suggests a first rule from the column named like a property', () => {
    const r = suggestRule({ columns: ['Id', 'Pour ID'], rows: [] }, ['_name', 'CWA Codes.Pour ID', 'CWA.Level']);
    expect([r.column, r.objectPropertySet, r.objectAttribute]).toEqual(['Pour ID', 'CWA Codes', 'Pour ID']);
    const fallback = suggestRule({ columns: ['Code'], rows: [] }, ['_name']);
    expect([fallback.column, fallback.objectPropertySet]).toEqual(['Code', '_name']);
  });
});
