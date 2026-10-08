import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { NO_CUT, NO_CUTS, type CutSetting, type SectionCuts } from '../viewer/sectionPlanes';

interface SectionCutsState {
  cuts: SectionCuts;
  setCut: (kind: keyof SectionCuts, patch: Partial<CutSetting>) => void;
  clear: (kind: keyof SectionCuts) => void;
  clearAll: () => void;
}

/** Views > Section cuts: the gridline cut and the level cut, remembered. */
export const useSectionCutsStore = create<SectionCutsState>()(
  persist(
    (set) => ({
      cuts: NO_CUTS,
      setCut: (kind, patch) => set((s) => ({ cuts: { ...s.cuts, [kind]: { ...s.cuts[kind], ...patch } } })),
      clear: (kind) => set((s) => ({ cuts: { ...s.cuts, [kind]: NO_CUT } })),
      clearAll: () => set({ cuts: NO_CUTS }),
    }),
    { name: 'viewer.sectionCuts' },
  ),
);
