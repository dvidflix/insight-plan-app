import { useState, type ReactNode } from 'react';
import { IconRemove } from './icons';

export interface FilterChip {
  id: string;
  /** The field's name. */
  label: string;
  /** What it is set to. */
  summary: string;
  onRemove: () => void;
  /** Opens the builder at this filter. */
  onEdit?: () => void;
}

export interface QuickFilter {
  id: string;
  label: string;
  active: boolean;
  onToggle: () => void;
}

/** The filter panel of every list, one layout: the match count, quick filters, what is applied as chips (one click removes one),
    saved filters, and the builder behind an "Add filter" button for when the quick ones are not enough. */
export function FilterShell({ matched, total, noun, emptyHint, chips, onClearAll, quick, combine, presets, addLabel = 'Add filter', advanced, advancedOpen, onAdvancedOpen, className = '' }: {
  matched: number;
  total: number;
  /** What the rows are called: "activities", "objects". */
  noun: string;
  /** Shown instead of the count when there is nothing to filter (no model loaded yet). */
  emptyHint?: string;
  chips: FilterChip[];
  onClearAll: () => void;
  quick?: QuickFilter[];
  /** How several filters combine: shown when more than one is applied. */
  combine?: ReactNode;
  presets?: ReactNode;
  addLabel?: string;
  /** The builder (conditions, fields). */
  advanced: ReactNode;
  /** Held by the panel when it needs to open the builder itself (a chip clicked); otherwise the shell keeps it. */
  advancedOpen?: boolean;
  onAdvancedOpen?: (open: boolean) => void;
  className?: string;
}) {
  const [own, setOwn] = useState(false);
  const open = advancedOpen ?? own;
  const setOpen = onAdvancedOpen ?? setOwn;
  const pct = total ? (matched / total) * 100 : 100;
  return (
    <div className={`fsh ${className}`}>
      <div className="fsh__count" aria-live="polite">
        {total === 0 && emptyHint ? <span className="fsh__empty">{emptyHint}</span> : (
          <>
            <span><b>{matched.toLocaleString()}</b> of {total.toLocaleString()} {noun}{matched === 0 && total > 0 && <span className="flt__none"> — no matches</span>}</span>
            <button type="button" className="cols__link" disabled={chips.length === 0} onClick={onClearAll}>Clear all</button>
          </>
        )}
        <div className="flt__bar"><span style={{ width: `${pct}%` }} /></div>
      </div>

      {quick && quick.length > 0 && (
        <div className="fsh__quick" role="group" aria-label="Quick filters">
          {quick.map((q) => (
            <button key={q.id} type="button" className={`fsh__pill${q.active ? ' on' : ''}`} aria-pressed={q.active} onClick={q.onToggle}>{q.label}</button>
          ))}
        </div>
      )}

      {chips.length > 0 && (
        <div className="fsh__chips" aria-label="Applied filters">
          {chips.map((c) => (
            <span key={c.id} className="fsh__chip">
              <button type="button" className="fsh__chip-main" onClick={() => { c.onEdit?.(); if (c.onEdit) setOpen(true); }} title={`${c.label}: ${c.summary}`}>
                <b>{c.label}</b><span>{c.summary}</span>
              </button>
              <button type="button" className="fsh__chip-x" onClick={c.onRemove} aria-label={`Remove ${c.label} filter`} title="Remove"><IconRemove /></button>
            </span>
          ))}
        </div>
      )}
      {chips.length > 1 && combine}
      {presets}

      <button type="button" className={`fsh__add${open ? ' is-open' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden>{open ? '–' : '+'}</span> {open ? 'Hide filter builder' : addLabel}
      </button>
      {open && <div className="fsh__adv">{advanced}</div>}
    </div>
  );
}
