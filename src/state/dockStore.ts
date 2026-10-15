import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { IS_SATELLITE } from './satellite';

/** The panels that can be docked around the 3D view (Models and 4D Sequencing pages): each sits on the left, at the
    bottom or on the right of it. Panels on the same side share it as tabs; panels on different sides show together. */
export type DockSide = 'left' | 'bottom' | 'right';
export type DockPanelId = 'datatable' | 'gantt' | 'tasks' | 'resources' | 'scenarios' | 'recipes' | 'rules' | 'clash' | 'topics' | 'viewpoints' | 'checks' | 'compare' | 'layouts' | 'details' | 'links' | 'predecessors' | 'successors' | 'related' | 'tree' | 'properties' | 'search' | 'views' | 'colour' | 'tableSetup' | 'fourD' | 'planning' | 'dictionary'
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
};
/** The order of the tabs on a side: Tree, Properties, Sets, 4D, Tasks, 3D & Related, Clash first, then the rest. */
const ORDER: DockPanelId[] = ['tree', 'properties', 'search', 'fourD', 'tasks', 'related', 'clash', 'views', 'colour', 'tableSetup', 'gantt', 'resources', 'scenarios', 'recipes', 'rules', 'topics', 'viewpoints', 'checks', 'compare', 'datatable', 'planning', 'dictionary', 'layouts', 'details', 'links', 'predecessors', 'successors', 'cfgColumns', 'cfgFilters', 'cfgGroup', 'cfgSort', 'cfgColor', 'generated', 'scenarioSettings', 'settings'];

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
      host: null,
      setHost: (host) => set((s) => (s.host === host ? s : { host, bodies: { left: null, bottom: null, right: null } })),
      placement: {},
      active: {},
      size: { left: 520, bottom: 300, right: 560 },
      folded: { left: false, bottom: false, right: false },
      entries: {},
      bodies: { left: null, bottom: null, right: null },
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
export function activeOn(state: Pick<DockState, 'entries' | 'placement' | 'active'>, side: DockSide): DockPanelId | null {
  const tabs = panelsOn(state, side);
  const want = state.active[side];
  return (tabs.find((t) => t.id === want) ?? tabs[0])?.id ?? null;
}
