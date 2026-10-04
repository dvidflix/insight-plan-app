import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** One old → new Pour ID pair for renumbering the programme. */
export interface PourMapEntry {
  oldPour: string;
  newPour: string;
}

interface PourMapState {
  /** The map from the model comparison (or an imported file), edited in Programmes > Renumber. */
  entries: PourMapEntry[];
  setEntries: (entries: PourMapEntry[]) => void;
}

/** Old → new Pour IDs, kept in the browser so the comparison made on the
    Models page is there when the programme is renumbered. */
export const usePourMapStore = create<PourMapState>()(
  persist(
    (set) => ({
      entries: [],
      setEntries: (entries) => set({ entries }),
    }),
    { name: 'schedule.pourMap', version: 1 },
  ),
);
