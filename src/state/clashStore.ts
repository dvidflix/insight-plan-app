import { create } from 'zustand';
import type { ContactRow } from '../viewer/relations';

/** Clashes & contacts, kept up to date by useClashRunner (mounted with the
    3D view): every model against itself ("touching": pairs within a model)
    and every pair of models ("linked": pairs across models). Each job's
    rows are kept under its scope with the key they were found for, so only
    jobs whose models, placement or settings changed run again. */

export interface ClashJobResult {
  key: string;
  /** "self:<model>" or "pair:<model A>|<model B>". */
  scope: string;
  rows: ContactRow[];
  /** Loaded from the project database rather than worked out now. */
  stored: boolean;
}

/** Which pairs the results list shows: all, within a model, or across models. */
export type ClashView = 'all' | 'touching' | 'linked';

export interface ClashSettings {
  /** Max gap (m) still counted as contact. */
  tolerance: number;
  /** Test the real triangles, not just bounding boxes. */
  exact: boolean;
  /** Work out missing or outdated results as soon as the models change. */
  auto: boolean;
}

interface ClashState {
  settings: ClashSettings;
  results: Record<string, ClashJobResult>;
  /** Jobs still to run (scope → key), when not running automatically. */
  pending: number;
  running: { label: string; progress: number } | null;
  error: string | null;
  /** Bumped to ask the runner to run the pending jobs now. */
  runRequest: number;
  cancelRequest: number;
  view: ClashView;
  setView: (view: ClashView) => void;
  setSettings: (s: Partial<ClashSettings>) => void;
  requestRun: () => void;
  requestCancel: () => void;
}

const SETTINGS_KEY = 'viewer.clashSettings';
const DEFAULTS: ClashSettings = { tolerance: 0.01, exact: true, auto: true };

function loadSettings(): ClashSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export const useClashStore = create<ClashState>((set, get) => ({
  settings: loadSettings(),
  results: {},
  pending: 0,
  running: null,
  error: null,
  runRequest: 0,
  cancelRequest: 0,
  view: 'all',
  setView: (view) => set({ view }),
  setSettings: (s) => {
    const settings = { ...get().settings, ...s };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // not remembered
    }
    set({ settings });
  },
  requestRun: () => set((s) => ({ runRequest: s.runRequest + 1 })),
  requestCancel: () => set((s) => ({ cancelRequest: s.cancelRequest + 1 })),
}));

/** Touching (within a model) and linked (across models) pairs of the current results. */
export function clashRows(results: Record<string, ClashJobResult>): { touching: ContactRow[]; linked: ContactRow[] } {
  const touching: ContactRow[] = [];
  const linked: ContactRow[] = [];
  for (const r of Object.values(results)) (r.scope.startsWith('self:') ? touching : linked).push(...r.rows);
  return { touching, linked };
}
