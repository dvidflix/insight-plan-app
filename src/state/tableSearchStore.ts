import { create } from 'zustand';

/** The words each list is narrowed to, by the id it registers with the List setup (ListConfig). They are typed in the search box of the
    main header, which works on the list that is active ("Search on Gantt"). */
interface TableSearchState {
  queries: Record<string, string>;
  setListQuery: (list: string, query: string) => void;
}

export const useTableSearchStore = create<TableSearchState>((set) => ({
  queries: {},
  setListQuery: (list, query) => set((s) => (s.queries[list] === query ? s : { queries: { ...s.queries, [list]: query } })),
}));

/** One list's words ('' when none). */
export const useListQuery = (list: string) => useTableSearchStore((s) => s.queries[list] ?? '');
