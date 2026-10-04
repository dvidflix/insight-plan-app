import { create } from 'zustand';

/** A model or programme an imported app configuration referenced but whose
    actual file isn't loaded yet — `path` is only ever present if it was
    hand-authored into the config file (the app itself can never read a
    real filesystem path from a browser file picker or drop, so a normal
    export never fills it in), shown as a hint for where to browse to. */
export interface PendingFile {
  name: string;
  path?: string;
}

interface PendingImportsState {
  models: PendingFile[];
  schedules: PendingFile[];
  setPending: (models: PendingFile[], schedules: PendingFile[]) => void;
  clearModel: (name: string) => void;
  clearSchedule: (name: string) => void;
}

/** Backs the "waiting for these files" list shown on the Inputs tab after
    importing a configuration — separate from modelsStore's own
    pendingHiddenNames (which only remembers a hidden flag to re-apply);
    this remembers the reference itself so Inputs has something to show. */
export const usePendingImportsStore = create<PendingImportsState>((set) => ({
  models: [],
  schedules: [],
  setPending: (models, schedules) => set({ models, schedules }),
  clearModel: (name) => set((s) => ({ models: s.models.filter((m) => m.name !== name) })),
  clearSchedule: (name) => set((s) => ({ schedules: s.schedules.filter((m) => m.name !== name) })),
}));
