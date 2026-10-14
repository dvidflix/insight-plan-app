import { create } from 'zustand';

/** The dates the 4D timeline bar covers (its left and right ends), published by the bar so a chart can draw on the same scale. */
export const useTimelineSpanStore = create<{ min: number | null; max: number | null; set: (min: number | null, max: number | null) => void }>((set) => ({
  min: null,
  max: null,
  set: (min, max) => set((s) => (s.min === min && s.max === max ? s : { min, max })),
}));

// The bar and the charts that mirror it scroll as one: each keeps the same share of its own width scrolled, so with the same zoom
// (every inner width is zoom × its viewport) they show the same dates.
const scrollers = new Set<HTMLElement>();
let syncing = false;

const fractionOf = (el: HTMLElement) => el.scrollLeft / Math.max(1, el.scrollWidth);

/** Copies the scrolled share of another registered scroller onto `el` (after its width changed, say). */
export function syncTimelineScroll(el: HTMLElement) {
  const peer = [...scrollers].find((o) => o !== el);
  if (peer) el.scrollLeft = fractionOf(peer) * el.scrollWidth;
}

export function registerTimelineScroller(el: HTMLElement): () => void {
  scrollers.add(el);
  syncTimelineScroll(el);
  const onScroll = () => {
    if (syncing) return;
    syncing = true;
    const f = fractionOf(el);
    for (const o of scrollers) if (o !== el && Math.abs(o.scrollLeft - f * o.scrollWidth) >= 1) o.scrollLeft = f * o.scrollWidth;
    syncing = false;
  };
  el.addEventListener('scroll', onScroll, { passive: true });
  return () => {
    scrollers.delete(el);
    el.removeEventListener('scroll', onScroll);
  };
}
