import { create } from 'zustand';

/** The activities picked in a programme's table or Gantt: click one, Ctrl+click to add or remove one, Shift+click to reach
    down (or up) to another. It sits beside each view's own "current activity" (the details pane, the links): that one is
    always the last one clicked. Used by the actions that work on several activities (Settings > SeaTable > Retired). */
interface ActivitySelectionState {
  ids: Set<string>;
  /** Where a Shift range starts: the last plain or Ctrl click. */
  anchor: string | null;
  /** A click on a row. `order` is the rows as listed now (a Shift range follows it). */
  click: (id: string, mod: { ctrl?: boolean; shift?: boolean }, order: string[]) => void;
  clear: () => void;
}

export const useActivitySelectionStore = create<ActivitySelectionState>((set, get) => ({
  ids: new Set(),
  anchor: null,
  click: (id, mod, order) => {
    const { ids, anchor } = get();
    if (mod.shift && anchor !== null) {
      const from = order.indexOf(anchor);
      const to = order.indexOf(id);
      if (from >= 0 && to >= 0) {
        const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
        // Shift+Ctrl adds the range to what is picked; Shift alone makes it the selection.
        set({ ids: new Set(mod.ctrl ? [...ids, ...range] : range) });
        return;
      }
    }
    if (mod.ctrl) {
      const next = new Set(ids);
      if (!next.delete(id)) next.add(id);
      set({ ids: next, anchor: id });
      return;
    }
    set({ ids: new Set([id]), anchor: id });
  },
  clear: () => set({ ids: new Set(), anchor: null }),
}));
