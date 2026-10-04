import { create } from 'zustand';

/** App-wide display preferences that several components react to at once
    (Settings changes them, the app shell reads them). Stored under
    "viewer." keys, so the app configuration file carries them. */
const SCENARIOS_TAB_KEY = 'viewer.showScenariosTab';

interface AppPrefs {
  /** The top bar's Scenarios page tab — off by default: Scenarios also
      lives in 4D Sequencing (its Scenarios panel). */
  showScenariosTab: boolean;
  setShowScenariosTab: (v: boolean) => void;
}

export const useAppPrefsStore = create<AppPrefs>((set) => ({
  showScenariosTab: (() => {
    try {
      return localStorage.getItem(SCENARIOS_TAB_KEY) === 'true';
    } catch {
      return false;
    }
  })(),
  setShowScenariosTab: (v) => {
    try {
      localStorage.setItem(SCENARIOS_TAB_KEY, String(v));
    } catch {
      // not remembered
    }
    set({ showScenariosTab: v });
  },
}));
