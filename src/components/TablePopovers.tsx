import { useEffect, useRef, useState, type ReactNode } from 'react';
import { IconMoreHorizontal } from './icons';

/** A toolbar button that opens a popover under it, as in SeaTable: Filter, Sort, Group, Columns. The button lights up with a count when the
    tool has something set. A click outside, or Escape, closes it. */
export function ToolPopover({ icon, label, active = 0, activeLabel, width = 480, iconOnly = true, onOpen, children }: {
  icon: ReactNode;
  label: string;
  /** How many rules / filters are set; 0: none. */
  active?: number;
  /** The button's text while something is set ("2 sorts"); the label when absent. */
  activeLabel?: string;
  width?: number;
  /** Just the icon (and the count), for a narrow toolbar. */
  iconOnly?: boolean;
  /** Called as it opens. */
  onOpen?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [shift, setShift] = useState(0);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  // A popover that would run off the right of the window slides left to fit.
  const [maxH, setMaxH] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!open) { setShift(0); setMaxH(undefined); return; }
    const r = pop.current?.getBoundingClientRect();
    if (!r) return;
    if (r.right > window.innerWidth - 8) setShift(window.innerWidth - 8 - r.right);
    // One that opens up (from the bottom panel) or down must fit in the window: it scrolls inside instead of running off it.
    const top = 40;
    if (r.top < top) setMaxH(Math.max(160, r.height - (top - r.top)));
    else if (r.bottom > window.innerHeight - 8) setMaxH(Math.max(160, r.height - (r.bottom - (window.innerHeight - 8))));
  }, [open]);
  return (
    <span className="tp" ref={root}>
      <button type="button" className={`tp__btn${active > 0 ? ' is-active' : ''}${open ? ' is-open' : ''}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => { if (!open) onOpen?.(); setOpen(!open); }} title={label} aria-label={label}>
        {icon}
        {iconOnly ? (active > 0 && <span>{active}</span>) : <span>{active > 0 && activeLabel ? activeLabel : label}</span>}
      </button>
      {open && <div className="tp__pop" role="dialog" aria-label={label} ref={pop} style={{ width, left: shift, ...(maxH ? { maxHeight: maxH } : {}) }}>{children}</div>}
    </span>
  );
}

/** The three dots: the buttons there is no room for, as a menu. Each item closes the menu. */
export function OverflowMenu({ items }: { items: { label: string; icon?: ReactNode; onClick: () => void; hidden?: boolean; disabled?: boolean; /** A tick box: on or off. */ checked?: boolean; title?: string; /** A heading over the items that follow, not an item. */ heading?: boolean; /** A line between groups of items, not an item. */ separator?: boolean; /** Set in under the heading above it. */ indent?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  // A line only where there are items on both sides of it; a heading after items is set off by a line too.
  const visible = items.filter((i) => !i.hidden);
  const shown: typeof items = [];
  for (const i of visible) {
    const last = shown[shown.length - 1];
    if (i.separator && (!last || last.separator)) continue;
    if (i.heading && last && !last.separator) shown.push({ label: '-' + shown.length, onClick: () => {}, separator: true });
    shown.push(i);
  }
  while (shown.length && shown[shown.length - 1].separator) shown.pop();
  if (shown.length === 0) return null;
  return (
    <span className="tp" ref={root}>
      <button type="button" className={`tp__btn tp__btn--dots${open ? ' is-open' : ''}`} aria-expanded={open} aria-haspopup="menu" aria-label="More" title="More" onClick={() => setOpen(!open)}><IconMoreHorizontal width={18} height={18} /></button>
      {open && (
        <div className="tp__pop tp__menu" role="menu" style={{ right: 0, left: 'auto' }}>
          {shown.map((i) => (i.separator ? <div key={i.label} className="tp__sep" role="separator" /> : i.heading ? <div key={i.label} className="tp__heading">{i.label}</div> : (
            <button key={i.label} type="button" className={i.icon ? undefined : 'tp__noicon'} role={i.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={i.checked} disabled={i.disabled} title={i.title} onClick={() => { setOpen(false); i.onClick(); }}>{i.icon}<span>{i.label}</span>{i.checked !== undefined && <span className="tp__tick">{i.checked ? '✓' : ''}</span>}</button>
          )))}
        </div>
      )}
    </span>
  );
}
