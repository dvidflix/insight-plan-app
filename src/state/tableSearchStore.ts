import { create } from 'zustand';

/** The words the table in view is narrowed to (set from the search box: "Filter this table"), and whether a table can take them now. */
interface TableSearchState {
  query: string;
  available: boolean;
  setQuery: (query: string) => void;
  setAvailable: (available: boolean) => void;
}

export const useTableSearchStore = create<TableSearchState>((set) => ({
  query: '',
  available: false,
  setQuery: (query) => set({ query }),
  setAvailable: (available) => set((s) => (s.available === available ? s : { available })),
}));
