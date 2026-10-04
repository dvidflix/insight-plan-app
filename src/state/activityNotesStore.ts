import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Activity } from '../schedule/types';

/** Notes kept against activities (Programmes > the Activity pane, and a Notes
    column). Keyed by project and activity code, so they follow the activity
    across reloads of the programme. Stored under "viewer." so the app
    configuration file carries them (and layouts, which only snapshot the
    table / Gantt keys, leave them alone). */
export interface ActivityNote {
  text: string;
  /** ISO time of the last edit. */
  updated: string;
}

export const noteKey = (a: Pick<Activity, 'projectId' | 'code'>) => `${a.projectId ?? ''}|${a.code}`;

interface State {
  notes: Record<string, ActivityNote>;
  setNote: (key: string, text: string) => void;
}

export const useActivityNotesStore = create<State>()(
  persist(
    (set) => ({
      notes: {},
      setNote: (key, text) =>
        set((s) => {
          const notes = { ...s.notes };
          if (text.trim()) notes[key] = { text, updated: new Date().toISOString() };
          else delete notes[key];
          return { notes };
        }),
    }),
    { name: 'viewer.activityNotes', version: 1 },
  ),
);

/** A note's text for a column / export (one line). */
export const noteText = (a: Activity) => (useActivityNotesStore.getState().notes[noteKey(a)]?.text ?? '').replace(/\s+/g, ' ');
