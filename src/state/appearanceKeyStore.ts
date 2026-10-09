import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LabelPosition } from './sequenceLabelStore';

/** The key of the Appearance profiles in use, drawn over the 4D viewer (4D Sequencing > Label > Appearance key).
    Kept under "sequence." so the app configuration carries it. */
interface State {
  enabled: boolean;
  position: LabelPosition;
  /** A column of rows, or one row of chips. */
  orientation: 'vertical' | 'horizontal';
  setEnabled: (v: boolean) => void;
  setPosition: (p: LabelPosition) => void;
  setOrientation: (o: 'vertical' | 'horizontal') => void;
}

export const useAppearanceKeyStore = create<State>()(
  persist(
    (set) => ({
      enabled: false,
      position: 'bottom-left',
      orientation: 'vertical',
      setEnabled: (enabled) => set({ enabled }),
      setPosition: (position) => set({ position }),
      setOrientation: (orientation) => set({ orientation }),
    }),
    { name: 'sequence.appearanceKey' },
  ),
);
