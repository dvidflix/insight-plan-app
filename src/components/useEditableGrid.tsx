import type { ReactNode } from 'react';
import { useCellRange } from './useCellRange';
import { useColumnResize } from './useColumnResize';

/** The standard for a table whose cells are typed in: Excel's range, fill down (Ctrl+D, or drag the corner square; double-click: to the
    end), copy and paste of columns. A table uses it like this:

      const grid = useEditableGrid({ rows, get: (col, row) => text, write: (col, [[rowIndex, text], ...]) => one change for all });
      <table className="xgrid" {...grid.grid}>
        <tr data-line={i}>
          <td className={`xgrid__cell${grid.sel('qty', i)}`}><input {...grid.cell('qty', i)} />{grid.handle('qty', i)}</td>

    `write` gets every cell of a fill or a paste at once, so the table can make it one change (one undo step). */
export function useEditableGrid<R>({ rows, get, write, widthsKey }: {
  /** Remembers the widths the columns were dragged to (the edge of a header cell sizes that column; double-click fits it to its text). */
  widthsKey?: string;
  rows: R[];
  /** The text of a cell. */
  get: (col: string, row: R) => string;
  /** Set cells of a column from text: [row index, text] pairs. What is no use as a value is for the table to leave out. */
  write: (col: string, cells: [number, string][]) => void;
}) {
  const range = useCellRange({
    rowCount: rows.length,
    fill: (col, srcLo, srcHi, end) => {
      const len = srcHi - srcLo + 1;
      const cells: [number, string][] = [];
      for (let i = srcHi + 1; i <= end; i++) {
        const from = rows[srcLo + ((i - srcHi - 1) % len)];
        if (from !== undefined && rows[i] !== undefined) cells.push([i, get(col, from)]);
      }
      if (cells.length) write(col, cells);
    },
    paste: (col, start, values) => write(col, values.map((v, k): [number, string] => [start + k, v]).filter(([i]) => i < rows.length)),
    read: (col, row) => (rows[row] === undefined ? '' : get(col, rows[row])),
  });
  const resize = useColumnResize(widthsKey);
  return {
    /** Spread on the <table>. */
    grid: {
      ...range.grid,
      ref: resize.ref,
      onMouseMove: resize.onMouseMove,
      onDoubleClick: resize.onDoubleClick,
      onMouseDown: (e: Parameters<typeof resize.onMouseDown>[0]) => { if (!resize.onMouseDown(e)) range.grid.onMouseDown(e); },
    },
    /** Spread on the input or select of a cell. */
    cell: (col: string, row: number) => ({ 'data-col': col, 'data-row': row }),
    /** The class to add to the <td>: it is tinted when in the range. */
    sel: (col: string, row: number) => (range.inRange(col, row) ? ' is-sel' : ''),
    /** The fill square, for the <td> at the corner of the range (the <td> needs position: relative, as .xgrid__cell has). */
    handle: (col: string, row: number): ReactNode =>
      range.hasHandle(col, row)
        ? <span className="xgrid__fill" onMouseDown={range.startFill} onDoubleClick={range.fillToEnd} title="Drag down to fill (Ctrl+D). Double-click: to the end." />
        : null,
  };
}
