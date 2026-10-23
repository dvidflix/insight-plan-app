import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useSequenceTimelineStore } from './sequenceTimelineStore';

/** Home's "Getting started" steps: whether they are put away, and whether the 4D timeline has ever been played (the last step; the
    other steps read the app's own state). Kept in this browser, not in a scene: they are about learning the app, not about a project. */
interface GettingStartedState {
  dismissed: boolean;
  played: boolean;
  setDismissed: (dismissed: boolean) => void;
}

export const useGettingStarted = create<GettingStartedState>()(
  persist(
    (set) => ({
      dismissed: false,
      played: false,
      setDismissed: (dismissed) => set({ dismissed }),
    }),
    { name: 'home.gettingStarted' },
  ),
);

useSequenceTimelineStore.subscribe((s) => {
  if (s.playing && !useGettingStarted.getState().played) useGettingStarted.setState({ played: true });
});
