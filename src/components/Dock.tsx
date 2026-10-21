import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { createPortal } from 'react-dom';
import { activeTargetId, useListConfigStore } from '../state/listConfigStore';
import { useDockNavStore } from '../state/dockNavStore';
import { DockNav } from './DockNav';
import { panelColor } from './panelColors';
import { activeOn, isShowing, DOCK_DEFAULTS, DOCK_SIDES, panelsOn, SIDE_LABEL, useDockStore, type DockHost, type DockPanelId, type DockSide } from '../state/dockStore';
import { IconCube, IconPalette, IconSchema, IconSearch, IconTree, IconBookmark, IconCamera, IconChat, IconChevronLeft, IconChevronDown, IconClose, IconChecklist, IconGantt, IconLineGraph, IconList, IconSplit, IconTune, IconCompare, IconViewTable, IconWarning, IconInfo, IconArrowUp, IconArrowDown, IconColumns, IconFilter, IconGroup, IconSort, IconBookingsOpen, IconGear, IconCubeFocus, IconFolder, IconGridTable } from './icons';

/** What a tab shows instead of its name when the tabs don't fit. */
export const TAB_ICONS: Record<DockPanelId, ComponentType<SVGProps<SVGSVGElement>>> = {
  gantt: IconGantt,
  tasks: IconList,
  resources: IconLineGraph,
  distribution: IconGridTable,
  scenarios: IconSplit,
  clash: IconWarning,
  topics: IconChat,
  viewpoints: IconCamera,
  checks: IconChecklist,
  compare: IconCompare,
  datatable: IconViewTable,
  layouts: IconBookmark,
  details: IconInfo,
  links: IconSplit,
  predecessors: IconArrowUp,
  successors: IconArrowDown,
  related: IconCube,
  tree: IconTree,
  properties: IconList,
  search: IconSearch,
  views: IconCubeFocus,
  colour: IconPalette,
  fourD: IconSchema,
  planning: IconList,
  dictionary: IconTune,
  files: IconFolder,
  cfgColumns: IconColumns,
  cfgFilters: IconFilter,
  cfgGroup: IconGroup,
  cfgSort: IconSort,
  cfgColor: IconPalette,
  generated: IconBookingsOpen,
  settings: IconGear,
};

/** A panel that lives in one of the three docks around the 3D view (left, bottom, right). Mount it wherever its state
    lives; its content is drawn into the dock it is placed in, when it is that dock's tab showing. `shown` / `setShown`
    are for a panel with a switch of its own (the data table). */
export function DockPanel({ id, label, shown, setShown, host = 'viewer', children }: { id: DockPanelId; label: string; shown?: boolean; setShown?: (v: boolean) => void; host?: DockHost; children: ReactNode }) {
  // A panel of a page that is not showing stays out of the docks (and the Panels menu).
  const mine = useDockStore((s) => s.host === host);
  useEffect(() => {
    if (mine) useDockStore.getState().register({ id, label, shown, setShown });
  }, [mine, id, label, shown, setShown]);
  useEffect(() => () => { if (mine) useDockStore.getState().unregister(id); }, [mine, id]);
  const target = useDockStore((s) => {
    if (!mine || s.entries[id]?.shown === false) return null;
    const side = s.placement[id] ?? DOCK_DEFAULTS[id];
    if (side === 'closed' || s.folded[side] || activeOn(s, side) !== id) return null;
    return s.bodies[side];
  });
  // Its settings tab is the one showing: the panel stays mounted (it holds the settings), drawn nowhere.
  // So does a list that the settings panels are for: they sit beside it as tabs and the list must not go while they show.
  const configured = useListConfigStore((s) => activeTargetId(s) === id);
  const keep = useDockStore((s) => mine && s.entries[id]?.shown !== false && (s.placement[id] ?? DOCK_DEFAULTS[id]) !== 'closed' && (configured || isShowing(s, id)));
  const parked = useMemo(() => document.createElement('div'), []);
  if (target) return createPortal(children, target);
  return keep ? createPortal(children, parked) : null;
}

/** A panel's own toolbar: in a dock it joins the tabs in one header row; undocked it stays at the top of the panel. */
export function DockToolbar({ id, children }: { id: DockPanelId; children: ReactNode }) {
  const side = useDockStore((s) => { const p = s.placement[id] ?? DOCK_DEFAULTS[id]; return p === 'closed' ? null : p; });
  const here = useDockStore((s) => !!side && activeOn(s, side) === id);
  const slot = useDockStore((s) => (side ? s.tools[side] : null));
  if (side && here && slot) return createPortal(children, slot);
  return <>{children}</>;
}

/** A panel's action buttons, drawn in the navigation bar of the left or right dock it sits in (under the tab icons) while it is the tab
    showing; in the bottom dock, which has no bar, or when it is not docked, they stay where they are written. `order` sets their place. */
export function DockNavTools({ id, order = 0, className, children }: { id: DockPanelId; order?: number; className?: string; children: ReactNode }) {
  const side = useDockStore((s) => { const p = s.placement[id] ?? DOCK_DEFAULTS[id]; return p === 'closed' ? null : p; });
  const barSide = side === 'left' || side === 'right' ? side : null;
  const here = useDockStore((s) => !!barSide && activeOn(s, barSide) === id);
  const slot = useDockStore((s) => (barSide ? s.navTools[barSide] : null));
  if (barSide && here && slot) return createPortal(<div className="dock-nav__grp" style={{ order }}>{children}</div>, slot);
  if (barSide) return null;
  return <div className={className}>{children}</div>;
}

/** A tiny picture of a window with one side filled: where a panel goes. */
export function SideIcon({ side, size = 16 }: { side: DockSide | 'main'; size?: number }) {
  const fill = side === 'main' ? { x: 3, y: 3, w: 10, h: 10 } : side === 'left' ? { x: 2, y: 2, w: 5, h: 12 } : side === 'right' ? { x: 9, y: 2, w: 5, h: 12 } : { x: 2, y: 9, w: 12, h: 5 };
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x={fill.x} y={fill.y} width={fill.w} height={fill.h} fill="currentColor" opacity="0.75" />
    </svg>
  );
}

const LIMITS: Record<DockSide, [number, number]> = { left: [260, 1100], right: [260, 1100], bottom: [300, 720] };

/** One dock: its tabs, a move / close menu, and the body its panels are drawn into. Nothing when it holds no panel. */
export function DockSideView({ side, host = 'viewer' }: { side: DockSide; host?: DockHost }) {
  const mine = useDockStore((s) => s.host === host);
  const entries = useDockStore((s) => s.entries);
  const navFlip = useDockNavStore((s) => s.flip[side]);
  const placement = useDockStore((s) => s.placement);
  const activeRaw = useDockStore((s) => s.active);
  const size = useDockStore((s) => s.size[side]);
  const folded = useDockStore((s) => s.folded[side]);
  const setBody = useDockStore((s) => s.setBody);
  const order = useDockStore((s) => s.order);
  const tabs = useMemo(() => panelsOn({ entries, placement, order }, side), [entries, placement, order, side]);
  const active = activeOn({ entries, placement, active: activeRaw, order }, side);
  const drag = useRef<{ from: number; size: number } | null>(null);

  // Tabs that don't fit with their names are drawn as icons (names stay as tooltips). The width the named tabs
  // need is remembered while they are shown, so the switch back happens as soon as there is room again.
  const headEl = useRef<HTMLDivElement>(null);
  const tabsEl = useRef<HTMLDivElement>(null);
  const toolsEl = useRef<HTMLSpanElement>(null);
  const namedWidth = useRef(0);
  const iconWidth = useRef(0);
  const toolsWidth = useRef(0);
  // Layout changes made since the last frame: a header whose measuring flips back and forth is held where it is (a loop of
  // changes inside one frame can only end this way, as no frame is drawn in between).
  const flips = useRef({ n: 0, frame: 0 });
  const spend = () => {
    if (flips.current.n++ >= 8) return false;
    if (!flips.current.frame) flips.current.frame = requestAnimationFrame(() => { flips.current = { n: 0, frame: 0 }; });
    return true;
  };
  const [compact, setCompact] = useState(false);
  const [stacked, setStacked] = useState(false);
  // Not even the icons fit in the row of their own: the tabs become a dropdown box.
  const [dropdown, setDropdown] = useState(false);
  const tabKey = tabs.map((t) => t.id + t.label).join('|');
  useLayoutEffect(() => {
    namedWidth.current = 0;
    iconWidth.current = 0;
    toolsWidth.current = 0;
    if (!compact && !stacked && !dropdown) return;
    if (spend()) {
      setCompact(false);
      setStacked(false);
      setDropdown(false);
    }
    // Starts again from the names only when the tabs change; what it reads is the state at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKey, folded]);
  useLayoutEffect(() => {
    const head = headEl.current;
    const el = tabsEl.current;
    if (!head || !el) return;
    // The names fit when they and the tools (move / fold / close) share the header's row. Icons that still
    // don't fit: the tools take a row of their own (first, at the right) and the icons the row below.
    const measure = () => {
      if (!compact) namedWidth.current = el.scrollWidth;
      // The tools' width is taken while they share the row: stacked, they have a row of their own and measuring then would
      // make the room look bigger, so the layout would flip back and forth for ever.
      // (The fold button stretches to fill the row, so the width is that of the buttons at their own size, not the strip's.)
      if (!stacked && toolsEl.current) {
        const btns = Array.from(toolsEl.current.querySelectorAll<HTMLElement>('button:not(.dock__tool--fold)'));
        const one = btns[0]?.offsetWidth || 26;
        toolsWidth.current = (btns.length + 1) * one;
      }
      const room = head.clientWidth - toolsWidth.current - 16;
      if (compact && !stacked) iconWidth.current = el.scrollWidth;
      const nextCompact = namedWidth.current > room;
      const nextStacked = compact && iconWidth.current > room;
      const nextDropdown = nextStacked && iconWidth.current > head.clientWidth - 16;
      if (nextCompact === compact && nextStacked === stacked && nextDropdown === dropdown) return;
      if (!spend()) return;
      setCompact(nextCompact);
      setStacked(nextStacked);
      setDropdown(nextDropdown);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(head);
    return () => ro.disconnect();
  });

  useEffect(() => {
    if (mine && (tabs.length === 0 || folded)) setBody(side, null);
  }, [mine, tabs.length, folded, side, setBody]);

  // Every panel closed: the navigation bar stays, collapsed to its strip on the right, so the panels can be brought back from its menu.
  const nothingOpen = useDockStore((s) => DOCK_SIDES.every((sd) => panelsOn(s, sd).length === 0));
  if (mine && tabs.length === 0 && side === 'right' && nothingOpen) {
    return (
      <aside className="config-panel seq-panel dock dock--right dock--nav dock--empty" style={{ width: 'var(--nav-w, 38px)', minWidth: 0, flex: '0 0 auto' }}>
        <DockNav side="right" tabs={[]} active={null} icons={TAB_ICONS} />
      </aside>
    );
  }
  if (!mine || tabs.length === 0) return null;
  const store = useDockStore.getState;
  const horizontal = side === 'bottom';
  const [min, max] = LIMITS[side];

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    drag.current = { from: horizontal ? e.clientY : e.clientX, size };
    const move = (m: MouseEvent) => {
      if (!drag.current) return;
      const delta = horizontal ? drag.current.from - m.clientY : side === 'right' ? drag.current.from - m.clientX : m.clientX - drag.current.from;
      const cap = Math.min(max, (horizontal ? window.innerHeight : window.innerWidth) * 0.8);
      store().setSize(side, Math.round(Math.min(cap, Math.max(min, drag.current.size + delta))));
    };
    const up = () => {
      drag.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (folded) {
    const label = tabs.map((t) => t.label).join(', ');
    // Left and right: the fold button's place at the top of a strip as wide as the bar, pointing the other way to bring the panels back.
    if (!horizontal) {
      return (
        <nav className={`dock-nav dock-nav--folded${side === 'right' ? ' dock-nav--right' : ''}`} aria-label={`${SIDE_LABEL[side]} panels`}>
          <button type="button" className="dock-nav__more" onClick={() => store().setFolded(side, false)} title={`Show the ${SIDE_LABEL[side].toLowerCase()} panels: ${label}`} aria-label={`Show the ${SIDE_LABEL[side].toLowerCase()} panels`}>
            <IconChevronDown width={16} height={16} style={{ transform: side === 'right' ? 'rotate(90deg)' : 'rotate(-90deg)' }} />
          </button>
        </nav>
      );
    }
    return (
      <button type="button" className={`pane-reveal dock-reveal dock-reveal--${side}`} onClick={() => store().setFolded(side, false)} title={`Show the ${SIDE_LABEL[side].toLowerCase()} panels: ${label}`} aria-label={`Show the ${SIDE_LABEL[side].toLowerCase()} panels`}>
        <IconChevronLeft style={{ transform: 'rotate(90deg)' }} />
      </button>
    );
  }

  const toolButtons = (
    <>
      {active !== 'files' && <button type="button" className="icon-btn dock__tool dock__tool--fold" onClick={() => store().setFolded(side, true)} title="Fold these panels away" aria-label="Fold away"><IconChevronLeft style={{ transform: side === 'right' ? 'rotate(180deg)' : side === 'left' ? undefined : 'rotate(-90deg)' }} /></button>}
      {active && active !== 'files' && <button type="button" className="icon-btn dock__tool dock__tool--close" onClick={() => store().close(active)} title={`Close ${entries[active]?.label ?? 'the panel'} (the Panels menu brings it back)`} aria-label="Close panel"><IconClose /></button>}
    </>
  );

  // Left and right docks have a navigation bar of icons (as Blender's Properties editor); the bottom one keeps its tabs in a header.
  const navBar = !horizontal;
  // The bar is on the inner edge by default (the left for a right dock); Flip puts it on the other edge.
  const barOnLeft = (side === 'right') !== navFlip;

  const handle = horizontal
    ? <div className="resize-handle resize-handle--h dock__grip" onMouseDown={startResize} role="separator" aria-label="Resize the bottom panels" />
    : <div className="resize-handle" onMouseDown={startResize} role="separator" aria-label={`Resize the ${side} panels`} />;

  return (
    <>
      {side !== 'left' && handle}
      <aside data-active={active ?? undefined} className={`config-panel seq-panel dock dock--${side}${navBar ? ` dock--nav${barOnLeft ? '' : ' dock--nav-right'}` : ''}`} style={horizontal ? { height: size, width: 'auto', marginTop: 0 } : { width: size, minWidth: 0 }}>
        {/* Every dock has the same header as the bottom one: the tab (in the left and right docks only the panel showing; the others are in the navigation bar), a fold strip and the close button. */}
        {<div className={`filter-sidebar-header seq-righthead dock__head${stacked && !navBar ? ' is-stacked' : ''}`} ref={headEl}>
          <div className={`config-tabs seq-righttabs${compact && !navBar ? ' is-compact' : ''}`} role="tablist" ref={tabsEl}>
            {dropdown && !navBar ? (
              <select className="dock__tabselect" value={active ?? ''} onChange={(e) => store().select(side, e.target.value as typeof tabs[number]['id'])} aria-label="Panel">
                {tabs.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            ) : (
              <>
              {(navBar ? tabs.filter((t) => t.id === active) : tabs).map((t) => {
                const TabIcon = TAB_ICONS[t.id];
                return (
                  <button key={t.id} type="button" role="tab" aria-selected={active === t.id} aria-label={t.label} title={compact && !navBar ? `${t.label} (drag to the left, bottom or right to move it)` : 'Drag to the left, bottom or right to move it'} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => store().setDragging(t.id), 0); }} onDragEnd={() => store().setDragging(null)} className={`config-tab${active === t.id ? ' active' : ''}`} onClick={() => store().select(side, t.id)}>
                    {compact && !navBar && TabIcon ? <TabIcon className="dock__tabicon" style={{ color: panelColor(t.id) }} /> : t.label}
                  </button>
                );
              })}
              </>
            )}
          </div>
          <span className="dock__panel-tools" ref={(el) => store().setTools(side, el)} />
          <span className="dock__tools" ref={toolsEl}>
            {toolButtons}
          </span>
        </div>}
        {navBar ? (
          <div className="dock__row">
            <DockNav side={side} tabs={tabs} active={active} icons={TAB_ICONS} />
            <div className="dock__body" ref={(el) => { if (el) setBody(side, el); }} />
          </div>
        ) : (
          <div className="dock__body" ref={(el) => { if (el) setBody(side, el); }} />
        )}
      </aside>
      {side === 'left' && handle}
    </>
  );
}

/** While a tab is dragged: a zone along the left, bottom and right of the workspace to drop it on. */
export function DockDropZones() {
  const dragging = useDockStore((s) => s.dragging);
  const [over, setOver] = useState<DockSide | null>(null);
  if (!dragging) return null;
  const zone = (side: DockSide) => (
    <div
      key={side}
      className={`dock-drop dock-drop--${side}${over === side ? ' is-over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== side) setOver(side); }}
      onDragLeave={() => setOver((o) => (o === side ? null : o))}
      onDrop={(e) => { e.preventDefault(); useDockStore.getState().move(dragging, side); useDockStore.getState().setDragging(null); setOver(null); }}
    >
      <SideIcon side={side} size={28} />
      <span>{SIDE_LABEL[side]}</span>
    </div>
  );
  return <>{DOCK_SIDES.map(zone)}</>;
}
