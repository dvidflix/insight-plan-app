import { create } from 'zustand';
import type { Relationship } from '../schedule/types';

/** The links created last (Generated schedules, or the Activity pane), kept to list and undo them. */
export interface CreatedLinks {
  count: number;
  /** Each schedule's relationships as they were before, per schedule id. */
  undo: Map<string, Relationship[]>;
  /** The links, as activity codes. */
  links: { pred: string; succ: string }[];
}

interface GeneratedLinksState {
  last: CreatedLinks | null;
  setLast: (last: CreatedLinks | null) => void;
}

export const useGeneratedLinksStore = create<GeneratedLinksState>((set) => ({
  last: null,
  setLast: (last) => set({ last }),
}));
