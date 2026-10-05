import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Which groups of Views > View settings are open (shared by the groups and
    the expand / collapse button in the section's header). */
export const VIEW_SETTINGS_GROUPS = ['views', 'colour', 'display', 'quality', 'outline', 'cuts', 'realistic', 'page'] as const;
export type ViewSettingsGroup = (typeof VIEW_SETTINGS_GROUPS)[number];

interface State {
  open: ViewSettingsGroup[];
  toggle: (id: ViewSettingsGroup) => void;
  setAll: (open: boolean) => void;
}

export const useViewSettingsGroups = create<State>()(
  persist(
    (set) => ({
      open: ['views', 'display'],
      toggle: (id) => set((s) => ({ open: s.open.includes(id) ? s.open.filter((x) => x !== id) : [...s.open, id] })),
      setAll: (open) => set({ open: open ? [...VIEW_SETTINGS_GROUPS] : [] }),
    }),
    { name: 'view3d.groupsOpen' },
  ),
);
