import { useIgnoreTimelinerStore } from '../state/ignoreTimelinerStore';
import { useOnSplit } from '../state/sidePaneStore';
import { ScenarioDock, ScenarioTabContent } from '../components/scenarios/ScenarioDock';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSequenceSchedule, useVisibleSchedules } from '../state/scheduleStore';
import { useModelsStore } from '../state/modelsStore';
import { useLinkGroupsStore } from '../state/linkGroupsStore';
import { useAppearanceStore } from '../state/appearanceStore';
import { useSequenceTimelineStore, type StepUnit } from '../state/sequenceTimelineStore';
import { useScenarioStore } from '../state/scenarioStore';
import { useSelectionStore } from '../state/selectionStore';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { activityFinishMs, activityStartMs, progressAt, scheduleRange, statusInPeriod, type SequenceStatus } from '../schedule/linking';
import type { GrowthSpec } from '../viewer/growthAnimator';
import { DEFAULT_GROWTH_DISTANCE } from '../schedule/appearance';
import { alignDown, nextBoundary } from '../schedule/period';
import { computeGroupLinks, type LinkGroup } from '../schedule/linkGroups';
import { isPerTask, renderTag, renderTagLines } from '../schedule/tagTemplate';
import { tagStyleOf, useActiveTagsStore, useTagsStore, type ActiveTagLabel, type TagCallout } from '../state/tagsStore';
import { lerpStage, type AppearanceProfile, type AppearanceStage } from '../schedule/appearance';
import { ResizeHandle, useResizableWidth } from '../components/ResizeHandle';
import { LinkGroupsPanel } from '../components/sequence/LinkGroupsPanel';
import { AppearancePanel } from '../components/sequence/AppearancePanel';
import { TaskFieldFromSets } from '../components/sequence/TaskFieldFromSets';
import { LabelPanel } from '../components/sequence/LabelPanel';
import { GanttChart } from '../components/schedule/GanttChart';
import { usePersistedState } from '../utils/persistedState';
import { DEFAULT_GANTT_COLUMNS, buildColumnContext, resolveColumns } from '../schedule/columns';
import { useColumnCatalog } from '../schedule/calculatedColumns';
import { TasksPanel } from '../components/sequence/TasksPanel';
import { useSequenceUiStore } from '../state/sequenceUiStore';
import { ViewColorSettings, propertyColorer } from '../components/sequence/ColorModePanel';
import { View3DPanel } from '../components/View3DPanel';
import { NavisworksExport } from '../components/sequence/ExportPanel';
import { MediaExport } from '../components/sequence/MediaExport';
import { SidePane, type SidePaneTab } from '../components/SidePane';
import { IconCamera, IconCube, IconList, IconSchema, IconSearch, IconTag, IconTree, IconViewTable } from '../components/icons';
import { DataTablePanel } from '../components/DataTablePanel';
import { useSidePaneStore } from '../state/sidePaneStore';
import { useDataTableStore } from '../state/dataTableStore';
import { SearchSetsPanel } from '../components/SearchSetsPanel';
import { CollapsibleSection, useOpenSections } from '../components/CollapsibleSection';
import { PropertiesTab, RelatedTab, SelectionTreeTab, ViewpointsPanel } from '../components/ModelConfigPanel';
import { useViewSettingsStore } from '../state/viewSettingsStore';
import { useColorModeStore, type ColorModeSettings } from '../state/colorModeStore';
import type { ElementSummary } from '../viewer/types';

/** What the 4D driver pushes per-element visibility/colour/opacity into —
    the main viewer or the split view. */
interface ViewTarget {
  setVisible(modelId: string, localIds: number[], visible: boolean, skipUpdate?: boolean): Promise<void>;
  setColor(modelId: string, localIds: number[], color: string | null, skipUpdate?: boolean): Promise<void>;
  setOpacity(modelId: string, localIds: number[], opacity: number | null, skipUpdate?: boolean): Promise<void>;
  forceUpdate(): Promise<void>;
}
import type { Activity, ScheduleModel } from '../schedule/types';
import { InfoTip } from '../components/InfoTip';
import { JumpToDate } from '../components/sequence/JumpToDate';

type LinkTab = 'groups' | 'tree' | 'properties' | 'search' | 'datatable' | 'view3d' | 'label' | 'models';

/** A stage with an unset color/opacity falls back to the given bookend
    stage — e.g. leaving "Active start" blank inherits "Start" rather than
    silently showing nothing, matching a profile where only the Start/End
    columns were filled in (Active is meant to blend between them, not be a
    5th independent state you must also fill in). */
function withFallback(stage: AppearanceStage, fallback: AppearanceStage): AppearanceStage {
  return { color: stage.color ?? fallback.color, opacity: stage.opacity ?? fallback.opacity };
}

const PROGRESS_STEPS = 12;

/** Resolves what a linked element should look like at `status`/`progress`
    for a given profile (or the default orange-in-progress look when a group
    has none attached). */
function resolveAppearance(
  profile: AppearanceProfile | null,
  status: 'pending' | 'in-progress' | 'done',
  progress: number,
): { visible: boolean; stage: AppearanceStage } {
  if (!profile) {
    if (status === 'pending') return { visible: false, stage: { color: null, opacity: null } };
    if (status === 'in-progress') return { visible: true, stage: { color: '#f59e0b', opacity: null } };
    return { visible: true, stage: { color: null, opacity: null } };
  }
  if (status === 'in-progress') {
    const activeStart = withFallback(profile.activeStart, profile.startColor);
    const activeFinish = withFallback(profile.activeFinish, profile.endColor);
    // Quantised: a smooth lerp gives every element its own colour on every
    // tick — hundreds of distinct setColor/setOpacity round-trips per batch,
    // which is what made playback fall behind and then drift out of sync.
    // 12 steps keeps the gradient smooth enough and caps the groups.
    return { visible: true, stage: lerpStage(activeStart, activeFinish, Math.round(progress * PROGRESS_STEPS) / PROGRESS_STEPS) };
  }
  if (status === 'pending') {
    if (profile.action === 'remove' || profile.action === 'maintain') return { visible: true, stage: profile.startColor };
    return { visible: false, stage: { color: null, opacity: null } };
  }
  // done
  if (profile.action === 'remove') return { visible: false, stage: { color: null, opacity: null } };
  return { visible: true, stage: profile.endColor };
}

// A later-starting activity that has actually begun always outranks an
// earlier one that has also begun (Concrete takes over from Rebar the
// moment it starts, not just once Rebar finishes) — but neither can be
// pre-empted by some OTHER activity that hasn't started yet, even if
// that one is scheduled to start later still (an unstarted future task
// must never hide/reset an element a started task already claimed).
// When none has started, the earliest-starting one owns the element.
function shouldClaim(candidateStatus: SequenceStatus, candidateStart: number, ownerStatus: SequenceStatus, ownerStart: number): boolean {
  const candidateStarted = candidateStatus !== 'pending';
  const ownerStarted = ownerStatus !== 'pending';
  if (candidateStarted !== ownerStarted) return candidateStarted;
  // Neither has begun: the NEXT one to start decides (an install before its
  // own removal), so an object waiting to be installed stays hidden.
  if (!candidateStarted) return candidateStart <= ownerStart;
  return candidateStart >= ownerStart;
}

export function SequencePanel() {
  const engine = useViewerEngine();
  const model = useSequenceSchedule();
  const [ganttColumnIds] = usePersistedState<string[]>('gantt.columns', DEFAULT_GANTT_COLUMNS);
  const ganttCatalog = useColumnCatalog(model);
  const ganttColumns = useMemo(() => resolveColumns(ganttCatalog, ganttColumnIds), [ganttCatalog, ganttColumnIds]);
  const ganttColumnCtx = useMemo(() => (model ? buildColumnContext(model) : null), [model]);
  // Every loaded (non-hidden) model is "active" at once — no picking one
  // model out of several to drive the 4D sequence off of.
  // Filtered outside the zustand selector (memoized, not a fresh array
  // every call) — a selector returning a brand-new array each time breaks
  // React's useSyncExternalStore reference-stability requirement and
  // free-falls into an infinite re-render loop that silently blanks the app.
  const allModels = useModelsStore((s) => s.models);
  const hiddenModelIds = useModelsStore((s) => s.hiddenModelIds);
  const models = useMemo(() => allModels.filter((m) => !hiddenModelIds.has(m.modelId)), [allModels, hiddenModelIds]);
  const groups = useLinkGroupsStore((s) => s.groups);
  const appearanceProfiles = useAppearanceStore((s) => s.profiles);
  const split = useViewSettingsStore((s) => s.pages.sequence.split);
  const settingsA = useColorModeStore((s) => s.a);
  const settingsB = useColorModeStore((s) => s.b);
  // Bumped when the second view appears/disappears, so the driver pushes the
  // whole current state to it (a fresh view starts with nothing applied).
  const [secondaryTick, setSecondaryTick] = useState(0);
  useEffect(() => {
    const onChange = () => {
      needsFullApplyRef.current = true;
      setSecondaryTick((t) => t + 1);
    };
    engine.onSecondaryChange.add(onChange);
    return () => { engine.onSecondaryChange.remove(onChange); };
  }, [engine]);

  const [linkTab, setLinkTab] = useState<LinkTab>('groups');
  // Splitting the view brings up Views, to set the two views up.
  useOnSplit(split, () => setLinkTab('view3d'));
  // The data table's Configure button brings up its tab, as on the Models page.
  const dataTableConfigRequest = useDataTableStore((s) => s.configRequest);
  useEffect(() => {
    if (!dataTableConfigRequest) return;
    setLinkTab('datatable');
    useSidePaneStore.getState().setOpen(true);
    useSidePaneStore.getState().setSettings(false);
  }, [dataTableConfigRequest]);
  const modelPanels = useSequenceUiStore((s) => s.modelPanels);
  const fourD = useOpenSections<'jump' | 'groups' | 'appearance' | 'taskField' | 'why'>('sequence.4dSections', ['jump', 'groups', 'appearance']);
  const basis = useSequenceTimelineStore((s) => s.basis);
  const setBasis = useSequenceTimelineStore((s) => s.setBasis);
  const stepUnit = useSequenceTimelineStore((s) => s.stepUnit);
  const date = useSequenceTimelineStore((s) => s.date);
  // Defaults match pre-toggle behavior (unmatched elements just show with
  // their normal color) — "Highlighted red" is opt-in, not the default,
  // since it otherwise drowns out Appearance Profile colors on the
  // elements that ARE matched by painting most of the model solid red.
  const [showUnassigned, setShowUnassigned] = usePersistedState('sequence.showUnassigned', true);
  // 4D tab switches: leave out the timeline's show / hide (every linked
  // object stays visible) and / or the appearance profiles (own colours).
  const ignoreTimeliner = useIgnoreTimelinerStore((s) => s.ignore);
  const setIgnoreTimeliner = useIgnoreTimelinerStore((s) => s.setIgnore);
  const ignoreAppearance = useIgnoreTimelinerStore((s) => s.ignoreAppearance);
  const setIgnoreAppearance = useIgnoreTimelinerStore((s) => s.setIgnoreAppearance);
  const [unassignedMode, setUnassignedMode] = usePersistedState<'original' | 'red'>('sequence.unassignedMode', 'original');
  const [rightTab, setRightTab] = usePersistedState<'gantt' | 'tasks' | 'scenarios'>('sequence.rightTab', 'gantt');
  const [ganttCollapsed, setGanttCollapsed] = usePersistedState('sequence.ganttCollapsed', false);
  // Bumped by the "Refresh graphics" buttons to force the driving effect to
  // re-apply visibility/colors/opacity to the viewer on demand.
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshGraphics = () => {
    needsFullApplyRef.current = true;
    setRefreshTick((t) => t + 1);
  };
  // The driving effect's engine calls are coalesced, latest-wins: only one
  // batch runs at a time, it always runs to completion, and whatever tick
  // arrived meanwhile is applied next (intermediate ticks are dropped).
  // Aborting an in-flight batch as soon as a newer tick arrives — what this
  // used to do — starves the viewer during playback: a tick every 550ms is
  // usually faster than one batch's worker round-trips, so no batch ever
  // finished and colors/visibility only caught up once playback stopped.
  const pendingDriveRef = useRef<(() => Promise<void>) | null>(null);
  const driveRunningRef = useRef(false);
  // Leaving the page must not let a batch that is still in flight hide
  // elements AFTER the viewer was reset (that left the Models page empty):
  // stop applying, wait for the running batch to end, then reset.
  const unmountedRef = useRef(false);
  const driveLoopRef = useRef<Promise<void> | null>(null);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      pendingDriveRef.current = null;
      void (driveLoopRef.current ?? Promise.resolve()).then(() => engine.resetOverrides());
    };
  }, [engine]);
  // What was last pushed to the viewer, per model, so a tick only sends the
  // elements whose visibility/color/opacity actually changed. Cleared when
  // something else may have changed the viewer's state (see needsFullApplyRef).
  type Applied = { visible: Map<number, boolean>; color: Map<number, string | null>; opacity: Map<number, number | null> };
  const appliedRef = useRef(new Map<string, Applied>());
  const needsFullApplyRef = useRef(false);
  const ganttWidth = useResizableWidth('sequence.ganttWidth', 560, 300, 900);

  // Each (model, group) pair keeps its own task->element map (so a group's
  // attached Appearance Profile, if any, can be applied per-group).
  const groupResultsByModel = useMemo(() => {
    if (!model) return [];
    return models.flatMap((m) =>
      groups.map((g) => ({ modelId: m.modelId, group: g, links: computeGroupLinks(model, m.elements, g) })),
    );
  }, [model, models, groups]);

  const appearanceById = useMemo(() => new Map(appearanceProfiles.map((p) => [p.id, p])), [appearanceProfiles]);

  // For LinkGroupsPanel's own dropdowns/preview counts only — a flattened
  // union across models is fine there since it never needs to tell which
  // model a given localId came from (see previewGroup/the driving effect
  // below, which both work per-model for anything that does).
  const allElements = useMemo(() => models.flatMap((m) => m.elements), [models]);

  const linkedActivityIdSet = useMemo(() => {
    const ids = new Set<string>();
    for (const { links } of groupResultsByModel) for (const taskId of links.taskToElements.keys()) ids.add(taskId);
    return ids;
  }, [groupResultsByModel]);
  const combinedLinkedActivityCount = linkedActivityIdSet.size;
  // Linked activities per programme (the merged 4D model prefixes each
  // programme's activity ids with its index, see mergeSchedules) — so a
  // programme none of whose tasks link (e.g. a Link Group filter that only
  // fits the first programme) is visible instead of silently not animating.
  const visibleSchedules = useVisibleSchedules();
  const linkedPerProgramme = useMemo(() => {
    if (visibleSchedules.length < 2) return null;
    const counts = visibleSchedules.map(() => 0);
    for (const id of linkedActivityIdSet) {
      const i = Number(id.slice(0, id.indexOf(':')));
      if (Number.isInteger(i) && counts[i] !== undefined) counts[i]++;
    }
    return visibleSchedules.map((s, i) => ({ name: s.project.name || s.sourceFileName, linked: counts[i], total: s.activities.length }));
  }, [visibleSchedules, linkedActivityIdSet]);
  const unlinkedProgrammes = (linkedPerProgramme ?? []).filter((p) => p.linked === 0);

  // Reverse mapping for the Gantt panel: which activities does the current
  // 3D selection touch, on whichever model the selection belongs to (the
  // viewer only ever attributes a live selection to one model at a time —
  // see ViewerCanvas, which switches the active model on pick before
  // recording the localId).
  const selectedElementIds = useSelectionStore((s) => s.selectedIds);
  const activeModelId = useModelsStore((s) => s.selectedModelId ?? s.models[0]?.modelId ?? null);

  const linkedActivityIds = useMemo(() => {
    const ids = new Set<string>();
    if (!activeModelId || selectedElementIds.length === 0) return ids;
    const selected = new Set(selectedElementIds);
    for (const { modelId, links } of groupResultsByModel) {
      if (modelId !== activeModelId) continue;
      for (const [activityId, localIds] of links.taskToElements) {
        if (localIds.some((id) => selected.has(id))) ids.add(activityId);
      }
    }
    return ids;
  }, [activeModelId, selectedElementIds, groupResultsByModel]);

  // The earliest-starting activity among the linked set — the Gantt panel
  // scrolls/jumps to this one whenever the 3D selection changes.
  const focusActivityId = useMemo(() => {
    if (!model || linkedActivityIds.size === 0) return null;
    let best: Activity | null = null;
    for (const a of model.activities) {
      if (!linkedActivityIds.has(a.id)) continue;
      const start = a.earlyStart ?? a.targetStart;
      if (!start) continue;
      const bestStart = best ? best.earlyStart ?? best.targetStart : null;
      if (!best || !bestStart || start < bestStart) best = a;
    }
    return best?.id ?? null;
  }, [model, linkedActivityIds]);

  // Scenarios table: a double-click on a pour moves the 4D timeline to the
  // day its (earliest linked) activity starts.
  const focusRef = useRef(focusActivityId);
  focusRef.current = focusActivityId;
  const modelRef = useRef(model);
  modelRef.current = model;
  const jumpToPourStart = () => {
    // The row's click has selected the pour in 3D; its links are worked out a moment later.
    window.setTimeout(() => {
      const m = modelRef.current;
      const activity = m?.activities.find((a) => a.id === focusRef.current);
      const start = activity ? activityStartMs(activity, useSequenceTimelineStore.getState().basis) : null;
      if (start === null || start === undefined) {
        useScenarioStore.setState({ message: { kind: 'warn', text: 'That item has no linked activity in the 4D programme yet (Update 4D, and check the Link Groups).' } });
        return;
      }
      const range = scheduleRange(m!, useSequenceTimelineStore.getState().basis);
      useSequenceTimelineStore.getState().setPlaying(false);
      useSequenceTimelineStore.getState().setDate(range ? Math.min(range.max, Math.max(range.min, start)) : start);
    }, 250);
  };

  const [ganttSelectedId, setGanttSelectedId] = useState<string | null>(null);

  // Double-click on an activity (Gantt or Tasks): the 4D timeline moves to its start and its linked objects are selected in 3D.
  const openActivity = async (activity: Activity) => {
    setGanttSelectedId(activity.id);
    const { basis: b } = useSequenceTimelineStore.getState();
    const start = activityStartMs(activity, b);
    if (start !== null && start !== undefined && model) {
      const range = scheduleRange(model, b);
      useSequenceTimelineStore.getState().setPlaying(false);
      useSequenceTimelineStore.getState().setDate(range ? Math.min(range.max, Math.max(range.min, start)) : start);
    }
    const ids: Record<string, number[]> = {};
    for (const { modelId, group, links } of groupResultsByModel) {
      if (group.hidden) continue;
      const linked = links.taskToElements.get(activity.id);
      if (linked?.length) ids[modelId] = [...new Set([...(ids[modelId] ?? []), ...linked])];
    }
    if (Object.keys(ids).length > 0) await engine.selectElements(ids, true);
  };

  // Anything that changes the viewer's visibility behind the driving effect's
  // back (a new model, Show all / Hide / Isolate in the toolbar) invalidates
  // its "already applied" cache; the next batch then re-sends everything.
  useEffect(() => {
    needsFullApplyRef.current = true;
  }, [models]);
  useEffect(() => {
    const onExternal = () => {
      needsFullApplyRef.current = true;
      setRefreshTick((t) => t + 1);
    };
    engine.onExternalVisibilityChange.add(onExternal);
    return () => {
      engine.onExternalVisibilityChange.remove(onExternal);
    };
  }, [engine]);

  // Seeding the initial date and ticking it forward while playing both live
  // in SequenceTimelineStatusBar now (it stays mounted even if this panel is
  // collapsed), driven off the same useSequenceTimelineStore this effect
  // reads `date`/`basis` from.

  // Drive the viewer whenever the cursor date or the link mapping changes —
  // once per loaded model, since every model plays the 4D sequence
  // simultaneously. An element linked to more than one activity (e.g. a
  // column with both a Rebar and a Concrete task) is "owned" by whichever
  // linked activity has actually started and started LATEST — see
  // shouldClaim's own doc comment — so Rebar's end appearance holds until
  // Concrete actually begins, instead of group/iteration order deciding it
  // arbitrarily.
  useEffect(() => {
    if (!model || date === null || models.length === 0) return;
    // Queued for the coalescing loop below (see pendingDriveRef): it runs to
    // completion unless a newer tick replaces it before its turn starts.
    // Everything is judged over the whole step period the cursor sits in
    // (a year for Yearly, a month for Monthly...), not at that one instant.
    const periodStart = alignDown(date, stepUnit);
    const periodEnd = nextBoundary(date, stepUnit);
    const activityById = new Map(model.activities.map((a) => [a.id, a]));

    const perModelRuns: {
      modelId: string;
      hidden: Set<number>;
      visible: Set<number>;
      unlinked: number[];
      elements: ElementSummary[];
      /** Colours from Appearance Profiles — what a view in that mode uses. */
      colorOf: Map<number, string | null>;
      opacityOf: Map<number, number | null>;
      /** Elements a growth simulation stands in for this step (main view). */
      animated: Set<number>;
    }[] = [];
    const growthSpecs: GrowthSpec[] = [];

    for (const m of models) {
      const hidden = new Set<number>();
      const visible = new Set<number>();
      const colorOf = new Map<number, string | null>();
      const opacityOf = new Map<number, number | null>();
      const linkedIds = new Set<number>();
      const ownerStatusOf = new Map<number, SequenceStatus>();
      const ownerStartOf = new Map<number, number>();
      // Who owns each element, for the growth simulation below.
      const ownerOf = new Map<number, { activity: Activity; profile: AppearanceProfile | null; status: SequenceStatus }>();

      const applySource = (taskToElements: Map<string, number[]>, profile: AppearanceProfile | null) => {
        for (const [activityId, localIds] of taskToElements) {
          const activity = activityById.get(activityId);
          if (!activity) continue;
          const status = statusInPeriod(activity, periodStart, periodEnd, basis);
          // How far along the activity is by the END of the period.
          const progress = progressAt(activity, new Date(periodEnd), basis);
          // Undated activities (no start at all) sort last or first here
          // makes no practical difference — they're always 'pending' per
          // statusAt, so shouldClaim only lets one own an element when
          // nothing else linked to it has started yet.
          const start = activityStartMs(activity, basis) ?? -Infinity;
          const resolved = ignoreAppearance
            ? // The timeline alone: not built yet = hidden, else visible in its own colour.
              { visible: status !== 'pending', stage: { color: null, opacity: null } }
            : resolveAppearance(profile, status, progress);
          // Without the timeline everything stays; what it would hide keeps its own look.
          const isVisible = ignoreTimeliner || resolved.visible;
          const stage = resolved.visible ? resolved.stage : { color: null, opacity: null };
          for (const id of localIds) {
            linkedIds.add(id);
            const ownerStatus = ownerStatusOf.get(id);
            if (ownerStatus !== undefined && !shouldClaim(status, start, ownerStatus, ownerStartOf.get(id)!)) continue;
            ownerStatusOf.set(id, status);
            ownerStartOf.set(id, start);
            ownerOf.set(id, { activity, profile, status });
            if (isVisible) {
              visible.add(id);
              hidden.delete(id);
              colorOf.set(id, stage.color);
              opacityOf.set(id, stage.opacity);
            } else {
              hidden.add(id);
              visible.delete(id);
              colorOf.delete(id);
              opacityOf.delete(id);
            }
          }
        }
      };

      for (const { modelId, group, links } of groupResultsByModel) {
        if (modelId !== m.modelId || group.hidden) continue;
        applySource(links.taskToElements, group.appearanceProfileId ? appearanceById.get(group.appearanceProfileId) ?? null : null);
      }
      // Hidden groups (the eye in the Link Groups table): their objects stay
      // hidden, except those another group shows.
      for (const { modelId, group, links } of groupResultsByModel) {
        if (modelId !== m.modelId || !group.hidden) continue;
        for (const localIds of links.taskToElements.values()) {
          for (const id of localIds) {
            if (linkedIds.has(id)) continue;
            linkedIds.add(id);
            hidden.add(id);
          }
        }
      }

      // Growth simulation (profile Arrival / Removal): elements arriving or
      // leaving in this step, or growing bottom-to-top, get a stand-in that
      // animates (viewer/growthAnimator.ts); the real one is hidden meanwhile.
      const animated = new Set<number>();
      const bySpec = new Map<string, GrowthSpec>();
      for (const [id, { activity, profile, status }] of ownerOf) {
        if (ignoreTimeliner || ignoreAppearance) break; // growth is part of both
        if (!profile || status !== 'in-progress' || !visible.has(id)) continue;
        const start = activityStartMs(activity, basis);
        const finish = activityFinishMs(activity, basis);
        const distance = profile.growthDistance ?? DEFAULT_GROWTH_DISTANCE;
        let mode: GrowthSpec['mode'] | null = null;
        if (profile.action !== 'remove' && profile.growthIn && profile.growthIn !== 'none') mode = profile.growthIn;
        else if (profile.action === 'remove' && profile.growthOut && profile.growthOut !== 'none') mode = profile.growthOut;
        if (!mode || start === null) continue;
        // Movement progress (0..1) at the step's start and end, on the task's
        // own clock: bottom-to-top over the whole task; drop / slide / lift
        // over the last `growthHours` before the finish (else the whole task).
        const end = finish ?? start;
        const windowMs = mode !== 'bottomToTop' && profile.growthHours ? Math.min(end - start, profile.growthHours * 3_600_000) : end - start;
        const from0 = end - windowMs;
        const at = (t: number) => (windowMs <= 0 ? (t >= end ? 1 : 0) : Math.max(0, Math.min(1, (t - from0) / windowMs)));
        const from = at(periodStart);
        const to = at(periodEnd);
        if (from >= 1) continue;
        const key = `${m.modelId}:${activity.id}:${mode}`;
        const spec = bySpec.get(key) ?? { key, modelId: m.modelId, localIds: [], mode, distance, color: colorOf.get(id) ?? null, opacity: opacityOf.get(id) ?? null, from, to };
        spec.localIds.push(id);
        bySpec.set(key, spec);
        animated.add(id);
      }
      growthSpecs.push(...bySpec.values());

      const unlinked = m.elements.map((e) => e.localId).filter((id) => !linkedIds.has(id));
      perModelRuns.push({ modelId: m.modelId, hidden, visible, unlinked, elements: m.elements, colorOf, opacityOf, animated });
    }

    // The colour mode only swaps colour; visibility and opacity stay driven by
    // the timeline, so both views always show the same elements.
    const colorsFor = (settings: ColorModeSettings, run: (typeof perModelRuns)[number]) => {
      if (settings.mode === 'appearance') return { colorOf: run.colorOf, unlinkedColorOf: null };
      const unlinkedSet = new Set(run.unlinked);
      const colorOf = new Map<number, string | null>();
      const unlinkedColorOf = new Map<number, string | null>();
      const colorFor = settings.mode === 'property' ? propertyColorer(settings.field, settings.rules, settings.fallback) : () => null;
      for (const el of run.elements) {
        const c = colorFor(el);
        if (unlinkedSet.has(el.localId)) unlinkedColorOf.set(el.localId, c);
        else if (run.colorOf.has(el.localId)) colorOf.set(el.localId, c);
      }
      return { colorOf, unlinkedColorOf };
    };

    pendingDriveRef.current = runDriveBatch;
    if (!driveRunningRef.current) {
      driveRunningRef.current = true;
      driveLoopRef.current = (async () => {
        try {
          while (pendingDriveRef.current && !unmountedRef.current) {
            const job = pendingDriveRef.current;
            pendingDriveRef.current = null;
            try {
              // Strictly one batch at a time and always awaited to the end.
              // (A timeout that abandoned a slow batch let it keep running
              // underneath the next one, so an OLD date's calls could land
              // after the new date's and leave the viewer on stale state.)
              await job();
            } catch (e) {
              console.error('SequencePanel: 4D driving batch failed', e);
            }
          }
        } finally {
          driveRunningRef.current = false;
        }
      })();
    }

    async function runDriveBatch() {
      // (The loop below names each view's target `engine`.)
      const mainEngine = engine;
      if (needsFullApplyRef.current) {
        appliedRef.current.clear();
        needsFullApplyRef.current = false;
      }
      const applied = appliedRef.current;
      // View A is the main viewer; B is the split view, once it exists.
      const views: { id: string; target: ViewTarget; settings: ColorModeSettings }[] = [{ id: 'a', target: engine, settings: settingsA }];
      if (split) {
        const secondary = engine.secondary;
        if (secondary) {
          await secondary.syncModels();
          views.push({ id: 'b', target: secondary, settings: settingsB });
        }
      }
      // Stand-ins first, so an animated element never blinks out before its
      // copy is on screen.
      await engine.growth.set(growthSpecs);
      for (const view of views) for (const run of perModelRuns) {
        if (unmountedRef.current) return;
        const { modelId, unlinked, opacityOf, animated } = run;
        // Growth stand-ins are drawn in the main view only.
        const hidden = view.id === 'a' && animated.size ? new Set([...run.hidden, ...animated]) : run.hidden;
        const visible = view.id === 'a' && animated.size ? [...run.visible].filter((id) => !animated.has(id)) : run.visible;
        const { colorOf, unlinkedColorOf } = colorsFor(view.settings, run);
        const engine = view.target;
        const key = `${view.id}:${modelId}`;
        const prev = applied.get(key) ?? { visible: new Map(), color: new Map(), opacity: new Map() };
        applied.set(key, prev);

        // Target state for this date; only what differs from `prev` is sent.
        const toHide: number[] = [];
        const toShow: number[] = [];
        // What the user hid (Hide / Isolate in the toolbar) stays hidden whatever the timeline says.
        // (Hide / Isolate reach the split's second view too, so one list serves both.)
        const userHid = (id: number) => mainEngine.isUserHidden(modelId, id);
        const noteVisible = (ids: Iterable<number>, wanted: boolean) => {
          for (const id of ids) {
            const target = wanted && !userHid(id);
            if (prev.visible.get(id) === target) continue;
            prev.visible.set(id, target);
            (target ? toShow : toHide).push(id);
          }
        };
        noteVisible(hidden, false);
        noteVisible(visible, true);
        noteVisible(unlinked, showUnassigned);

        const unlinkedColor = unassignedMode === 'red' ? '#ef4444' : null;
        const colorGroups = new Map<string | null, number[]>();
        const noteColor = (id: number, color: string | null) => {
          if (prev.color.has(id) && prev.color.get(id) === color) return;
          prev.color.set(id, color);
          (colorGroups.get(color) ?? colorGroups.set(color, []).get(color)!).push(id);
        };
        for (const id of unlinked) noteColor(id, unlinkedColorOf ? unlinkedColorOf.get(id) ?? null : unlinkedColor);
        for (const [id, color] of colorOf) noteColor(id, color);

        // A stage with no opacity must actively RESET whatever an earlier
        // stage set, so null is a real target here, not "skip".
        const opacityGroups = new Map<number | null, number[]>();
        for (const [id, opacity] of opacityOf) {
          if (prev.opacity.has(id) && prev.opacity.get(id) === opacity) continue;
          prev.opacity.set(id, opacity);
          (opacityGroups.get(opacity) ?? opacityGroups.set(opacity, []).get(opacity)!).push(id);
        }

        // skipUpdate on every call but the last — one composited re-render
        // per model per date change.
        if (toHide.length) await engine.setVisible(modelId, toHide, false, true);
        if (toShow.length) await engine.setVisible(modelId, toShow, true, true);
        for (const [color, ids] of colorGroups) await engine.setColor(modelId, ids, color, true);
        for (const [opacity, ids] of opacityGroups) await engine.setOpacity(modelId, ids, opacity, true);
        await engine.forceUpdate();
      }
      // The real elements are back on screen: now the finished drops' stand-ins can go.
      engine.growth.flushStale();
      // Tells the image/video export this date is now on screen.
      useSequenceTimelineStore.setState({ appliedDate: date });
    }
  }, [model, models, groupResultsByModel, appearanceById, date, basis, stepUnit, engine, showUnassigned, unassignedMode, refreshTick, secondaryTick, split, settingsA, settingsB, ignoreTimeliner, ignoreAppearance]);

  // Tasks wear the colour their linked objects have in the 4D view: the
  // Appearance Profile stage of the (first) Link Group that links them, for the
  // current step. Tasks no group links, or whose stage has no colour, stay plain.
  const taskColorOf = useMemo(() => {
    // Profiles ignored in 3D: the Gantt bars keep their own colours too.
    if (date === null || ignoreAppearance) return null;
    const periodStart = alignDown(date, stepUnit);
    const periodEnd = nextBoundary(date, stepUnit);
    const profileOf = new Map<string, AppearanceProfile | null>();
    for (const { group, links } of groupResultsByModel) {
      const profile = group.appearanceProfileId ? appearanceById.get(group.appearanceProfileId) ?? null : null;
      for (const taskId of links.taskToElements.keys()) if (!profileOf.has(taskId)) profileOf.set(taskId, profile);
    }
    return (a: Activity): string | null => {
      if (!profileOf.has(a.id)) return null;
      const status = statusInPeriod(a, periodStart, periodEnd, basis);
      const progress = progressAt(a, new Date(periodEnd), basis);
      return resolveAppearance(profileOf.get(a.id)!, status, progress).stage.color;
    };
  }, [date, stepUnit, basis, groupResultsByModel, appearanceById, ignoreAppearance]);

  useEffect(() => {
    useSequenceUiStore.setState({ taskColorOf });
  }, [taskColorOf]);

  // Tag labels for the viewer: each tagged group whose tasks are active in
  // the current step contributes its tag's text (once per active task when
  // the template uses a {Task…} token).
  const tags = useTagsStore((s) => s.tags);
  const setActiveTags = useActiveTagsStore((s) => s.set);
  useEffect(() => {
    if (!model || date === null || tags.length === 0) {
      setActiveTags([]);
      return;
    }
    const periodStart = alignDown(date, stepUnit);
    const periodEnd = nextBoundary(date, stepUnit);
    const tagById = new Map(tags.map((t) => [t.id, t]));
    const activityById = new Map(model.activities.map((a) => [a.id, a]));
    const elementsByModel = new Map(models.map((m) => [m.modelId, new Map(m.elements.map((e) => [e.localId, e]))]));
    type ActiveEntry = { task: Activity; elements: ElementSummary[]; targets: Record<string, number[]> };
    const perGroup = new Map<string, Map<string, ActiveEntry>>();
    for (const { modelId, group, links } of groupResultsByModel) {
      if (group.hidden || !group.tagId || !tagById.has(group.tagId)) continue;
      const active = perGroup.get(group.id) ?? new Map<string, ActiveEntry>();
      perGroup.set(group.id, active);
      const lookup = elementsByModel.get(modelId);
      for (const [taskId, localIds] of links.taskToElements) {
        const task = activityById.get(taskId);
        if (!task || statusInPeriod(task, periodStart, periodEnd, basis) !== 'in-progress') continue;
        const entry = active.get(taskId) ?? { task, elements: [], targets: {} };
        for (const id of localIds) {
          const el = lookup?.get(id);
          if (el) entry.elements.push(el);
        }
        entry.targets[modelId] = [...(entry.targets[modelId] ?? []), ...localIds];
        active.set(taskId, entry);
      }
    }
    const items: ActiveTagLabel[] = [];
    const callouts: TagCallout[] = [];
    for (const group of groups) {
      const active = perGroup.get(group.id);
      const tag = group.tagId ? tagById.get(group.tagId) : undefined;
      if (!active || active.size === 0 || !tag) continue;
      const entries = [...active.values()];
      const lines = renderTagLines(tag.template, entries, basis);
      if (lines.length > 0) items.push({ key: `${group.id}:${tag.id}`, color: group.color, lines, style: tagStyleOf(tag) });
      // Next-to-object callouts: one per task for a per-task template, else
      // one for the whole group at the middle of all its active objects.
      if (isPerTask(tag.template)) {
        for (const e of entries) {
          const text = renderTag(tag.template, { activeCount: entries.length, task: e.task, elements: e.elements, basis }).trim();
          if (text) callouts.push({ key: `${group.id}:${e.task.id}`, color: group.color, text, style: tagStyleOf(tag), targets: e.targets });
        }
      } else if (lines[0]) {
        const targets: Record<string, number[]> = {};
        for (const e of entries) for (const [m, ids] of Object.entries(e.targets)) targets[m] = [...(targets[m] ?? []), ...ids];
        callouts.push({ key: `${group.id}:${tag.id}`, color: group.color, text: lines[0], style: tagStyleOf(tag), targets });
      }
    }
    setActiveTags(items, callouts);
  }, [model, models, date, stepUnit, basis, groups, tags, groupResultsByModel, setActiveTags]);
  useEffect(() => () => useActiveTagsStore.getState().set([]), []);

  const previewGroup = async (group: LinkGroup) => {
    if (!model || models.length === 0) return;
    // The preview recolours elements behind the cache's back.
    needsFullApplyRef.current = true;
    const idsByModel = new Map<string, number[]>();
    for (const m of models) {
      const r = computeGroupLinks(model, m.elements, group);
      const ids = [...r.elementIds];
      idsByModel.set(m.modelId, ids);
      await engine.setColor(m.modelId, ids, group.color);
    }
    await engine.fitToModelIds(idsByModel);
  };

  const rightTabs = (
    <div className="config-tabs seq-righttabs" role="tablist">
      {([['gantt', 'Gantt'], ['tasks', 'Tasks'], ['scenarios', 'Scenarios']] as const).map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={rightTab === id} className={`config-tab${rightTab === id ? ' active' : ''}`} onClick={() => setRightTab(id)}>{label}</button>
      ))}
    </div>
  );

  // No programme (or model) yet: Scenarios still works — it is how a
  // building's first programme gets generated.
  const collapsedStrip = (
    <button
      type="button"
      onClick={() => setGanttCollapsed(false)}
      title="Show Gantt panel"
      style={{ width: 24, flexShrink: 0, background: 'var(--bg-elevated)', border: 'none', borderLeft: '1px solid var(--border)', cursor: 'pointer', color: 'var(--text-dim)' }}
    >
      ‹
    </button>
  );
  const collapseButton = (
    <button className="icon-btn" type="button" onClick={() => setGanttCollapsed(true)} title="Hide panel" style={{ marginLeft: 'auto' }}>{'›'}</button>
  );

  if (!model || models.length === 0) {
    if (ganttCollapsed) return collapsedStrip;
    return (
      <>
        <ResizeHandle onMouseDown={ganttWidth.startDrag(true)} />
        <aside className="config-panel seq-panel" style={{ width: ganttWidth.width, minWidth: 0 }}>
          <div className="filter-sidebar-header seq-righthead">
            {rightTabs}
            {collapseButton}
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {rightTab === 'scenarios' ? (
              <ScenarioTabContent onOpen={jumpToPourStart} />
            ) : (
              <div style={{ padding: 12, color: 'var(--text-dim)' }}>
                Load both an IFC model and a P6 programme in Inputs to start 4D sequencing — or generate one from the Scenarios tab.
              </div>
            )}
          </div>
        </aside>
        {rightTab === 'scenarios' && <ScenarioDock />}
      </>
    );
  }

  return (
    <>
      {ganttCollapsed ? (
        collapsedStrip
      ) : (
        <>
          <ResizeHandle onMouseDown={ganttWidth.startDrag(true)} />
          <aside className="config-panel seq-panel" style={{ width: ganttWidth.width, minWidth: 0 }}>
            <div className="filter-sidebar-header seq-righthead">
              {rightTabs}
              {rightTab === 'gantt' && linkedActivityIds.size > 0 && (
                <span className="seq-linked">
                  {linkedActivityIds.size} activit{linkedActivityIds.size === 1 ? 'y' : 'ies'} linked to selection
                </span>
              )}
              {collapseButton}
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {rightTab === 'scenarios' && <ScenarioTabContent onOpen={jumpToPourStart} />}
              {rightTab === 'tasks' && ganttColumnCtx && (
                <TasksPanel model={model} catalog={ganttCatalog} columnCtx={ganttColumnCtx} selectedId={ganttSelectedId} getColor={taskColorOf ?? undefined} onSelect={(a) => setGanttSelectedId(a.id)} onOpen={(a) => void openActivity(a)} />
              )}
              {rightTab === 'gantt' && <GanttChart
                getColor={taskColorOf ?? undefined}
                columns={ganttColumns}
                columnCtx={ganttColumnCtx!}
                activities={model.activities}
                relationships={model.relationships}
                selectedId={ganttSelectedId}
                highlightedIds={linkedActivityIds}
                scrollToId={focusActivityId}
                onSelect={(a) => setGanttSelectedId(a.id)}
                onOpen={(a) => void openActivity(a)}
              />}
            </div>
          </aside>
          {rightTab === 'scenarios' && <ScenarioDock />}
        </>
      )}

      <SidePane
        tabs={[
          { id: 'groups', label: '4D', icon: <IconSchema /> },
          { id: 'models', label: '3D & Related', icon: <IconCube /> },
          { id: 'properties', label: 'Properties', icon: <IconList /> },
          { id: 'tree', label: 'Selection Tree', icon: <IconTree /> },
          { id: 'search', label: 'Search sets', icon: <IconSearch /> },
          { id: 'datatable', label: 'Data table', icon: <IconViewTable /> },
          { id: 'view3d', label: 'Views', icon: <IconCamera /> },
          { id: 'label', label: 'Label', icon: <IconTag /> },
        ] satisfies SidePaneTab<LinkTab>[]}
        active={linkTab}
        onSelect={setLinkTab}
        bodyClassName={(linkTab === 'view3d' && modelPanels) || linkTab === 'models' || linkTab === 'tree' || linkTab === 'search' || linkTab === 'datatable' || linkTab === 'properties' || linkTab === 'groups' ? 'config-panel__body model-config__body' : undefined}
      >
              {linkTab === 'groups' && (
                // Jump to date, Link Groups and Appearance Profiles, one collapsible section each.
                <div>
                  <CollapsibleSection title="Jump to date" open={fourD.isOpen('jump')} onToggle={() => fourD.toggle('jump')}>
                    <JumpToDate />
                  </CollapsibleSection>
                  <CollapsibleSection title={`Link Groups (${groups.length})`} open={fourD.isOpen('groups')} onToggle={() => fourD.toggle('groups')} flush>
                    <LinkGroupsPanel model={model} elements={allElements} elementSets={models.map((m) => m.elements)} onPreview={previewGroup} />
                  </CollapsibleSection>
                  <CollapsibleSection title={`Appearance Profiles (${appearanceProfiles.length})`} open={fourD.isOpen('appearance')} onToggle={() => fourD.toggle('appearance')} flush>
                    <AppearancePanel onRefresh={refreshGraphics} />
                  </CollapsibleSection>
                  <CollapsibleSection title="Why is it shown?" open={fourD.isOpen('why')} onToggle={() => fourD.toggle('why')} tip={<p>Select an object in the 3D view: this lists every task that links to it, which Link Group each comes from, where each stands at the current step, and which one controls the object (and so whether it is shown, hidden or recoloured).</p>}>
                    <WhyShown
                      groupResults={groupResultsByModel}
                      model={model}
                      modelId={activeModelId}
                      selectedIds={selectedElementIds}
                      date={date}
                      stepUnit={stepUnit}
                      basis={basis}
                      appearanceById={appearanceById}
                      ignoreAppearance={ignoreAppearance}
                    />
                  </CollapsibleSection>
                  <CollapsibleSection title="Task fields from search sets" open={fourD.isOpen('taskField')} onToggle={() => fourD.toggle('taskField')}>
                    <TaskFieldFromSets results={groupResultsByModel} />
                  </CollapsibleSection>
                  <div className="disp seq-ignore">
                    <div className="disp__row">
                      <span>
                        Ignore timeliner{' '}
                        <InfoTip>Every linked object stays visible whatever the date: nothing is hidden before it starts or after a Remove. Appearance colours for the current date still apply (unless ignored below).</InfoTip>
                      </span>
                      <button type="button" role="switch" aria-checked={ignoreTimeliner} className={`switch${ignoreTimeliner ? ' on' : ''}`} onClick={() => setIgnoreTimeliner(!ignoreTimeliner)}>
                        <span className="switch__thumb" />
                      </button>
                    </div>
                    <div className="disp__row">
                      <span>
                        Ignore appearance profiles{' '}
                        <InfoTip>Objects keep their own colours: no profile colours, opacity or growth animation. The timeline still shows and hides them by date (unless ignored above).</InfoTip>
                      </span>
                      <button type="button" role="switch" aria-checked={ignoreAppearance} className={`switch${ignoreAppearance ? ' on' : ''}`} onClick={() => setIgnoreAppearance(!ignoreAppearance)}>
                        <span className="switch__thumb" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {linkTab === 'label' && <LabelPanel />}
              {linkTab === 'models' && <RelatedTab page="sequence" />}
              {linkTab === 'tree' && <SelectionTreeTab />}
              {linkTab === 'search' && <SearchSetsPanel />}
              {linkTab === 'datatable' && <DataTablePanel />}
              {linkTab === 'properties' && <PropertiesTab />}
              {linkTab === 'view3d' && (() => {
                // The Models page's Views panel, with this page's view settings as its
                // second section and the exports (Output, Navisworks) at the end.
                const settings = (
                  <View3DPanel
                    page="sequence"
                    colorSection={(view) => <ViewColorSettings view={view} elements={allElements} />}
                    extra={
                      <>
                        <div className="disp__row">
                          <span>Gantt panel</span>
                          <button type="button" role="switch" aria-checked={!ganttCollapsed} className={`switch${!ganttCollapsed ? ' on' : ''}`} onClick={() => setGanttCollapsed((v) => !v)}>
                            <span className="switch__thumb" />
                          </button>
                        </div>
  
                        <div className="cols__heading"><span>Unassigned objects</span></div>
                        <div className="disp__row">
                          <span>Show unassigned objects</span>
                          <button type="button" role="switch" aria-checked={showUnassigned} className={`switch${showUnassigned ? ' on' : ''}`} onClick={() => setShowUnassigned((v) => !v)}>
                            <span className="switch__thumb" />
                          </button>
                        </div>
                        {showUnassigned && (
                          <div className="segmented-choice" style={{ marginTop: 6 }}>
                            <button className={unassignedMode === 'original' ? 'active' : ''} type="button" onClick={() => setUnassignedMode('original')}>Original colors</button>
                            <button className={unassignedMode === 'red' ? 'active' : ''} type="button" onClick={() => setUnassignedMode('red')}>Highlighted red</button>
                          </div>
                        )}
  
                        <div className="cols__heading">
                          <span>
                            Playback{' '}
                            <InfoTip>The playback Step and the timeline scrubber live in the status bar; the date/week label on the viewer is set in the Label tab.</InfoTip>
                          </span>
                        </div>
                        <label className="disp__row">
                          <span>Date basis</span>
                          <select value={basis} onChange={(e) => setBasis(e.target.value as 'planned' | 'actual')} title="Date basis">
                            <option value="planned">Planned</option>
                            <option value="actual">Actual</option>
                          </select>
                        </label>
                      </>
                    }
                  />
                );
                const extra = [
                  { label: 'Output', content: <MediaExport schedule={model} /> },
                  { label: 'Navisworks TimeLiner', content: <NavisworksExport schedule={model} models={models} basis={basis} /> },
                ];
                return modelPanels ? <ViewpointsPanel element={modelPanels.views} settings={settings} extra={extra} /> : settings;
              })()}
      </SidePane>
    </>
  );
}


type GroupResult = { modelId: string; group: LinkGroup; links: ReturnType<typeof computeGroupLinks> };

/** 4D tab › Why is it shown?: for the first selected object, the tasks linked to
    it, where each stands at the current step and which one controls it. */
function WhyShown({ groupResults, model, modelId, selectedIds, date, stepUnit, basis, appearanceById, ignoreAppearance }: {
  groupResults: GroupResult[];
  model: ScheduleModel | null;
  modelId: string | null;
  selectedIds: number[];
  date: number | null;
  stepUnit: StepUnit;
  basis: 'planned' | 'actual';
  appearanceById: Map<string, AppearanceProfile>;
  ignoreAppearance: boolean;
}) {
  const id = selectedIds[0];
  const info = useMemo(() => {
    if (!model || modelId === null || id === undefined || date === null) return null;
    const periodStart = alignDown(date, stepUnit);
    const periodEnd = nextBoundary(date, stepUnit);
    const activityById = new Map(model.activities.map((a) => [a.id, a]));
    const fmt = (ms: number | null) => (ms === null ? '—' : new Date(ms).toLocaleDateString());
    const rows: { key: string; group: string; task: string; dates: string; status: SequenceStatus; action: string; claimed: boolean; visible: boolean }[] = [];
    let owner: { row: (typeof rows)[number]; start: number } | null = null;
    for (const { modelId: mid, group, links } of groupResults) {
      if (mid !== modelId) continue;
      const profile = group.appearanceProfileId ? appearanceById.get(group.appearanceProfileId) ?? null : null;
      for (const [taskId, ids] of links.taskToElements) {
        if (!ids.includes(id)) continue;
        const a = activityById.get(taskId);
        if (!a) continue;
        const status = statusInPeriod(a, periodStart, periodEnd, basis);
        const progress = progressAt(a, new Date(periodEnd), basis);
        const resolved = ignoreAppearance ? { visible: status !== 'pending' } : resolveAppearance(profile, status, progress);
        const start = activityStartMs(a, basis) ?? -Infinity;
        const row = {
          key: `${group.id}:${taskId}`,
          group: group.name + (group.hidden ? ' (hidden)' : ''),
          task: `${a.code} ${a.name}`,
          dates: `${fmt(activityStartMs(a, basis))} – ${fmt(activityFinishMs(a, basis))}`,
          status,
          action: profile ? profile.action : 'no profile',
          claimed: false,
          visible: resolved.visible,
        };
        rows.push(row);
        if (group.hidden) continue;
        if (!owner || shouldClaim(status, start, owner.row.status, owner.start)) owner = { row, start };
      }
    }
    if (owner) owner.row.claimed = true;
    return { rows, owner: owner?.row ?? null, hiddenGroup: rows.length > 0 && !owner };
  }, [groupResults, model, modelId, id, date, stepUnit, basis, appearanceById, ignoreAppearance]);

  if (id === undefined) return <div style={{ color: 'var(--text-dim)' }}>Select an object in the 3D view.</div>;
  if (!info) return <div style={{ color: 'var(--text-dim)' }}>Move the timeline to a date first.</div>;
  if (info.rows.length === 0) return <div style={{ color: 'var(--text-dim)' }}>No Link Group links this object, so the timeline does not drive it (shown or hidden by “Unassigned objects”).</div>;
  return (
    <div style={{ fontSize: 11 }}>
      <div style={{ marginBottom: 6 }}>
        {info.hiddenGroup
          ? <b>Hidden: every group linking it is hidden (eye).</b>
          : <b>{info.owner!.visible ? 'Shown' : 'Hidden'}</b>}
        {info.owner && <> — controlled by <b>{info.owner.group}</b>: {info.owner.status}, {info.owner.action}</>}
      </div>
      {info.rows.map((r) => (
        <div key={r.key} style={{ padding: '3px 0', borderTop: '1px solid var(--border)', fontWeight: r.claimed ? 600 : 400 }} title={r.task}>
          {r.claimed ? '▶ ' : ''}{r.group}: {r.task}
          <div style={{ color: 'var(--text-dim)', fontWeight: 400 }}>{r.dates} · {r.status} · {r.action} → {r.visible ? 'shown' : 'hidden'}</div>
        </div>
      ))}
    </div>
  );
}
