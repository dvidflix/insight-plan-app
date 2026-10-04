import type * as BUI from '@thatopen/ui';
import type { TableRowData } from '@thatopen/ui';

/** bim-table has no column resizing and no cell borders, so this wraps one:
    row dividers come from the table's own `--bim-table-row--border-bottom`
    token, and the two column dividers (after the first column, before the
    last) are thin draggable lines laid over the table. Dragging rewrites
    `table.columns` with new pixel widths for the first / last column; the
    middle column takes the rest. */
export function gridTable<T extends TableRowData>(
  table: BUI.Table<T>,
  columns: { first: { name: keyof T; px: number }; middle: keyof T; last: { name: keyof T; px: number } },
): HTMLElement {
  const MIN = 48;
  let firstPx = columns.first.px;
  let lastPx = columns.last.px;

  const apply = () => {
    table.columns = [
      { name: columns.first.name, width: `${firstPx}px` },
      columns.middle,
      { name: columns.last.name, width: `${lastPx}px` },
    ] as never;
    place();
  };

  table.style.setProperty('--bim-table-row--border-bottom', '1px solid var(--bim-ui_bg-contrast-20)');

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position: relative; width: 100%;';
  wrapper.append(table);

  const makeHandle = (onDrag: (dx: number) => void) => {
    const handle = document.createElement('div');
    handle.style.cssText =
      'position: absolute; top: 0; bottom: 0; width: 9px; margin-left: -4px; cursor: col-resize; z-index: 3; touch-action: none;';
    const line = document.createElement('div');
    line.style.cssText = 'position: absolute; top: 0; bottom: 0; left: 4px; width: 1px; background: var(--bim-ui_bg-contrast-20);';
    handle.append(line);
    handle.addEventListener('mouseenter', () => (line.style.background = 'var(--bim-ui_bg-contrast-50)'));
    handle.addEventListener('mouseleave', () => (line.style.background = 'var(--bim-ui_bg-contrast-20)'));
    handle.addEventListener('pointerdown', (down) => {
      down.preventDefault();
      handle.setPointerCapture(down.pointerId);
      let lastX = down.clientX;
      const move = (e: PointerEvent) => {
        onDrag(e.clientX - lastX);
        lastX = e.clientX;
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
    wrapper.append(handle);
    return handle;
  };

  const room = () => wrapper.clientWidth - MIN; // keep the middle column usable
  const firstHandle = makeHandle((dx) => {
    firstPx = Math.max(MIN, Math.min(room() - lastPx, firstPx + dx));
    apply();
  });
  const lastHandle = makeHandle((dx) => {
    lastPx = Math.max(MIN, Math.min(room() - firstPx, lastPx - dx));
    apply();
  });

  function place() {
    firstHandle.style.left = `${firstPx}px`;
    lastHandle.style.left = `${wrapper.clientWidth - lastPx}px`;
  }

  new ResizeObserver(place).observe(wrapper);
  apply();
  return wrapper;
}
