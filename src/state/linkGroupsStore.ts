import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LinkGroup } from '../schedule/linkGroups';

interface LinkGroupsState {
  groups: LinkGroup[];
  add: (g: LinkGroup) => void;
  update: (g: LinkGroup) => void;
  remove: (id: string) => void;
  /** Appends — used by each panel's own "Import" button to merge a file into
      whatever's already there. */
  setAll: (groups: LinkGroup[]) => void;
  /** Replaces everything — used when loading a whole app configuration file. */
  replaceAll: (groups: LinkGroup[]) => void;
}

// Persisted (under the "sequence." prefix utils/persistedState.ts already
// treats as part of the exportable app config) so Link Groups survive a
// page reload on their own — previously this store was in-memory only, so
// importing a config file's groups (or building them from scratch) then
// hitting "Reload now" for the OTHER settings that do need a reload wiped
// them straight back out, whether or not the 4D Sequencing tab had ever
// been opened.
export const useLinkGroupsStore = create<LinkGroupsState>()(
  persist(
    (set) => ({
      groups: [],
      add: (g) => set((s) => ({ groups: [...s.groups, g] })),
      update: (g) => set((s) => ({ groups: s.groups.map((x) => (x.id === g.id ? g : x)) })),
      remove: (id) => set((s) => ({ groups: s.groups.filter((g) => g.id !== id) })),
      setAll: (groups) => set((s) => ({ groups: [...s.groups, ...groups] })),
      replaceAll: (groups) => set({ groups }),
    }),
    { name: 'sequence.linkGroups' },
  ),
);
