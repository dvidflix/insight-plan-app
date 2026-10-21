import { create } from 'zustand';

/** What the Visible tags found the last time they looked (shown under "Most labels" in the tag editor, so a tag that draws nothing says why). */
export interface TagLabelStat {
  /** Objects whose label comes out with some text. */
  withLabel: number;
  /** Of those, how many are on screen in the view (up to the label limit). */
  shown: number;
  /** The models looked at. */
  models: number;
  error?: string;
}

export const useTagLabelStats = create<{ stats: Record<string, TagLabelStat>; set: (key: string, stat: TagLabelStat) => void; clear: () => void }>((set) => ({
  stats: {},
  set: (key, stat) => set((s) => ({ stats: { ...s.stats, [key]: stat } })),
  clear: () => set({ stats: {} }),
}));
