const EDGE_PX = 6;
const MIN_PX = 40;

/** Makes every column of every plain <table> in the app resizable: drag the
    right edge of a header cell. Tables that manage their own widths opt out
    with the `no-resize` class. Widths last until the table is re-mounted.

    Done once, at the document level, instead of per table: the first drag
    freezes each header's current width and switches the table to fixed
    layout (cells clip with an ellipsis), so the other columns don't jump. */
export function installTableColumnResize() {
  const edgeHit = (e: MouseEvent): HTMLTableCellElement | null => {
    const th = (e.target as Element | null)?.closest?.('th');
    if (!th || th.closest('table.no-resize')) return null;
    return e.clientX >= th.getBoundingClientRect().right - EDGE_PX ? th : null;
  };

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const th = edgeHit(e);
    if (!th) return;
    const table = th.closest('table')!;
    const row = th.parentElement as HTMLTableRowElement;
    const heads = [...row.children] as HTMLTableCellElement[];
    if (heads.some((h) => h.colSpan > 1)) return; // grouped headers: leave alone

    e.preventDefault();
    e.stopPropagation();

    if (!table.classList.contains('is-sized')) {
      const widths = heads.map((h) => h.getBoundingClientRect().width);
      heads.forEach((h, i) => { h.style.width = `${widths[i]}px`; h.style.minWidth = `${widths[i]}px`; });
      table.style.width = `${widths.reduce((a, b) => a + b, 0)}px`;
      table.style.minWidth = '0';
      table.classList.add('is-sized');
    }

    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    const startTable = table.getBoundingClientRect().width;
    document.body.classList.add('is-col-resizing');
    let moved = false;

    const onMove = (m: MouseEvent) => {
      const w = Math.max(MIN_PX, startW + m.clientX - startX);
      moved = moved || Math.abs(m.clientX - startX) > 2;
      th.style.width = `${w}px`;
      th.style.minWidth = `${w}px`;
      table.style.width = `${startTable + (w - startW)}px`;
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.classList.remove('is-col-resizing');
      // The mouseup lands on the header and would otherwise trigger its sort.
      if (moved) window.addEventListener('click', (c) => c.stopPropagation(), { capture: true, once: true });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, true);
}
