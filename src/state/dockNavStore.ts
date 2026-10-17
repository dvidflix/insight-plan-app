import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { DockSide } from './dockStore';

/** How each side's navigation bar (the strip of panel icons) is set: which edge it is on. */
interface DockNavState {
  /** On the other edge from its default (the left one for a right dock, the right one for a left dock). */
  flip: Record<DockSide, boolean>;
  toggleFlip: (side: DockSide) => void;
  /** Width of the N panel (list setup), px. */
  nWidth: number;
  setNWidth: (w: number) => void;
}

const none = { left: false, bottom: false, right: false };

export const useDockNavStore = create<DockNavState>()(
  persist(
    (set) => ({
      flip: none,
      nWidth: 340,
      setNWidth: (nWidth) => set({ nWidth }),
      toggleFlip: (side) => set((s) => ({ flip: { ...s.flip, [side]: !s.flip[side] } })),
    }),
    { name: 'viewer.dock.nav' },
  ),
);
