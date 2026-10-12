import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface CellOption {
  value: string;
  label: string;
}

/** A table cell that shows its value as plain text; a click opens a small menu to pick another (like the data table's
    totals). With many options the menu has a filter box. */
export function CellPick({ value, options, onChange, title, placeholder = '—', className = '' }: { value: string; options: CellOption[]; onChange: (v: string) => void; title?: string; placeholder?: string; className?: string }) {
  const [at, setAt] = useState<{ x: number; y: number; w: number } | null>(null);
  const [query, setQuery] = useState('');
  const menu = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);
  useEffect(() => {
    if (!at) return;
    const away = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node)) setAt(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAt(null); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [at]);
  const q = query.trim().toLowerCase();
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  return (
    <>
      <button
        type="button"
        className={`cellpick ${className}`}
        title={title ?? current?.label}
        aria-haspopup="menu"
        aria-expanded={!!at}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setQuery('');
          setAt({ x: r.left, y: r.bottom + 2, w: r.width });
        }}
      >
        {current?.label ?? (value || placeholder)}
      </button>
      {at && createPortal(
        <div ref={menu} className="mdt__aggmenu cellpick__menu" style={{ left: Math.min(at.x, window.innerWidth - 260), top: at.y, minWidth: Math.max(120, at.w), maxHeight: Math.max(160, window.innerHeight - at.y - 12) }} role="menu">
          {options.length > 10 && <input className="cellpick__filter" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter…" aria-label="Filter" />}
          <div className="cellpick__list">
            {shown.map((o) => (
              <button key={o.value} type="button" role="menuitemradio" aria-checked={o.value === value} className={o.value === value ? 'is-on' : ''} onClick={() => { onChange(o.value); setAt(null); }}>
                <span className="mdt__aggmenu-tick">{o.value === value ? '✓' : ''}</span>{o.label}
              </button>
            ))}
            {shown.length === 0 && <div className="cellpick__none">Nothing matches</div>}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
