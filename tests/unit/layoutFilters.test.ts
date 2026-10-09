import { beforeAll, describe, expect, it, vi } from 'vitest';

// (The totals store persists to the browser's storage; it is not what is under test.)
vi.mock('../../src/state/aggregateStore', () => ({ useAggregateStore: { persist: { rehydrate: async () => {} } } }));

// A layout keeps the filters of the Table and of the Gantt, and applying it hands them back to the page.
beforeAll(() => {
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return data.size; },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  } });
});

describe('layouts and filters', () => {
  it('saves the filters and gives them back on apply', async () => {
    const store = await import('../../src/state/scheduleLayoutsStore');
    const { emptyFilterState } = await import('../../src/schedule/filterFields');
    const table = { ...emptyFilterState(), combine: 'all' as const, textFilters: { name: 'Concrete', successors: 'SZC-1HDAB-COMPLETION' }, textModes: { name: 'contains' as const }, selections: { status: new Set(['not-started']) }, ranges: { floatDays: { min: '1', max: '' } } };
    const gantt = { ...emptyFilterState(), combine: 'any' as const, textFilters: { code: 'L1' } };
    store.saveLayout('open ends', { table, gantt }, undefined, 'activities');
    const id = store.useScheduleLayoutsStore.getState().layouts[0].id;
    store.applyLayout(id);
    const back = store.peekPendingFilters()!;
    expect(back.table.textFilters).toEqual(table.textFilters);
    expect(back.table.textModes).toEqual(table.textModes);
    expect([...back.table.selections.status]).toEqual(['not-started']);
    expect(back.table.ranges.floatDays.min).toBe('1');
    expect(back.gantt.combine).toBe('any');
    expect(back.gantt.textFilters.code).toBe('L1');
    // Update overwrites with the new filters.
    store.updateLayout(id, { table: emptyFilterState(), gantt }, 'activities');
    store.applyLayout(id);
    expect(store.peekPendingFilters()!.table.textFilters).toEqual({});
  });
});
