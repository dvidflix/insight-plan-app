import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const PALETTE = ['#f6b8cb', '#aecbf2', '#b9e6b0', '#f5e79c', '#f6b3a9', '#d9dde0', '#c9b8f2', '#9fe0dc', '#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#8e24aa', '#6d4c41', '#212121'];

/** A colour as a cell of a grid (rules lists): just the swatch. Clicking it opens a small picker that starts on the hex code (type
    or paste it), with a palette and the system picker for anything else. The colour is always a #rrggbb hex. */
export function HexCell({ value, onChange, label = 'Colour' }: { value: string | null; onChange: (hex: string) => void; label?: string }) {
  const hex = value && HEX_RE.test(value) ? value.toLowerCase() : '#ffffff';
  const [open, setOpen] = useState<DOMRect | null>(null);
  const [text, setText] = useState(hex);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const system = useRef<HTMLInputElement>(null);
  useEffect(() => setText(hex), [hex]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const commit = (v: string) => {
    const t = v.trim();
    const withHash = t.startsWith('#') ? t : `#${t}`;
    if (HEX_RE.test(withHash)) onChange(withHash.toLowerCase());
    else setText(hex);
  };
  const top = open ? Math.min(open.bottom + 4, window.innerHeight - 190) : 0;
  const left = open ? Math.max(8, Math.min(open.left, window.innerWidth - 196)) : 0;
  return (
    <span className="rgrid__cell rgrid__cell--colour">
      <button ref={btn} type="button" className="rgrid__swatch" style={{ background: hex }} onClick={() => setOpen(open ? null : btn.current!.getBoundingClientRect())} title={`${label}: ${hex}`} aria-label={`${label} ${hex}`} aria-expanded={!!open} />
      {open && createPortal(
        <div ref={pop} className="hexpop" style={{ top, left }} role="dialog" aria-label={label}>
          <div className="hexpop__row">
            <span className="hexpop__chip" style={{ background: hex }} />
            <input
              className="hexpop__hex"
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => commit(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { commit(e.currentTarget.value); setOpen(null); } }}
              placeholder="#rrggbb"
              spellCheck={false}
              aria-label={`${label} (hex)`}
            />
          </div>
          <div className="hexpop__palette">
            {PALETTE.map((c) => <button key={c} type="button" className={`hexpop__sw${c === hex ? ' is-on' : ''}`} style={{ background: c }} onClick={() => { onChange(c); setOpen(null); }} title={c} aria-label={c} />)}
          </div>
          <button type="button" className="btn btn--small hexpop__more" onClick={() => system.current?.click()}>More colours…</button>
          <input ref={system} type="color" className="hexpop__native" value={hex} onChange={(e) => onChange(e.target.value)} tabIndex={-1} aria-hidden />
        </div>,
        document.body,
      )}
    </span>
  );
}
