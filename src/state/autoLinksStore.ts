import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Adding the generated links as soon as a programme is generated (Scenarios > Update 4D / Load into Inputs). */
interface AutoLinksState {
  /** Add the links automatically after each generation. */
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  /** The programme (schedule id) just loaded, still to get its links. Not remembered. */
  pending: string | null;
  request: (scheduleId: string) => void;
  clear: () => void;
  /** What happened last, or what it is waiting for. Not remembered. */
  status: string | null;
  setStatus: (status: string | null) => void;
}

export const useAutoLinksStore = create<AutoLinksState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
      pending: null,
      request: (pending) => set({ pending, status: null }),
      clear: () => set({ pending: null }),
      status: null,
      setStatus: (status) => set({ status }),
    }),
    { name: 'schedule.autoLinks', partialize: (s) => ({ enabled: s.enabled }) },
  ),
);
