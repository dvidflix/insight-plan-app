import { create } from 'zustand';
import type { QueryCondition, QueryMode } from '../viewer/query';

export interface SavedQuery {
  id: string;
  name: string;
  group: string;
  conditions: QueryCondition[];
  mode: QueryMode;
  color: string;
  pinned: boolean;
}

interface QueriesState {
  queries: SavedQuery[];
  add: (q: SavedQuery) => void;
  remove: (id: string) => void;
  togglePin: (id: string) => void;
  importAll: (queries: SavedQuery[]) => void;
}

export const useQueriesStore = create<QueriesState>((set) => ({
  queries: [],
  add: (q) => set((s) => ({ queries: [...s.queries, q] })),
  remove: (id) => set((s) => ({ queries: s.queries.filter((q) => q.id !== id) })),
  togglePin: (id) => set((s) => ({ queries: s.queries.map((q) => (q.id === id ? { ...q, pinned: !q.pinned } : q)) })),
  importAll: (queries) => set((s) => ({ queries: [...s.queries, ...queries.map((q) => ({ ...q, id: crypto.randomUUID() }))] })),
}));
