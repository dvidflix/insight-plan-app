import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { createPortal } from 'react-dom';
import { activeOn, DOCK_DEFAULTS, DOCK_SIDES, panelsOn, SIDE_LABEL, useDockStore, type DockHost, type DockPanelId, type DockSide } from '../state/dockStore';
import { IconCube, IconPalette, IconSchema, IconSearch, IconTree, IconBookmark, IconCamera, IconChat, IconChevronLeft, IconClose, IconChecklist, IconGantt, IconLineGraph, IconList, IconSplit, IconTune, IconTwoPane, IconViewTable, IconWarning } from './icons';

/** What a tab shows instead of its name when the tabs don't fit. */
const TAB_ICONS: Record<DockPanelId, ComponentType<SVGProps<SVGSVGElement>>> = {
  gantt: IconGantt,
  tasks: IconList,
  resources: IconLineGraph,
  scenarios: IconSplit,
  recipes: IconList,
  rules: IconTune,
  clash: IconWarning,
  topics: IconChat,
  viewpoints: IconCamera,
  checks: IconChecklist,
  compare: IconTwoPane,
  datatable: IconViewTable,
  layouts: IconBookmark,
  details: IconList,
  links: IconSplit,
  predecessors: IconSplit,
  successors: IconSplit,
  progGantt: IconGantt,
  progTable: IconViewTable,
  related: IconCube,
  tree: IconTree,
  properties: IconList,
  search: IconSearch,
  views: IconCamera,
  colour: IconPalette,
  tableSetup: IconViewTable,
  fourD: IconSchema,
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
  return target ? createPortal(children, target) : null;
}

/** A tiny picture of a window with one side filled: where a panel goes. */
function SideIcon({ side, size = 16 }: { side: DockSide; size?: number }) {
  const fill = side === 'left' ? { x: 2, y: 2, w: 5, h: 12 } : side === 'right' ? { x: 9, y: 2, w: 5, h: 12 } : { x: 2, y: 9, w: 12, h: 5 };
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <rect x="1.5" y="1.5" width="13" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x={fill.x} y={fill.y} width={fill.w} height={fill.h} fill="currentColor" opacity="0.75" />
    </svg>
  );
}

const LIMITS: Record<DockSide, [number, number]> = { left: [260, 1100], right: [260, 1100], bottom: [140, 720] };

/** One dock: its tabs, a move / close menu, and the body its panels are drawn into. Nothing when it holds no panel. */
export function DockSideView({ side, host = 'viewer' }: { side: DockSide; host?: DockHost }) {
  const mine = useDockStore((s) => s.host === host);
  const entries = useDockStore((s) => s.entries);
  const placement = useDockStore((s) => s.placement);
  const activeRaw = useDockStore((s) => s.active);
  const size = useDockStore((s) => s.size[side]);
  const folded = useDockStore((s) => s.folded[side]);
  const setBody = useDockStore((s) => s.setBody);
  const tabs = useMemo(() => panelsOn({ entries, placement }, side), [entries, placement, side]);
  const active = activeOn({ entries, placement, active: activeRaw }, side);
  const drag = useRef<{ from: number; size: number } | null>(null);

  // Tabs that don't fit with their names are drawn as icons (names stay as tooltips). The width the named tabs
  // need is remembered while they are shown, so the switch back happens as soon as there is room again.
  const headEl = useRef<HTMLDivElement>(null);
  const tabsEl = useRef<HTMLDivElement>(null);
  const toolsEl = useRef<HTMLSpanElement>(null);
  const namedWidth = useRef(0);
  const iconWidth = useRef(0);
  const [compact, setCompact] = useState(false);
  const [stacked, setStacked] = useState(false);
  const tabKey = tabs.map((t) => t.id + t.label).join('|');
  useLayoutEffect(() => {
    namedWidth.current = 0;
    iconWidth.current = 0;
    setCompact(false);
    setStacked(false);
  }, [tabKey, folded]);
  useLayoutEffect(() => {
    const head = headEl.current;
    const el = tabsEl.current;
    if (!head || !el) return;
    // The names fit when they and the tools (move / fold / close) share the header's row. Icons that still
    // don't fit: the tools take a row of their own (first, at the right) and the icons the row below.
    const measure = () => {
      if (!compact) namedWidth.current = el.scrollWidth;
      const tools = toolsEl.current?.offsetWidth ?? 0;
      const room = head.clientWidth - tools - 16;
      if (compact && !stacked) iconWidth.current = el.scrollWidth;
      setCompact(namedWidth.current > room);
      setStacked(compact && iconWidth.current > room);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(head);
    return () => ro.disconnect();
  });

  useEffect(() => {
    if (mine && (tabs.length === 0 || folded)) setBody(side, null);
  }, [mine, tabs.length, folded, side, setBody]);

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
    return (
      <button type="button" className={`pane-reveal dock-reveal dock-reveal--${side}`} onClick={() => store().setFolded(side, false)} title={`Show the ${SIDE_LABEL[side].toLowerCase()} panels: ${label}`} aria-label={`Show the ${SIDE_LABEL[side].toLowerCase()} panels`}>
        <IconChevronLeft style={{ transform: side === 'right' ? undefined : side === 'left' ? 'rotate(180deg)' : 'rotate(90deg)' }} />
      </button>
    );
  }

  const handle = horizontal
    ? <div className="resize-handle resize-handle--h dock__grip" onMouseDown={startResize} role="separator" aria-label="Resize the bottom panels" />
    : <div className="resize-handle" onMouseDown={startResize} role="separator" aria-label={`Resize the ${side} panels`} />;

  return (
    <>
      {side !== 'left' && handle}
      <aside className={`config-panel seq-panel dock dock--${side}`} style={horizontal ? { height: size, width: 'auto', marginTop: 0 } : { width: size, minWidth: 0 }}>
        <div className={`filter-sidebar-header seq-righthead dock__head${stacked ? ' is-stacked' : ''}`} ref={headEl}>
          <div className={`config-tabs seq-righttabs${compact ? ' is-compact' : ''}`} role="tablist" ref={tabsEl}>
            {tabs.map((t) => {
              const TabIcon = TAB_ICONS[t.id];
              return (
                <button key={t.id} type="button" role="tab" aria-selected={active === t.id} aria-label={t.label} title={compact ? t.label : undefined} className={`config-tab${active === t.id ? ' active' : ''}`} onClick={() => store().select(side, t.id)}>
                  {compact && TabIcon ? <TabIcon className="dock__tabicon" /> : t.label}
                </button>
              );
            })}
          </div>
          <span className="dock__tools" ref={toolsEl}>
            {active && DOCK_SIDES.filter((s) => s !== side).map((s) => (
              <button key={s} type="button" className="icon-btn dock__tool" onClick={() => store().move(active, s)} title={`Move ${entries[active]?.label ?? 'this panel'} to the ${SIDE_LABEL[s].toLowerCase()}`} aria-label={`Move to the ${SIDE_LABEL[s].toLowerCase()}`}><SideIcon side={s} /></button>
            ))}
            <button type="button" className="icon-btn dock__tool" onClick={() => store().setFolded(side, true)} title="Fold these panels away" aria-label="Fold away"><IconChevronLeft style={{ transform: side === 'right' ? 'rotate(180deg)' : side === 'left' ? undefined : 'rotate(-90deg)' }} /></button>
            {active && <button type="button" className="icon-btn dock__tool" onClick={() => store().close(active)} title={`Close ${entries[active]?.label ?? 'the panel'} (the Panels menu brings it back)`} aria-label="Close panel"><IconClose /></button>}
          </span>
        </div>
        <div className="dock__body" ref={(el) => { if (el) setBody(side, el); }} />
      </aside>
      {side === 'left' && handle}
    </>
  );
}

/** The toolbar's Panels menu: every panel of this page, where it sits (left, bottom, right), and a switch to show or close it. */
export function DockMenu() {
  const entries = useDockStore((s) => s.entries);
  const placement = useDockStore((s) => s.placement);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const list = Object.values(entries).sort((a, b) => a.label.localeCompare(b.label));
  if (list.length === 0) return null;
  const store = useDockStore.getState;
  const isOn = (e: (typeof list)[number]) => (e.shown !== undefined ? e.shown : (placement[e.id] ?? DOCK_DEFAULTS[e.id]) !== 'closed');
  return (
    <div className="dock-menu" ref={root}>
      <button type="button" className={`btn btn--small${open ? ' primary' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} title="Panels: choose which show, and whether each sits left, at the bottom or right. Panels on the same side share it as tabs.">Panels ▾</button>
      {open && (
        <div className="dock-menu__pop" role="menu">
          {list.map((e) => {
            const side = placement[e.id] ?? DOCK_DEFAULTS[e.id];
            const on = isOn(e);
            return (
              <div key={e.id} className="dock-menu__row">
                <label className="dock-menu__name">
                  <input type="checkbox" checked={on} onChange={() => (on ? store().close(e.id) : store().reveal(e.id))} />
                  {e.label}
                </label>
                <span className="dock-menu__sides">
                  {DOCK_SIDES.map((s) => (
                    <button key={s} type="button" className={`icon-btn dock__tool${on && side === s ? ' is-on' : ''}`} onClick={() => store().move(e.id, s)} title={`${e.label} on the ${SIDE_LABEL[s].toLowerCase()}`} aria-label={`${e.label} on the ${SIDE_LABEL[s].toLowerCase()}`} aria-pressed={on && side === s}><SideIcon side={s} /></button>
                  ))}
                </span>
              </div>
            );
          })}
          <div className="dock-menu__foot" title="Panels on the same side share it as tabs; on different sides they show together.">
            <button type="button" className="btn btn--small" onClick={() => list.forEach((e) => { if (!isOn(e)) store().reveal(e.id); })}>Show all</button>
            <button type="button" className="btn btn--small" onClick={() => list.forEach((e) => { if (isOn(e)) store().close(e.id); })}>Hide all</button>
          </div>
        </div>
      )}
    </div>
  );
}
