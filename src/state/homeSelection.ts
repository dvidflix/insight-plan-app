import { create } from 'zustand';

/** The scene chosen on Home: the Files panel filters as that scene has its Files filters saved (null: the filters as they are now, i.e. the scene you are in). */
interface HomeSelection {
  sceneId: string | null;
  name: string;
  filters: Record<string, string[]> | null;
  /** The column of the Files panel where the chosen scene's card goes (null: the panel is closed). */
  sideEl: HTMLElement | null;
  setSideEl: (el: HTMLElement | null) => void;
  select: (sceneId: string, name: string, filters: Record<string, string[]> | null) => void;
  clear: () => void;
}

export const useHomeSelection = create<HomeSelection>((set) => ({
  sceneId: null,
  name: '',
  filters: null,
  sideEl: null,
  setSideEl: (sideEl) => set((s) => (s.sideEl === sideEl ? s : { sideEl })),
  select: (sceneId, name, filters) => set({ sceneId, name, filters }),
  clear: () => set({ sceneId: null, name: '', filters: null }),
}));

/** What Open needs from the Files list (App registers it while the list is mounted): the stored models that pass the filters and are not loaded yet. */
export const homeOpen: { names: () => string[]; load: () => Promise<void> } = { names: () => [], load: async () => undefined };
