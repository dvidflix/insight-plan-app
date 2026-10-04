import { create } from 'zustand';

/** The 4D image / video recording in progress (Export tab) — kept outside
    the Configuration pane so it keeps going, and stays cancellable from the
    on-view indicator, while the pane is hidden for a full-width capture. */
interface RecordingState {
  phase: 'idle' | 'countdown' | 'recording';
  /** Seconds left in the countdown. */
  count: number;
  done: number;
  total: number;
  /** Result or error of the last recording. */
  message: string | null;
  cancelRequested: boolean;
  cancel: () => void;
}

export const useRecordingStore = create<RecordingState>((set) => ({
  phase: 'idle',
  count: 0,
  done: 0,
  total: 0,
  message: null,
  cancelRequested: false,
  cancel: () => set({ cancelRequested: true }),
}));
