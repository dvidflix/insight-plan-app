import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { IconInfo } from './icons';

const WIDTH = 280;

/** A small ⓘ that shows a general explanation on hover or keyboard focus,
    instead of a line of text taking up room in the panel. The tip is drawn
    on <body> (fixed), so scrolling panes never clip it; it opens below the
    icon, or above when there is no room. */
export function InfoTip({ children, label = 'About this', icon: Icon = IconInfo }: { children: ReactNode; label?: string; icon?: typeof IconInfo }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 8);
    const above = r.bottom + 180 > window.innerHeight;
    setPos({ left, top: above ? r.top - 6 : r.bottom + 6, above });
  };
  const hide = () => setPos(null);

  return (
    <>
      <span
        ref={ref}
        className="info-tip"
        role="button"
        tabIndex={0}
        aria-label={label}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        // Inside a <label> or a clickable header, a click must not toggle anything.
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <Icon />
      </span>
      {pos &&
        createPortal(
          <div className="info-tip__pop" role="tooltip" style={{ left: pos.left, top: pos.top, width: WIDTH, transform: pos.above ? 'translateY(-100%)' : undefined }}>
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
