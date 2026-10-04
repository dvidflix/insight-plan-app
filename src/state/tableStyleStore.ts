import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface TableStyleState {
  /** Let long column headers wrap onto several lines instead of being cut off. */
  wrapHeaders: boolean;
  setWrapHeaders: (v: boolean) => void;
}

export const useTableStyleStore = create<TableStyleState>()(
  persist(
    (set) => ({
      wrapHeaders: false,
      setWrapHeaders: (wrapHeaders) => set({ wrapHeaders }),
    }),
    { name: 'tables.style' },
  ),
);
