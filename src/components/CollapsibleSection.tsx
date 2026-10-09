import type { ReactNode } from 'react';
import { IconSectionChevron } from './icons';
import { usePersistedState } from '../utils/persistedState';
import { InfoTip } from './InfoTip';

/** Which sections of a Configuration tab are open, remembered under `key`. */
export function useOpenSections<Id extends string>(key: string, defaultOpen: Id[]) {
  const [openIds, setOpenIds] = usePersistedState<Id[]>(key, defaultOpen);
  const toggle = (id: Id) => setOpenIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  return { isOpen: (id: Id) => openIds.includes(id), toggle };
}

/** A collapsible section of a side pane tab, styled like That Open's
    bim-panel-section: chevron then title (right when collapsed, down when
    open). `flush` drops the body padding for content that pads itself;
    `tip` puts an explanation (InfoTip) at the end of the header row, `actions` small buttons at the far right, after it. */
export function CollapsibleSection({ title, open, onToggle, flush, tip, actions, children }: { title: string; open: boolean; onToggle: () => void; flush?: boolean; tip?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="settings-section config-section">
      <div className="config-section__head">
        <button type="button" className="settings-section__header" aria-expanded={open} onClick={onToggle}>
          <IconSectionChevron className="section-chevron" />
          <span className="section-title">{title}</span>
        </button>
        {tip && <span className="config-section__tip"><InfoTip label={`About ${title}`}>{tip}</InfoTip></span>}
        {actions && <span className="config-section__actions">{actions}</span>}
      </div>
      {open && <div className={`settings-section__body${flush ? ' settings-section__body--flush' : ''}`}>{children}</div>}
    </div>
  );
}
