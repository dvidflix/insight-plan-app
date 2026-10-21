import { create } from 'zustand';

/** What one model's load is doing: its stage, how far it is when that is known, and a log of what happened and when
    (shown under the Files list, and written to the browser console as "[model load] …"). */
export interface LoadJob {
  name: string;
  kind: string;
  bytes: number;
  startedAt: number;
  /** Set when it ends (finished or failed). */
  endedAt?: number;
  /** What it is doing now. */
  stage: string;
  /** 0–1 when the stage reports it, else null (the bar then moves on its own). */
  fraction: number | null;
  error?: string;
  log: { at: number; text: string }[];
}

interface LoadState {
  jobs: Record<string, LoadJob>;
  begin: (name: string, kind: string, bytes: number) => void;
  step: (name: string, stage: string, fraction?: number | null) => void;
  note: (name: string, text: string) => void;
  progress: (name: string, fraction: number | null) => void;
  finish: (name: string) => void;
  fail: (name: string, error: unknown) => void;
  dismiss: (name: string) => void;
}

const MAX_LOG = 400;
const stamp = (job: LoadJob | undefined, text: string) => ({ ...job!, log: [...job!.log.slice(-(MAX_LOG - 1)), { at: Date.now(), text }] });

export const useModelLoadStore = create<LoadState>((set, get) => {
  const edit = (name: string, change: (job: LoadJob) => LoadJob) => set((s) => (s.jobs[name] ? { jobs: { ...s.jobs, [name]: change(s.jobs[name]) } } : s));
  const say = (name: string, text: string) => console.info(`[model load] ${name}: ${text}`);
  return {
    jobs: {},
    begin: (name, kind, bytes) => {
      // A load that is already on (its first steps were logged before the viewer took over) goes on in the same job.
      const open = get().jobs[name];
      if (open && !open.endedAt) {
        say(name, `${kind}, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
        edit(name, (j) => ({ ...stamp(j, `${kind}, ${(bytes / 1024 / 1024).toFixed(1)} MB`), kind, bytes }));
        return;
      }
      say(name, `started (${kind}, ${(bytes / 1024 / 1024).toFixed(1)} MB)`);
      set((s) => ({ jobs: { ...s.jobs, [name]: { name, kind, bytes, startedAt: Date.now(), stage: 'Starting', fraction: null, log: [{ at: Date.now(), text: `Started: ${kind}, ${(bytes / 1024 / 1024).toFixed(1)} MB` }] } } }));
    },
    step: (name, stage, fraction = null) => {
      say(name, stage);
      edit(name, (j) => ({ ...stamp(j, stage), stage, fraction }));
    },
    note: (name, text) => {
      say(name, text);
      edit(name, (j) => stamp(j, text));
    },
    progress: (name, fraction) => edit(name, (j) => (j.fraction === fraction ? j : { ...j, fraction })),
    finish: (name) => {
      const job = get().jobs[name];
      if (!job) return;
      const secs = ((Date.now() - job.startedAt) / 1000).toFixed(1);
      say(name, `finished in ${secs} s`);
      edit(name, (j) => ({ ...stamp(j, `Finished in ${secs} s`), stage: 'Loaded', fraction: 1, endedAt: Date.now() }));
    },
    fail: (name, error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[model load] ${name}: FAILED`, error);
      edit(name, (j) => ({ ...stamp(j, `Failed: ${message}`), stage: 'Failed', error: message, endedAt: Date.now() }));
    },
    dismiss: (name) => set((s) => { const jobs = { ...s.jobs }; delete jobs[name]; return { jobs }; }),
  };
});

/** The calls a loader makes for one model (so it needs no name each time). */
export interface LoadLog {
  step: (stage: string, fraction?: number | null) => void;
  note: (text: string) => void;
  progress: (fraction: number | null) => void;
}
export const loadLogFor = (name: string): LoadLog => {
  const s = () => useModelLoadStore.getState();
  return { step: (stage, fraction) => s().step(name, stage, fraction), note: (text) => s().note(name, text), progress: (f) => s().progress(name, f) };
};
