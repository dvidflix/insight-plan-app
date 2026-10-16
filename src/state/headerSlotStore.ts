import { create } from 'zustand';

/** Where a page puts its toolbar (`el`: across the whole width above the docks) and the status bar (`footer`: under the centre only, so
    the docks on the sides run to the bottom of the page). Both are set by ViewerWorkspace. */
export const useHeaderSlotStore = create<{
  el: HTMLElement | null;
  setEl: (el: HTMLElement | null) => void;
  footer: HTMLElement | null;
  setFooter: (el: HTMLElement | null) => void;
}>((set) => ({
  el: null,
  setEl: (el) => set((s) => (s.el === el ? s : { el })),
  footer: null,
  setFooter: (footer) => set((s) => (s.footer === footer ? s : { footer })),
}));
