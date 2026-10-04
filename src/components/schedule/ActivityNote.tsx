import { useEffect, useState } from 'react';
import type { Activity } from '../../schedule/types';
import { noteKey, useActivityNotesStore } from '../../state/activityNotesStore';

/** The Activity pane's note: free text kept against the activity (saved as you leave the box). */
export function ActivityNote({ activity }: { activity: Activity }) {
  const key = noteKey(activity);
  const saved = useActivityNotesStore((s) => s.notes[key]);
  const setNote = useActivityNotesStore((s) => s.setNote);
  const [draft, setDraft] = useState(saved?.text ?? '');
  useEffect(() => setDraft(saved?.text ?? ''), [key, saved?.text]);
  return (
    <div className="activity-note">
      <textarea
        value={draft}
        placeholder="Observations on this activity…"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== (saved?.text ?? '') && setNote(key, draft)}
      />
      {saved && <div className="activity-note__meta">Saved {new Date(saved.updated).toLocaleString()}</div>}
    </div>
  );
}
