import { describe, expect, it, vi } from 'vitest';
import { elementValue } from '../../src/viewer/bimTables';
import { conditionTest } from '../../src/viewer/searchSets';
import { parseScope, pseudoObjects, scopeOf } from '../../src/datasources/externalRows';
import type { DataTable } from '../../src/datasources/parsers';

// The stores persist to localStorage, which has to exist before they are imported.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 };
  (globalThis as unknown as { window: unknown }).window = { innerHeight: 800, localStorage: (globalThis as unknown as { localStorage: Storage }).localStorage };
});

const table: DataTable = { columns: ['Pour.Level', 'Qty'], rows: [['L1', 4], ['L2', 7], [null, 1]] };

describe('Data table with external data', () => {
  it('names a source table in the scope and reads it back', () => {
    const s = scopeOf('ds-1', 'Sheet|1');
    expect(parseScope(s)).toEqual({ sourceId: 'ds-1', table: 'Sheet|1' });
    expect(parseScope('all')).toBeNull();
  });

  it('gives each row its columns as properties, so columns and filters work as on objects', () => {
    const rows = pseudoObjects(table, 'Plan');
    expect(rows.map((r) => elementValue(r, 'Pour.Level'))).toEqual(['L1', 'L2', '<no value>']);
    expect(elementValue(rows[1], 'Qty')).toBe('7');
    const test = conditionTest({ id: 'c', field: 'Pour.Level', op: 'anyOf', value: '', values: ['L2'] });
    expect(rows.filter((r) => test!(r)).map((r) => r.localId)).toEqual([1]);
  });

  it('keeps a setup per source when the scope changes', async () => {
    const { useDataTableStore } = await import('../../src/state/dataTableStore');
    const st = useDataTableStore.getState;
    st().setColumns(['Attributes.Name']);
    st().setScope('src:a|T');
    expect(st().columns).toEqual([]);
    st().setColumns(['Qty']);
    st().patch({ sortRules: [{ id: 's', field: 'Qty', direction: 'up' }] });
    st().setScope('visible');
    expect(st().columns).toEqual(['Attributes.Name']);
    expect(st().sortRules).toEqual([]);
    st().setScope('src:a|T');
    expect(st().columns).toEqual(['Qty']);
    expect(st().sortRules).toHaveLength(1);
    st().setScope('all');
  });
});
