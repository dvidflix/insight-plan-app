import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ColourSort = 'count' | 'az' | 'za' | 'manual';

interface ColourOrderState {
  sort: ColourSort;
  /** Hand-dragged order of the values, per colouring field. */
  manual: Record<string, string[]>;
  setSort: (s: ColourSort) => void;
  setManual: (field: string, order: string[]) => void;
}

/** The order Models > Colour lists its values in (and the viewer's legend follows), remembered. */
export const useColourOrderStore = create<ColourOrderState>()(
  persist(
    (set) => ({
      sort: 'count',
      manual: {},
      setSort: (sort) => set({ sort }),
      setManual: (field, order) => set((s) => ({ manual: { ...s.manual, [field]: order }, sort: 'manual' })),
    }),
    { name: 'models.colourOrder' },
  ),
);

/** `values` (most objects first) in the chosen order: A–Z with numbers in order (L2 before L10), Z–A, or dragged by hand. */
export function orderValues<T extends { value: string }>(values: T[], sort: ColourSort, manual: string[] | undefined): T[] {
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  if (sort === 'az') return [...values].sort((a, b) => byName(a.value, b.value));
  if (sort === 'za') return [...values].sort((a, b) => byName(b.value, a.value));
  if (sort === 'manual') {
    const rank = new Map((manual ?? []).map((v, i) => [v, i]));
    return [...values].sort((a, b) => (rank.get(a.value) ?? Infinity) - (rank.get(b.value) ?? Infinity));
  }
  return values;
}
