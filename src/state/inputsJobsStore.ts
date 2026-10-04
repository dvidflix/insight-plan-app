import { create } from 'zustand';
import type { XerIndex } from '../schedule/importSchedule';

/** Inputs page: imports in progress, their errors, and multi-project .xer
    files waiting for a choice — kept outside the page, so an import started
    there still shows its progress after another tab was open. */
interface InputsJobsState {
  modelError: string | null;
  scheduleError: string | null;
  /** Per file being imported: current phase and how far through it is. */
  scheduleBusy: Record<string, { label: string; fraction: number }>;
  xerPicks: { file: File; index: XerIndex }[];
}

export const useInputsJobsStore = create<InputsJobsState>(() => ({
  modelError: null,
  scheduleError: null,
  scheduleBusy: {},
  xerPicks: [],
}));

type Update<T> = T | ((prev: T) => T);

/** A setState-like setter for one field (value or updater). */
export function inputsSetter<K extends keyof InputsJobsState>(key: K) {
  return (next: Update<InputsJobsState[K]>) =>
    useInputsJobsStore.setState((s) => ({ [key]: typeof next === 'function' ? (next as (p: InputsJobsState[K]) => InputsJobsState[K])(s[key]) : next }) as Partial<InputsJobsState>);
}
