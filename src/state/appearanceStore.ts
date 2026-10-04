import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppearanceProfile } from '../schedule/appearance';

interface AppearanceState {
  profiles: AppearanceProfile[];
  add: (p: AppearanceProfile) => void;
  update: (p: AppearanceProfile) => void;
  remove: (id: string) => void;
  /** Appends — used by the panel's own "Import" button to merge a file into
      whatever's already there. */
  setAll: (profiles: AppearanceProfile[]) => void;
  /** Replaces everything — used when loading a whole app configuration file. */
  replaceAll: (profiles: AppearanceProfile[]) => void;
}

// Persisted — see linkGroupsStore's matching comment for why (this store had
// the exact same in-memory-only, wiped-on-reload problem).
export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      profiles: [],
      add: (p) => set((s) => ({ profiles: [...s.profiles, p] })),
      update: (p) => set((s) => ({ profiles: s.profiles.map((x) => (x.id === p.id ? p : x)) })),
      remove: (id) => set((s) => ({ profiles: s.profiles.filter((p) => p.id !== id) })),
      setAll: (profiles) => set((s) => ({ profiles: [...s.profiles, ...profiles] })),
      replaceAll: (profiles) => set({ profiles }),
    }),
    { name: 'sequence.appearanceProfiles' },
  ),
);
