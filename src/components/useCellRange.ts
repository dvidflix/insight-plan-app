import { useRef, useState, type ClipboardEvent, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react';

/** The spreadsheet behaviour of an editable grid, kept apart from what the grid shows so every such table can use it.
    The editable cells carry data-col (the column) and data-row (the row, from 0, as displayed); a row to fill to carries data-line.
    - click / Tab picks a cell; Shift+click or Shift+Up/Down extends the range down the column
    - Up / Down / Enter move to the cell above / below; Ctrl+D fills down (from the cell above, or from the top of the range)
    - drag the square at the corner of the range (double-click: to the end) to fill down, repeating the cells of the range
    - Ctrl+C copies the range as lines; pasting several lines fills down from the picked cell */
export interface CellRange { col: string; from: number; to: number }

export interface CellRangeOptions {
  rowCount: number;
  /** Copy the cells srcLo..srcHi down over the rows after srcHi, up to and including `end` (the source repeats if it is shorter). */
  fill: (col: string, srcLo: number, srcHi: number, end: number) => void;
  /** Put the pasted values down the column from the row `start`. */
  paste: (col: string, start: number, values: string[]) => void;
  /** The text of a cell, for copying. */
  read: (col: string, row: number) => string;
}

export function useCellRange(options: CellRangeOptions) {
  const [sel, setSel] = useState<CellRange | null>(null);
  const opts = useRef(options);
  opts.current = options;
  // Set when the grid puts the focus back itself (a filled cell is drawn anew): the range stays as it is.
  const keepRange = useRef(false);

  const lo = sel ? Math.min(sel.from, sel.to) : 0;
  const hi = sel ? Math.max(sel.from, sel.to) : 0;
  // The data-col / data-row are on the input or select, or on the cell (<td>) that holds it.
  const cellOf = (target: EventTarget) => {
    const d = (target as HTMLElement).closest?.<HTMLElement>('[data-col][data-row]')?.dataset;
    return d && d.col !== undefined && d.row !== undefined ? { col: d.col, row: Number(d.row) } : null;
  };
  const editorOf = (grid: HTMLElement, col: string, row: number) => {
    const el = grid.querySelector<HTMLElement>(`[data-col="${col}"][data-row="${row}"]`);
    return el && (el.matches('input,select,textarea') ? el : el.querySelector<HTMLElement>('input,select,textarea'));
  };
  const focusCell = (grid: HTMLElement, col: string, row: number) => editorOf(grid, col, row)?.focus();

  const onFocus = (e: FocusEvent) => {
    const c = cellOf(e.target);
    if (keepRange.current) { keepRange.current = false; return; }
    if (c) setSel({ col: c.col, from: c.row, to: c.row });
  };
  const onMouseDown = (e: MouseEvent) => {
    const c = cellOf(e.target);
    if (c && e.shiftKey && sel && sel.col === c.col) {
      e.preventDefault();
      setSel({ ...sel, to: c.row });
    }
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const c = cellOf(e.target);
    if (!c) return;
    const grid = e.currentTarget as HTMLElement;
    const last = opts.current.rowCount - 1;
    const s = sel && sel.col === c.col ? sel : { col: c.col, from: c.row, to: c.row };
    const top = Math.min(s.from, s.to);
    const bottom = Math.max(s.from, s.to);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      if (top === bottom) { if (top > 0) opts.current.fill(c.col, top - 1, top - 1, top); } else opts.current.fill(c.col, top, top, bottom);
      // The cell in focus may be drawn anew by the fill: give the focus back to it.
      requestAnimationFrame(() => {
        const el = editorOf(grid, c.col, c.row);
        if (el && document.activeElement !== el) { keepRange.current = true; el.focus(); if (document.activeElement !== el) keepRange.current = false; }
      });
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = Math.max(0, Math.min(last, (e.shiftKey ? s.to : c.row) + (e.key === 'ArrowDown' ? 1 : -1)));
      if (e.shiftKey) setSel({ col: c.col, from: s.from, to: next });
      else focusCell(grid, c.col, next);
    } else if (e.key === 'Enter' && !e.shiftKey && c.row < last) {
      e.preventDefault();
      focusCell(grid, c.col, c.row + 1);
    }
  };
  const onPaste = (e: ClipboardEvent) => {
    const c = cellOf(e.target);
    if (!c) return;
    const lines = e.clipboardData.getData('text/plain').replace(/\r/g, '').split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    if (lines.length < 2) return; // one value: the cell takes it as usual
    e.preventDefault();
    opts.current.paste(c.col, c.row, lines.map((l) => l.split('\t')[0].trim()));
    setSel({ col: c.col, from: c.row, to: Math.min(opts.current.rowCount - 1, c.row + lines.length - 1) });
  };
  const onCopy = (e: ClipboardEvent) => {
    if (!sel || lo === hi || cellOf(e.target)?.col !== sel.col) return;
    e.preventDefault();
    const lines: string[] = [];
    for (let r = lo; r <= hi; r++) lines.push(opts.current.read(sel.col, r));
    e.clipboardData.setData('text/plain', lines.join('\n'));
  };

  /** The square at the corner of the range: drag down to fill. */
  const startFill = (e: MouseEvent) => {
    if (!sel) return;
    e.preventDefault();
    e.stopPropagation();
    const col = sel.col;
    const last = opts.current.rowCount - 1;
    let end = hi;
    const move = (ev: globalThis.MouseEvent) => {
      const line = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-line]')?.dataset.line;
      if (line === undefined) return;
      end = Math.max(hi, Math.min(last, Number(line)));
      setSel({ col, from: lo, to: end });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (end > hi) opts.current.fill(col, lo, hi, end);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const fillToEnd = () => {
    if (!sel) return;
    const last = opts.current.rowCount - 1;
    if (last > hi) { opts.current.fill(sel.col, lo, hi, last); setSel({ col: sel.col, from: lo, to: last }); }
  };

  return {
    /** Spread on the table: the events that do the work. */
    grid: { onFocus, onMouseDown, onKeyDown, onPaste, onCopy },
    inRange: (col: string, row: number) => !!sel && sel.col === col && row >= lo && row <= hi,
    /** True for the cell that carries the fill square (the bottom of the range). */
    hasHandle: (col: string, row: number) => !!sel && sel.col === col && row === hi,
    startFill,
    fillToEnd,
  };
}
