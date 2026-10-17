import { OverflowRow } from '../OverflowRow';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Activity, ScheduleModel } from '../../schedule/types';
import { GanttChart, ZOOMS, type GanttHandle, type Zoom } from '../schedule/GanttChart';
import { DEFAULT_GANTT_COLUMNS, buildColumnContext, resolveColumns } from '../../schedule/columns';
import { useColumnCatalog } from '../../schedule/calculatedColumns';
import { resolveRuleColor } from '../schedule/ColorPanel';
import { DEFAULT_WBS_PALETTE } from '../../schedule/wbsPalette';
import { activitySearchText, matchesSearchTokens, searchTokens } from '../../schedule/search';
import { useViewSettings } from '../../pages/SchedulePage';
import { usePersistedState } from '../../utils/persistedState';
import { useSequenceTimelineStore } from '../../state/sequenceTimelineStore';
import { activityFinishMs, activityStartMs } from '../../schedule/linking';
import { ExpandCollapseToggle } from '../ExpandCollapseToggle';
import { configFocusProps } from '../../state/listConfigStore';
import { ListConfig } from '../ListConfig';
import { useListQuery } from '../../state/tableSearchStore';
import { ColumnsPanel } from '../schedule/ColumnsPanel';
import { GroupPanel } from '../schedule/GroupPanel';
import { SortPanel } from '../schedule/SortPanel';
import { ColorPanel } from '../schedule/ColorPanel';
import { IconCopy, IconDownload, IconRedo, IconUndo } from '../icons';
import { LevelStepper } from '../schedule/LevelStepper';
import { EditTools } from '../schedule/EditTools';
import { EditableStatus } from '../schedule/EditableStatus';
import { BaselineMenu } from '../schedule/BaselineMenu';
import { useScheduleStore } from '../../state/scheduleStore';
import { redo, undo, useProgrammeHistory } from '../../state/programmeHistory';
import { exportGanttXlsx } from '../../schedule/exportGanttXlsx';
import { makeGanttEditor } from '../../schedule/ganttEdit';

const ZOOM_LABEL: Record<Zoom, string> = { hour: 'Hours', day: 'Days', week: 'Weeks', month: 'Months', quarter: 'Quarters', year: 'Years' };

/** The 4D page's Gantt: the Programmes Gantt in a dock — the same columns, grouping, sorting, colour rules, zoom and
    options (they are shared, set up once) — with the 4D timeline's date drawn as a line across it, and the colours the
    Appearance Profiles give the tasks in 3D when those apply. */
export function DockGantt({ model, getColor, selectedId, highlightedIds, scrollToId, onSelect, onOpen, activities: given, dimmedIds, onLinkShortcut, onLagChange, pickFirst }: {
  model: ScheduleModel;
  /** 4D: picking an object in 3D picks its first linked activity (its switch is in the ⋯ menu). */
  pickFirst?: { on: boolean; set: (v: boolean) => void };
  /** The tasks to show when the page has filtered them already (Programmes: its filters and the driving path); else all of them. */
  activities?: Activity[];
  /** Tasks drawn faded (Programmes: the driving path's curtain). */
  dimmedIds?: Set<string>;
  /** Alt+S / Alt+F on the chart: link the picked tasks (Programmes). */
  onLinkShortcut?: (kind: 'SS' | 'FS') => void;
  onLagChange?: (rel: { predId: string; succId: string }, deltaDays: number) => void;
  /** The colour a task has in the 4D view now (an Appearance Profile stage), else null. */
  getColor?: (a: Activity) => string | null;
  selectedId: string | null;
  highlightedIds: Set<string>;
  scrollToId: string | null;
  onSelect: (a: Activity) => void;
  onOpen?: (a: Activity) => void;
}) {
  const ref = useRef<GanttHandle>(null);
  const catalog = useColumnCatalog(model);
  const columnCtx = useMemo(() => buildColumnContext(model), [model]);
  const [columnIds, setColumnIds] = usePersistedState<string[]>('gantt.columns', DEFAULT_GANTT_COLUMNS);
  const columns = useMemo(() => resolveColumns(catalog, columnIds), [catalog, columnIds]);
  const set = useViewSettings('gantt');
  const [zoom, setZoom] = usePersistedState<Zoom>('schedule.zoom', 'week');
  const [links, setLinks] = usePersistedState('schedule.showGanttLinks', false);
  const [critical, setCritical] = usePersistedState('schedule.showGanttCritical', true);
  const [baseline, setBaseline] = usePersistedState('schedule.showGanttBaseline', false);
  const [labels, setLabels] = usePersistedState('schedule.showGanttLabels', false);
  const [palette, setPalette] = usePersistedState('schedule.wbsPalette', DEFAULT_WBS_PALETTE);
  const [follow, setFollow] = usePersistedState('sequence.ganttFollow', false);
  const search = useListQuery('gantt');
  const [collapseAll, setCollapseAll] = useState(0);
  const [expandAll, setExpandAll] = useState(0);
  const date = useSequenceTimelineStore((s) => s.date);
  // The same header as the Gantt page: search, level, the planning tools, undo / redo, baselines, copy and export. They work on the
  // programme when there is one (the one the page shows), and the cells of the chart are edited in place.
  const schedules = useScheduleStore((s) => s.schedules);
  const single = schedules.length === 1 ? schedules[0] : null;
  const [note, setNote] = useState<string | null>(null);
  const flash = (text: string) => { setNote(text); window.setTimeout(() => setNote((cur) => (cur === text ? null : cur)), 5000); };
  const editor = useMemo(() => makeGanttEditor(single, flash), [single]);
  const undoLabel = useProgrammeHistory((h) => h.undos[h.undos.length - 1]?.label ?? null);
  const redoLabel = useProgrammeHistory((h) => h.redos[h.redos.length - 1]?.label ?? null);
  const baselineBase = single && single.dbProgrammeId !== undefined ? single : null;
  const exportGantt = () => {
    const data = ref.current?.getExport();
    if (data) exportGanttXlsx(data, `Gantt ${new Date().toISOString().slice(0, 10)}.xlsx`);
  };
  const copyRows = () => {
    ref.current?.copyTable().then((n) => flash(`Copied ${n} rows with their headings: paste into Excel, change them there, copy them back and paste in the Gantt (Ctrl+V).`), () => flash('The browser did not allow copying to the clipboard.'));
  };
  const valuesOf = useMemo(() => {
    const cache = new Map<string, { value: string; count: number }[]>();
    return (fieldId: string) => {
      const hit = cache.get(fieldId);
      if (hit) return hit;
      const col = catalog.find((c) => c.id === fieldId);
      const counts = new Map<string, number>();
      if (col) for (const a of model.activities) counts.set(col.text(a, columnCtx), (counts.get(col.text(a, columnCtx)) ?? 0) + 1);
      const list = [...counts].map(([value, count]) => ({ value, count })).sort((x, y) => y.count - x.count || x.value.localeCompare(y.value));
      cache.set(fieldId, list);
      return list;
    };
  }, [catalog, columnCtx, model]);
  const basis = useSequenceTimelineStore((s) => s.basis);
  const setBasis = useSequenceTimelineStore((s) => s.setBasis);

  const activities = useMemo(() => {
    const tokens = searchTokens(search);
    const base = given ?? model.activities;
    return tokens.length ? base.filter((a) => matchesSearchTokens(activitySearchText(a), tokens)) : base;
  }, [model, search, given]);

  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  const ruleColour = (a: Activity) => resolveRuleColor(set.colorRules, a, (field, act) => catalogById.get(field)?.text(act, columnCtx));

  // Following the timeline: the chart scrolls to keep its date in view.
  // The rows follow too: to the task in progress at that date that started first (else the next to start).
  const followId = useMemo(() => {
    if (!follow || date === null) return null;
    let active: { id: string; start: number } | null = null;
    let next: { id: string; start: number } | null = null;
    for (const a of activities) {
      const start = activityStartMs(a, basis);
      const finish = activityFinishMs(a, basis);
      if (start === null) continue;
      if (start <= date && (finish === null || finish >= date)) {
        if (!active || start < active.start) active = { id: a.id, start };
      } else if (start > date && (!next || start < next.start)) next = { id: a.id, start };
    }
    return (active ?? next)?.id ?? null;
  }, [follow, date, basis, activities]);
  useEffect(() => {
    if (follow && date !== null) ref.current?.scrollToDate(date);
  }, [follow, date]);
  useEffect(() => {
    if (followId) ref.current?.scrollToRow(followId);
  }, [followId]);

  const options = [
    ['Follow', follow, setFollow, 'Keep the 4D timeline date, and the task in progress then, in view while it plays'],
    ['Links', links, setLinks, 'Draw the links between tasks'],
    ['Critical', critical, setCritical, 'Critical tasks in red'],
    ['Baseline', baseline, setBaseline, 'The target dates under each bar'],
    ['Names', labels, setLabels, 'Task names beside the bars'],
    ['WBS', set.groupByWbs, set.setGroupByWbs, 'Group by WBS (the Gantt page\'s group rules, when set, win)'],
  ] as const;

  return (
    <div className="dockgantt" {...configFocusProps('gantt')}>
      {note && <div className="shortcut-note" role="status">{note}</div>}
      {/* One row: what does not fit goes into the ⋯ menu at its right, the last tools first. */}
      <OverflowRow
        className="dockgantt__bar"
        items={[
          { key: 'basis', node: (
            <select value={basis} onChange={(e) => setBasis(e.target.value as 'planned' | 'actual')} title="Date basis: which dates drive the 4D playback" aria-label="Date basis">
              <option value="planned">Planned</option>
              <option value="actual">Actual</option>
            </select>
          ) },
          { key: 'date4d', node: <button type="button" className="btn btn--small" disabled={date === null} onClick={() => date !== null && ref.current?.scrollToDate(date)} title="Scroll to the 4D timeline's date">4D date</button> },
          { key: 'level', node: <LevelStepper value={set.groupLevel} onChange={set.setGroupLevel} /> },
          { key: 'undo', menu: true, node: <button type="button" className="btn btn--small" disabled={!undoLabel} onClick={() => undo()} title={undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'} aria-label="Undo"><IconUndo width={16} height={16} /></button> },
          { key: 'redo', menu: true, node: <button type="button" className="btn btn--small" disabled={!redoLabel} onClick={() => redo()} title={redoLabel ? `Redo: ${redoLabel} (Ctrl+Y)` : 'Nothing to redo'} aria-label="Redo"><IconRedo width={16} height={16} /></button> },
          ...(single?.editable ? [{ key: 'edit', node: <EditTools model={single} selectedId={selectedId} onSelect={(id) => { const a = single.activities.find((x) => x.id === id); if (a) onSelect(a); }} onNote={flash} keys /> }] : []),
          ...(baselineBase ? [{ key: 'baselines', node: <BaselineMenu model={baselineBase} /> }] : []),
          { key: 'expand', node: <ExpandCollapseToggle className="btn btn--small" onCollapse={() => setCollapseAll((n) => n + 1)} onExpand={() => setExpandAll((n) => n + 1)} /> },
          ...options.map(([label, on, setter, tip]) => ({ key: `opt-${label}`, node: <button type="button" className={`tags__chip${on ? ' active' : ''}`} aria-pressed={on} title={tip} onClick={() => setter(!on)}>{label}</button> })),
          { key: 'status', node: <EditableStatus /> },
          ...(pickFirst ? [{ key: 'pick', menu: true, node: (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', whiteSpace: 'nowrap' }} title="On: picking an object in the 3D view picks its first linked activity here. Ctrl+Shift+F then moves the timeline to the start of the picked activity.">
              <input type="checkbox" checked={pickFirst.on} onChange={(e) => pickFirst.set(e.target.checked)} /> Pick first activity
            </label>
          ) }] : []),
          { key: 'copy', menu: true, node: <button type="button" className="icon-btn" onClick={copyRows} title="Copy the rows to the clipboard to paste into Excel. Change them there, copy them back and paste them in the Gantt (Ctrl+V): rows are matched by Activity ID and only what changed is set"><IconCopy /></button> },
          { key: 'export', node: <button type="button" className="icon-btn" onClick={exportGantt} title="Export the Gantt to Excel as it is shown"><IconDownload /></button> },
          { key: 'zoom', node: (
            <select value={zoom} onChange={(e) => setZoom(e.target.value as Zoom)} title="Time scale" aria-label="Time scale">
              {ZOOMS.map((z) => <option key={z} value={z}>{ZOOM_LABEL[z]}</option>)}
            </select>
          ) },
          { key: 'fit', node: <button type="button" className="btn btn--small" onClick={() => ref.current?.fit()} title="Fit the whole programme in the panel">Fit</button> },
          { key: 'today', node: <button type="button" className="btn btn--small" onClick={() => ref.current?.scrollToToday()} title="Scroll to today">Today</button> },
          { key: 'zoomout', node: <button type="button" className="icon-btn icon-btn--sm" onClick={() => ref.current?.zoomOut()} title="Zoom out" aria-label="Zoom out">−</button> },
          { key: 'zoomin', node: <button type="button" className="icon-btn icon-btn--sm" onClick={() => ref.current?.zoomIn()} title="Zoom in" aria-label="Zoom in">+</button> },
        ]}
      />
      <ListConfig
        id="gantt"
        searchable
        label="Gantt panel"
        badges={{ group: set.groupRules.length, sort: set.sortRules.length, color: set.colorRules.length }}
        panels={{
          columns: <ColumnsPanel catalog={catalog} views={[{ id: 'gantt', label: 'Gantt', selected: columnIds, defaults: DEFAULT_GANTT_COLUMNS, onChange: setColumnIds }]} calculated />,
          group: <GroupPanel bare fields={catalog} rules={set.groupRules} onChange={set.setGroupRules} onClose={() => {}} onCollapseAll={() => setCollapseAll((n) => n + 1)} onExpandAll={() => setExpandAll((n) => n + 1)} groupByWbs={set.groupByWbs} onToggleGroupByWbs={() => set.setGroupByWbs(!set.groupByWbs)} />,
          sort: <SortPanel bare fields={catalog} rules={set.sortRules} onChange={set.setSortRules} onClose={() => {}} />,
          color: <ColorPanel bare rules={set.colorRules} onChange={set.setColorRules} onClose={() => {}} wbsPalette={palette} onWbsPaletteChange={setPalette} fields={catalog} valuesOf={valuesOf} />,
        }}
      />
      <div className="dockgantt__chart">
        <GanttChart
          ref={ref}
          getColor={getColor}
          rowColor={ruleColour}
          columns={columns}
          columnCtx={columnCtx}
          catalog={catalog}
          aggregatable
          activities={activities}
          relationships={model.relationships}
          selectedId={selectedId}
          highlightedIds={highlightedIds}
          scrollToId={scrollToId}
          groupByWbs={set.groupByWbs}
          groupRules={set.groupRules}
          sortRules={set.sortRules}
          wbsLevel={set.groupLevel}
          wbsPalette={palette}
          showLinks={links}
          showCritical={critical}
          showBaseline={baseline}
          showLabels={labels}
          dataDate={model.project.dataDate}
          cursorMs={date}
          zoom={zoom}
          collapseAllSignal={collapseAll}
          expandAllSignal={expandAll}
          onSelect={onSelect}
          onOpen={onOpen}
          dimmedIds={dimmedIds}
          onLinkShortcut={onLinkShortcut}
          onLagChange={onLagChange}
          editor={editor}
        />
      </div>
    </div>
  );
}
