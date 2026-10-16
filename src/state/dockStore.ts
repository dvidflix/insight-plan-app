import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { IS_SATELLITE } from './satellite';

/** The panels that can be docked around the 3D view (Models and 4D Sequencing pages): each sits on the left, at the
    bottom or on the right of it. Panels on the same side share it as tabs; panels on different sides show together. */
export type DockSide = 'left' | 'bottom' | 'right';
export type DockPanelId = 'datatable' | 'gantt' | 'tasks' | 'resources' | 'scenarios' | 'recipes' | 'rules' | 'clash' | 'topics' | 'viewpoints' | 'checks' | 'compare' | 'layouts' | 'details' | 'links' | 'predecessors' | 'successors' | 'related' | 'tree' | 'properties' | 'search' | 'views' | 'colour' | 'tableSetup' | 'fourD' | 'planning' | 'dictionary' | 'files'
  // The Programmes page's settings, the app's Settings and the settings of the 4D panels: panels like the rest, where the side pane held them.
  | 'cfgColumns' | 'cfgFilters' | 'cfgGroup' | 'cfgSort' | 'cfgColor' | 'generated' | 'settings' | 'scenarioSettings';

export const DOCK_SIDES: DockSide[] = ['left', 'bottom', 'right'];
export const SIDE_LABEL: Record<DockSide, string> = { left: 'Left', bottom: 'Bottom', right: 'Right' };

/** Where each panel starts, and the order of the tabs sharing a side. */
export const DOCK_DEFAULTS: Record<DockPanelId, DockSide> = {
  datatable: 'bottom',
  gantt: 'bottom',
  tasks: 'right',
  resources: 'right',
  scenarios: 'right',
  recipes: 'bottom',
  rules: 'bottom',
  clash: 'right',
  topics: 'right',
  viewpoints: 'right',
  checks: 'right',
  compare: 'right',
  layouts: 'right',
  details: 'right',
  links: 'bottom',
  predecessors: 'bottom',
  successors: 'bottom',
  related: 'left',
  tree: 'left',
  properties: 'left',
  search: 'left',
  views: 'left',
  colour: 'left',
  tableSetup: 'left',
  fourD: 'right',
  cfgColumns: 'right',
  cfgFilters: 'right',
  cfgGroup: 'right',
  cfgSort: 'right',
  cfgColor: 'right',
  generated: 'right',
  settings: 'right',
  scenarioSettings: 'right',
  planning: 'right',
  dictionary: 'right',
  files: 'bottom',
};
/** The order of the tabs on a side: Tree, Properties, Sets, 4D, Tasks, 3D & Related, Clash first, then the rest, the Programmes ones and the tools in the order of the Panels menu. */
const ORDER: DockPanelId[] = ['tree', 'properties', 'search', 'fourD', 'tasks', 'related', 'clash', 'views', 'colour', 'tableSetup', 'resources', 'scenarios', 'recipes', 'rules', 'topics', 'viewpoints', 'checks', 'compare', 'datatable', 'layouts', 'details', 'links', 'planning', 'predecessors', 'successors', 'gantt', 'cfgColumns', 'cfgFilters', 'cfgGroup', 'cfgSort', 'cfgColor', 'dictionary', 'files', 'generated', 'scenarioSettings', 'settings'];

/** Which page's docks the panels belong to: the 3D view's (Models, 4D Sequencing) or the Programmes page's. Only the
    host that is showing registers its panels and draws its docks. */
export type DockHost = 'viewer' | 'programme';

export interface DockEntry {
  id: DockPanelId;
  label: string;
  /** Shown or not, for panels that have their own switch (the data table). Absent: shown unless closed here. */
  shown?: boolean;
  /** Turns a panel with its own switch on / off. */
  setShown?: (shown: boolean) => void;
}

interface DockState {
  /** The host showing now (null: a page without docks). Not remembered. */
  host: DockHost | null;
  setHost: (host: DockHost | null) => void;
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
  /** The panel being dragged by its tab (not remembered): the drop zones show while there is one. */
  dragging: DockPanelId | null;
  setDragging: (id: DockPanelId | null) => void;
  register: (e: DockEntry) => void;
  unregister: (id: DockPanelId) => void;
  setBody: (side: DockSide, el: HTMLElement | null) => void;
  /** Where a panel puts its own toolbar in the header, between the tabs and the fold / close buttons (bottom dock). */
  tools: Record<DockSide, HTMLElement | null>;
  setTools: (side: DockSide, el: HTMLElement | null) => void;
  sideOf: (id: DockPanelId) => DockSide | 'closed';
  move: (id: DockPanelId, side: DockSide) => void;
  close: (id: DockPanelId) => void;
  select: (side: DockSide, id: DockPanelId) => void;
  setSize: (side: DockSide, size: number) => void;
  setFolded: (side: DockSide, folded: boolean) => void;
  /** Brings a panel up: on its side, as the tab showing, unfolded. */
  reveal: (id: DockPanelId) => void;
  /** The order the user dragged the panels into (the tabs and the Panels list follow it); panels not named keep their place after. */
  order: DockPanelId[];
  setOrder: (order: DockPanelId[]) => void;
}

export const useDockStore = create<DockState>()(
  persist(
    (set, get) => ({
      order: [],
      setOrder: (order) => set({ order }),
      host: null,
      setHost: (host) => set((s) => (s.host === host ? s : { host, bodies: { left: null, bottom: null, right: null } })),
      placement: {},
      active: {},
      size: { left: 520, bottom: Math.round(window.innerHeight * 0.4), right: 560 },
      folded: { left: false, bottom: false, right: false },
      entries: {},
      bodies: { left: null, bottom: null, right: null },
      tools: { left: null, bottom: null, right: null },
      setTools: (side, el) => set((s) => (s.tools[side] === el ? s : { tools: { ...s.tools, [side]: el } })),
      dragging: null,
      setDragging: (dragging) => set({ dragging }),
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
      name: IS_SATELLITE ? 'viewer.dock.satellite' : 'viewer.dock',
      version: 3,
      // v3: the bottom dock defaults to two fifths of the screen, so any earlier saved height is dropped.
      migrate: (persisted, from) => {
        const p = persisted as Partial<DockState>;
        if (from < 3 && p.size) p.size = { ...p.size, bottom: Math.round(window.innerHeight * 0.4) };
        return p as DockState;
      },
      // While Home shows, the state in the store is Home's own: what is kept under this key stays the workspace's.
      partialize: (s) => (homeStash ?? { placement: s.placement, active: s.active, size: s.size, folded: s.folded, order: s.order }),
    },
  ),
);

/** Home keeps its own panel arrangement (sides, sizes, folds), whatever the scene or workspace: it is swapped in while Home
    shows and the workspace's put back when it is left. Kept under its own key, which scenes and workspaces leave alone. */
type DockLayout = Pick<DockState, 'placement' | 'active' | 'size' | 'folded' | 'order'>;
const HOME_DOCK_KEY = 'home.dock';
let homeStash: DockLayout | null = null;
const HOME_PANELS: DockPanelId[] = ['files', 'settings'];
const layoutOf = (s: DockState): DockLayout => ({ placement: s.placement, active: s.active, size: s.size, folded: s.folded, order: s.order });
export function setHomeDock(on: boolean) {
  const st = useDockStore;
  if (on && !homeStash) {
    homeStash = layoutOf(st.getState());
    let saved: Partial<DockLayout> = {};
    try { saved = JSON.parse(localStorage.getItem(HOME_DOCK_KEY) ?? '{}') as Partial<DockLayout>; } catch { /* the defaults */ }
    st.setState({ placement: saved.placement ?? {}, active: saved.active ?? {}, size: saved.size ?? homeStash.size, folded: saved.folded ?? { left: false, bottom: false, right: false }, order: saved.order ?? [] });
  } else if (!on && homeStash) {
    const back = homeStash;
    homeStash = null;
    st.setState(back);
  }
}
useDockStore.subscribe((s) => {
  if (!homeStash) return;
  try { localStorage.setItem(HOME_DOCK_KEY, JSON.stringify(layoutOf(s))); } catch { /* not kept */ }
});

/** The panels on `side` that are showing, in tab order. */
/** The tab order: the one the user dragged, then the default for the rest. */
export function panelOrder(order?: DockPanelId[]): DockPanelId[] {
  const mine = (order ?? []).filter((id) => ORDER.includes(id));
  return [...mine, ...ORDER.filter((id) => !mine.includes(id))];
}

export function panelsOn(state: Pick<DockState, 'entries' | 'placement'> & { order?: DockPanelId[] }, side: DockSide): DockEntry[] {
  return panelOrder(state.order).flatMap((id) => {
    const e = state.entries[id];
    if (!e) return [];
    // Home holds only its own panels, not the views' (4D, Clash, Viewpoints…).
    if (homeStash && !HOME_PANELS.includes(id)) return [];
    if (e.shown === false) return [];
    return (state.placement[id] ?? DOCK_DEFAULTS[id]) === side ? [e] : [];
  });
}

/** A panel's settings panel, which opens as a tab beside it and is mounted from inside it (or from its page). The panel
    has to stay mounted while its settings tab is the one showing, or the settings would unmount, the panel come back as the
    tab showing, and the settings be made again, for ever. */
export const COMPANION: Partial<Record<DockPanelId, DockPanelId>> = { scenarios: 'scenarioSettings' };

/** Whether `id` is the tab showing on its side, or its settings companion is (and is on screen). */
export function isShowing(state: Pick<DockState, 'entries' | 'placement' | 'active' | 'folded'>, id: DockPanelId): boolean {
  const side = state.placement[id] ?? DOCK_DEFAULTS[id];
  if (side === 'closed' || state.folded[side]) return false;
  const shown = activeOn(state, side);
  if (shown === id) return true;
  const c = COMPANION[id];
  return !!c && shown === c && (state.placement[c] ?? DOCK_DEFAULTS[c]) === side;
}

/** The tab showing on `side`: the remembered one if it is there, else the first. */
export function activeOn(state: Pick<DockState, 'entries' | 'placement' | 'active'> & { order?: DockPanelId[] }, side: DockSide): DockPanelId | null {
  const tabs = panelsOn(state, side);
  const want = state.active[side];
  return (tabs.find((t) => t.id === want) ?? tabs[0])?.id ?? null;
}
