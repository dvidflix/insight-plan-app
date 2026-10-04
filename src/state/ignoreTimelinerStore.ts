import { create } from 'zustand';

// Same keys / format the 4D tab's switches used when this was page-local state.
const TIMELINER_KEY = 'sequence.ignoreTimeliner';
const APPEARANCE_KEY = 'sequence.ignoreAppearance';

function load(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

function save(key: string, v: boolean) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // Storage unavailable — the setting just won't survive a reload.
  }
}

interface IgnoreState {
  /** Every linked object stays visible whatever the date. */
  ignore: boolean;
  /** Appearance profile colours are not applied. */
  ignoreAppearance: boolean;
  setIgnore: (v: boolean) => void;
  setIgnoreAppearance: (v: boolean) => void;
}

/** "Ignore timeliner" / "Ignore appearance profiles": shared by the 4D tab's
    switches and the viewer toolbar's toggle. */
export const useIgnoreTimelinerStore = create<IgnoreState>((set) => ({
  ignore: load(TIMELINER_KEY),
  ignoreAppearance: load(APPEARANCE_KEY),
  setIgnore: (ignore) => {
    set({ ignore });
    save(TIMELINER_KEY, ignore);
  },
  setIgnoreAppearance: (ignoreAppearance) => {
    set({ ignoreAppearance });
    save(APPEARANCE_KEY, ignoreAppearance);
  },
}));
