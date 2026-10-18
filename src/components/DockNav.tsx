import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from 'react';
import { createPortal } from 'react-dom';
import { goToPanel, isHomeDock, PANEL_LABELS, panelOrder, SIDE_LABEL, useDockStore, type DockEntry, type DockPanelId, type DockSide } from '../state/dockStore';
import { useDockNavStore } from '../state/dockNavStore';
import { IconChevronDown } from './icons';
import { PANEL_KIND_ORDER, panelColor, panelKind } from './panelColors';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;
/** The navigation bar's box: the menu opens beside it, from the top of the window. */
type Anchor = { left: number; right: number; top: number };

/** A dock's navigation bar, as Blender's Properties editor has it: a strip of coloured panel icons down one edge, and under them a
    chevron with the menu (Hide, Flip, Visible Tabs). The colour says what kind of panel it is: planning, models, others, settings. */
export function DockNav({ side, tabs, active, icons }: { side: DockSide; tabs: DockEntry[]; active: DockPanelId | null; icons: Record<DockPanelId, IconType> }) {
  const flip = useDockNavStore((s) => s.flip[side]);
  const [menu, setMenu] = useState<Anchor | null>(null);
  const chev = useRef<HTMLButtonElement>(null);
  const bar = useRef<HTMLElement>(null);
  const store = useDockStore.getState;

  const openMenu = () => {
    const r = bar.current?.getBoundingClientRect();
    if (!r) return;
    // Under the fold button at the bar's top, so the menu covers neither the bar nor the header above it.
    const fold = bar.current?.querySelector('.dock-nav__more')?.getBoundingClientRect();
    setMenu({ left: r.left, right: r.right, top: fold ? fold.bottom + 4 : r.top });
  };

  return (
    <nav ref={bar} className="dock-nav" aria-label={`${SIDE_LABEL[side]} panels`}>
      <button type="button" className="dock-nav__more" aria-label="Fold away" title="Fold these panels away" onClick={() => store().setFolded(side, true)}>
        <IconChevronDown width={16} height={16} style={{ transform: side === 'right' ? 'rotate(-90deg)' : 'rotate(90deg)' }} />
      </button>
      {tabs.map((t) => {
        const Icon = icons[t.id];
        const on = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            aria-label={t.label}
            title={`${t.label} (drag to the left, bottom or right to move it)`}
            draggable
            onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; setTimeout(() => store().setDragging(t.id), 0); }}
            onDragEnd={() => store().setDragging(null)}
            className={`dock-nav__tab${on ? ' is-active' : ''}`}
            style={{ color: panelColor(t.id) }}
            onClick={() => store().select(side, t.id)}
          >
            {Icon ? <Icon width={20} height={20} /> : t.label.slice(0, 2)}
          </button>
        );
      })}
      <button ref={chev} type="button" className="dock-nav__more" aria-label="Navigation bar" aria-haspopup="menu" aria-expanded={!!menu} title="Navigation bar" onClick={() => (menu ? setMenu(null) : openMenu())}>
        <IconChevronDown width={16} height={16} />
      </button>
      <div className="dock-nav__actions" ref={(el) => store().setNavTools(side, el)} />
      {menu && <NavMenu side={side} flip={flip} at={menu} icons={icons} onClose={() => setMenu(null)} />}
    </nav>
  );
}

function NavMenu({ side, flip, at, icons, onClose }: { side: DockSide; flip: boolean; at: Anchor; icons: Record<DockPanelId, IconType>; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const entries = useDockStore((s) => s.entries);
  const placement = useDockStore((s) => s.placement);
  const order = useDockStore((s) => s.order);
  const nav = useDockNavStore.getState;
  const store = useDockStore.getState;
  useEffect(() => {
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  // Beside the bar, on the side that faces the middle of the window, measured once the menu has its width.
  const [pos, setPos] = useState({ top: at.top, left: at.right + 4 });
  useLayoutEffect(() => {
    const w = root.current?.offsetWidth ?? 200;
    const h = root.current?.offsetHeight ?? 0;
    const toRight = at.left < window.innerWidth / 2;
    const left = toRight ? at.right + 8 : at.left - w - 8;
    // From the top of the bar (under its fold button), tall enough to show every panel at once.
    const top = Math.max(8, Math.min(at.top, window.innerHeight - h - 8));
    setPos({ top, left: Math.max(8, left) });
  }, [at]);
  // Every panel, whatever the view: one this view does not have is listed too, and clicking it goes to the view that has it.
  const rows = useMemo(() => panelOrder(order).flatMap((id) => {
    const e = entries[id];
    if (e) return [{ ...e, here: true }];
    const label = PANEL_LABELS[id];
    return label && !isHomeDock() ? [{ id, label, here: false } as DockEntry & { here: boolean }] : [];
  }).sort((a, b) => PANEL_KIND_ORDER.indexOf(panelKind(a.id)) - PANEL_KIND_ORDER.indexOf(panelKind(b.id))), [entries, order]);
  // Shown: in a dock (this one or another) and not closed or switched off.
  const sideOfPanel = (e: DockEntry) => placement[e.id] ?? store().sideOf(e.id);
  const isShown = (e: DockEntry & { here?: boolean }) => e.here !== false && sideOfPanel(e) !== 'closed' && e.shown !== false;
  const toggle = (e: DockEntry & { here?: boolean }) => {
    if (e.here === false) { goToPanel(e.id); onClose(); return; }
    if (isShown(e)) store().close(e.id);
    else store().reveal(e.id);
  };
  // The bar sits on the inner edge by default (the left for a right dock); Flip moves it to the outer edge.
  const barOnLeft = (side === 'right') !== flip;
  return createPortal(
    <div ref={root} className="dock-menu" role="menu" style={{ top: pos.top, left: pos.left, maxHeight: window.innerHeight - pos.top - 8 }}>
      <div className="dock-menu__title">Navigation Bar</div>
      <button type="button" role="menuitem" className="dock-menu__item" onClick={() => { nav().toggleFlip(side); onClose(); }}>{barOnLeft ? 'Flip to Right' : 'Flip to Left'}</button>
      {(
        <div className="dock-menu__tabs">
                    {rows.map((r, i) => {
            const Icon = icons[r.id];
            const groupStart = i > 0 && panelKind(rows[i - 1].id) !== panelKind(r.id);
            return (
              <button key={r.id} type="button" role="menuitemcheckbox" aria-checked={isShown(r)} title={r.here ? undefined : 'Opens the view that has it'}className={`dock-menu__tab${isShown(r) ? ' is-on' : ''}${groupStart ? ' is-group' : ''}`} onClick={() => toggle(r)}>
                <span className="dock-menu__icon" style={{ color: panelColor(r.id) }}>{Icon && <Icon width={16} height={16} />}</span>
                <span className="dock-menu__label">{r.label}</span>
                
              </button>
            );
          })}
        </div>
      )}
    </div>,
    document.body,
  );
}
