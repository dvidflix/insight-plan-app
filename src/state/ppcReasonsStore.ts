import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Why an activity planned for a week was not finished in it (Programmes > PPC).
    Keyed by project, activity code and the week's Monday; stored under "viewer."
    so the app configuration file carries it. */
interface State {
  reasons: Record<string, string>;
  setReason: (key: string, reason: string) => void;
}

export const ppcReasonKey = (a: { projectId?: string; code: string }, weekStart: Date) => `${a.projectId ?? ''}|${a.code}|${weekStart.toISOString().slice(0, 10)}`;

export const usePpcReasonsStore = create<State>()(
  persist(
    (set) => ({
      reasons: {},
      setReason: (key, reason) =>
        set((s) => {
          const reasons = { ...s.reasons };
          if (reason) reasons[key] = reason;
          else delete reasons[key];
          return { reasons };
        }),
    }),
    { name: 'viewer.ppcReasons', version: 1 },
  ),
);
