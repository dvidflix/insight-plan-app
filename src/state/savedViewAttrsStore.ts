import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** What a saved view (Views > Saved views) stores and restores. */
export type SavedViewAttr = 'camera' | 'visibility' | 'sections' | 'style' | 'display' | 'placement' | 'selection';

export const SAVED_VIEW_ATTRS: { id: SavedViewAttr; label: string; hint: string }[] = [
  { id: 'camera', label: 'Camera', hint: 'Position, target and perspective / orthographic.' },
  { id: 'visibility', label: 'Hidden / shown', hint: 'Which elements are hidden (Hide / Isolate).' },
  { id: 'sections', label: 'Section planes', hint: 'The section (clipping) planes.' },
  { id: 'style', label: 'View style', hint: 'Color Pen or Color Pen Shadows.' },
  { id: 'display', label: 'Display settings', hint: 'Edges, ambient occlusion, anti-aliasing, background, grid, sun & shadows, concrete.' },
  { id: 'placement', label: 'Model placement', hint: 'Model offsets (3D tab) and storey slides.' },
  { id: 'selection', label: 'Selection', hint: 'The selected objects (kept by GUID, so they also go into a BCF export).' },
];

/** What views saved before these options existed restore. */
export const LEGACY_SAVED_VIEW_ATTRS: Record<SavedViewAttr, boolean> = {
  camera: true,
  visibility: true,
  sections: true,
  style: true,
  display: false,
  placement: false,
  selection: false,
};

interface SavedViewAttrsState {
  attrs: Record<SavedViewAttr, boolean>;
  toggle: (id: SavedViewAttr) => void;
}

/** The ticked attributes new saved views are made with. */
export const useSavedViewAttrsStore = create<SavedViewAttrsState>()(
  persist(
    (set) => ({
      attrs: { ...LEGACY_SAVED_VIEW_ATTRS, selection: true },
      toggle: (id) => set((s) => ({ attrs: { ...s.attrs, [id]: !s.attrs[id] } })),
    }),
    { name: 'views.savedAttributes' },
  ),
);
