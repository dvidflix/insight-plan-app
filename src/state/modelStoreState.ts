import { create } from 'zustand';
import { listStoredModels, type StoredModel } from '../db/modelsApi';

/** The models kept in the open project's model store (Inputs › Models in the project database). */
interface State {
  models: StoredModel[];
  error: string | null;
  refresh: (root: string | null) => Promise<void>;
}

export const useModelStoreState = create<State>((set) => ({
  models: [],
  error: null,
  refresh: async (root) => {
    if (!root) return set({ models: [], error: null });
    try {
      set({ models: await listStoredModels(root), error: null });
    } catch (e) {
      set({ models: [], error: e instanceof Error ? e.message : String(e) });
    }
  },
}));
