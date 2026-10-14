import { useActiveSchedule } from '../../state/scheduleStore';
import { flushEditable, useEditableSaveStore } from '../../state/projectDbStore';

/** For a programme edited in place: that it is, and whether its edits are in the project database yet. */
export function EditableStatus() {
  const schedule = useActiveSchedule();
  const { pending, error, savedAt } = useEditableSaveStore();
  if (!schedule?.editable) return null;
  const text = error ? 'Not saved' : pending ? 'Saving…' : savedAt ? 'Saved' : 'Editable';
  return (
    <button
      type="button"
      className={`source-chip editable-status${error ? ' is-error' : ''}`}
      onClick={() => void flushEditable()}
      title={error ?? (pending ? 'Your edits are being written to the project database.' : 'Edited in place: every change is saved to the project database. Click to save now.')}
    >
      {text}
    </button>
  );
}
