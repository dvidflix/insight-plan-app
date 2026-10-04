import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface PropertyVisibilityState {
  /** Property sets left out of the Properties table (by name). */
  hiddenPsets: string[];
  /** Single properties left out, as "Pset.Property". */
  hiddenProps: string[];
  /** How the Properties table opens: property sets closed, or open. */
  expandMode: 'collapsed' | 'expanded';
  setPsetHidden: (pset: string, hidden: boolean) => void;
  setPropHidden: (key: string, hidden: boolean) => void;
  setAll: (hiddenPsets: string[], hiddenProps: string[]) => void;
  setExpandMode: (mode: 'collapsed' | 'expanded') => void;
}

const toggle = (list: string[], item: string, on: boolean) => (on ? [...new Set([...list, item])] : list.filter((x) => x !== item));

/** Models page > Properties: which property sets / properties are shown,
    and whether the sets open collapsed. Kept by name across models and
    sessions. */
export const usePropertyVisibilityStore = create<PropertyVisibilityState>()(
  persist(
    (set) => ({
      hiddenPsets: [],
      hiddenProps: [],
      // Sets open, so a selected object's properties show straight away.
      expandMode: 'expanded',
      setPsetHidden: (pset, hidden) => set((s) => ({ hiddenPsets: toggle(s.hiddenPsets, pset, hidden) })),
      setPropHidden: (key, hidden) => set((s) => ({ hiddenProps: toggle(s.hiddenProps, key, hidden) })),
      setAll: (hiddenPsets, hiddenProps) => set({ hiddenPsets, hiddenProps }),
      setExpandMode: (expandMode) => set({ expandMode }),
    }),
    {
      name: 'models.propertyVisibility',
      version: 1,
      // Version 0 opened the sets collapsed: open them once, keep the rest.
      migrate: (old, version) => (version === 0 ? { ...(old as object), expandMode: 'expanded' } : old) as PropertyVisibilityState,
    },
  ),
);
