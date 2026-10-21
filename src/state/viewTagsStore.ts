import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ViewId } from '../viewer/ViewerEngine';

/** What each view of a split does with tags (the Tags menu in the view's own header).
    - `hover`: the tag shown next to the object under the pointer (the main view's is the toolbar's "Tag on hover", state/tagsStore.ts).
    - `visible`: the tags that label the objects shown in that view. Undefined: every tag whose source is "Visible", as before. */
export interface ViewTagSettings {
  hover: string | null;
  visible?: string[];
}

interface ViewTagsState {
  views: Record<ViewId, ViewTagSettings>;
  setHover: (view: ViewId, id: string | null) => void;
  setVisible: (view: ViewId, ids: string[]) => void;
}

export const useViewTagsStore = create<ViewTagsState>()(
  persist(
    (set) => ({
      views: { main: { hover: null }, second: { hover: null } },
      setHover: (view, hover) => set((s) => ({ views: { ...s.views, [view]: { ...s.views[view], hover } } })),
      setVisible: (view, visible) => set((s) => ({ views: { ...s.views, [view]: { ...s.views[view], visible } } })),
    }),
    { name: 'viewer.viewTags' },
  ),
);
