import { useTableStyleStore } from '../state/tableStyleStore';

/** Holding Ctrl (or Cmd) while the wheel turns scrolls 2, 3 or 4 times as far (a setting) over a list: the Table and the Gantt. The wheel's own amount is
    taken as the browser reports it (pixels, or lines on some mice) and doubled; the page does not zoom. */

const LINE_PX = 40;

/** How far a wheel event moves a scroller in pixels along each axis, with Ctrl / Cmd multiplying it (Settings > Tables: 2×, 3× or 4×); null when Ctrl is not held. */
export function wheelScrollBy(e: Pick<WheelEvent, 'ctrlKey' | 'metaKey' | 'altKey' | 'deltaX' | 'deltaY' | 'deltaMode'>): { x: number; y: number } | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? 800 : 1;
  const factor = useTableStyleStore.getState().ctrlScrollFactor;
  return { x: e.deltaX * unit * factor, y: e.deltaY * unit * factor };
}

/** A wheel tick within this time of the last one is part of the same spin: each speeds the glide up a little more. */
const SPIN_MS = 90;
const MAX_GAIN = 3;
/** The share of the way to the target covered each frame: the glide slows to a stop as it gets there. */
const EASE = 0.14;

/** Makes Ctrl + wheel over `el` scroll it double, and (Settings > Tables > Smooth mouse scrolling) glides the plain wheel: the
    distance is added to a target that the scroll position eases towards, faster the faster the wheel is turned. A trackpad (small
    pixel steps) already glides on its own and is left alone. Returns what takes it off. */
export function scrollDoubleWithCtrl(el: HTMLElement): () => void {
  let target = { x: 0, y: 0 };
  let last = { x: 0, y: 0 };
  let frame = 0;
  let lastTick = 0;
  let gain = 1;

  const step = () => {
    frame = 0;
    // Scrolled some other way meanwhile (scrollbar, keys): the glide gives up.
    if (Math.abs(el.scrollTop - last.y) > 2 || Math.abs(el.scrollLeft - last.x) > 2) return;
    const dx = target.x - el.scrollLeft;
    const dy = target.y - el.scrollTop;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      el.scrollLeft = target.x;
      el.scrollTop = target.y;
      return;
    }
    el.scrollLeft += dx * EASE;
    el.scrollTop += dy * EASE;
    last = { x: el.scrollLeft, y: el.scrollTop };
    frame = requestAnimationFrame(step);
  };

  const onWheel = (e: WheelEvent) => {
    const by = wheelScrollBy(e);
    const smooth = useTableStyleStore.getState().smoothScroll;
    if (by && !smooth) {
      e.preventDefault();
      el.scrollBy({ left: by.x, top: by.y });
      return;
    }
    if (e.altKey) return;
    const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? 800 : 1;
    // Shift + wheel scrolls sideways: the vertical turn becomes a horizontal one.
    const sideways = e.shiftKey && !by;
    const dX = sideways ? e.deltaX || e.deltaY : e.deltaX;
    const dY = sideways ? 0 : e.deltaY;
    if (sideways && !smooth) {
      e.preventDefault();
      el.scrollBy({ left: dX * unit });
      return;
    }
    if (!smooth) return;
    // With Ctrl the glide goes the set number of times as far.
    const factor = by ? useTableStyleStore.getState().ctrlScrollFactor : 1;
    if (e.deltaMode === 0 && Math.abs(dY) < 30 && Math.abs(dX) < 30) {
      // A trackpad glides on its own; Ctrl still stretches it (and keeps the browser from zooming the page).
      if (by) { e.preventDefault(); el.scrollBy({ left: by.x, top: by.y }); }
      else if (sideways) { e.preventDefault(); el.scrollBy({ left: dX * unit }); }
      return;
    }
    const now = performance.now();
    gain = now - lastTick < SPIN_MS ? Math.min(MAX_GAIN, gain + 0.25) : 1;
    lastTick = now;
    e.preventDefault();
    // A glide in progress goes on from where it is heading; a new one starts from where the scroller is.
    if (!frame) target = { x: el.scrollLeft, y: el.scrollTop };
    target = {
      x: Math.max(0, Math.min(el.scrollWidth - el.clientWidth, target.x + dX * unit * gain * factor)),
      y: Math.max(0, Math.min(el.scrollHeight - el.clientHeight, target.y + dY * unit * gain * factor)),
    };
    last = { x: el.scrollLeft, y: el.scrollTop };
    if (!frame) frame = requestAnimationFrame(step);
  };
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    el.removeEventListener('wheel', onWheel);
    if (frame) cancelAnimationFrame(frame);
  };
}
