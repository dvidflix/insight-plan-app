import { create } from 'zustand';

/** How Focus colours the focused pours: each its own colour, or the colour the
    model gives its objects. */
export type FocusColourMode = 'random' | 'original';

interface FocusState {
  focus: boolean;
  setFocus: (v: boolean) => void;
  colourMode: FocusColourMode;
  setColourMode: (m: FocusColourMode) => void;
  /** Row key (GlobalId) -> colour of the focused pours, in the 3D view and as the row's tint. */
  colours: Map<string, string>;
}

/** "Focus": on = isolate the selection without ghosting and pin it; off = the
    regular ghost, nothing pinned. Set from the Scenarios toolbar, applied by the
    viewer toolbar (which owns the select / isolate / ghost / pin state). While
    on, the focused pours are coloured (see FocusColours in ScenarioDock). */
export const useFocusStore = create<FocusState>((set) => ({
  focus: false,
  setFocus: (focus) => set({ focus }),
  colourMode: 'random',
  setColourMode: (colourMode) => set({ colourMode }),
  colours: new Map(),
}));
