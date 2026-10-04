import { useEffect, useRef, useState } from 'react';

export interface FilterValue {
  value: string;
  count: number;
}

interface PourFilterProps {
  /** What the chart can show (e.g. Concrete, Precast), and which are switched off. */
  series: string[];
  hiddenSeries: string[];
  onHiddenSeries: (names: string[]) => void;
  /** WBS level the list below is cut at, and the values of that level. */
  depth: number;
  onDepth: (depth: number) => void;
  values: FilterValue[];
  excluded: string[];
  onExcluded: (values: string[]) => void;
}

const DEPTHS = [1, 2, 3, 4, 5];

/** Excel-style filter for the pours chart: tick what to include — which
    series, and which WBS values at a chosen level — with a search box and
    Select all / Clear. */
export function PourFilter({ series, hiddenSeries, onHiddenSeries, depth, onDepth, values, excluded, onExcluded }: PourFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const shown = values.filter((v) => v.value.toLowerCase().includes(query.trim().toLowerCase()));
  const active = hiddenSeries.length + excluded.length;
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const allShown = shown.length > 0 && shown.every((v) => !excluded.includes(v.value));

  return (
    <div className="rv-filter" ref={ref}>
      <button type="button" className={`btn${active ? ' primary' : ''}`} aria-expanded={open} onClick={() => setOpen((o) => !o)} title="Choose what the chart includes">
        Filter{active ? ` (${active})` : ''} ▾
      </button>
      {open && (
        <div className="rv-filter__pop" role="dialog" aria-label="Filter the chart">
          <div className="rv-filter__title">Show</div>
          {series.map((n) => (
            <label key={n} className="rv-filter__item">
              <input type="checkbox" checked={!hiddenSeries.includes(n)} onChange={() => onHiddenSeries(toggle(hiddenSeries, n))} /> {n}
            </label>
          ))}
          <div className="rv-filter__title">
            WBS
            <select value={depth} onChange={(e) => onDepth(Number(e.target.value))} aria-label="WBS level" title="WBS level the list is cut at">
              {DEPTHS.map((d) => (
                <option key={d} value={d}>Level {d}</option>
              ))}
            </select>
          </div>
          <input className="rv-filter__search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" aria-label="Search WBS values" />
          <label className="rv-filter__item rv-filter__item--all">
            <input
              type="checkbox"
              checked={allShown}
              onChange={() => onExcluded(allShown ? [...new Set([...excluded, ...shown.map((v) => v.value)])] : excluded.filter((x) => !shown.some((v) => v.value === x)))}
            />{' '}
            (Select all)
          </label>
          <div className="rv-filter__list">
            {shown.map((v) => (
              <label key={v.value} className="rv-filter__item">
                <input type="checkbox" checked={!excluded.includes(v.value)} onChange={() => onExcluded(toggle(excluded, v.value))} />
                <span className="rv-filter__label" title={v.value}>{v.value}</span>
                <span className="rv-filter__count">{v.count}</span>
              </label>
            ))}
            {shown.length === 0 && <div className="rv-note">Nothing matches.</div>}
          </div>
          {active > 0 && (
            <button type="button" className="mini-btn" onClick={() => { onHiddenSeries([]); onExcluded([]); }}>Clear filter</button>
          )}
        </div>
      )}
    </div>
  );
}
