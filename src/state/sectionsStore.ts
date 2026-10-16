import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Section, SectionOrient } from '../viewer/sectionPlanes';

export interface SavedSections {
  name: string;
  sections: Omit<Section, 'id'>[];
}

interface SectionsState {
  open: boolean;
  sections: Section[];
  activeId: string | null;
  /** What dragging a section's disc in the view does. */
  handle: 'move' | 'rotate';
  /** Fill the sliced faces so the cut reads as a section. */
  solid: boolean;
  saved: SavedSections[];
  counter: number;
  setOpen: (open: boolean) => void;
  add: (orient: SectionOrient, offset: number) => string;
  patch: (id: string, p: Partial<Section>) => void;
  remove: (id: string) => void;
  clear: () => void;
  setActive: (id: string | null) => void;
  setHandle: (h: 'move' | 'rotate') => void;
  setSolid: (on: boolean) => void;
  save: (name: string) => void;
  load: (name: string) => void;
  deleteSaved: (name: string) => void;
}

/** The Sections panel: any number of section planes, the active one being edited, and named sets kept for later. */
export const useSectionsStore = create<SectionsState>()(
  persist(
    (set, get) => ({
      open: false,
      sections: [],
      activeId: null,
      handle: 'move',
      solid: true,
      saved: [],
      counter: 0,
      setOpen: (open) => set({ open }),
      add: (orient, offset) => {
        const counter = get().counter + 1;
        const id = `section-${counter}`;
        set((s) => ({ counter, activeId: id, sections: [...s.sections, { id, orient, offset, rotate: 0, flip: false, hidden: false }] }));
        return id;
      },
      patch: (id, p) => set((s) => ({ sections: s.sections.map((x) => (x.id === id ? { ...x, ...p } : x)) })),
      remove: (id) => set((s) => {
        const sections = s.sections.filter((x) => x.id !== id);
        return { sections, activeId: s.activeId === id ? sections[sections.length - 1]?.id ?? null : s.activeId };
      }),
      clear: () => set({ sections: [], activeId: null }),
      setActive: (activeId) => set({ activeId }),
      setHandle: (handle) => set({ handle }),
      setSolid: (solid) => set({ solid }),
      save: (name) => set((s) => ({
        saved: [...s.saved.filter((x) => x.name !== name), { name, sections: s.sections.map(({ id: _id, ...rest }) => rest) }],
      })),
      load: (name) => {
        const set_ = get().saved.find((x) => x.name === name);
        if (!set_) return;
        let counter = get().counter;
        const sections = set_.sections.map((x) => ({ ...x, id: `section-${++counter}` }));
        set({ sections, counter, activeId: sections[sections.length - 1]?.id ?? null });
      },
      deleteSaved: (name) => set((s) => ({ saved: s.saved.filter((x) => x.name !== name) })),
    }),
    { name: 'viewer.sections', partialize: (s) => ({ saved: s.saved, solid: s.solid, handle: s.handle }) },
  ),
);
