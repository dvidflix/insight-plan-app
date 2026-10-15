import { create } from 'zustand';
import type { LinkKind } from '../schedule/linkShortcuts';

/** The relation used when activities are linked (the toolbar's Link, the Planner, the status bar): chosen once, kept between sessions. */
const KEY = 'planning.linkKind';
const KINDS: LinkKind[] = ['FS', 'SS', 'FF', 'SF'];

const read = (): LinkKind => {
  try {
    const v = localStorage.getItem(KEY) as LinkKind | null;
    return v && KINDS.includes(v) ? v : 'FS';
  } catch {
    return 'FS';
  }
};

export const useLinkTypeStore = create<{ kind: LinkKind; setKind: (k: LinkKind) => void }>((set) => ({
  kind: read(),
  setKind: (kind) => {
    try { localStorage.setItem(KEY, kind); } catch { /* kept for this session only */ }
    set({ kind });
  },
}));
