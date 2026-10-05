import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePersistedState } from '../utils/persistedState';
import { IconTune } from './icons';

/** "Row buttons": a small popover to choose which of a list's per-row buttons
    show (like Blender's restriction toggles), remembered under `storageKey`.
    Used by the Search sets, Viewpoints, the Inputs tables. */

export interface RowButtonDef<Id extends string> {
  id: Id;
  /** What the toggle shows (a character or an icon). */
  glyph: ReactNode;
  label: string;
}

export function useRowButtons<Id extends string>(storageKey: string) {
  const [hidden, setHidden] = usePersistedState<Id[]>(storageKey, []);
  return { hidden, setHidden, shown: (id: Id) => !hidden.includes(id) };
}

export function RowButtonsChooser<Id extends string>({ buttons, rb, title = 'Choose which buttons show on each row', compact }: {
  buttons: readonly RowButtonDef<Id>[];
  rb: ReturnType<typeof useRowButtons<Id>>;
  title?: string;
  /** A small icon button (for table headers) instead of a toolbar button. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="ss__cols" ref={ref} style={compact ? { display: 'inline-block' } : undefined}>
      <button type="button" className={compact ? 'mini-btn mini-btn--icon' : 'btn ss__tool'} onClick={() => setOpen((v) => !v)} aria-expanded={open} title={title} aria-label="Row buttons">
        <IconTune width={16} height={16} />
      </button>
      {open && (
        <div className="ss__pop" role="dialog" aria-label="Row buttons">
          <div className="ss__pop-title">Row buttons</div>
          <div className="ss__pop-row">
            {buttons.map((b) => {
              const on = rb.shown(b.id);
              return (
                <button
                  key={b.id}
                  type="button"
                  className={`ss__pop-btn${on ? ' on' : ''}`}
                  aria-pressed={on}
                  title={`${on ? 'Hide' : 'Show'}: ${b.label}`}
                  onClick={() => rb.setHidden(on ? [...rb.hidden, b.id] : rb.hidden.filter((x) => x !== b.id))}
                >
                  {b.glyph}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
