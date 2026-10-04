import { create } from 'zustand';
import { DEFAULT_LABEL_TEMPLATE } from '../schedule/labelTemplate';

export type LabelPosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

interface Persisted {
  enabled: boolean;
  position: LabelPosition;
  template: string;
}

interface SequenceLabelState extends Persisted {
  setEnabled: (v: boolean) => void;
  setPosition: (p: LabelPosition) => void;
  setTemplate: (t: string) => void;
}

// Kept under the "sequence." prefix that utils/persistedState.ts already
// treats as part of the exportable app configuration, without needing its
// own React-hook-per-instance wrapper — this store is read by both the
// settings editor and the viewer overlay at once, so it needs one shared,
// live-updating source of truth rather than usePersistedState's per-mount copy.
const STORAGE_KEY = 'sequence.label';

const DEFAULTS: Persisted = { enabled: true, position: 'top-left', template: DEFAULT_LABEL_TEMPLATE };

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      enabled: parsed.enabled ?? DEFAULTS.enabled,
      position: parsed.position ?? DEFAULTS.position,
      template: parsed.template ?? DEFAULTS.template,
    };
  } catch {
    return DEFAULTS;
  }
}

function persist(state: Persisted) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage full/unavailable — the setting just won't survive a reload.
  }
}

export const useSequenceLabelStore = create<SequenceLabelState>((set, get) => ({
  ...load(),
  setEnabled: (enabled) => {
    set({ enabled });
    persist({ enabled, position: get().position, template: get().template });
  },
  setPosition: (position) => {
    set({ position });
    persist({ enabled: get().enabled, position, template: get().template });
  },
  setTemplate: (template) => {
    set({ template });
    persist({ enabled: get().enabled, position: get().position, template });
  },
}));
