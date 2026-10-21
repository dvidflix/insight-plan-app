import { useCallback } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

/** Excel's column widths for a typed-in table (.xgrid): drag the right edge of a header cell to size that column alone, double-click the edge to fit
    the column to its widest text. Part of useEditableGrid, so a table that follows the standard has it. With a `key` the widths are remembered. */
const EDGE = 6;
const MIN = 36;
const MAX = 1200;

const cellsOfHead = (table: HTMLTableElement) => {
  const row = table.tHead?.rows[table.tHead.rows.length - 1];
  return row ? Array.from(row.cells) : [];
};

/** The <col> of each column, made when the table has none (so a width is the column's, whatever its cells hold). */
function colsOf(table: HTMLTableElement): HTMLTableColElement[] {
  let group = table.querySelector(':scope > colgroup');
  if (!group) {
    group = document.createElement('colgroup');
    for (const h of cellsOfHead(table)) {
      const c = document.createElement('col');
      c.style.width = `${h.getBoundingClientRect().width}px`;
      group.appendChild(c);
    }
    table.insertBefore(group, table.firstChild);
  }
  return Array.from(group.querySelectorAll('col'));
}

const widthsOf = (cols: HTMLTableColElement[], table: HTMLTableElement) => {
  const heads = cellsOfHead(table);
  return cols.map((c, i) => parseFloat(c.style.width) || heads[i]?.getBoundingClientRect().width || 80);
};

/** The table is as wide as its columns (fixed layout): a wider column pushes the next ones along, as in Excel, instead of squeezing them. */
function fix(table: HTMLTableElement, cols: HTMLTableColElement[]) {
  table.style.tableLayout = 'fixed';
  table.style.width = `${widthsOf(cols, table).reduce((a, b) => a + b, 0)}px`;
  table.style.minWidth = '0';
}

export function useColumnResize(key?: string) {
  const storeKey = key ? `xgrid.widths.${key}` : null;

  /** The saved widths, put back when the table is drawn. */
  const ref = useCallback((el: HTMLTableElement | null) => {
    if (!el || !storeKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) ?? 'null') as number[] | null;
      if (!Array.isArray(saved) || !saved.length) return;
      const cols = colsOf(el);
      saved.forEach((w, i) => { if (cols[i] && Number.isFinite(w) && w >= MIN) cols[i].style.width = `${w}px`; });
      fix(el, cols);
    } catch { /* not remembered */ }
  }, [storeKey]);

  const remember = (el: HTMLTableElement, cols: HTMLTableColElement[]) => {
    if (!storeKey) return;
    try { localStorage.setItem(storeKey, JSON.stringify(widthsOf(cols, el).map(Math.round))); } catch { /* not remembered */ }
  };

  /** The header cell whose right edge the pointer is on, with its table and column index, or null. */
  const edgeOf = (e: ReactMouseEvent) => {
    const th = (e.target as HTMLElement | null)?.closest?.('thead th') as HTMLTableCellElement | null;
    const el = th?.closest('table') as HTMLTableElement | null;
    if (!th || !el || th.colSpan !== 1) return null;
    const r = th.getBoundingClientRect();
    if (e.clientX < r.right - EDGE || e.clientX > r.right + 2) return null;
    let index = 0;
    for (const h of cellsOfHead(el)) { if (h === th) return { th, el, index }; index += h.colSpan; }
    return null;
  };

  const onMouseMove = (e: ReactMouseEvent) => {
    const th = (e.target as HTMLElement | null)?.closest?.('thead th') as HTMLElement | null;
    if (th) th.style.cursor = edgeOf(e) ? 'col-resize' : '';
  };

  /** True when the press was on a column edge (and starts a resize). */
  const onMouseDown = (e: ReactMouseEvent): boolean => {
    const hit = edgeOf(e);
    if (!hit || e.button !== 0) return false;
    const cols = colsOf(hit.el);
    if (!cols[hit.index]) return false;
    e.preventDefault();
    const now = widthsOf(cols, hit.el);
    cols.forEach((c, i) => { c.style.width = `${now[i]}px`; });
    const startX = e.clientX;
    const startW = now[hit.index];
    fix(hit.el, cols);
    const move = (m: MouseEvent) => {
      cols[hit.index].style.width = `${Math.max(MIN, Math.min(MAX, startW + m.clientX - startX))}px`;
      fix(hit.el, cols);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      remember(hit.el, cols);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return true;
  };

  const onDoubleClick = (e: ReactMouseEvent) => {
    const hit = edgeOf(e);
    if (!hit) return;
    const cols = colsOf(hit.el);
    if (!cols[hit.index]) return;
    // The widest text of the column: its header, and the text (or the value of the input) of each of its cells.
    let widest = hit.th.scrollWidth;
    const probe = document.createElement('canvas').getContext('2d');
    for (const row of Array.from(hit.el.rows)) {
      let at = 0;
      for (const cell of Array.from(row.cells)) {
        if (at === hit.index && cell.colSpan === 1 && cell.tagName === 'TD' && probe) {
          const input = cell.querySelector<HTMLInputElement | HTMLSelectElement>('input:not([type=checkbox]), select');
          const text = input ? (input instanceof HTMLSelectElement ? input.selectedOptions[0]?.text ?? '' : input.value) : cell.textContent ?? '';
          probe.font = getComputedStyle(cell).font;
          widest = Math.max(widest, probe.measureText(text).width + 24);
        }
        at += cell.colSpan;
      }
    }
    const now = widthsOf(cols, hit.el);
    cols.forEach((c, i) => { c.style.width = `${now[i]}px`; });
    cols[hit.index].style.width = `${Math.max(MIN, Math.min(MAX, Math.ceil(widest)))}px`;
    fix(hit.el, cols);
    remember(hit.el, cols);
  };

  return { ref, onMouseMove, onMouseDown, onDoubleClick };
}
