import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The panels that can be docked around the 3D view (Models and 4D Sequencing pages): each sits on the left, at the
    bottom or on the right of it. Panels on the same side share it as tabs; panels on different sides show together. */
export type DockSide = 'left' | 'bottom' | 'right';
export type DockPanelId = 'datatable' | 'gantt' | 'tasks' | 'resources' | 'scenarios' | 'clash' | 'topics' | 'viewpoints' | 'checks' | 'compare';

export const DOCK_SIDES: DockSide[] = ['left', 'bottom', 'right'];
export const SIDE_LABEL: Record<DockSide, string> = { left: 'Left', bottom: 'Bottom', right: 'Right' };

/** Where each panel starts, and the order of the tabs sharing a side. */
export const DOCK_DEFAULTS: Record<DockPanelId, DockSide> = {
  datatable: 'bottom',
  gantt: 'right',
  tasks: 'right',
  resources: 'right',
  scenarios: 'right',
  clash: 'right',
  topics: 'right',
  viewpoints: 'right',
  checks: 'right',
  compare: 'right',
};
const ORDER: DockPanelId[] = ['gantt', 'tasks', 'resources', 'scenarios', 'clash', 'topics', 'viewpoints', 'checks', 'compare', 'datatable'];

export interface DockEntry {
  id: DockPanelId;
  label: string;
  /** Shown or not, for panels that have their own switch (the data table). Absent: shown unless closed here. */
  shown?: boolean;
  /** Turns a panel with its own switch on / off. */
  setShown?: (shown: boolean) => void;
}

interface DockState {
  /** Where the user put each panel (absent: its default). 'closed' = not shown. */
  placement: Partial<Record<DockPanelId, DockSide | 'closed'>>;
  /** The tab showing on each side. */
  active: Partial<Record<DockSide, DockPanelId>>;
  /** Width (left, right) or height (bottom), px. */
  size: Record<DockSide, number>;
  /** Folded away to a thin strip. */
  folded: Record<DockSide, boolean>;
  /** Panels on screen now (set by DockPanel while mounted; not remembered). */
  entries: Partial<Record<DockPanelId, DockEntry>>;
  /** Where each side's body is (portal targets; not remembered). */
  bodies: Record<DockSide, HTMLElement | null>;
  register: (e: DockEntry) => void;
  unregister: (id: DockPanelId) => void;
  setBody: (side: DockSide, el: HTMLElement | null) => void;
  sideOf: (id: DockPanelId) => DockSide | 'closed';
  move: (id: DockPanelId, side: DockSide) => void;
  close: (id: DockPanelId) => void;
  select: (side: DockSide, id: DockPanelId) => void;
  setSize: (side: DockSide, size: number) => void;
  setFolded: (side: DockSide, folded: boolean) => void;
  /** Brings a panel up: on its side, as the tab showing, unfolded. */
  reveal: (id: DockPanelId) => void;
}

export const useDockStore = create<DockState>()(
  persist(
    (set, get) => ({
      placement: {},
      active: {},
      size: { left: 520, bottom: 300, right: 560 },
      folded: { left: false, bottom: false, right: false },
      entries: {},
      bodies: { left: null, bottom: null, right: null },
      register: (e) => set((s) => ({ entries: { ...s.entries, [e.id]: e } })),
      unregister: (id) => set((s) => {
        const entries = { ...s.entries };
        delete entries[id];
        return { entries };
      }),
      setBody: (side, el) => set((s) => (s.bodies[side] === el ? s : { bodies: { ...s.bodies, [side]: el } })),
      sideOf: (id) => get().placement[id] ?? DOCK_DEFAULTS[id],
      move: (id, side) => {
        get().entries[id]?.setShown?.(true);
        set((s) => ({ placement: { ...s.placement, [id]: side }, active: { ...s.active, [side]: id }, folded: { ...s.folded, [side]: false } }));
      },
      close: (id) => {
        const e = get().entries[id];
        if (e?.setShown) e.setShown(false);
        else set((s) => ({ placement: { ...s.placement, [id]: 'closed' } }));
      },
      select: (side, id) => set((s) => ({ active: { ...s.active, [side]: id } })),
      setSize: (side, size) => set((s) => ({ size: { ...s.size, [side]: size } })),
      setFolded: (side, folded) => set((s) => ({ folded: { ...s.folded, [side]: folded } })),
      reveal: (id) => {
        const e = get().entries[id];
        e?.setShown?.(true);
        set((s) => {
          const side = s.placement[id] && s.placement[id] !== 'closed' ? (s.placement[id] as DockSide) : DOCK_DEFAULTS[id];
          return { placement: { ...s.placement, [id]: side }, active: { ...s.active, [side]: id }, folded: { ...s.folded, [side]: false } };
        });
      },
    }),
    {
      name: 'viewer.dock',
      version: 1,
      partialize: (s) => ({ placement: s.placement, active: s.active, size: s.size, folded: s.folded }),
    },
  ),
);

/** The panels on `side` that are showing, in tab order. */
export function panelsOn(state: Pick<DockState, 'entries' | 'placement'>, side: DockSide): DockEntry[] {
  return ORDER.flatMap((id) => {
    const e = state.entries[id];
    if (!e) return [];
    if (e.shown === false) return [];
    return (state.placement[id] ?? DOCK_DEFAULTS[id]) === side ? [e] : [];
  });
}

/** The tab showing on `side`: the remembered one if it is there, else the first. */
export function activeOn(state: Pick<DockState, 'entries' | 'placement' | 'active'>, side: DockSide): DockPanelId | null {
  const tabs = panelsOn(state, side);
  const want = state.active[side];
  return (tabs.find((t) => t.id === want) ?? tabs[0])?.id ?? null;
}
