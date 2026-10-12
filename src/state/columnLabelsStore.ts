import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Your own short names for the programme's columns (Configuration > Columns): column id → the name shown in the
    Table, Gantt and Tasks headings. A column without an entry shows its own name; resetting removes the entry. */
interface ColumnLabelsState {
  labels: Record<string, string>;
  /** An empty or unchanged name resets it. */
  rename: (id: string, label: string, original: string) => void;
  reset: (id: string) => void;
}

export const useColumnLabelsStore = create<ColumnLabelsState>()(
  persist(
    (set) => ({
      labels: {},
      rename: (id, label, original) =>
        set((s) => {
          const next = { ...s.labels };
          const text = label.trim();
          if (!text || text === original) delete next[id];
          else next[id] = text;
          return { labels: next };
        }),
      reset: (id) => set((s) => {
        const next = { ...s.labels };
        delete next[id];
        return { labels: next };
      }),
    }),
    { name: 'table.columnLabels' },
  ),
);
