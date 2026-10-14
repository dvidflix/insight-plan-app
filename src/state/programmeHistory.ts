import { useEffect } from 'react';
import { create } from 'zustand';
import type { Activity, Relationship } from '../schedule/types';
import { useActivityOverridesStore } from './activityOverridesStore';
import { useScheduleStore } from './scheduleStore';

/** One undo / redo history for every edit of a programme: field edits, bulk edits, renumbering, links added, edited or taken out.
    An edit is made inside `commit`, which keeps the state of what edits can touch before and after (the stores update immutably,
    so a snapshot is a handful of references, not a copy of the programme). Undo and redo put a snapshot back. Loading or removing a
    programme is not an edit and is not undone. */

interface Snap {
  byProgramme: ReturnType<typeof useActivityOverridesStore.getState>['byProgramme'];
  links: ReturnType<typeof useActivityOverridesStore.getState>['links'];
  /** Loaded schedule id -> its activities and relationships. */
  programmes: Map<string, { activities: Activity[]; relationships: Relationship[] }>;
}

interface Entry {
  label: string;
  before: Snap;
  after: Snap;
  /** Edits made one after another under the same key within MERGE_MS are one step (typing, nudging a value). */
  merge?: string;
  at: number;
}

const LIMIT = 100;
const MERGE_MS = 1500;

const snapshot = (): Snap => {
  const o = useActivityOverridesStore.getState();
  return { byProgramme: o.byProgramme, links: o.links, programmes: new Map(useScheduleStore.getState().schedules.map((m) => [m.id, { activities: m.activities, relationships: m.relationships }])) };
};

const same = (a: Snap, b: Snap) =>
  a.byProgramme === b.byProgramme && a.links === b.links && a.programmes.size === b.programmes.size
  && [...a.programmes].every(([id, p]) => b.programmes.get(id)?.activities === p.activities && b.programmes.get(id)?.relationships === p.relationships);

const restore = (s: Snap) => {
  useActivityOverridesStore.setState({ byProgramme: s.byProgramme, links: s.links });
  useScheduleStore.setState((st) => ({
    schedules: st.schedules.map((m) => {
      const p = s.programmes.get(m.id);
      return p && (p.activities !== m.activities || p.relationships !== m.relationships) ? { ...m, activities: p.activities, relationships: p.relationships } : m;
    }),
  }));
};

interface HistoryState {
  undos: Entry[];
  redos: Entry[];
}

export const useProgrammeHistory = create<HistoryState>(() => ({ undos: [], redos: [] }));

/** Makes an edit that can be undone: runs `edit` and, if it changed anything, records it as one step called `label`. */
export function commit<T>(label: string, edit: () => T, opts: { merge?: string } = {}): T {
  const before = snapshot();
  const result = edit();
  const after = snapshot();
  if (same(before, after)) return result;
  const now = Date.now();
  useProgrammeHistory.setState((h) => {
    const top = h.undos[h.undos.length - 1];
    if (opts.merge && top?.merge === opts.merge && now - top.at < MERGE_MS) return { undos: [...h.undos.slice(0, -1), { ...top, after, at: now }], redos: [] };
    return { undos: [...h.undos, { label, before, after, merge: opts.merge, at: now }].slice(-LIMIT), redos: [] };
  });
  return result;
}

/** Undoes the last edit; returns its label (null when there was none). */
export function undo(): string | null {
  const { undos, redos } = useProgrammeHistory.getState();
  const entry = undos[undos.length - 1];
  if (!entry) return null;
  restore(entry.before);
  useProgrammeHistory.setState({ undos: undos.slice(0, -1), redos: [...redos, entry] });
  return entry.label;
}

export function redo(): string | null {
  const { undos, redos } = useProgrammeHistory.getState();
  const entry = redos[redos.length - 1];
  if (!entry) return null;
  restore(entry.after);
  useProgrammeHistory.setState({ undos: [...undos, entry], redos: redos.slice(0, -1) });
  return entry.label;
}

export const clearHistory = () => useProgrammeHistory.setState({ undos: [], redos: [] });

/** Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y on the Programmes page, except while typing in a field (which has its own undo). */
export function useProgrammeHistoryKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) undo();
      else if (k === 'y' || (k === 'z' && e.shiftKey)) redo();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
