import type { ReactNode } from 'react';
import { usePersistedState } from '../utils/persistedState';
import { IconSectionChevron } from './icons';

/** A collapsible section kept at the bottom of a side-pane tab, like Clash
    results: the rest of the tab (`children`) scrolls above it. Starts
    collapsed and remembers being opened under `storageKey`. */
export function BottomDock({ title, storageKey, dock, flush, children }: { title: string; storageKey: string; dock: ReactNode; /** No padding round the content (a list that runs edge to edge). */ flush?: boolean; children: ReactNode }) {
  const [open, setOpen] = usePersistedState(`models.dock.${storageKey}`, false);
  return (
    <div className="model-config__split">
      <div className="model-config__split-top">{children}</div>
      <div className={`clash-list bottom-dock config-section${open ? ' is-open' : ''}`}>
        {/* The same header as the pane's other sections (CollapsibleSection), so the heights match. */}
        <div className="config-section__head">
          <button type="button" className="settings-section__header" aria-expanded={open} onClick={() => setOpen(!open)}>
            <IconSectionChevron className="section-chevron" />
            <span className="section-title">{title}</span>
          </button>
        </div>
        {open && <div className={`clash-list__body${flush ? ' bottom-dock__body--flush' : ''}`}>{dock}</div>}
      </div>
    </div>
  );
}
