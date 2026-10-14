import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { activeOn, useDockStore } from './dockStore';

interface SidePaneState {
  /** The full-height side pane is shown (else only its reveal strip) on
      pages with tabs of their own. */
  open: boolean;
  /** The same on pages without tabs (Inputs), where the pane holds only
      Settings: hidden until asked for. */
  bareOpen: boolean;
  /** Shows / hides the pane of the page showing now (see `open`, `bareOpen`). */
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  /** The Settings tab is showing instead of the page's own tab. */
  settings: boolean;
  setSettings: (settings: boolean) => void;
  /** Where pages portal their tabs (set by SidePaneHost). */
  host: HTMLElement | null;
  /** How many pages are showing their tabs; none shows Settings alone. */
  claims: number;
  /** Where a page's second panel is portaled under the tabs (set by
      SidePaneHost), and how many pages are showing one. */
  dockHost: HTMLElement | null;
  dockClaims: number;
  /** The Settings pane also holds the 4D timeline settings (4D Sequencing is showing). */
  timelineSettings: boolean;
  /** Ctrl+Alt+9: show Viewpoints on this page (hide the pane when already showing them). */
  viewpointsRequest: { page: 'model' | 'sequence'; n: number } | null;
  requestViewpoints: (page: 'model' | 'sequence') => void;
}

/** Runs on each Ctrl+Alt+9 aimed at `page`: hides the Views panel when it is the tab showing in its dock, else brings it up. */
export function useViewpointsToggle(page: 'model' | 'sequence') {
  const request = useSidePaneStore((s) => s.viewpointsRequest);
  const seen = useRef(request);
  useEffect(() => {
    if (!request || request === seen.current) return;
    seen.current = request;
    if (request.page !== page) return;
    const dock = useDockStore.getState();
    const side = dock.sideOf('views');
    if (side !== 'closed' && !dock.folded[side] && activeOn(dock, side) === 'views') {
      dock.setFolded(side, true);
      return;
    }
    dock.reveal('views');
  }, [request, page]);
}

/** Calls fn when the view is split (not when it loads split): the Views panel comes up,
    where the split view is set up. */
export function useOnSplit(split: boolean) {
  const prev = useRef(split);
  useEffect(() => {
    if (split && !prev.current) useDockStore.getState().reveal('views');
    prev.current = split;
  }, [split]);
}

/** The app's one side pane (components/SidePane.tsx): whether it is shown,
    and whether it shows Settings or the current page's tabs. */
export const useSidePaneStore = create<SidePaneState>()(
  persist(
    (set) => ({
      open: true,
      bareOpen: false,
      setOpen: (open) =>
        set((s) => {
          const key = s.claims === 0 ? 'bareOpen' : 'open';
          return { [key]: typeof open === 'function' ? open(s[key]) : open };
        }),
      settings: false,
      setSettings: (settings) => set({ settings }),
      host: null,
      claims: 0,
      dockHost: null,
      dockClaims: 0,
      timelineSettings: false,
      viewpointsRequest: null,
      requestViewpoints: (page) => set((s) => ({ viewpointsRequest: { page, n: (s.viewpointsRequest?.n ?? 0) + 1 } })),
    }),
    { name: 'app.sidePane', partialize: (s) => ({ open: s.open, bareOpen: s.bareOpen }) },
  ),
);
