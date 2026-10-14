/** Holding Ctrl (or Cmd) while the wheel turns scrolls twice as far over a list: the Table and the Gantt. The wheel's own amount is
    taken as the browser reports it (pixels, or lines on some mice) and doubled; the page does not zoom. */
export const CTRL_SCROLL_FACTOR = 2;

const LINE_PX = 40;

/** How far a wheel event moves a scroller in pixels along each axis, with Ctrl / Cmd doubling it; null when Ctrl is not held. */
export function wheelScrollBy(e: Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'deltaX' | 'deltaY' | 'deltaMode'>): { x: number; y: number } | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? 800 : 1;
  return { x: e.deltaX * unit * CTRL_SCROLL_FACTOR, y: e.deltaY * unit * CTRL_SCROLL_FACTOR };
}

/** Makes Ctrl + wheel over `el` scroll it double. Returns what takes it off. */
export function scrollDoubleWithCtrl(el: HTMLElement): () => void {
  const onWheel = (e: WheelEvent) => {
    const by = wheelScrollBy(e);
    if (!by) return;
    e.preventDefault();
    el.scrollBy({ left: by.x, top: by.y });
  };
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => el.removeEventListener('wheel', onWheel);
}
