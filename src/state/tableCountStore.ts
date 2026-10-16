import { create } from 'zustand';

/** What the Data table says about its rows ("1,204 elements · 3 selected"), shown in the status bar while the table is up. */
export const useTableCountStore = create<{ text: string | null; set: (text: string | null) => void }>((set) => ({
  text: null,
  set: (text) => set((s) => (s.text === text ? s : { text })),
}));

/** What the Files panel says about its rows ("11 of 83 files"), shown in Home's status bar. */
export const useFilesCountStore = create<{ text: string | null; set: (text: string | null) => void }>((set) => ({
  text: null,
  set: (text) => set((s) => (s.text === text ? s : { text })),
}));
