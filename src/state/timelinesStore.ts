import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { GroupRule } from '../components/schedule/GroupPanel';

/** Timelines: a row per building (or anything else), each with dated spans for
    the stages of its planning, the planner allocated to it, and events that
    apply to every row (cut-off for integrating the programmes, a review…).
    Kept under the "timelines." key, so it is mirrored into the project
    database with the other settings (db/uiSettingsSync.ts). Dates are
    "YYYY-MM-DD" (local days); a span's end day is included. */

export interface Person {
  id: string;
  name: string;
  /** The name they are known by ("Dave"), shown for the planner of a row. */
  knownAs?: string;
  role: string;
  color: string;
}

/** What the planner column shows: the known name, else the name. */
export const shortName = (p: Pick<Person, 'name' | 'knownAs'>) => p.knownAs?.trim() || p.name;

export interface StageDef {
  id: string;
  name: string;
  color: string;
}

/** A field of the rows besides the built-in ones (Unit, Phase…): a column in the table, a line in the row editor, and something to group by. */
export interface FieldDef {
  id: string;
  name: string;
}

export interface Span {
  start: string;
  end: string;
  /** Percent done (0-100). Left out, it follows today's date: the share of the span that has passed. */
  done?: number;
}

/** How much of a span is done, as a percent: what was entered, else the share of it that today has passed. */
export function progressOf(span: Span, today: string): number {
  if (span.done !== undefined) return Math.max(0, Math.min(100, span.done));
  if (today < span.start) return 0;
  if (today > span.end) return 100;
  const total = daysBetween(span.start, span.end) + 1;
  return Math.round(((daysBetween(span.start, today) + 1) / total) * 100);
}

export interface TimelineRow {
  id: string;
  name: string;
  plannerId: string | null;
  note: string;
  /** Field id -> the row's value. */
  values: Record<string, string>;
  /** Stage id -> its dates; a stage with no entry isn't drawn for this row. */
  spans: Record<string, Span>;
}

export interface TimelineEvent {
  id: string;
  name: string;
  date: string;
  color: string;
}

/** A summary bar at the top of the timeline: the span from the earliest start to the latest finish of a stage (or all of them) over every row, with how much of it is done. */
export interface SummaryBar {
  id: string;
  name: string;
  /** Optional text beside the bar. */
  description: string;
  color: string;
  /** The stage it summarises; null = every stage. */
  stageId: string | null;
  labelPos: 'above' | 'end' | 'none';
  /** Optional fixed dates, instead of the ones taken from the rows. */
  start?: string;
  end?: string;
}

/** A holiday or bank holiday (one day or a run of days): hatched in yellow over every row. */
export interface Holiday {
  id: string;
  name: string;
  start: string;
  /** The last day, included. */
  end: string;
}

export interface Timeline {
  id: string;
  name: string;
  stages: StageDef[];
  /** The user fields every row has. */
  fields: FieldDef[];
  /** Group rows by these (first outermost): 'planner', 'name' or a field id. */
  groups: GroupRule[];
  /** Show the groups as merged cells beside the rows (like a pivot table), not as header rows. */
  mergeGroups?: boolean;
  rows: TimelineRow[];
  /** Days off, hatched across all the rows. */
  holidays?: Holiday[];
  /** Summary bars drawn above the rows. */
  summaries?: SummaryBar[];
  /** Apply to all the rows: drawn as a line across the whole timeline. */
  events: TimelineEvent[];
}

export const PALETTE = ['#3c7bd9', '#e69f00', '#2e8d5a', '#cc4e4e', '#7c5cff', '#0e9aa7', '#c9a227', '#8f3a00', '#56b4e9', '#6b7280'];

export const newId = () => crypto.randomUUID();

export function newTimeline(name: string): Timeline {
  return {
    id: newId(),
    name,
    stages: [
      { id: newId(), name: 'Programme development', color: PALETTE[0] },
      { id: newId(), name: 'Programme review', color: PALETTE[1] },
    ],
    fields: [{ id: newId(), name: 'Unit' }],
    groups: [],
    rows: [],
    events: [],
  };
}

/** Timelines saved before fields and groups existed get empty ones. */
const normalise = (t: Timeline): Timeline => ({
  ...t,
  fields: t.fields ?? [],
  groups: t.groups ?? [],
  summaries: t.summaries ?? [],
  holidays: t.holidays ?? [],
  rows: (t.rows ?? []).map((r) => ({ ...r, note: r.note ?? '', values: r.values ?? {} })),
});

interface TimelinesState {
  timelines: Timeline[];
  people: Person[];
  activeId: string | null;
  setActive: (id: string | null) => void;
  addTimeline: (t: Timeline) => void;
  removeTimeline: (id: string) => void;
  /** Edits one timeline in place (the function returns its new value). */
  patchTimeline: (id: string, fn: (t: Timeline) => Timeline) => void;
  setPeople: (people: Person[]) => void;
}

export const useTimelinesStore = create<TimelinesState>()(
  persist(
    (set) => ({
      timelines: [],
      people: [],
      activeId: null,
      setActive: (activeId) => set({ activeId }),
      addTimeline: (t) => set((s) => ({ timelines: [...s.timelines, t], activeId: t.id })),
      removeTimeline: (id) =>
        set((s) => {
          const timelines = s.timelines.filter((t) => t.id !== id);
          return { timelines, activeId: s.activeId === id ? timelines[0]?.id ?? null : s.activeId };
        }),
      patchTimeline: (id, fn) => set((s) => ({ timelines: s.timelines.map((t) => (t.id === id ? fn(t) : t)) })),
      setPeople: (people) => set({ people }),
    }),
    {
      name: 'timelines.data',
      merge: (persisted, current) => {
        const p = persisted as Partial<TimelinesState> | undefined;
        return { ...current, ...p, timelines: (p?.timelines ?? current.timelines).map(normalise) };
      },
    },
  ),
);

// ---- dates ----

export const DAY_MS = 86400000;
export const dayMs = (s: string): number => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).getTime();
};
export const dayStr = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const todayStr = () => dayStr(Date.now());
export const addDays = (s: string, n: number) => {
  const [y, m, d] = s.split('-').map(Number);
  return dayStr(new Date(y, (m || 1) - 1, (d || 1) + n).getTime());
};
export const daysBetween = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / DAY_MS);
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
