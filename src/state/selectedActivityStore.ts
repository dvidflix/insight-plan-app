import { create } from 'zustand';
import type { ScheduleModel } from '../schedule/types';

/** The activity selected on the Programmes page (and the programme it belongs to, as shown there),
    so the 3D view can select its predecessors and successors. */
interface SelectedActivityState {
  model: ScheduleModel | null;
  activityId: string | null;
  set: (model: ScheduleModel | null, activityId: string | null) => void;
}

export const useSelectedActivityStore = create<SelectedActivityState>((set) => ({
  model: null,
  activityId: null,
  set: (model, activityId) => set({ model, activityId }),
}));
