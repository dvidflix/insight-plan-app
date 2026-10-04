import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ViewKey } from './viewSettingsStore';

export interface ValueColor {
  value: string;
  color: string;
}

/** How one view colours the models. */
export interface ColourConfig {
  /** Colour the models by `field` (Models page). */
  enabled: boolean;
  /** Property key: "Attributes.Class", "Pset.Prop", … (see bimTables.elementValue). */
  field: string;
  palette: string;
  /** Start of the random palette (Shuffle picks a new one). */
  seed: number;
  /** Colour per value. */
  colors: ValueColor[];
  /** Colour for values without one; null keeps their own colours. */
  others: string | null;
}

export const DEFAULT_COLOUR: ColourConfig = {
  enabled: false,
  field: 'Attributes.Class',
  palette: 'vivid',
  seed: 0.2,
  colors: [],
  others: null,
};

interface ModelColorState {
  /** The main (left) view, and the split's right view — each coloured on its own. */
  views: Record<ViewKey, ColourConfig>;
  patch: (view: ViewKey, p: Partial<ColourConfig>) => void;
}

/** Models > Colour: colouring the models by any property, per view, remembered. */
export const useModelColorStore = create<ModelColorState>()(
  persist(
    (set) => ({
      views: { main: DEFAULT_COLOUR, second: DEFAULT_COLOUR },
      patch: (view, p) => set((s) => ({ views: { ...s.views, [view]: { ...s.views[view], ...p } } })),
    }),
    {
      name: 'models.colour',
      version: 1,
      // Version 0 held one colouring for both views: both start from it.
      migrate: (old, version) => {
        if (version === 0) {
          const main = { ...DEFAULT_COLOUR, ...(old as Partial<ColourConfig>) };
          return { views: { main, second: main } };
        }
        return old as ModelColorState;
      },
    },
  ),
);
