import { create } from 'zustand';

/** Whose settings the lower part of the side pane (and the data table's tab) shows: one at a time, so opening one
    switches the others off. null = as it comes (the Tasks and Scenarios settings follow their panels); 'none' = all off. */
export type SettingsTarget = 'tasks' | 'gantt' | 'datatable' | 'scenarios' | 'none';

interface SettingsPaneState {
  target: SettingsTarget | null;
  setTarget: (t: SettingsTarget | null) => void;
  /** The tune button of a panel: opens its settings (and closes the others'), or closes them when they are showing. */
  toggle: (id: SettingsTarget) => void;
}

export const useSettingsPaneStore = create<SettingsPaneState>((set, get) => ({
  target: null,
  setTarget: (target) => set({ target }),
  toggle: (id) => set({ target: isSettingsOpen(get().target, id) ? 'none' : id }),
}));

/** Whether `id`'s settings are showing for `target`: its own, or (Tasks / Scenarios) the automatic one. */
export function isSettingsOpen(target: SettingsTarget | null, id: SettingsTarget): boolean {
  return target === id || (target === null && (id === 'tasks' || id === 'scenarios'));
}
