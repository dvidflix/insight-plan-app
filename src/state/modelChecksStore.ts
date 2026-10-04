import { create } from 'zustand';
import type { SpecResult } from '../ids/runIds';

/** Models page > Model checks: the last run's results and any run in
    progress, kept outside the panel so a run carries on, and its results
    stay, while another tab is open. */
interface ModelChecksState {
  results: SpecResult[] | null;
  testedNames: string[];
  running: boolean;
  message: { kind: 'ok' | 'error'; text: string } | null;
}

export const useModelChecksStore = create<ModelChecksState>(() => ({
  results: null,
  testedNames: [],
  running: false,
  message: null,
}));
