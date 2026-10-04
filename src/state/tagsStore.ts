import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CSSProperties } from 'react';

/** A named on-viewer label. A Link Group picks one; while any of the group's
    tasks is active the label is shown. The template mixes free text with
    task and object-property tokens — see schedule/tagTemplate.ts. */
export interface Tag extends TagStyle {
  id: string;
  name: string;
  template: string;
}

/** How a tag's text looks on the viewer; every field is optional (the default look). */
export interface TagStyle {
  /** px; default 12 (11 for callouts). */
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  /** Text colour (hex). */
  textColor?: string;
  /** Box background (hex). */
  background?: string;
}

export const DEFAULT_TAG_FONT_SIZE = 12;

export function tagStyleOf(t: TagStyle): TagStyle {
  return { fontSize: t.fontSize, bold: t.bold, italic: t.italic, textColor: t.textColor, background: t.background };
}

export function tagCss(s: TagStyle | undefined): CSSProperties {
  if (!s) return {};
  return {
    fontSize: s.fontSize,
    lineHeight: s.fontSize ? `${Math.round(s.fontSize * 1.3)}px` : undefined,
    fontWeight: s.bold ? 700 : undefined,
    fontStyle: s.italic ? 'italic' : undefined,
    color: s.textColor,
    background: s.background,
  };
}

/** Where active tags show on the 4D viewer: stacked in the bottom corner,
    or as callouts next to the objects they belong to. */
export type TagPlacement = 'corner' | 'objects';

interface TagsState {
  tags: Tag[];
  placement: TagPlacement;
  setPlacement: (p: TagPlacement) => void;
  /** Tags drawn on the 4D view at all (the toolbar's Visibility menu). */
  shown: boolean;
  setShown: (v: boolean) => void;
  /** Models page: the tag shown next to the object under the pointer
      (its {Obj:…} tokens from that object), or none. */
  hoverTagId: string | null;
  setHoverTagId: (id: string | null) => void;
  /** Creates a tag and returns its id. */
  add: () => string;
  update: (id: string, patch: Partial<Omit<Tag, 'id'>>) => void;
  remove: (id: string) => void;
}

export const useTagsStore = create<TagsState>()(
  persist(
    (set) => ({
      tags: [],
      placement: 'corner',
      setPlacement: (placement) => set({ placement }),
      shown: true,
      setShown: (shown) => set({ shown }),
      hoverTagId: null,
      setHoverTagId: (hoverTagId) => set({ hoverTagId }),
      add: () => {
        const id = crypto.randomUUID();
        set((s) => ({ tags: [...s.tags, { id, name: `Tag ${s.tags.length + 1}`, template: '{TaskName}' }] }));
        return id;
      },
      update: (id, patch) => set((s) => ({ tags: s.tags.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
      remove: (id) => set((s) => ({ tags: s.tags.filter((t) => t.id !== id) })),
    }),
    { name: 'sequence.tags' },
  ),
);

/** What the 4D driver found active at the current step, for the viewer overlay. */
export interface ActiveTagLabel {
  key: string;
  color: string;
  lines: string[];
  style?: TagStyle;
}

/** One tag text placed next to its objects (placement 'objects'). */
export interface TagCallout {
  key: string;
  color: string;
  text: string;
  style?: TagStyle;
  /** The objects it labels, per model id. */
  targets: Record<string, number[]>;
}

interface ActiveTagsState {
  items: ActiveTagLabel[];
  callouts: TagCallout[];
  set: (items: ActiveTagLabel[], callouts?: TagCallout[]) => void;
}

export const useActiveTagsStore = create<ActiveTagsState>((set) => ({
  items: [],
  callouts: [],
  set: (items, callouts = []) => set({ items, callouts }),
}));
