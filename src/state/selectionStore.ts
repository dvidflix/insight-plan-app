import { create } from 'zustand';

/** Local ids of the Highlighter's current selection, mirrored here so the 4D
    page can read it. The Highlighter (OBF.Highlighter) owns selection — this
    is read-only state for the rest of the app. */
interface SelectionState {
  selectedIds: number[];
  /** The whole selection, per model id (selectedIds is the first model's). */
  byModel: Record<string, number[]>;
  setSelection: (ids: number[], byModel?: Record<string, number[]>) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedIds: [],
  byModel: {},
  setSelection: (ids, byModel = {}) => set({ selectedIds: ids, byModel }),
}));
