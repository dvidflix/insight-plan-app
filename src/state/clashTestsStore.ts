import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Clash tests, as in the clash tools of other BIM applications: a test pits one selection of objects (A) against
    another (B) with a rule, and lists the pairs found as results the team works through (new → active → reviewed →
    approved / resolved). Tests and results are kept in the browser; a re-run keeps each result's status, and marks the
    ones no longer found as resolved. */

/** hard: the geometry passes through each other. clearance: closer than a distance (not touching through). duplicate: the same
    object twice (same shape, same place). */
export type ClashKind = 'hard' | 'clearance' | 'duplicate';
export const CLASH_KINDS: { id: ClashKind; label: string; hint: string }[] = [
  { id: 'hard', label: 'Hard clash', hint: 'The two objects pass through each other.' },
  { id: 'clearance', label: 'Clearance', hint: 'The two objects are closer than the clearance distance, without passing through each other.' },
  { id: 'duplicate', label: 'Duplicates', hint: 'Two objects with the same shape in the same place (a model placed twice).' },
];

export type ClashStatus = 'new' | 'active' | 'reviewed' | 'approved' | 'resolved';
export const CLASH_STATUSES: { id: ClashStatus; label: string; color: string }[] = [
  { id: 'new', label: 'New', color: '#d03b3b' },
  { id: 'active', label: 'Active', color: '#e09f1f' },
  { id: 'reviewed', label: 'Reviewed', color: '#1c5fb0' },
  { id: 'approved', label: 'Approved', color: '#6f6bd6' },
  { id: 'resolved', label: 'Resolved', color: '#1f9d6b' },
];

/** What a side of the test takes its objects from. */
export type ClashSide = { kind: 'all' } | { kind: 'model'; model: string } | { kind: 'set'; setId: string };

export interface ClashItemRef {
  /** The model's file name. */
  model: string;
  guid: string;
  name: string;
  category: string;
}

export interface ClashResult {
  /** The pair's two GlobalIds, sorted: stable between runs. */
  key: string;
  /** Running number within the test. */
  n: number;
  status: ClashStatus;
  a: ClashItemRef;
  b: ClashItemRef;
  /** Closest distance (m); 0 when they pass through each other. */
  distance: number;
  /** Not found by the last run. */
  gone?: boolean;
  comment?: string;
  /** The topic made from it (Topics). */
  topicId?: string;
}

export interface ClashTest {
  id: string;
  name: string;
  kind: ClashKind;
  /** Metres (clearance tests). */
  clearance: number;
  a: ClashSide;
  b: ClashSide;
  /** Test the real triangles, not just the boxes. */
  exact: boolean;
  /** Only what is shown in the 3D view now (so the 4D timeline's date decides). */
  onlyVisible: boolean;
  /** Leave out pairs of the same IFC class (a wall against a wall). */
  skipSameClass: boolean;
  results: ClashResult[];
  /** ISO time of the last run. */
  lastRun: string | null;
}

export const newClashTest = (n: number): ClashTest => ({
  id: crypto.randomUUID(),
  name: `Test ${n}`,
  kind: 'hard',
  clearance: 0.05,
  a: { kind: 'all' },
  b: { kind: 'all' },
  exact: true,
  onlyVisible: false,
  skipSameClass: false,
  results: [],
  lastRun: null,
});

interface ClashTestsState {
  tests: ClashTest[];
  selectedId: string | null;
  add: () => string;
  update: (id: string, patch: Partial<ClashTest>) => void;
  remove: (id: string) => void;
  select: (id: string | null) => void;
  /** A run's findings: kept statuses, new numbers, and what was not found any more marked resolved. */
  setResults: (id: string, found: Omit<ClashResult, 'n' | 'status'>[]) => { added: number; gone: number; total: number };
  setStatus: (id: string, keys: string[], status: ClashStatus) => void;
  patchResult: (id: string, key: string, patch: Partial<ClashResult>) => void;
}

const safeStorage = createJSONStorage<Pick<ClashTestsState, 'tests' | 'selectedId'>>(() => ({
  getItem: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  // Many results can outgrow the browser's quota: then they are just not remembered.
  setItem: (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } },
  removeItem: (k) => { try { localStorage.removeItem(k); } catch { /* nothing */ } },
}));

export const useClashTestsStore = create<ClashTestsState>()(
  persist(
    (set, get) => ({
      tests: [],
      selectedId: null,
      add: () => {
        const t = newClashTest(get().tests.length + 1);
        set((s) => ({ tests: [...s.tests, t], selectedId: t.id }));
        return t.id;
      },
      update: (id, patch) => set((s) => ({ tests: s.tests.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
      remove: (id) => set((s) => {
        const tests = s.tests.filter((t) => t.id !== id);
        return { tests, selectedId: s.selectedId === id ? tests[0]?.id ?? null : s.selectedId };
      }),
      select: (selectedId) => set({ selectedId }),
      setResults: (id, found) => {
        const test = get().tests.find((t) => t.id === id);
        if (!test) return { added: 0, gone: 0, total: 0 };
        const before = new Map(test.results.map((r) => [r.key, r]));
        let next = Math.max(0, ...test.results.map((r) => r.n)) + 1;
        let added = 0;
        const seen = new Set<string>();
        const results: ClashResult[] = found.map((f) => {
          seen.add(f.key);
          const old = before.get(f.key);
          if (old) return { ...old, ...f, n: old.n, status: old.gone && old.status === 'resolved' ? 'active' : old.status, gone: false };
          added++;
          return { ...f, n: next++, status: 'new' };
        });
        let gone = 0;
        for (const old of test.results) {
          if (seen.has(old.key)) continue;
          if (!old.gone) gone++;
          results.push({ ...old, gone: true, status: old.gone ? old.status : 'resolved' });
        }
        results.sort((x, y) => x.n - y.n);
        set((s) => ({ tests: s.tests.map((t) => (t.id === id ? { ...t, results, lastRun: new Date().toISOString() } : t)) }));
        return { added, gone, total: found.length };
      },
      setStatus: (id, keys, status) => {
        const wanted = new Set(keys);
        set((s) => ({ tests: s.tests.map((t) => (t.id === id ? { ...t, results: t.results.map((r) => (wanted.has(r.key) ? { ...r, status } : r)) } : t)) }));
      },
      patchResult: (id, key, patch) =>
        set((s) => ({ tests: s.tests.map((t) => (t.id === id ? { ...t, results: t.results.map((r) => (r.key === key ? { ...r, ...patch } : r)) } : t)) })),
    }),
    { name: 'viewer.clashTests', version: 1, storage: safeStorage, partialize: (s) => ({ tests: s.tests, selectedId: s.selectedId }) },
  ),
);

/** The key of a pair, the same whichever way round it was found. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
