import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AggKind } from '../schedule/aggregates';

interface AggregateState {
  /** Totals row and group subtotals on the Table View and Gantt. */
  showTotals: boolean;
  /** How each column is summarised (by column id); unset = its default. */
  kinds: Record<string, AggKind>;
  setShowTotals: (on: boolean) => void;
  setKind: (columnId: string, kind: AggKind) => void;
}

/** Programmes > Σ Totals: whether totals show, and how each column sums up. */
export const useAggregateStore = create<AggregateState>()(
  persist(
    (set) => ({
      showTotals: false,
      kinds: {},
      setShowTotals: (showTotals) => set({ showTotals }),
      setKind: (columnId, kind) => set((s) => ({ kinds: { ...s.kinds, [columnId]: kind } })),
    }),
    { name: 'schedule.aggregates' },
  ),
);
