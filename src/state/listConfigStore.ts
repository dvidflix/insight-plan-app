import { create } from 'zustand';

/** The settings every list has: the same five panels, whichever list they are for. */
/** `source` and `match` are the Data table's external data: its sources, and how its rows are matched to the model's objects. */
export type ConfigKind = 'columns' | 'filters' | 'group' | 'sort' | 'color' | 'source' | 'match';
export const CONFIG_KINDS: ConfigKind[] = ['source', 'match', 'columns', 'filters', 'group', 'sort', 'color'];

/** A list that can be set up (the Programmes table, the Gantt, the Tasks): what it supports and how much is set. */
export interface ConfigTarget {
  id: string;
  label: string;
  kinds: ConfigKind[];
  badges: Partial<Record<ConfigKind, number>>;
  /** The list has settings of its own (shown at the bottom of the panel). */
  hasExtra?: boolean;
  /** The list narrows itself to the words of the header's search box. */
  searchable?: boolean;
  /** The list is grouped: the header's ‹ 2 › stepper works on it. `max` is its deepest group level ('' = All open). */
  level?: { value: string; max: number; set: (value: string) => void };
}

interface ListConfigState {
  targets: Record<string, ConfigTarget>;
  /** Lists clicked in, the latest first. */
  recent: string[];
  /** Held on one list whatever is clicked. */
  pinned: string | null;
  /** Where each panel draws what the active list gives it (not remembered). */
  slots: Partial<Record<ConfigKind, HTMLElement | null>>;
  /** Where the active list's own extras (presets, twin models ...) are drawn, above the settings. */
  extraSlot: HTMLElement | null;
  /** The setting the panel shows. */
  kind: ConfigKind;
  setKind: (kind: ConfigKind) => void;
  /** The N panel (list setup) beside the docks is open. */
  nOpen: boolean;
  setNOpen: (open: boolean) => void;
  setExtraSlot: (el: HTMLElement | null) => void;
  register: (t: ConfigTarget) => void;
  unregister: (id: string) => void;
  focus: (id: string, kind?: ConfigKind) => void;
  setPinned: (id: string | null) => void;
  setSlot: (kind: ConfigKind, el: HTMLElement | null) => void;
}

const same = (a: ConfigTarget | undefined, b: ConfigTarget) =>
  !!a && a.label === b.label && !!a.hasExtra === !!b.hasExtra && !!a.searchable === !!b.searchable && a.level?.value === b.level?.value && a.level?.max === b.level?.max && a.kinds.join() === b.kinds.join() && JSON.stringify(a.badges) === JSON.stringify(b.badges);

export const useListConfigStore = create<ListConfigState>((set) => ({
  targets: {},
  recent: [],
  pinned: null,
  slots: {},
  extraSlot: null,
  kind: 'filters',
  setKind: (kind) => set({ kind }),
  nOpen: false,
  setNOpen: (nOpen) => set({ nOpen }),
  setExtraSlot: (extraSlot) => set((s) => (s.extraSlot === extraSlot ? s : { extraSlot })),
  register: (t) => set((s) => (same(s.targets[t.id], t) ? s : { targets: { ...s.targets, [t.id]: t } })),
  unregister: (id) => set((s) => {
    if (!s.targets[id]) return s;
    const targets = { ...s.targets };
    delete targets[id];
    return { targets, recent: s.recent.filter((r) => r !== id), pinned: s.pinned === id ? null : s.pinned };
  }),
  focus: (id, kind) => set((s) => ({ ...(kind ? { kind } : {}), ...(s.recent[0] === id ? {} : { recent: [id, ...s.recent.filter((r) => r !== id)] }) })),
  setPinned: (pinned) => set({ pinned }),
  setSlot: (kind, el) => set((s) => (s.slots[kind] === el ? s : { slots: { ...s.slots, [kind]: el } })),
}));

type View = Pick<ListConfigState, 'targets' | 'recent' | 'pinned'>;

/** The list the panels are for: the pinned one, else the one last clicked in, else any that there is. */
export function activeTargetId(s: View): string | null {
  if (s.pinned && s.targets[s.pinned]) return s.pinned;
  // With none clicked yet: the first real list (one with settings of its own), so the lists that only take the header's search (Rules, Recipes) do not stand in for the Gantt.
  const ids = Object.keys(s.targets);
  return s.recent.find((id) => s.targets[id]) ?? ids.find((id) => s.targets[id].kinds.length > 0) ?? ids[0] ?? null;
}

/** Spread on a list's container: clicking or tabbing into it makes it the list the panels are for.
    The header's search box and level stepper work on the active list, so using them never changes it (a page's header sits inside its container as a portal, and its events bubble up to it). */
export function configFocusProps(id: string) {
  const focus = (e: { target: EventTarget }) => {
    if ((e.target as Element | null)?.closest?.('.gs, .ctx-stepper')) return;
    useListConfigStore.getState().focus(id);
  };
  return { onPointerDownCapture: focus, onFocusCapture: focus };
}
