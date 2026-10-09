import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ColumnDef } from '../../schedule/columns';
import { aggOptions, type AggKind } from '../../schedule/aggregates';

/** A totals-row cell, as in the Data table: the column's summary with a short tag for how it is
    summarised (Σ, avg, min…), or a faint ＋ when it is not; click it for a menu to change how
    (sum / average / min / max / count; earliest / latest / span for dates). */
export function AggCell({ column, kind, value, onKind }: { column: ColumnDef; kind: AggKind; value: string; onKind: (k: AggKind) => void }) {
  const [menu, setMenu] = useState<{ x: number; top?: number; bottom?: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);
  const options = aggOptions(column);
  if (!options.length) return null;
  const current = options.find((o) => o.id === kind) ?? options[0];
  return (
    <span className="agg-cell">
      <button
        type="button"
        className={`agg-cell__btn${kind === 'none' ? ' is-none' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          setMenu(r.top > window.innerHeight / 2 ? { x: r.left, bottom: window.innerHeight - r.top + 4 } : { x: r.left, top: r.bottom + 4 });
        }}
        title={kind === 'none' ? `Sum up ${column.label}…` : `${current.label} of ${column.label}: ${value} (click to change)`}
        aria-label={`Sum up ${column.label}`}
      >
        {kind === 'none' ? <span className="agg-cell__add">＋</span> : <><span className="agg-cell__kind">{current.short}</span><span className="agg-cell__value">{value}</span></>}
      </button>
      {menu &&
        createPortal(
          <div className="mdt__aggmenu" style={{ left: menu.x, top: menu.top, bottom: menu.bottom }} role="menu" onMouseDown={(e) => e.stopPropagation()}>
            {options.map((o) => (
              <button key={o.id} type="button" role="menuitemradio" aria-checked={kind === o.id} className={kind === o.id ? 'is-on' : ''} onClick={() => { onKind(o.id); setMenu(null); }}>
                <span className="mdt__aggmenu-tick">{kind === o.id ? '✓' : ''}</span>{o.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </span>
  );
}
