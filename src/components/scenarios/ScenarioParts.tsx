import { InfoTip } from '../InfoTip';
import { ProgrammeDownload } from '../ProgrammeDownload';
import { ExpandCollapseToggle } from '../ExpandCollapseToggle';
import { FlagToggle } from './FlagToggle';
import { useFocusStore } from '../../state/focusStore';
import { useIgnoreTimelinerStore } from '../../state/ignoreTimelinerStore';
import { useColorModeStore } from '../../state/colorModeStore';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DockNavTools } from '../Dock';
import { useModelsStore } from '../../state/modelsStore';
import { useScheduleStore } from '../../state/scheduleStore';
import {
  applyRows,
  createScenario,
  deleteScenario,
  type StartFrom,
  download,
  isDirty,
  isTableCfgTab,
  loadGenerated,
  loadOrder,
  needsUpdate,
  pickScenario,
  orderOfScenario,
  pickStem,
  redoRows,
  refreshProject,
  saveOrder,
  scheduleAutoUpdate,
  setFlags,
  setRules,
  setSelected,
  stemsInInputs,
  takeOver,
  undoRows,
  updateFourD,
  useScenarioStem,
  warmUp,
  useScenarioStore,
  type ScenarioCfgTab,
} from '../../state/scenarioStore';
import { applySteps, moveDown, moveTo, moveToStep, moveUp, orderByPicks, reorderLike, separate, startTogether, unsequence } from '../../scenarios/pourOrder';
import { BASE_COL, rowColor, SHIFT_COL, STEP_COL } from '../../scenarios/tableView';
import { useScenarioView } from '../../scenarios/useScenarioView';
import { unjoinObjects } from '../../prs/joins';
import { totalRules } from '../../prs/rules';
import { DEFAULT_PRESETS, normalizePresets, type RulePreset } from '../../prs/presets';
import { ScenarioTableConfig, scnTabBadges } from './ScenarioTableConfig';
import { ScenarioRulesEditor } from './ScenarioRules';
import { IconArrowDown, IconArrowUp, IconColumns, IconFilter, IconGroup, IconPalette, IconRedo, IconReroute, IconSync, IconSplit, IconTune, IconUndo, IconUpload, IconChevronRight, IconExpandMore, IconCubeFocus, IconFlag, IconVideoCamera, IconVideoCameraSlash, IconDelete, IconRemove } from '../icons';
import { useProjectDbStore } from '../../state/projectDbStore';
import type { SidePaneTab } from '../SidePane';
import { AddModelToProject, ModelCheckCard } from './ScenarioModelCheck';
import { fetchDefaultRoot } from '../../scenarios/api';
import { useSearchSetsStore } from '../../state/searchSetsStore';
import { useViewerEngine } from '../../viewer/ViewerEngineContext';
import { STEPS_GROUP, stepGuids, stepSetsOf } from '../../viewer/importSteps';

/** The Reorder source that is not a folder: the project's baseline order. */
const BASELINE_SOURCE = '\u0001baseline';
/** Reorder from another scenario of the same model: the value is this prefix and the scenario's name. */
const SCENARIO_SOURCE = '\u0002scenario:';
import { usePersistedState } from '../../utils/persistedState';

/** Loads the project and the scenario's pour order from the store's
    choices. Mount it once wherever Scenarios is showing (the Scenarios tab,
    or 4D's Scenarios panel) — an order already loaded is kept. The app also mounts it once with `loadOnly` at start, so the scenario last
    used (scenarios.current) opens with its saved rules without a panel being open: it loads, but starts no generator and no auto-update. */
export function ScenarioSync({ loadOnly = false }: { loadOnly?: boolean }) {
  const root = useProjectDbStore((s) => s.root);
  const project = useScenarioStore((s) => s.project);
  const scenario = useScenarioStore((s) => s.scenario);
  const loaded = useScenarioStore((s) => s.loaded);
  const { scenarioNames } = useScenarioView();
  const stem = useScenarioStem();
  const modelsKey = project?.models.map((m) => m.stem).join('|') ?? '';

  useEffect(() => {
    void refreshProject(root);
  }, [root]);
  useEffect(() => {
    if (project && stem && scenario && !scenarioNames.includes(scenario)) useScenarioStore.setState({ scenario: null });
  }, [project, stem, scenario, scenarioNames]);
  // Keyed on the folder + model names only: refreshing the project after a
  // save/generate returns new objects but must not reload the order.
  useEffect(() => {
    void loadOrder(stem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.root, modelsKey, scenario, stem, loaded === null]);
  // Load the model into the long-running generator while the order is being
  // edited, so the first Update 4D is quick too.
  useEffect(() => {
    if (loaded && !loadOnly) warmUp();
  }, [loaded, loadOnly]);
  // Auto-update: regenerate a moment after each edit to the order.
  const stale = useScenarioStore((s) => isDirty(s) && needsUpdate(s));
  const autoUpdate = useScenarioStore((s) => s.autoUpdate);
  const rows = useScenarioStore((s) => s.rows);
  const relations = useScenarioStore((s) => s.relations);
  const crews = useScenarioStore((s) => s.crews);
  useEffect(() => {
    if (!loadOnly && autoUpdate && loaded && stale) scheduleAutoUpdate();
  }, [loadOnly, autoUpdate, loaded, stale, rows, relations, crews]);
  return null;
}

/** A group of the toolbar's icon buttons: in the 4D panel (`compact`) they go to the dock's navigation bar, under its tab icons. */
function ToolGroup({ compact, order, className, children }: { compact?: boolean; order: number; className: string; children: ReactNode }) {
  return compact ? <DockNavTools id="scenarios" order={order} className={className}>{children}</DockNavTools> : <div className={className}>{children}</div>;
}

/** Filter and the move / step / undo buttons. `compact`: smaller, wrapping
    onto more rows when narrow (4D panel). */
export function ScenarioToolbar({ compact }: { compact?: boolean }) {
  const rows = useScenarioStore((s) => s.rows);
  const selected = useScenarioStore((s) => s.selected);
  const filter = useScenarioStore((s) => s.filter);
  const undo = useScenarioStore((s) => s.undo);
  const redo = useScenarioStore((s) => s.redo);
  const busy = useScenarioStore((s) => s.busy);
  const dirty = useScenarioStore((s) => isDirty(s));
  const stale = useScenarioStore((s) => needsUpdate(s));
  const autoUpdate = useScenarioStore((s) => s.autoUpdate);
  const { loaded, modelInfo, reordered, view, scenario, scenarioNames } = useScenarioView();
  const collapsedGroups = useScenarioStore((s) => s.collapsedGroups);
  const flaggedOnly = useScenarioStore((s) => s.flaggedOnly);
  const groupKeys = view.flatMap((x) => (x.kind === 'group' ? [x.key] : []));
  const [stepInput, setStepInput] = useState('');
  const engine = useViewerEngine();
  const searchSets = useSearchSetsStore((s) => s.sets);
  const recordPicks = useScenarioStore((s) => s.recordPicks);
  const pickOrder = useScenarioStore((s) => s.pickOrder);
  const hasSelection = selected.size > 0;
  const ignoreTimeliner = useIgnoreTimelinerStore((s) => s.ignore);
  const setIgnoreTimeliner = useIgnoreTimelinerStore((s) => s.setIgnore);
  const patchColorMode = useColorModeStore((s) => s.patch);
  const focus = useFocusStore((s) => s.focus);
  const setFocus = useFocusStore((s) => s.setFocus);
  // The folder of sets that gives the order: Steps (imported) unless another is chosen, e.g. a folder of recorded selection sets.
  const [stepsFolder, setStepsFolder] = usePersistedState('scenarios.stepsFolder', STEPS_GROUP);
  const stepFolders = useMemo(() => [...new Set([STEPS_GROUP, ...(stepsFolder === BASELINE_SOURCE || stepsFolder.startsWith(SCENARIO_SOURCE) ? [] : [stepsFolder]), ...searchSets.map((s) => s.group).filter(Boolean)])].sort((a, b) => a.localeCompare(b)), [searchSets, stepsFolder]);
  const byBaseline = stepsFolder === BASELINE_SOURCE;
  const otherScenarios = scenarioNames.filter((n) => n !== scenario);
  const fromScenario = stepsFolder.startsWith(SCENARIO_SOURCE) ? stepsFolder.slice(SCENARIO_SOURCE.length) : null;
  const stepSets = useMemo(() => (byBaseline || stepsFolder.startsWith(SCENARIO_SOURCE) ? [] : stepSetsOf(searchSets, stepsFolder)), [searchSets, stepsFolder, byBaseline]);
  if (!loaded) return null;
  const updating = busy?.startsWith('Updating 4D') ?? false;
  return (
    <div className={compact ? 'scn-tools scn-tools--compact' : 'scn-tools'}>
      <div className="scn-tools__row scn-tools__row--small">
      {/* Docked beside the 3D view the table is searched with the main header's search box. */}
      {!compact && (
        <div className="scn-grp">
        <input className="scn-filter" type="search" value={filter} onChange={(e) => useScenarioStore.setState({ filter: e.target.value })} placeholder="Filter (any column)…" />
        </div>
      )}
      <div className="scn-grp scn-grp--span2">
      <form
        className="scn-row"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(stepInput);
          if (hasSelection && Number.isFinite(n) && n >= 1) applyRows(moveToStep(rows, selected, n));
        }}
      >
        <input className="scn-step-input" value={stepInput} onChange={(e) => setStepInput(e.target.value.replace(/\D/g, ''))} placeholder="Step" />
        <button className="btn scn-icon-btn" type="submit" disabled={!hasSelection || !stepInput} title="Move the selection to this step (Enter)" aria-label="Move to step"><IconReroute width={16} height={16} /></button>
      </form>
      <select className="scn-step-folder" value={stepsFolder} onChange={(e) => setStepsFolder(e.target.value)} title="What Reorder follows: the project's baseline order, the order of another scenario of this model, or a Search sets folder (its search or selection sets, numbered 1, 2, 3…, are the steps)" aria-label="Order source">
        <option value={BASELINE_SOURCE}>Baseline</option>
        {otherScenarios.length > 0 && (
          <optgroup label="Another scenario">
            {otherScenarios.map((n) => <option key={n} value={SCENARIO_SOURCE + n}>{n}</option>)}
          </optgroup>
        )}
        <optgroup label="Search sets">
          {stepFolders.map((f) => <option key={f} value={f}>{f}</option>)}
        </optgroup>
      </select>
      <button
        className="btn"
        disabled={!byBaseline && fromScenario === null && stepSets.length === 0}
        onClick={() => {
          if (fromScenario !== null) {
            void orderOfScenario(fromScenario).then((order) => {
              if (typeof order === 'string') {
                useScenarioStore.setState({ message: { kind: 'warn', text: order } });
              } else if (window.confirm(`Put the items in the order of “${fromScenario}”? Its ${order.count} sequenced items keep its steps (items in a step start together); the others leave the sequence. Undo (Ctrl+Z) takes it back.`)) {
                applyRows(reorderLike(useScenarioStore.getState().rows, order.steps));
              }
            });
            return;
          }
          if (byBaseline) {
            applyRows(reorderLike(rows, loaded.baseStep));
            return;
          }
          if (window.confirm(`Order the items by the ${stepSets.length} sets of “${stepsFolder}” (Models › Search sets)? Items in a step start together; items in no step leave the sequence.`)) {
            applyRows(applySteps(rows, stepSets.map((s) => stepGuids(engine.getIndexes(), s))));
          }
        }}
        title={fromScenario !== null
          ? `Follow the order of the scenario “${fromScenario}”: its steps, item by item`
          : byBaseline
          ? 'Reset to baseline: put every item back in the project\'s baseline order'
          : stepSets.length
            ? `Follow the sets of “${stepsFolder}”: the items of each step start together, in step order (by the number each name starts with)`
            : `No sets in “${stepsFolder}”: choose another source, or import steps in Models › Search sets`}
      >
        Reorder
      </button>
      </div>
      <ToolGroup compact={compact} order={5} className="scn-grp scn-grp--icons">
      <button className="btn scn-icon-btn" disabled={!hasSelection} onClick={() => applyRows(moveUp(rows, selected))} title="Move up one step (Alt+↑)" aria-label="Move up one step"><IconArrowUp width={16} height={16} /></button>
      <button className="btn scn-icon-btn" disabled={!hasSelection} onClick={() => applyRows(moveDown(rows, selected))} title="Move down one step (Alt+↓)" aria-label="Move down one step"><IconArrowDown width={16} height={16} /></button>
      <button className="btn scn-icon-btn" disabled={!undo.length} onClick={undoRows} title="Undo (Ctrl+Z)" aria-label="Undo"><IconUndo width={16} height={16} /></button>
      <button className="btn scn-icon-btn" disabled={!redo.length} onClick={redoRows} title="Redo (Ctrl+Y)" aria-label="Redo"><IconRedo width={16} height={16} /></button>
      <button className="btn scn-icon-btn" disabled={!hasSelection} onClick={() => applyRows(unsequence(rows, selected))} title="Remove from sequence: blank the Index so the generator orders these items by its automatic rules" aria-label="Remove from sequence"><IconDelete /></button>
      <button
        className={`btn scn-icon-btn${flaggedOnly ? ' primary' : ''}`}
        aria-pressed={flaggedOnly}
        onClick={() => useScenarioStore.setState({ flaggedOnly: !flaggedOnly })}
        title={flaggedOnly ? 'Showing only the flagged pours and groups (click to show all)' : 'Show only the flagged pours and groups'}
        aria-label="Flagged only"
      >
        <IconFlag width={16} height={16} />
      </button>
      <ExpandCollapseToggle
        className="btn scn-icon-btn"
        disabled={!groupKeys.length}
        collapsed={groupKeys.length > 0 && groupKeys.every((k) => collapsedGroups.has(k))}
        onCollapse={() => useScenarioStore.setState({ collapsedGroups: new Set(groupKeys) })}
        onExpand={() => useScenarioStore.setState({ collapsedGroups: new Set() })}
      />
      </ToolGroup>
        <span style={{ marginLeft: 'auto' }}>
          <InfoTip>
            {reordered
              ? 'Sorted / grouped view (Configuration): drag is off; the move buttons still work on the order. Clear Sort and Group to drag again.'
              : 'Select with click / Ctrl / Shift, then drag or use the buttons (Alt+↑/↓, Alt+S / Alt+F for SS / FS, Ctrl+Z/Y). Same step = start together.'}{' '}
            Pours in one step start together; each step waits for the previous one to finish. Dropping inside a bracketed step joins it. Highlighted Base cells moved against the baseline.
          </InfoTip>
        </span>
      </div>
      <div className="scn-tools__row">
      <ToolGroup compact={compact} order={4} className="scn-grp scn-grp--fill">
      <button className="btn scn-link-btn" disabled={selected.size < 2} onClick={() => applyRows(startTogether(rows, selected))} title="Make the selected items one step: they start together (Start-to-Start) (Alt+S)">SS</button>
      <button className="btn scn-link-btn" disabled={!hasSelection} onClick={() => applyRows(separate(rows, selected))} title="Give each selected item its own step, one after another (Finish-to-Start) (Alt+F)">FS</button>
      </ToolGroup>
      <div className="scn-grp scn-grp--span2">
      <button className={`btn${recordPicks ? ' primary' : ''}`} aria-pressed={recordPicks} onClick={() => useScenarioStore.setState({ recordPicks: !recordPicks })} title="Record the order objects are picked in the 3D view, one at a time">
        {recordPicks ? `Recording (${pickOrder.length})` : 'Record picks'}
      </button>
      <button className="btn" disabled={pickOrder.length === 0} onClick={() => {
          applyRows(orderByPicks(rows, pickOrder));
          useScenarioStore.setState({ pickOrder: [] });
        }} title="Put the picked items first, one step each, in the order they were picked">Sort by picks</button>
      <button className="btn" disabled={pickOrder.length === 0} onClick={() => useScenarioStore.setState({ pickOrder: [] })} title="Forget the recorded picks">Clear picks</button>
      </div>
      <ToolGroup compact={compact} order={3} className="scn-grp scn-grp--icons scn-grp--icons-2">
      <button
        className={`btn scn-icon-btn scn-ignore-btn${focus ? ' primary' : ''}`}
        aria-pressed={focus}
        disabled={!hasSelection && !focus}
        onClick={() => setFocus(!focus)}
        title={focus ? 'Focus on: the selection is isolated and pinned (click to release)' : hasSelection ? 'Focus: isolate and pin the selected items, no ghost' : 'Focus: select rows in the table first'}
        aria-label="Focus"
      >
        <IconCubeFocus width={18} height={18} />
      </button>
      <button
        className={`btn scn-icon-btn scn-ignore-btn${ignoreTimeliner ? '' : ' primary'}`}
        aria-pressed={!ignoreTimeliner}
        onClick={() => {
          const on = !ignoreTimeliner;
          setIgnoreTimeliner(on);
          // Appearance profiles are ignored when the views' Color mode is Original colours.
          for (const v of ['a', 'b'] as const) {
            const cur = useColorModeStore.getState()[v].mode;
            if (on) patchColorMode(v, { mode: 'original' });
            else if (cur === 'original') patchColorMode(v, { mode: 'appearance' });
          }
        }}
        title={ignoreTimeliner ? 'Timeliner ignored' : 'Timeliner active'}
        aria-label={ignoreTimeliner ? 'Timeliner ignored' : 'Timeliner active'}
      >
        {ignoreTimeliner ? <IconVideoCameraSlash width={18} height={18} /> : <IconVideoCamera width={18} height={18} />}
      </button>
      <button
        className={`btn scn-icon-btn scn-ignore-btn${autoUpdate ? ' primary' : ''}`}
        aria-pressed={autoUpdate}
        onClick={() => useScenarioStore.setState({ autoUpdate: !autoUpdate })}
        title={autoUpdate ? 'Auto-update on: 4D follows each change' : 'Auto-update off: use Update 4D'}
        aria-label="Auto-update 4D"
      >
        <IconSync width={18} height={18} />
      </button>
      </ToolGroup>
      <div className="scn-grp">
      {/* Like "unsaved": only there while the order, links or crews changed since 4D was last updated (or an update is running); never with auto-update on. */}
      {!autoUpdate && (stale || updating) && (
        <button
          className={`btn primary scn-sync${updating ? ' is-busy' : ''}`}
          disabled={!!busy || !modelInfo?.hasSource}
          onClick={() => void updateFourD()}
          title="Update 4D: regenerate the programme for this order (about a second) and play it in 4D. Does not save the order."
        >
          <span className="scn-sync__icon" aria-hidden="true">⟳</span> Update 4D
        </button>
      )}
      {dirty && (
        <button type="button" className="scn-unsaved" disabled={!!busy} onClick={() => void saveOrder()} title="Unsaved changes to the order, links or crews: click to save them to the project database">
          unsaved
        </button>
      )}
      </div>
      </div>
    </div>
  );
}

/** The pour order table: select (click / Ctrl / Shift), drag to reorder,
    keyboard moves. `onPick`: a row click (4D selects those pours in 3D);
    `onOpen`: a double-click on a row (4D jumps to that pour's start date). */
export function ScenarioTable({ onPick, onOpen }: { onPick?: (keys: Set<string>) => void; onOpen?: (key: string) => void }) {
  const focusColours = useFocusStore((s) => s.colours);
  const flags = useScenarioStore((s) => s.flags);
  const rows = useScenarioStore((s) => s.rows);
  const selected = useScenarioStore((s) => s.selected);
  const collapsedGroups = useScenarioStore((s) => s.collapsedGroups);
  const v = useScenarioView();
  const { loaded, shownColumns, fields, view, viewKeys, reordered, moved, steps, shiftOf, valueOf, tableCfg, unsequencedCount, firstUnsequencedKey, subRows } = v;
  const anchorRef = useRef<string | null>(null);
  /** The row the arrow keys moved to last (the end of a Shift range). */
  const cursorRef = useRef<string | null>(null);
  const [drop, setDrop] = useState<{ key: string; after: boolean } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Rows selected from elsewhere (the 3D view) scroll into sight.
  useEffect(() => {
    const first = [...selected][0];
    if (!first) return;
    const tr = wrapRef.current?.querySelector(`tr[data-key="${CSS.escape(first)}"]`);
    if (tr && !(tr as HTMLElement).matches(':hover')) tr.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  if (!loaded) return null;
  const pick = (next: Set<string>) => {
    setSelected(next);
    onPick?.(next);
  };

  const onRowClick = (e: React.MouseEvent, key: string) => {
    if (e.shiftKey && anchorRef.current) {
      const a = viewKeys.indexOf(anchorRef.current);
      const b = viewKeys.indexOf(key);
      if (a >= 0 && b >= 0) {
        const range = viewKeys.slice(Math.min(a, b), Math.max(a, b) + 1);
        pick(new Set(e.ctrlKey || e.metaKey ? [...selected, ...range] : range));
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(selected);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      pick(next);
    } else pick(new Set([key]));
    anchorRef.current = key;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redoRows();
      else undoRows();
    } else if ((e.ctrlKey || e.metaKey) && k === 'y') {
      e.preventDefault();
      redoRows();
    } else if ((e.ctrlKey || e.metaKey) && k === 'a') {
      e.preventDefault();
      pick(new Set(viewKeys));
    } else if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      applyRows(moveUp(rows, selected));
    } else if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      applyRows(moveDown(rows, selected));
    } else if (!e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && viewKeys.length) {
      // Next / previous row (Shift extends the selection from where it started).
      e.preventDefault();
      const dir = e.key === 'ArrowDown' ? 1 : -1;
      const cursor = cursorRef.current && viewKeys.includes(cursorRef.current) ? cursorRef.current : [...selected].pop();
      const at = cursor ? viewKeys.indexOf(cursor) : -1;
      const to = viewKeys[Math.min(viewKeys.length - 1, Math.max(0, at < 0 ? (dir === 1 ? 0 : viewKeys.length - 1) : at + dir))];
      cursorRef.current = to;
      if (e.shiftKey) {
        const from = viewKeys.indexOf(anchorRef.current && viewKeys.includes(anchorRef.current) ? anchorRef.current : to);
        const [lo, hi] = [Math.min(from, viewKeys.indexOf(to)), Math.max(from, viewKeys.indexOf(to))];
        pick(new Set(viewKeys.slice(lo, hi + 1)));
      } else {
        anchorRef.current = to;
        pick(new Set([to]));
      }
      wrapRef.current?.querySelector(`tr[data-key="${CSS.escape(to)}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.altKey && !e.ctrlKey && !e.metaKey && k === 's') {
      e.preventDefault();
      if (selected.size >= 2) applyRows(startTogether(rows, selected));
    } else if (e.altKey && !e.ctrlKey && !e.metaKey && k === 'f') {
      e.preventDefault();
      if (selected.size) applyRows(separate(rows, selected));
    }
  };

  const onDrop = () => {
    if (!drop || selected.has(drop.key)) return setDrop(null);
    let beforeKey: string | null = drop.key;
    if (drop.after) {
      const i = rows.findIndex((r) => r.key === drop.key);
      beforeKey = rows.slice(i + 1).find((r) => !selected.has(r.key))?.key ?? null;
    }
    applyRows(moveTo(rows, selected, beforeKey));
    setDrop(null);
  };

  const toggleGroup = (key: string) => {
    const next = new Set(collapsedGroups);
    if (!next.delete(key)) next.add(key);
    useScenarioStore.setState({ collapsedGroups: next });
  };

  return (
    <>
      <div className="scn-table-wrap" tabIndex={0} onKeyDown={onKeyDown} ref={wrapRef}>
        <table className="scn-table">
          <thead>
            <tr>
              <th className="scn-flagcol" title="Review flags" aria-label="Flag" />
              {shownColumns.map((id) => (
                <th
                  key={id}
                  className={id.startsWith('#') ? 'scn-num' : undefined}
                  title={id === STEP_COL ? 'Step (the Index written to SequenceOrder). Items sharing a step start together.' : id === BASE_COL ? "Step in the project's baseline SequenceOrder" : id === SHIFT_COL ? 'Steps moved against the baseline (- earlier, + later)' : undefined}
                >
                  {fields.find((f) => f.id === id)?.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody onDragLeave={() => setDrop(null)}>
            {view.map((it) => {
              if (it.kind === 'group') {
                return (
                  <tr key={it.key} className="scn-grouprow">
                    <td colSpan={shownColumns.length + 1} style={{ paddingLeft: 8 + it.depth * 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                        <button type="button" className="scn-grouprow__toggle" onClick={() => toggleGroup(it.key)}>{it.collapsed ? <IconChevronRight width={14} height={14} /> : <IconExpandMore width={14} height={14} />}</button>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tableCfg.groups.length > 1 && <span className="scn-grouprow__field">{fields.find((f) => f.id === it.field)?.label}: </span>}
                          {it.label}
                          <span className="scn-grouprow__count">{it.count}</span>
                        </span>
                        {(() => {
                          const keys = it.items.map((x) => x.r.key);
                          const allIn = keys.length > 0 && keys.every((k) => selected.has(k));
                          const max = it.items.reduce((m, x) => Math.max(m, steps[x.i] ?? 0), 0);
                          // Pinned to the visible right edge, however the table is scrolled.
                          return (
                            <span style={{ position: 'sticky', right: 8, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 8, background: 'var(--bg-panel)' }}>
                              <FlagToggle state={flags[it.key]} what="this group" onChange={(s) => setFlags([it.key], s)} />
                              {max > 0 && <span className="mdt__group-count" title={`Max step: the group's last step is ${max}`}>{max}</span>}
                              <button
                                type="button"
                                className={`mdt__mini${allIn ? ' is-on' : ''}`}
                                style={{ minWidth: 62 }}
                                onClick={() => pick(allIn ? new Set([...selected].filter((k) => !keys.includes(k))) : new Set([...selected, ...keys]))}
                                title={allIn ? 'Deselect this group' : `Select the ${keys.length.toLocaleString()} pours in this group (added to the selection)`}
                              >
                                {allIn ? 'Deselect' : 'Select'}
                              </button>
                            </span>
                          );
                        })()}
                      </div>
                    </td>
                  </tr>
                );
              }
              const { r, i } = it.item;
              const base = loaded.baseStep.get(r.key) ?? 0;
              const shift = shiftOf(r, i);
              const focusColour = focusColours.get(r.key);
              const color = focusColour ? `${focusColour}66` : rowColor(it.item, tableCfg.colors, valueOf);
              const groupedPrev = r.step !== null && i > 0 && rows[i - 1].step === r.step;
              const groupedNext = r.step !== null && i < rows.length - 1 && rows[i + 1].step === r.step;
              const cls = [
                'scn-tr',
                selected.has(r.key) ? 'is-selected' : '',
                moved.has(r.key) ? 'is-moved' : '',
                r.step === null ? 'is-unsequenced' : '',
                groupedPrev || groupedNext ? 'is-grouped' : '',
                groupedPrev ? '' : 'is-step-start',
                drop?.key === r.key ? (drop.after ? 'drop-after' : 'drop-before') : '',
              ].join(' ');
              const zoneHeader = !reordered && r.key === firstUnsequencedKey && (
                <tr
                  key="__zone"
                  className={`scn-zone${drop?.key === '__zone' ? ' drop-before' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (drop?.key !== '__zone') setDrop({ key: '__zone', after: false });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    applyRows(unsequence(rows, selected));
                    setDrop(null);
                  }}
                >
                  <td colSpan={shownColumns.length + 1}>
                    Not in sequence ({unsequencedCount}) — blank Index; the generator orders these by its automatic rules. Drop pours here to remove them from the sequence.
                  </td>
                </tr>
              );
              return [
                zoneHeader,
                <tr
                  key={r.key}
                  data-key={r.key}
                  className={cls}
                  style={color ? { background: color } : undefined}
                  draggable={!reordered}
                  onClick={(e) => onRowClick(e, r.key)}
                  onDoubleClick={() => onOpen?.(r.key)}
                  onDragStart={(e) => {
                    if (!selected.has(r.key)) pick(new Set([r.key]));
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', r.key);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const after = e.clientY > rect.top + rect.height / 2;
                    if (drop?.key !== r.key || drop.after !== after) setDrop({ key: r.key, after });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    onDrop();
                  }}
                  onDragEnd={() => setDrop(null)}
                >
                  <td className="scn-flagcol">
                    <FlagToggle
                      state={flags[r.key]}
                      what={selected.has(r.key) && selected.size > 1 ? `the ${selected.size} selected pours` : 'this pour'}
                      onChange={(s) => setFlags(selected.has(r.key) ? [...selected] : [r.key], s)}
                    />
                  </td>
                  {shownColumns.map((id) => {
                    if (id === STEP_COL) return <td key={id} className="scn-num scn-step">{r.step === null ? '—' : groupedPrev && !reordered ? '' : steps[i]}</td>;
                    if (id === BASE_COL)
                      return (
                        <td key={id} className="scn-num scn-dim scn-base">
                          {base || '—'}
                          {shift ? <span className={shift < 0 ? 'scn-up' : 'scn-down'}>{shift < 0 ? ` ▲${-shift}` : ` ▼${shift}`}</span> : null}
                        </td>
                      );
                    if (id === SHIFT_COL) return <td key={id} className="scn-num">{shift ? (shift > 0 ? `+${shift}` : shift) : ''}</td>;
                    return <td key={id}>{valueOf(it.item, id)}</td>;
                  })}
                </tr>,
                ...(subRows.get(r.key) ?? []).map((sub) => (
                  <tr
                    key={sub.r.key}
                    data-key={sub.r.key}
                    className={`scn-tr scn-subrow${selected.has(sub.r.key) ? ' is-selected' : ''}`}
                    onClick={(e) => onRowClick(e, sub.r.key)}
                    onDoubleClick={() => onOpen?.(sub.r.key)}
                  >
                    <td className="scn-flagcol">
                      <button
                        type="button"
                        className="scn-subrow__split"
                        title="Split this object from its main object (it gets its own activities again)"
                        aria-label="Split from the main object"
                        onClick={(e) => { e.stopPropagation(); setRules(unjoinObjects(useScenarioStore.getState().rules, [sub.r.key.split('#')[0]])); }}
                      >
                        ×
                      </button>
                    </td>
                    {shownColumns.map((id, n) => {
                      if (id === STEP_COL) return <td key={id} className="scn-num scn-step scn-subrow__tag" title="Joined: one activity with its main object above">↳ joined</td>;
                      if (id === BASE_COL || id === SHIFT_COL) return <td key={id} className="scn-num" />;
                      return <td key={id} className={n === 0 ? 'scn-subrow__first' : undefined}>{valueOf(sub, id)}</td>;
                    })}
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** What the main area shows instead of the table while nothing is ready. */
export function ScenarioNotice() {
  const { stem, project, scenario, modelInfo, ready } = useScenarioView();
  const log = useScenarioStore((s) => s.log);
  const showLog = useScenarioStore((s) => s.showLog);
  if (!stem) return <div className="scn-empty">Load the building's IFC in Inputs first — scenarios reorder the elements of that model.</div>;
  if (!project) return <NoProject stem={stem} />;
  if (!modelInfo) return <AddModelToProject root={project.root} stem={stem} />;
  if (!scenario) return <div className="scn-empty">Create or pick a scenario in the Scenario panel.</div>;
  return (
    <>
      {showLog && log && <pre className="scn-log">{log}</pre>}
      {modelInfo && !modelInfo.cached && (
        <div className="scn-status scn-status--warn">
          No enriched IFC / geometry cache for this building yet, so preparing its pour list runs class fixing and clash detection once (several minutes). After that, updates take about a second.
        </div>
      )}
      {!ready && null}
    </>
  );
}

/** No project folder yet: pick one in Inputs > Project database, or work in the
    default one (Documents\Insight Plan\Default project). */
function NoProject({ stem }: { stem: string }) {
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setError(null);
    try {
      useProjectDbStore.setState({ root: await fetchDefaultRoot() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="scn-addmodel">
      <section className="scn-card">
        <div className="scn-card__title">Generate a programme from this model</div>
        <p className="scn-dim scn-editor__help">
          Scenarios works in a project folder: the models it schedules, their scenarios and the project database. Pick your project's folder in Inputs › Project database (each scene keeps its own), or start in a default one (Documents\Insight Plan\Default project) — the model loaded in Inputs is added to it in the next step.
        </p>
        <div className="scn-row">
          <button type="button" className="btn primary" onClick={() => void start()}>Start without a project folder</button>
          {error && <span className="scn-error">{error}</span>}
        </div>
      </section>
      <ModelCheckCard stem={stem} />
    </div>
  );
}

/** The Scenario panel's tabs. `withRules` = false where Rules is a dock panel of its own (4D Sequencing). */
export function useScenarioTabs(withRules = true): SidePaneTab<ScenarioCfgTab>[] {
  const { ready, tableCfg, fields } = useScenarioView();
  const relations = useScenarioStore((s) => s.relations);
  const crews = useScenarioStore((s) => s.crews);
  const extras = useScenarioStore((s) => s.extras);
  const badges = scnTabBadges(tableCfg, fields);
  const all: SidePaneTab<ScenarioCfgTab>[] = [
    { id: 'scenario', label: 'Scenario', icon: <IconSplit /> },
    { id: 'rules', label: 'Rules: extra activities, links and crews', icon: <IconTune />, badge: relations.length + crews.length + extras.length || undefined },
    { id: 'columns', label: 'Columns', icon: <IconColumns /> },
    { id: 'filters', label: 'Filters', icon: <IconFilter />, badge: badges.filters },
    { id: 'group', label: 'Group', icon: <IconGroup />, badge: badges.group },
    { id: 'color', label: 'Color', icon: <IconPalette />, badge: badges.color },
  ];
  return ready ? all.filter((t) => withRules || t.id !== 'rules') : all.slice(0, 1);
}

/** The side panel's content for a tab: the scenario card (project folder,
    building, start date, Save / Generate / Load / Download, scenario list,
    new scenario), the manual links or crews, or one of the table
    configuration tabs. */
export function ScenarioPanelBody({ tab }: { tab: ScenarioCfgTab }) {
  const v = useScenarioView();
  const { ready, project, scenario, stem, scenarioNames, modelInfo, generatedAt, loaded, view, tableCfg, fields, allColumnIds } = v;
  // Saved scenarios of this building: what a new scenario can copy.
  const savedForStem = (project?.scenarios ?? []).filter((sc) => sc.models.some((m) => m.stem === stem)).map((sc) => sc.name);
  const startDate = useScenarioStore((s) => s.startDate);
  const projectError = useScenarioStore((s) => s.projectError);
  const busy = useScenarioStore((s) => s.busy);
  const dirty = useScenarioStore((s) => isDirty(s));
  const autoUpdate = useScenarioStore((s) => s.autoUpdate);
  const autoSave = useScenarioStore((s) => s.autoSave);
  const inputModels = useModelsStore((s) => s.models);
  const inputStems = stemsInInputs(inputModels);
  const [newName, setNewName] = useState('');
  const [newFrom, setNewFrom] = useState<StartFrom>('base');
  // The rules a new scenario starts with: those of the order it is made from, none, or a preset's (kept in the project, see the Rules tab).
  const [newRules, setNewRules] = useState<string>('source');
  const [presets] = usePersistedState<RulePreset[]>('sequence.rulePresets', DEFAULT_PRESETS, undefined, normalizePresets);
  const liveRules = useScenarioStore((s) => s.rules);
  const rulesSaved = useScenarioStore((s) => s.rules === s.savedRules);
  const loadedSchedules = useScheduleStore((s) => s.schedules);
  const [createError, setCreateError] = useState<string | null>(null);

  if (ready && tab === 'rules') return <ScenarioRulesEditor />;
  if (ready && isTableCfgTab(tab)) {
    return (
      <ScenarioTableConfig
        tab={tab}
        cfg={tableCfg}
        onChange={(next) => useScenarioStore.setState({ tableCfg: next })}
        fields={fields}
        defaultColumns={allColumnIds}
        onCollapseAll={() => useScenarioStore.setState({ collapsedGroups: new Set(view.flatMap((x) => (x.kind === 'group' ? [x.key] : []))) })}
        onExpandAll={() => useScenarioStore.setState({ collapsedGroups: new Set() })}
      />
    );
  }

  return (
    <>
      {projectError && <div className="scn-error">{projectError}</div>}

      {scenario && (
        <section className="scn-card">
          <div className="scn-card__title">Current scenario from input:</div>
          <label className="scn-field" title="The building (from Inputs) this scenario is for">
            {inputStems.length > 1 ? (
              <select value={stem ?? ''} onChange={(e) => pickStem(e.target.value)} aria-label="Building (from Inputs)">
                {inputStems.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <strong className="scn-building">{stem}</strong>
            )}
          </label>
          <div className="scn-compact-row scn-compact-row--one">
          <label className="scn-inline scn-inline--head" title="Project start / data date for the CPM. Keep it the same across scenarios you want to compare. Blank = the day you generate.">
            <span>Start</span>
            <input type="date" value={startDate} onChange={(e) => useScenarioStore.setState({ startDate: e.target.value })} />
          </label>
            <button
              className="btn primary scn-update"
              disabled={!ready || !!busy || (modelInfo ? !modelInfo.hasSource : true)}
              onClick={() => void updateFourD()}
              title="Regenerate the programme for the order on screen (about a second) and play it in 4D straight away — no download or Inputs step needed. Does not save the order."
            >
              Update 4D
            </button>
            <button
              type="button"
              className={`btn scn-icon-btn${autoUpdate ? ' primary' : ''}`}
              aria-pressed={autoUpdate}
              onClick={() => useScenarioStore.setState({ autoUpdate: !autoUpdate })}
              title={autoUpdate ? 'Auto-update on: 4D follows each change to the order' : 'Auto-update off: use Update 4D'}
              aria-label="Auto-update 4D"
            >
              <IconSync width={16} height={16} />
            </button>
            <button className="btn" disabled={!ready || !!busy || !dirty} onClick={() => void saveOrder()} title="Save the order, joined objects, manual links, crews and rules to the project database">Save</button>
            <button
              type="button"
              className={`btn scn-autosave${autoSave ? ' primary' : ''}`}
              aria-pressed={autoSave}
              onClick={() => useScenarioStore.setState({ autoSave: !autoSave })}
              title={autoSave ? 'Autosave on: a saved scenario saves itself a moment after each change (a new scenario needs its first Save)' : 'Autosave off: use Save'}
            >
              Auto
            </button>
            <button className="btn scn-icon-btn" disabled={!ready || !!busy || !generatedAt} onClick={() => void loadGenerated()} title="Load the last generated XML into Inputs without regenerating" aria-label="Load last generated">
              <IconUpload width={16} height={16} />
            </button>
            <ProgrammeDownload canXml disabled={!ready || !!busy || !generatedAt} onDownload={(f) => void download(f)} />
            <button
              className="btn"
              disabled={!ready || !!busy || !project || (modelInfo ? !modelInfo.hasSource : true)}
              onClick={() => {
                if (window.confirm(`Take over the programme of "${scenario}" to edit by hand?\n\nIt is copied as it is now to an editable programme. The scenario keeps generating its own programme; the copy is not changed by it.`)) void takeOver();
              }}
              title="Switch from the scenario to editing by hand: copies the generated programme to an editable one (add, change and link activities, export as XER). The scenario itself is left as it is."
            >
              Take over
            </button>
          </div>
        </section>
      )}

      {project && (
        <section className="scn-card scn-card--grow">
          <div className="scn-list__head" aria-hidden="true"><span>Scenario</span><span>Rules</span><span>Status</span><span /></div>
          <div className="scn-list">
            {scenarioNames.length === 0 && <div className="scn-dim">No scenarios yet — create one below.</div>}
            {scenarioNames.map((name) => {
              const info = project.scenarios.find((s) => s.name === name);
              const m = info?.models.find((x) => x.stem === stem);
              return (
                <div key={name} className={`scn-list__item${name === scenario ? ' active' : ''}`}>
                  <button type="button" className="scn-list__pick" onClick={() => pickScenario(name)}>
                    <span className="scn-list__name">{name}</span>
                    {(() => {
                      // The open scenario shows its rules as they are on screen (a * when not saved yet), the others as saved.
                      const open = name === scenario && ready;
                      const rules = open ? totalRules(liveRules) : m?.rules ?? 0;
                      const joins = open ? (liveRules.joins ?? []).length : m?.joins ?? 0;
                      const unsaved = open && !rulesSaved;
                      return (
                        <span className="scn-list__rules" title={rules ? `${rules} rule${rules === 1 ? '' : 's'}${joins ? `, ${joins} join${joins === 1 ? '' : 's'}` : ''} — saved with the scenario${unsaved ? ' (changes not saved yet: Save)' : ''}` : "No rules: the generator's own logic"}>
                          {rules ? `${rules}${joins ? ` · ${joins}⋈` : ''}${unsaved ? '*' : ''}` : unsaved ? '*' : '—'}
                        </span>
                      );
                    })()}
                    <span className="scn-list__meta">
                      {!m ? <span className="scn-chip">unsaved</span> : m.generated ? <span className="scn-chip scn-chip--ok" title={`Generated ${new Date(m.generated).toLocaleString()}`}>{new Date(m.generated).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span> : <span className="scn-chip">saved, not generated</span>}
                    </span>
                  </button>
                  <button type="button" className="scn-list__delete" disabled={!!busy} title={`Delete the scenario "${name}"`} aria-label={`Delete the scenario ${name}`} onClick={() => void deleteScenario(name)}>
                    <IconRemove />
                  </button>
                </div>
              );
            })}
          </div>
          <form
            className="scn-new"
            onSubmit={(e) => {
              e.preventDefault();
              const preset = newRules.startsWith('preset:') ? presets.find((x) => x.id === newRules.slice(7)) : undefined;
              void createScenario(newName, newFrom, newRules === 'none' ? 'none' : preset ? { preset: preset.content } : 'source').then((err) => {
                setCreateError(err);
                if (!err) setNewName('');
              });
            }}
          >
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New scenario name" />
            <div className="scn-row">
              <select value={newFrom} onChange={(e) => setNewFrom(e.target.value as StartFrom)} disabled={!!busy}>
                <option value="base">Start from the baseline order</option>
                <option value="current" disabled={!loaded}>Copy the order on screen</option>
                {savedForStem.length > 0 && (
                  <optgroup label="Copy a saved scenario (order, links, crews)">
                    {savedForStem.map((n) => <option key={n} value={`saved:${n}`}>{n}</option>)}
                  </optgroup>
                )}
                {loadedSchedules.length > 0 && (
                  <optgroup label="Order by a loaded programme's start dates">
                    {loadedSchedules.map((s) => <option key={s.id} value={`programme:${s.id}`}>{s.project.name || s.sourceFileName}</option>)}
                  </optgroup>
                )}
              </select>
              <button className="btn primary" type="submit" disabled={!newName.trim()}>Create</button>
            </div>
            <select value={newRules} onChange={(e) => setNewRules(e.target.value)} disabled={!!busy} aria-label="Rules of the new scenario" title="The rules the new scenario starts with. They are saved with the scenario (Save), and each scenario keeps its own.">
              <option value="source">Rules: as the order it starts from</option>
              <option value="none">Rules: none (the generator's own logic)</option>
              {presets.length > 0 && (
                <optgroup label="Rules: start from a preset">
                  {presets.map((x) => <option key={x.id} value={`preset:${x.id}`}>{x.name}</option>)}
                </optgroup>
              )}
            </select>
            {createError && <div className="scn-error">{createError}</div>}
          </form>
        </section>
      )}

      {stem && <ModelCheckCard stem={stem} compact />}
    </>
  );
}

/** Busy / result message, log toggle and the order's counts. */
export function ScenarioStatus({ className, extra }: { className?: string; extra?: ReactNode }) {
  const busy = useScenarioStore((s) => s.busy);
  const message = useScenarioStore((s) => s.message);
  const log = useScenarioStore((s) => s.log);
  const showLog = useScenarioStore((s) => s.showLog);
  const selected = useScenarioStore((s) => s.selected);
  const { ready, rows, stepCount, unsequencedCount, moved } = useScenarioView();
  return (
    <footer className={className ?? 'app-statusbar scn-statusbar'}>
      <span className={`scn-statusbar__msg${message && !busy ? ` scn-statusbar__msg--${message.kind}` : ''}`} title={busy ?? message?.text ?? ''}>
        {busy ?? message?.text ?? (ready ? 'Ready' : '')}
      </span>
      {log && !busy && <button className="mini-btn" onClick={() => useScenarioStore.setState({ showLog: !showLog })}>{showLog ? 'Hide log' : 'Show log'}</button>}
      {ready && (
        <>
          <span>Rows: <strong>{rows.length}</strong></span>
          <span>Steps: <strong>{stepCount}</strong></span>
          <span>Not in sequence: <strong>{unsequencedCount}</strong></span>
          <span>Moved: <strong>{moved.size}</strong></span>
          {selected.size > 0 && <span>Selected: <strong>{selected.size}</strong></span>}
        </>
      )}
      {extra}
      {/* The recipe editor puts what its recipe needs here (RecipesEditor > NeedsLine). */}
      <span id="scn-statusbar-needs" className="scn-statusbar__needs" />
    </footer>
  );
}

