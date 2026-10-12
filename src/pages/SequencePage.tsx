import { useIgnoreTimelinerStore } from '../state/ignoreTimelinerStore';
import { useOnSplit, useViewpointsToggle } from '../state/sidePaneStore';
import { ScenarioDock, ScenarioTabContent } from '../components/scenarios/ScenarioDock';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSequenceSchedule } from '../state/scheduleStore';
import { useModelsStore } from '../state/modelsStore';
import { useLinkGroupsStore } from '../state/linkGroupsStore';
import { useAppearanceStore } from '../state/appearanceStore';
import { useSequenceTimelineStore, type StepUnit } from '../state/sequenceTimelineStore';
import { useScenarioStore } from '../state/scenarioStore';
import { useSelectionStore } from '../state/selectionStore';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { activityFinishMs, activityStartMs, progressAt, scheduleRange, statusInPeriod, type SequenceStatus } from '../schedule/linking';
import type { GrowthSpec } from '../viewer/growthAnimator';
import { DEFAULT_GROWTH_DISTANCE, DEFAULT_GROWTH_VECTOR, GROWS_OVER_TASK, GROWTH_DIRECTIONS } from '../schedule/appearance';
import { alignDown, nextBoundary } from '../schedule/period';
import { computeGroupLinks, type GroupLinkResult, type LinkGroup } from '../schedule/linkGroups';
import { expandWork } from '../schedule/subSequence';
import { isPerTask, renderTag, renderTagLines } from '../schedule/tagTemplate';
import { placementOf, tagStyleOf, useActiveTagsStore, useTagsStore, type ActiveTagLabel, type TagCallout } from '../state/tagsStore';
import { lerpStage, type AppearanceProfile, type AppearanceStage } from '../schedule/appearance';
import { DockPanel } from '../components/Dock';
import { MATERIAL_CLASS_COLOURS, encodeSurfaceInColour } from '../viewer/materialClasses';
import { DOCK_DEFAULTS, activeOn, useDockStore } from '../state/dockStore';
import { DockGantt } from '../components/sequence/DockGantt';
import { TasksDock } from '../components/sequence/TasksDock';
import { SequenceResources } from '../components/sequence/SequenceResources';
import { LinkGroupsPanel, exportLinkGroupMatches, useLinkGroupsUiStore } from '../components/sequence/LinkGroupsPanel';
import { AppearancePanel, useAppearanceUiStore } from '../components/sequence/AppearancePanel';
import { TaskFieldFromSets } from '../components/sequence/TaskFieldFromSets';
import { LabelPanel } from '../components/sequence/LabelPanel';
import { usePersistedState } from '../utils/persistedState';
import { buildColumnContext } from '../schedule/columns';
import { useColumnCatalog } from '../schedule/calculatedColumns';
import { TasksPanel } from '../components/sequence/TasksPanel';
import { isSettingsOpen, useSettingsPaneStore } from '../state/settingsPaneStore';
import { useSequenceUiStore } from '../state/sequenceUiStore';
import { ColorModeRow, ViewColorSettings, propertyColorer } from '../components/sequence/ColorModePanel';
import { View3DPanel } from '../components/View3DPanel';
import { NavisworksExport } from '../components/sequence/ExportPanel';
import { MediaExport } from '../components/sequence/MediaExport';
import { SidePane, type SidePaneTab } from '../components/SidePane';
import { IconAddCircleOutline, IconDownload, IconSync, IconCamera, IconCube, IconList, IconSchema, IconSearch, IconTree, IconViewTable } from '../components/icons';
import { DataTablePanel } from '../components/DataTablePanel';
import { useSidePaneStore } from '../state/sidePaneStore';
import { useDataTableStore } from '../state/dataTableStore';
import { SearchSetsPanel } from '../components/SearchSetsPanel';
import { TopicsPanel } from '../components/TopicsPanel';
import { useTopicsStore } from '../state/topicsStore';
import { CollapsibleSection, useOpenSections } from '../components/CollapsibleSection';
import { useAppPrefsStore } from '../state/appPrefsStore';
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
import { SkipDays } from '../components/sequence/SkipDays';

type LinkTab = 'groups' | 'tree' | 'properties' | 'search' | 'datatable' | 'view3d' | 'models';

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
  const ganttCatalog = useColumnCatalog(model);
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
  useViewpointsToggle('sequence', () => linkTab === 'view3d', () => setLinkTab('view3d'));
  // The data table's Configure button brings up its tab, as on the Models page.
  const dataTableConfigRequest = useDataTableStore((s) => s.configRequest);
  useEffect(() => {
    if (!dataTableConfigRequest) return;
    setLinkTab('datatable');
    useSidePaneStore.getState().setOpen(true);
    useSidePaneStore.getState().setSettings(false);
  }, [dataTableConfigRequest]);
  const modelPanels = useSequenceUiStore((s) => s.modelPanels);
  const experimental = useAppPrefsStore((s) => s.experimental);
  const topicCount = useTopicsStore((s) => s.topics.length);
  // A topic marker clicked in the 3D view opens the 4D tab's Topics section.
  const topicOpenRequest = useTopicsStore((s) => s.openRequest);
  const topicSeen = useRef(topicOpenRequest);
  const fourD = useOpenSections<'options' | 'groups' | 'appearance' | 'taskField' | 'why'>('sequence.4dSections2', ['options', 'groups', 'appearance']);
  const basis = useSequenceTimelineStore((s) => s.basis);
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
  // Gantt, Tasks, Resources, Scenarios, Clash and Topics are dock panels (components/Dock.tsx): the user puts each on the
  // left, at the bottom or on the right. Scenarios has a second part (its dock) that goes with it while it shows.
  const settingsTarget = useSettingsPaneStore((s) => s.target);
  const tasksShowing = useDockStore((d) => {
    const side = d.placement.tasks ?? DOCK_DEFAULTS.tasks;
    return side !== 'closed' && !d.folded[side] && activeOn(d, side) === 'tasks';
  });
  const scenariosShowing = useDockStore((d) => {
    const side = d.placement.scenarios ?? DOCK_DEFAULTS.scenarios;
    return side !== 'closed' && !d.folded[side] && activeOn(d, side) === 'scenarios';
  });
  useEffect(() => {
    if (topicOpenRequest === topicSeen.current) return;
    topicSeen.current = topicOpenRequest;
    if (!experimental.bcf) return;
    useDockStore.getState().reveal('topics');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicOpenRequest]);
  // Bumped by the "Refresh graphics" buttons to force the driving effect to
  // re-apply visibility/colors/opacity to the viewer on demand.
  const [refreshTick, setRefreshTick] = useState(0);
  // Colours and opacity set by anything else (painting, Models > Colour, the legend, a stage left behind) go back to the
  // model's own first: the driving effect only re-sends the linked objects' own stages, so it never took those off.
  const refreshGraphics = () => {
    needsFullApplyRef.current = true;
    void engine.resetLooks().then(() => {
      needsFullApplyRef.current = true;
      setRefreshTick((t) => t + 1);
    });
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

      const applySource = (links: GroupLinkResult, overlapPct: number, profile: AppearanceProfile | null) => {
        // A group with a sub-sequence drives each part of an activity over its own slot of the activity's time.
        for (const { activity, ids: localIds } of expandWork(links.taskToElements, links.sub, activityById, basis, overlapPct)) {
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
              colorOf.set(id, stage.surface ? encodeSurfaceInColour(stage.color ?? MATERIAL_CLASS_COLOURS[stage.surface], stage.surface) : stage.color);
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
        applySource(links, group.subSequence?.enabled ? group.subSequence.overlapPct : 0, group.appearanceProfileId ? appearanceById.get(group.appearanceProfileId) ?? null : null);
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
        let direction: GrowthSpec['direction'];
        if (profile.action !== 'remove' && profile.growthIn && profile.growthIn !== 'none') {
          if (GROWS_OVER_TASK.includes(profile.growthIn)) {
            // Project axes (X east, Y north, Z up) to the viewer's (x, y up, -z).
            const v = profile.growthIn === 'custom' ? profile.growthVector ?? DEFAULT_GROWTH_VECTOR : GROWTH_DIRECTIONS[profile.growthIn];
            const len = Math.hypot(v.x, v.y, v.z);
            if (len > 1e-9) direction = { x: v.x / len, y: v.z / len, z: -v.y / len };
            mode = 'grow';
          } else mode = profile.growthIn as GrowthSpec['mode'];
        } else if (profile.action === 'remove' && profile.growthOut && profile.growthOut !== 'none') mode = profile.growthOut;
        if (!mode || start === null) continue;
        // Movement progress (0..1) at the step's start and end, on the task's
        // own clock: bottom-to-top over the whole task; drop / slide / lift
        // over the last `growthHours` before the finish (else the whole task).
        const end = finish ?? start;
        const windowMs = mode !== 'grow' && profile.growthHours ? Math.min(end - start, profile.growthHours * 3_600_000) : end - start;
        const from0 = end - windowMs;
        const at = (t: number) => (windowMs <= 0 ? (t >= end ? 1 : 0) : Math.max(0, Math.min(1, (t - from0) / windowMs)));
        const from = at(periodStart);
        const to = at(periodEnd);
        if (from >= 1) continue;
        const key = `${m.modelId}:${activity.id}:${mode}:${profile.growthIn}`;
        // Edges while it moves in: off by default for a growth over the task (they look messy on the cut).
        const edges = profile.growthEdges ?? mode !== 'grow';
        const spec = bySpec.get(key) ?? { key, modelId: m.modelId, localIds: [], mode, distance, color: colorOf.get(id) ?? null, opacity: opacityOf.get(id) ?? null, from, to, direction, edges };
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
  const legacyPlacement = useTagsStore((s) => s.placement);
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
      const nextToObjects = placementOf(tag, legacyPlacement) === 'objects';
      if (lines.length > 0 && !nextToObjects) items.push({ key: `${group.id}:${tag.id}`, color: group.color, lines, style: tagStyleOf(tag) });
      // Next-to-object callouts: one per task for a per-task template, else
      // one for the whole group at the middle of all its active objects.
      if (!nextToObjects) continue;
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
  }, [model, models, date, stepUnit, basis, groups, tags, legacyPlacement, groupResultsByModel, setActiveTags]);
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

  // No programme (or model) yet: Scenarios still works — it is how a
  // building's first programme gets generated.
  const needProgramme = <div style={{ padding: 12, color: 'var(--text-dim)' }}>Load both an IFC model and a P6 programme in Inputs to start 4D sequencing — or generate one from the Scenarios tab.</div>;
  const ready = !!model && models.length > 0;
  const dockPanels = (
    <>
      <DockPanel id="gantt" label="Gantt">
        {ready && model ? (
          <>
            {linkedActivityIds.size > 0 && (
              <div className="seq-linked" style={{ padding: '3px 10px', borderBottom: '1px solid var(--border)' }}>
                {linkedActivityIds.size} activit{linkedActivityIds.size === 1 ? 'y' : 'ies'} linked to selection
              </div>
            )}
            <DockGantt model={model} getColor={taskColorOf ?? undefined} selectedId={ganttSelectedId} highlightedIds={linkedActivityIds} scrollToId={focusActivityId} onSelect={(a) => setGanttSelectedId(a.id)} onOpen={(a) => void openActivity(a)} />
          </>
        ) : needProgramme}
      </DockPanel>
      <DockPanel id="tasks" label="Tasks">
        {ready && model && ganttColumnCtx ? (
          <TasksPanel model={model} catalog={ganttCatalog} columnCtx={ganttColumnCtx} selectedId={ganttSelectedId} getColor={taskColorOf ?? undefined} onSelect={(a) => setGanttSelectedId(a.id)} onOpen={(a) => void openActivity(a)} />
        ) : needProgramme}
      </DockPanel>
      <DockPanel id="resources" label="Resources">
        {ready && model ? <SequenceResources model={model} /> : needProgramme}
      </DockPanel>
      {experimental.scenarios && <DockPanel id="scenarios" label="Scenarios"><ScenarioTabContent onOpen={jumpToPourStart} /></DockPanel>}
      {experimental.bcf && <DockPanel id="topics" label={`Topics${topicCount ? ` (${topicCount})` : ''}`}><div className="tpc-pad" style={{ overflow: 'auto', flex: 1, minHeight: 0 }}><TopicsPanel /></div></DockPanel>}
      {experimental.scenarios && scenariosShowing && isSettingsOpen(settingsTarget, 'scenarios') && <ScenarioDock />}
      {tasksShowing && isSettingsOpen(settingsTarget, 'tasks') && ready && model && ganttColumnCtx && <TasksDock model={model} catalog={ganttCatalog} columnCtx={ganttColumnCtx} />}
    </>
  );

  if (!ready) {
    // The side pane's tabs that need no programme still show (a model alone, or nothing loaded).
    const emptyTabs = [
      { id: 'models', label: '3D & Related', icon: <IconCube /> },
      { id: 'properties', label: 'Properties', icon: <IconList /> },
      { id: 'tree', label: 'Selection Tree', icon: <IconTree /> },
      { id: 'search', label: 'Search sets', icon: <IconSearch /> },
      { id: 'datatable', label: 'Data table', icon: <IconViewTable /> },
    ] satisfies SidePaneTab<LinkTab>[];
    const emptyActive = emptyTabs.some((t) => t.id === linkTab) ? linkTab : 'models';
    return (
      <>
        {dockPanels}
        <SidePane timelineSettings tabs={emptyTabs} active={emptyActive} onSelect={setLinkTab} bodyClassName="config-panel__body model-config__body">
          {emptyActive === 'models' && <RelatedTab page="sequence" />}
          {emptyActive === 'tree' && <SelectionTreeTab />}
          {emptyActive === 'search' && <SearchSetsPanel />}
          {emptyActive === 'datatable' && <DataTablePanel />}
          {emptyActive === 'properties' && <PropertiesTab />}
        </SidePane>
      </>
    );
  }

  return (
    <>
      {dockPanels}

      <SidePane
        timelineSettings
        tabs={[
          { id: 'models', label: '3D & Related', icon: <IconCube /> },
          { id: 'properties', label: 'Properties', icon: <IconList /> },
          { id: 'tree', label: 'Selection Tree', icon: <IconTree /> },
          { id: 'search', label: 'Search sets', icon: <IconSearch /> },
          { id: 'datatable', label: 'Data table', icon: <IconViewTable /> },
          { id: 'view3d', label: 'Views', icon: <IconCamera /> },
          { id: 'groups', label: '4D', icon: <IconSchema /> },
        ] satisfies SidePaneTab<LinkTab>[]}
        active={linkTab}
        onSelect={setLinkTab}
        bodyClassName={(linkTab === 'view3d' && modelPanels) || linkTab === 'models' || linkTab === 'tree' || linkTab === 'search' || linkTab === 'datatable' || linkTab === 'properties' || linkTab === 'groups' ? 'config-panel__body model-config__body' : undefined}
      >
              {linkTab === 'groups' && (
                // Options (with Jump to date), Link Groups and Appearance Profiles, one collapsible section each.
                <div>
                  <CollapsibleSection title="Options" open={fourD.isOpen('options')} onToggle={() => fourD.toggle('options')}>
                    <div className="disp vsp seq-options">
                      <JumpToDate />
                      <SkipDays />
                      <ColorModeRow view="a" elements={allElements} label={split ? 'Color mode (left)' : 'Color mode'} />
                      {split && <ColorModeRow view="b" elements={allElements} label="Color mode (right)" />}
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
                      <div className="disp__row">
                        <span>Show unassigned objects</span>
                        <button type="button" role="switch" aria-checked={showUnassigned} className={`switch${showUnassigned ? ' on' : ''}`} onClick={() => setShowUnassigned((v) => !v)}>
                          <span className="switch__thumb" />
                        </button>
                      </div>
                      {showUnassigned && (
                        <div className="segmented-choice" style={{ marginTop: 4 }}>
                          <button className={unassignedMode === 'original' ? 'active' : ''} type="button" onClick={() => setUnassignedMode('original')}>Original colors</button>
                          <button className={unassignedMode === 'red' ? 'active' : ''} type="button" onClick={() => setUnassignedMode('red')}>Highlighted red</button>
                        </div>
                      )}
                    </div>
                  </CollapsibleSection>
                  <CollapsibleSection
                    title={`Link Groups (${groups.length})`}
                    open={fourD.isOpen('groups')}
                    onToggle={() => fourD.toggle('groups')}
                    flush
                    actions={
                      <>
                        <button type="button" className="mini-btn mini-btn--icon" onClick={() => exportLinkGroupMatches(model, allElements, groups)} title="Export matches (CSV): the matched task/object pairs and which fields matched them" aria-label="Export matches (CSV)">
                          <IconDownload width={16} height={16} />
                        </button>
                        <button type="button" className="mini-btn mini-btn--icon" onClick={() => { if (!fourD.isOpen('groups')) fourD.toggle('groups'); useLinkGroupsUiStore.getState().requestNew(); }} title="New group" aria-label="New group">
                          <IconAddCircleOutline width={20} height={20} />
                        </button>
                      </>
                    }
                  >
                    <LinkGroupsPanel model={model} elements={allElements} elementSets={models.map((m) => m.elements)} onPreview={previewGroup} />
                  </CollapsibleSection>
                  <CollapsibleSection
                    title={`Appearance Profiles (${appearanceProfiles.length})`}
                    open={fourD.isOpen('appearance')}
                    onToggle={() => fourD.toggle('appearance')}
                    flush
                    actions={
                      <>
                        <button type="button" className="mini-btn mini-btn--icon" onClick={refreshGraphics} title="Refresh graphics: apply appearance profiles to the 3D viewer" aria-label="Refresh graphics">
                          <IconSync width={16} height={16} />
                        </button>
                        <button type="button" className="mini-btn mini-btn--icon" onClick={() => { if (!fourD.isOpen('appearance')) fourD.toggle('appearance'); useAppearanceUiStore.getState().requestNew(); }} title="New profile" aria-label="New profile">
                          <IconAddCircleOutline width={20} height={20} />
                        </button>
                      </>
                    }
                  >
                    <AppearancePanel />
                  </CollapsibleSection>
                  {experimental.whyShown && <CollapsibleSection title="Why is it shown?" open={fourD.isOpen('why')} onToggle={() => fourD.toggle('why')} tip={<p>Select an object in the 3D view: this lists every task that links to it, which Link Group each comes from, where each stands at the current step, and which one controls the object (and so whether it is shown, hidden or recoloured).</p>}>
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
                  </CollapsibleSection>}
                  {experimental.taskFields && <CollapsibleSection title="Task fields from search sets" open={fourD.isOpen('taskField')} onToggle={() => fourD.toggle('taskField')}>
                    <TaskFieldFromSets results={groupResultsByModel} />
                  </CollapsibleSection>}
                  <LabelPanel />
                </div>
              )}
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
                  />
                );
                const extra = [
                  { label: 'Output', content: <MediaExport schedule={model} /> },
                  ...(experimental.navisworks ? [{ label: 'Navisworks TimeLiner', content: <NavisworksExport schedule={model} models={models} basis={basis} /> }] : []),
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
