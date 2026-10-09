import { useMemo } from 'react';
import { create } from 'zustand';
import type { ScheduleModel } from '../schedule/types';
import { mergeSchedules } from '../schedule/mergeSchedules';
import { programmeKey, useUnloadedWbsStore, withoutUnloaded } from './unloadedWbsStore';
import { markChoiceMade, nextChoice, useProgrammeChoiceStore } from './programmeChoiceStore';
import { useRetiredTasksStore, withoutRetired } from './retiredTasksStore';
import { useActivityOverridesStore, withOverrides } from './activityOverridesStore';

interface ScheduleState {
  schedules: ScheduleModel[];
  selectedId: string | null;
  /** Activities left after the schedule page's own search/field filters —
      set by SchedulePage so the status bar can show it without SchedulePage
      and StatusBar needing to share a common parent that threads it through. */
  visibleActivityCount: number | null;
  /** Programmes toggled off from the Inputs list — stay loaded (data kept
      in memory, so toggling back on is instant) but excluded from every
      view, the "unload without removing" ask. */
  hiddenScheduleIds: Set<string>;
  addSchedule: (model: ScheduleModel) => void;
  removeSchedule: (id: string) => void;
  select: (id: string) => void;
  setVisibleActivityCount: (count: number | null) => void;
  toggleScheduleHidden: (id: string) => void;
  /** Replaces every loaded schedule (and, optionally, which of them are
      hidden) — used when loading a whole app configuration file. */
  replaceAll: (schedules: ScheduleModel[], hiddenIds?: string[]) => void;
  /** Writes a text value into a user field (UDF) of activities: per schedule id, activity id -> value. */
  setActivityField: (field: string, values: Map<string, Map<string, string>>) => void;
  /** Applies changes to activities: per schedule id, activity id -> the fields to change. */
  patchActivities: (patches: Map<string, Map<string, Partial<import('../schedule/types').Activity>>>) => void;
  /** Replaces one schedule's relationships (adding generated links, or undoing that). */
  setRelationships: (scheduleId: string, relationships: import('../schedule/types').Relationship[]) => void;
  /** Puts activities back as they were (undoing a bulk edit): per schedule id. */
  restoreActivities: (activities: Map<string, import('../schedule/types').Activity[]>) => void;
}

export const useScheduleStore = create<ScheduleState>((set, get) => {
  /** Remembers the programme choice (selected, switched off) after the user changed it, for the scene to keep. */
  const rememberChoice = () => {
    markChoiceMade();
    const s = get();
    const selected = s.schedules.find((m) => m.id === s.selectedId);
    const choice = useProgrammeChoiceStore.getState();
    useProgrammeChoiceStore.getState().set(
      nextChoice(choice, s.schedules.map(programmeKey), selected ? programmeKey(selected) : null, s.schedules.filter((m) => s.hiddenScheduleIds.has(m.id)).map(programmeKey)),
    );
  };
  return {
  schedules: [],
  selectedId: null,
  visibleActivityCount: null,
  hiddenScheduleIds: new Set(),
  addSchedule: (model) => set((s) => ({ schedules: [...s.schedules, model], selectedId: model.id })),
  removeSchedule: (id) =>
    set((s) => {
      const schedules = s.schedules.filter((m) => m.id !== id);
      const wasSelected = s.selectedId === id;
      const hiddenScheduleIds = new Set(s.hiddenScheduleIds);
      hiddenScheduleIds.delete(id);
      return { schedules, hiddenScheduleIds, selectedId: wasSelected ? (schedules[0]?.id ?? null) : s.selectedId };
    }),
  select: (id) => {
    set({ selectedId: id });
    rememberChoice();
  },
  setVisibleActivityCount: (count) => set({ visibleActivityCount: count }),
  toggleScheduleHidden: (id) => {
    set((s) => {
      const hiddenScheduleIds = new Set(s.hiddenScheduleIds);
      if (hiddenScheduleIds.has(id)) hiddenScheduleIds.delete(id);
      else hiddenScheduleIds.add(id);
      return { hiddenScheduleIds };
    });
    rememberChoice();
  },
  replaceAll: (schedules, hiddenIds) =>
    set({ schedules, selectedId: schedules[0]?.id ?? null, hiddenScheduleIds: new Set(hiddenIds ?? []) }),
  patchActivities: (patches) =>
    set((s) => ({
      schedules: s.schedules.map((m) => {
        const mine = patches.get(m.id);
        if (!mine || mine.size === 0) return m;
        return { ...m, activities: m.activities.map((a) => (mine.has(a.id) ? { ...a, ...mine.get(a.id)! } : a)) };
      }),
    })),
  setRelationships: (scheduleId, relationships) =>
    set((s) => ({ schedules: s.schedules.map((m) => (m.id === scheduleId ? { ...m, relationships } : m)) })),
  restoreActivities: (activities) =>
    set((s) => ({ schedules: s.schedules.map((m) => (activities.has(m.id) ? { ...m, activities: activities.get(m.id)! } : m)) })),
  setActivityField: (field, values) =>
    set((s) => ({
      schedules: s.schedules.map((m) => {
        const mine = values.get(m.id);
        if (!mine || mine.size === 0) return m;
        return { ...m, activities: m.activities.map((a) => (mine.has(a.id) ? { ...a, udf: { ...a.udf, [field]: mine.get(a.id)! } } : a)) };
      }),
    })),
  };
});

/** The schedules currently in play — everything loaded minus what's been
    toggled off from Inputs without being removed.
    Filtered outside the zustand selector (memoized here, not recomputed
    fresh on every call) — a selector that returns a brand-new array every
    time breaks React's useSyncExternalStore reference-stability
    requirement and free-falls into an infinite re-render loop. */
export function useVisibleSchedules(): ScheduleModel[] {
  const schedules = useScheduleStore((s) => s.schedules);
  const hiddenScheduleIds = useScheduleStore((s) => s.hiddenScheduleIds);
  const unloaded = useUnloadedWbsStore((s) => s.byProgramme);
  const retired = useRetiredTasksStore((s) => s.codes);
  const overrides = useActivityOverridesStore((s) => s.byProgramme);
  const linkEdits = useActivityOverridesStore((s) => s.links);
  // Programmes with WBS branches unloaded (Programmes › WBS) lose those activities everywhere; so do the tasks retired in SeaTable.
  // The edits of Programmes › Bulk edit are applied on top of every programme, imported or generated.
  return useMemo(
    () => schedules.filter((m) => !hiddenScheduleIds.has(m.id)).map((m) => withoutRetired(withoutUnloaded(withOverrides(m, overrides[programmeKey(m)], linkEdits[programmeKey(m)]), unloaded[programmeKey(m)] ?? []), retired)),
    [schedules, hiddenScheduleIds, unloaded, retired, overrides, linkEdits],
  );
}

/** The schedule driving the current view: the explicitly selected one, or
    the first loaded (and visible) one, or null when nothing is loaded/visible. */
export function useActiveSchedule(): ScheduleModel | null {
  const visible = useVisibleSchedules();
  const selectedId = useScheduleStore((s) => s.selectedId);
  return visible.find((m) => m.id === selectedId) ?? visible[0] ?? null;
}

/** Every visible schedule combined into one — what the 4D sequence plays, so
    separate per-building programmes all animate together. */
export function useSequenceSchedule(): ScheduleModel | null {
  const visible = useVisibleSchedules();
  return useMemo(() => mergeSchedules(visible), [visible]);
}
