import { useCallback, useEffect, useRef, useState } from 'react';

/** A persisted, draggable width for a side panel — drag the handle this
    returns to resize, width is remembered across reloads via localStorage. */
export function useResizableWidth(storageKey: string, defaultWidth: number, min = 200, max = 600) {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(storageKey));
    return stored >= min && stored <= max ? stored : defaultWidth;
  });
  const dragging = useRef<{ startX: number; startWidth: number; fromRight: boolean } | null>(null);

  const onMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging.current) return;
      const { startX, startWidth, fromRight } = dragging.current;
      const delta = fromRight ? startX - e.clientX : e.clientX - startX;
      const next = Math.min(max, Math.max(min, startWidth + delta));
      setWidth(next);
    },
    [min, max],
  );

  const onUp = useCallback(() => {
    dragging.current = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    setWidth((w) => {
      localStorage.setItem(storageKey, String(w));
      return w;
    });
  }, [onMove, storageKey]);

  useEffect(() => () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }, [onMove, onUp]);

  const startDrag = (fromRight: boolean) => (e: React.MouseEvent) => {
    dragging.current = { startX: e.clientX, startWidth: width, fromRight };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  /** Programmatic resize (e.g. fit-to-content); clamped and persisted like a drag. */
  const setClamped = useCallback((next: number) => {
    const w = Math.min(max, Math.max(min, Math.round(next)));
    setWidth(w);
    localStorage.setItem(storageKey, String(w));
  }, [min, max, storageKey]);

  return { width, startDrag, setWidth: setClamped };
}

/** A persisted, draggable height for a bottom pane: drag its top handle up to grow it. */
export function useResizableHeight(storageKey: string, defaultHeight: number, min = 120, max = 600) {
  const [height, setHeight] = useState(() => {
    const stored = Number(localStorage.getItem(storageKey));
    return stored >= min && stored <= max ? stored : defaultHeight;
  });
  const start = useRef<{ y: number; height: number } | null>(null);

  const onMove = useCallback((e: MouseEvent) => {
    if (start.current) setHeight(Math.min(max, Math.max(min, start.current.height + start.current.y - e.clientY)));
  }, [min, max]);
  const onUp = useCallback(() => {
    start.current = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    setHeight((h) => {
      localStorage.setItem(storageKey, String(h));
      return h;
    });
  }, [onMove, storageKey]);
  useEffect(() => () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  }, [onMove, onUp]);

  const startDrag = (e: React.MouseEvent) => {
    start.current = { y: e.clientY, height };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  return { height, startDrag };
}

export function ResizeHandleH({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return <div className="resize-handle resize-handle--h" onMouseDown={onMouseDown} aria-label="Resize pane" role="separator" tabIndex={0} />;
}

export function ResizeHandle({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <div className="resize-handle" onMouseDown={onMouseDown} aria-label="Resize panel" role="separator" tabIndex={0} />
  );
}
