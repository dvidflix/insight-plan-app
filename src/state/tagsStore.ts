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
  /** Where this tag shows: stacked in the bottom corner, or next to its objects. Absent (older tags): the app-wide choice made before tags had their own. */
  placement?: TagPlacement;
  /** What the tag labels. Absent: the tasks of a 4D Link Group (the original). */
  source?: TagSource;
  /** Set / selection tags: the most labels drawn at once (default DEFAULT_SOURCE_MAX; keeps a big set readable and fast). */
  maxLabels?: number;
  /** Set / selection tags: switched off (kept, not drawn). */
  hidden?: boolean;
  /** The one tag the tag buttons of the sets use: turning a set's tags on adds the set to it, so no tag is made per set. */
  shared?: boolean;
}

/** What a tag is attached to. 'task': the active tasks of a Link Group in 4D. 'set': the objects of a search / selection set, always.
    'selection': the objects selected in the 3D view now. Their text comes from {Obj:...} tokens of each object. */
export type TagSource = { kind: 'task' } | { kind: 'set'; setId?: string; setIds?: string[] } | { kind: 'selection' };
/** The sets a set-tag labels (older tags have the one `setId`). */
export const setIdsOf = (t: Pick<Tag, 'source'>): string[] => (t.source?.kind === 'set' ? t.source.setIds ?? (t.source.setId ? [t.source.setId] : []) : []);
export const DEFAULT_SOURCE_MAX = 50;
export const isObjectSourced = (t: Pick<Tag, 'source'>) => t.source?.kind === 'set' || t.source?.kind === 'selection';

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

/** A tag's own placement, else the older app-wide one. */
export const placementOf = (tag: Pick<Tag, 'placement'>, fallback: TagPlacement): TagPlacement => tag.placement ?? fallback;

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
  /** A search / selection set's tags (from its row in Search sets): none yet makes one that labels each object by name; else all show or all hide. */
  toggleSetTags: (setId: string, setName: string) => void;
  /** Switches off every tag on a set or the selection (they are kept; the sets' tag buttons bring them back). */
  hideObjectTags: () => void;
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
      hideObjectTags: () => set((s) => ({
        tags: s.tags.map((t) => {
          if (!isObjectSourced(t)) return t;
          // The shared tag keeps its look and loses its sets (a set turned on again must not bring the others back).
          if (t.shared) return { ...t, source: { kind: 'set' as const, setIds: [] } };
          return t.hidden ? t : { ...t, hidden: true };
        }),
      })),
      toggleSetTags: (setId, setName) => set((s) => {
        const on = s.shown && s.tags.some((t) => t.source?.kind === 'set' && !t.hidden && setIdsOf(t).includes(setId));
        if (on) {
          // Off: out of the shared tag; a tag made for this set alone (earlier versions) is hidden.
          return {
            tags: s.tags.map((t) => {
              if (t.source?.kind !== 'set' || !setIdsOf(t).includes(setId)) return t;
              return t.shared ? { ...t, source: { kind: 'set' as const, setIds: setIdsOf(t).filter((x) => x !== setId) } } : { ...t, hidden: true };
            }),
          };
        }
        const shared = s.tags.find((t) => t.shared && t.source?.kind === 'set');
        if (!shared) {
          const tag: Tag = { id: crypto.randomUUID(), name: 'Set tags', template: '{Obj:_name}', placement: 'objects', shared: true, source: { kind: 'set', setIds: [setId] } };
          return { tags: [...s.tags, tag], shown: true };
        }
        void setName;
        return { tags: s.tags.map((t) => (t === shared ? { ...t, hidden: undefined, source: { kind: 'set' as const, setIds: [...new Set([...setIdsOf(t), setId])] } } : t)), shown: true };
      }),
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
  /** No coloured bar on the left (tags of a set or the selection: the colour belongs to 4D groups). */
  plain?: boolean;
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
