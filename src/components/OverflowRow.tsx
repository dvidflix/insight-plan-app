import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export interface OverflowItem {
  key: string;
  node: ReactNode;
  /** Takes the room that is left (a search box): never moved to the menu. `min` is the least width it keeps. */
  grow?: { min: number };
  /** Always in the ⋯ menu, whatever the room (the tools used now and then). */
  menu?: boolean;
}

const GAP = 6;
const MORE_W = 34;

/** One row of tools that never wraps: the items that do not fit move, from the end of the list backwards, into a "⋯" menu at the right.
    The widths of the items are measured while they are in the row and remembered, so the row can decide again when the window changes. */
export function OverflowRow({ items, className = '' }: { items: OverflowItem[]; className?: string }) {
  const row = useRef<HTMLDivElement>(null);
  const widths = useRef(new Map<string, number>());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const more = useRef<HTMLSpanElement>(null);

  const decide = useCallback(() => {
    const el = row.current;
    if (!el) return;
    // Remember what the items in the row measure now.
    for (const child of Array.from(el.querySelectorAll<HTMLElement>(':scope > [data-ofk]'))) {
      const k = child.dataset.ofk!;
      const it = items.find((x) => x.key === k);
      if (it && !it.grow) widths.current.set(k, child.offsetWidth);
    }
    const avail = el.clientWidth;
    const always = items.filter((x) => x.menu);
    const fixed = items.filter((x) => x.grow).reduce((n, x) => n + x.grow!.min + GAP, 0) + (always.length ? MORE_W + GAP : 0);
    const movable = items.filter((x) => !x.grow && !x.menu);
    let used = fixed;
    let fit = 0;
    for (let i = 0; i < movable.length; i++) {
      const w = widths.current.get(movable[i].key);
      if (w === undefined) { fit = movable.length; break; } // not measured yet: show it, measure, decide again
      const next = used + w + GAP;
      const rest = movable.length - (i + 1);
      if (next + (rest > 0 && !always.length ? MORE_W + GAP : 0) > avail) break;
      used = next;
      fit = i + 1;
    }
    const out = new Set([...movable.slice(fit), ...always].map((x) => x.key));
    setHidden((prev) => (prev.size === out.size && [...out].every((k) => prev.has(k)) ? prev : out));
  }, [items]);

  useLayoutEffect(decide);
  useEffect(() => {
    const el = row.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => decide());
    ro.observe(el);
    return () => ro.disconnect();
  }, [decide]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!more.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const inMenu = items.filter((x) => hidden.has(x.key));
  return (
    <div ref={row} className={`ofr ${className}`.trim()}>
      {items.filter((x) => !hidden.has(x.key)).map((x) => (
        <span key={x.key} data-ofk={x.key} className={`ofr__item${x.grow ? ' ofr__item--grow' : ''}`} style={x.grow ? { minWidth: x.grow.min } : undefined}>{x.node}</span>
      ))}
      {inMenu.length > 0 && (
        <span ref={more} className="ofr__more">
          <button type="button" className={`icon-btn${open ? ' is-open' : ''}`} aria-expanded={open} aria-label="More tools" title="More tools" onClick={() => setOpen(!open)}>⋯</button>
          {open && <div className="ofr__menu" role="menu">{inMenu.map((x) => <span key={x.key} className="ofr__menu-item">{x.node}</span>)}</div>}
        </span>
      )}
    </div>
  );
}
