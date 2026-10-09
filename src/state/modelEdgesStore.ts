import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Models drawn without edge lines (Models page › Models list), by model name so it follows a model across reloads.
    Stored under "viewer." so the app configuration file carries it. */
interface State {
  off: Record<string, true>;
  toggle: (name: string) => void;
}

export const useModelEdgesStore = create<State>()(
  persist(
    (set) => ({
      off: {},
      toggle: (name) =>
        set((s) => {
          const off = { ...s.off };
          if (off[name]) delete off[name];
          else off[name] = true;
          return { off };
        }),
    }),
    { name: 'viewer.modelEdgesOff', version: 1 },
  ),
);
