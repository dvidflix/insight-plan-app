/** A point on screen (client pixels). */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** Box select on a 3D view's container: while `active()`, dragging draws
    a rectangle. Left to right asks for what is fully inside it (solid
    outline), right to left for what it touches (dashed) — the CAD
    convention. A click without a drag reports `onClick`. Ctrl / Shift
    adds to the selection. Returns a function that removes it. */
export function attachBoxSelect(
  container: HTMLElement,
  active: () => boolean,
  onBox: (a: ScreenPoint, b: ScreenPoint, fullyIncluded: boolean, additive: boolean) => void,
  onClick: (additive: boolean) => void,
): () => void {
  const box = document.createElement('div');
  box.className = 'box-select';
  box.style.display = 'none';
  container.append(box);
  let start: ScreenPoint | null = null;
  const onDown = (e: PointerEvent) => {
    if (!active() || e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY };
    container.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const draw = (e: PointerEvent) => {
    if (!start) return;
    const r = container.getBoundingClientRect();
    const x = Math.min(start.x, e.clientX) - r.left;
    const y = Math.min(start.y, e.clientY) - r.top;
    box.style.cssText = `display: block; left: ${x}px; top: ${y}px; width: ${Math.abs(e.clientX - start.x)}px; height: ${Math.abs(e.clientY - start.y)}px;`;
    box.classList.toggle('is-crossing', e.clientX < start.x);
  };
  const onUp = (e: PointerEvent) => {
    if (!start) return;
    const from = start;
    start = null;
    box.style.display = 'none';
    if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
    const additive = e.ctrlKey || e.metaKey || e.shiftKey;
    if (Math.abs(e.clientX - from.x) < 4 && Math.abs(e.clientY - from.y) < 4) onClick(additive);
    else onBox(from, { x: e.clientX, y: e.clientY }, e.clientX >= from.x, additive);
  };
  container.addEventListener('pointerdown', onDown, { capture: true });
  container.addEventListener('pointermove', draw);
  container.addEventListener('pointerup', onUp);
  container.addEventListener('pointercancel', onUp);
  return () => {
    container.removeEventListener('pointerdown', onDown, { capture: true });
    container.removeEventListener('pointermove', draw);
    container.removeEventListener('pointerup', onUp);
    container.removeEventListener('pointercancel', onUp);
    box.remove();
  };
}
