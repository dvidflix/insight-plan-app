import { SAVED_VIEW_ATTRS, useSavedViewAttrsStore } from '../state/savedViewAttrsStore';
import { useViewSettingsStore } from '../state/viewSettingsStore';
import { InfoTip } from './InfoTip';

/** Views > Viewpoint attributes: tick what new viewpoints store and
    restore (like Navisworks' default saved attributes). */
export function SavedViewAttrsPanel() {
  const attrs = useSavedViewAttrsStore((s) => s.attrs);
  const toggle = useSavedViewAttrsStore((s) => s.toggle);
  const page = useViewSettingsStore((s) => s.activePage);
  return (
    <div className="disp">
      <div className="cols__heading">
        <span>
          Saved attributes{' '}
          <InfoTip>What a new viewpoint stores and brings back when you open it; anything unticked stays as it is. Viewpoints saved earlier keep what they were saved with. Update re-takes one with what is ticked now.</InfoTip>
        </span>
      </div>
      <div className="saved-attrs">
        {SAVED_VIEW_ATTRS.filter((a) => a.id !== 'timeline' || page === 'sequence').map((a) => (
          <label key={a.id} className="saved-attrs__item" title={a.hint}>
            <input type="checkbox" checked={attrs[a.id]} onChange={() => toggle(a.id)} />
            <span>{a.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
