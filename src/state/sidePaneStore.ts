import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
}

/** Calls fn when the view is split (not when it loads split): the side pane
    opens on the page's Views tab, where the split view is set up. */
export function useOnSplit(split: boolean, fn: () => void) {
  const prev = useRef(split);
  useEffect(() => {
    if (split && !prev.current) {
      fn();
      useSidePaneStore.getState().setOpen(true);
      useSidePaneStore.getState().setSettings(false);
    }
    prev.current = split;
    // fn only acts when split turns on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    }),
    { name: 'app.sidePane', partialize: (s) => ({ open: s.open, bareOpen: s.bareOpen }) },
  ),
);
