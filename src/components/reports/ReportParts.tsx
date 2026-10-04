import { useMemo, useState, type ReactNode } from 'react';
import type { ScheduleModel } from '../../schedule/types';
import { fmtDate } from '../../schedule/reports';
import { IconDownload } from '../icons';

export function ReportHeader({ title, description, model, onBack, onExport }: {
  title: string;
  description: string;
  model: ScheduleModel;
  onBack: () => void;
  onExport?: () => void;
}) {
  return (
    <div className="report-header">
      <div className="report-header__row">
        <button type="button" className="report-back" onClick={onBack}>← Reports</button>
        <h2 className="report-header__title">{title}</h2>
        {onExport && (
          <button type="button" className="checks-export-btn report-header__export" onClick={onExport}>
            <IconDownload />
            Export (CSV)
          </button>
        )}
      </div>
      <div className="report-header__desc">
        {description} · {model.project.name} · Data Date {fmtDate(model.project.dataDate)}
      </div>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="report-section">
      <div className="report-section__title">{title}</div>
      {children}
    </section>
  );
}

export interface Tile {
  value: ReactNode;
  label: string;
  color?: string;
}

export function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="report-tiles">
      {tiles.map((t) => (
        <div className="report-tile" key={t.label}>
          <div className="report-tile__value" style={t.color ? { color: t.color } : undefined}>{t.value}</div>
          <div className="report-tile__label">{t.label}</div>
        </div>
      ))}
    </div>
  );
}

export interface Bar {
  label: string;
  value: number;
  color?: string;
}

/** Horizontal bars scaled to the largest value; zero rows stay visible (empty
    track) so the full set of buckets is always shown. */
export function BarList({ rows, emptyText = 'No data.' }: { rows: Bar[]; emptyText?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <div className="report-empty">{emptyText}</div>;
  return (
    <div className="report-bars">
      {rows.map((r) => (
        <div className="report-bar" key={r.label}>
          <span className="report-bar__label" title={r.label}>{r.label}</span>
          <span className="report-bar__track">
            {r.value > 0 && <span className="report-bar__fill" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%`, background: r.color }} />}
          </span>
          <span className="report-bar__value">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Chips({ items }: { items: { text: string; color: string }[] }) {
  return (
    <div className="report-chips">
      {items.map((c) => (
        <span className="report-chip" key={c.text}><i style={{ background: c.color }} />{c.text}</span>
      ))}
    </div>
  );
}

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
  /** Sort key; omit to make the column unsortable. */
  sort?: (row: T) => string | number | null;
}

const PAGE_SIZE = 50;

/** Sortable, paged table in the style of the report screenshots. */
export function PagedTable<T>({ columns, rows, rowKey, initialSort, footnote }: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  footnote?: string;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!col?.sort || !sort) return rows;
    const get = col.sort;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      if (x === y) return 0;
      if (x === null) return 1; // blanks always last
      if (y === null) return -1;
      return (x < y ? -1 : 1) * dir;
    });
  }, [rows, columns, sort]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const slice = sorted.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const toggleSort = (key: string) => {
    setPage(0);
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  };

  return (
    <div className="report-table">
      <div className="report-table__scroll">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`${c.align === 'right' ? 'right' : ''}${c.sort ? ' sortable' : ''}`}
                  onClick={c.sort ? () => toggleSort(c.key) : undefined}
                  aria-sort={sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => <td key={c.key} className={c.align === 'right' ? 'right' : ''}>{c.render(row)}</td>)}
              </tr>
            ))}
            {slice.length === 0 && <tr><td colSpan={columns.length} className="report-empty">No rows.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="report-table__pager">
        <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)}>← Prev</button>
        <span>Page {current + 1} of {pages}</span>
        <button type="button" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>Next →</button>
        <span className="report-table__range">
          {sorted.length === 0 ? '0' : `${current * PAGE_SIZE + 1}–${current * PAGE_SIZE + slice.length}`} of {sorted.length}
        </span>
      </div>
      {footnote && <div className="report-table__footnote">{footnote}</div>}
    </div>
  );
}

export function FilterRow({ children, onClear, summary }: { children: ReactNode; onClear: () => void; summary: string }) {
  return (
    <div className="report-filters">
      {children}
      <button type="button" className="report-filters__clear" onClick={onClear}>Clear filters</button>
      <span className="report-filters__summary">{summary}</span>
    </div>
  );
}

export function FilterSelect({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="report-filter">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function FilterText({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="report-filter">
      <span>{label}</span>
      <input type="text" value={value} placeholder="contains…" onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
