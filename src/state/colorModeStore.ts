import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** How a 3D view colours the model:
    - appearance: the Appearance Profiles of the linked Link Groups (4D look)
    - original:   the model's own colours — the timeline still hides/ghosts
    - property:   one colour per value of a model property (rules below)
    Visibility and opacity always follow the timeline; only colour differs. */
export type ColorMode = 'appearance' | 'original' | 'property' | 'sets';

export const COLOR_MODES: { id: ColorMode; label: string; hint: string }[] = [
  { id: 'appearance', label: 'Appearance Profiles', hint: 'Colours from each Link Group’s appearance profile (the default 4D look).' },
  { id: 'original', label: 'Original colours', hint: 'The model’s own colours; the timeline still controls what is visible.' },
  { id: 'property', label: 'By property', hint: 'Colour elements by the value of a model property, using the colours of the Colour panel.' },
  { id: 'sets', label: 'Search / Selection Sets', hint: 'Colour the objects of each Search / Selection Set in the colour set for it below; an object in several sets takes the first one in the list.' },
];

export interface PropertyColorRule {
  id: string;
  /** Property value to match (compared case-insensitively). */
  value: string;
  color: string;
}

export interface ColorModeSettings {
  mode: ColorMode;
  /** Field key as in Link Group filters: `_category`, `_name`, or `Pset.Prop`. */
  field: string;
  rules: PropertyColorRule[];
  /** Colour for values no rule matches; null keeps the original colour. */
  fallback: string | null;
  /** Colour of each Search / Selection Set by id (sets without one take a palette colour by their place in the list). */
  setColors?: Record<string, string>;
  /** The folder of sets coloured in "Search / Selection Sets" mode ('' = sets in no folder); absent: every folder. */
  setFolder?: string;
  /** Sets switched off in "Search / Selection Sets" mode. */
  setsOff?: string[];
}

export const DEFAULT_COLOR_MODE: ColorModeSettings = { mode: 'appearance', field: '_category', rules: [], fallback: null };

/** The two 3D views of the 4D page: A is the main one, B the optional split. */
export type ViewId = 'a' | 'b';

/** Split / link / cube switches are per page — see viewSettingsStore. */
interface ColorModeState {
  a: ColorModeSettings;
  b: ColorModeSettings;
  patch: (view: ViewId, p: Partial<ColorModeSettings>) => void;
}

export const useColorModeStore = create<ColorModeState>()(
  persist(
    (set) => ({
      a: { ...DEFAULT_COLOR_MODE },
      // The second view starts out showing something different from the first.
      b: { ...DEFAULT_COLOR_MODE, mode: 'original' },
      patch: (view, p) => set((s) => ({ [view]: { ...s[view], ...p } }) as Partial<ColorModeState>),
    }),
    { name: 'sequence.colorModes' },
  ),
);

/** Categorical palette for auto-generated rules. */
export const RULE_PALETTE = [
  '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
  '#1f77b4', '#d62728', '#2ca02c', '#9467bd', '#8c564b', '#17becf',
];
