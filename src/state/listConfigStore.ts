import { create } from 'zustand';

/** The settings every list has: the same five panels, whichever list they are for. */
export type ConfigKind = 'columns' | 'filters' | 'group' | 'sort' | 'color';
export const CONFIG_KINDS: ConfigKind[] = ['columns', 'filters', 'group', 'sort', 'color'];

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
  !!a && a.label === b.label && !!a.hasExtra === !!b.hasExtra && !!a.searchable === !!b.searchable && a.kinds.join() === b.kinds.join() && JSON.stringify(a.badges) === JSON.stringify(b.badges);

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
  return s.recent.find((id) => s.targets[id]) ?? Object.keys(s.targets)[0] ?? null;
}

/** Spread on a list's container: clicking or tabbing into it makes it the list the panels are for. */
export function configFocusProps(id: string) {
  const focus = () => useListConfigStore.getState().focus(id);
  return { onPointerDownCapture: focus, onFocusCapture: focus };
}
