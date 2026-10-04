import { SAVED_VIEW_ATTRS, useSavedViewAttrsStore } from '../state/savedViewAttrsStore';
import { InfoTip } from './InfoTip';

/** Views > Saved view attributes: tick what new saved views store and
    restore (like Navisworks' default saved attributes). */
export function SavedViewAttrsPanel() {
  const attrs = useSavedViewAttrsStore((s) => s.attrs);
  const toggle = useSavedViewAttrsStore((s) => s.toggle);
  return (
    <div className="disp">
      <div className="cols__heading">
        <span>
          Saved attributes{' '}
          <InfoTip>What a new saved view stores and brings back when you open it; anything unticked stays as it is. Views saved earlier keep what they were saved with.</InfoTip>
        </span>
      </div>
      <div className="saved-attrs">
        {SAVED_VIEW_ATTRS.map((a) => (
          <label key={a.id} className="saved-attrs__item" title={a.hint}>
            <input type="checkbox" checked={attrs[a.id]} onChange={() => toggle(a.id)} />
            <span>{a.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
