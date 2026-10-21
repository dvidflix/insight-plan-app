import { OverflowMenu } from '../TablePopovers';
import { DockToolbar } from '../Dock';
import { useDockStore } from '../../state/dockStore';
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
import { configFocusProps } from '../../state/listConfigStore';
import { ListConfig } from '../ListConfig';
import { useListQuery } from '../../state/tableSearchStore';
import { ColumnsPanel } from '../schedule/ColumnsPanel';
import { GroupPanel } from '../schedule/GroupPanel';
import { ColorPanel } from '../schedule/ColorPanel';
import { IconChevronLeft, IconCopy, IconDownload, IconRedo, IconUndo } from '../icons';
import { useAggregateStore } from '../../state/aggregateStore';
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
  const showTotals = useAggregateStore((a) => a.showTotals);
  const setShowTotals = useAggregateStore((a) => a.setShowTotals);
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
      {/* The header of the panel is the Gantt view's own, in the dock's header: Baselines, the zoom group, then More (the view's tick items, copy, export,
          undo, redo) and the fold strip. The tools of an editable programme and its status come first. */}
      <DockToolbar id="gantt">
        <div className="mdt__bar dockgantt__head">
          {baselineBase && <BaselineMenu model={baselineBase} />}
          {single?.editable && <EditTools model={single} selectedId={selectedId} onSelect={(id) => { const a = single.activities.find((x) => x.id === id); if (a) onSelect(a); }} onNote={flash} keys />}
          <button type="button" className="mdt__fold" onClick={() => useDockStore.getState().setFolded('bottom', true)} title="Fold these panels away" aria-label="Fold away"><IconChevronLeft style={{ transform: 'rotate(-90deg)' }} /></button>
          <div className="mdt__actions">
            <EditableStatus />
            {/* The same group as the Gantt view's header: Zoom, Today, Fit, − and +. */}
            <span className="schedule-toolbar__view dockgantt__view">
              <select value={zoom} onChange={(e) => setZoom(e.target.value as Zoom)} title="Zoom: the time scale of the Gantt (Alt + wheel zooms too)" aria-label="Zoom">
                {ZOOMS.map((z) => <option key={z} value={z}>{ZOOM_LABEL[z]}</option>)}
              </select>
              <button className="btn btn--small" type="button" onClick={() => ref.current?.scrollToToday()} title="Scroll to today">Today</button>
              <button className="btn btn--small" type="button" onClick={() => ref.current?.fit()} title="Fit whole programme in view">Fit</button>
              <button className="icon-btn icon-btn--sm" type="button" onClick={() => ref.current?.zoomOut()} title="Zoom out (Alt + wheel)">−</button>
              <button className="icon-btn icon-btn--sm" type="button" onClick={() => ref.current?.zoomIn()} title="Zoom in (Alt + wheel)">+</button>
            </span>
            <span className="panels-btn mdt__more">
              <OverflowMenu
                items={[
                  { label: 'View', heading: true, onClick: () => {} },
                  { label: 'Follow the 4D timeline', checked: follow, onClick: () => setFollow(!follow), title: 'Keep the 4D timeline date, and the task in progress then, in view while it plays' },
                  { label: 'Relationship links', checked: links, onClick: () => setLinks(!links), title: 'Draw the links between tasks' },
                  { label: 'Critical path', checked: critical, onClick: () => setCritical(!critical), title: 'Highlight the critical path' },
                  { label: 'Baseline bars', checked: baseline, onClick: () => setBaseline(!baseline), title: 'Show the target (baseline) bars' },
                  { label: 'Names beside bars', checked: labels, onClick: () => setLabels(!labels), title: 'Task names beside the bars' },
                  { label: 'Group by WBS', checked: set.groupByWbs, onClick: () => set.setGroupByWbs(!set.groupByWbs), title: "Group by WBS (the Gantt page's group rules, when set, win)" },
                  { label: 'Totals', icon: <span className="tp__glyph" aria-hidden>Σ</span>, checked: showTotals, onClick: () => setShowTotals(!showTotals), title: 'Totals row and group subtotals; pick how each column sums up in the totals row' },
                  { label: '-3', separator: true, onClick: () => {} },
                  { label: 'Date basis', heading: true, onClick: () => {} },
                  { label: 'Planned dates', checked: basis === 'planned', onClick: () => setBasis('planned'), title: 'Which dates drive the 4D playback' },
                  { label: 'Actual dates', checked: basis === 'actual', onClick: () => setBasis('actual'), title: 'Which dates drive the 4D playback' },
                  { label: 'Go to the 4D date', disabled: date === null, onClick: () => { if (date !== null) ref.current?.scrollToDate(date); }, title: "Scroll to the 4D timeline's date" },
                  ...(pickFirst ? [{ label: 'Pick first activity', checked: pickFirst.on, onClick: () => pickFirst.set(!pickFirst.on), title: 'On: picking an object in the 3D view picks its first linked activity here' }] : []),
                  { label: '-4', separator: true, onClick: () => {} },
                  { label: 'Copy rows', icon: <IconCopy width={16} height={16} />, onClick: copyRows, title: 'Copy the rows to the clipboard to paste into Excel. Change them there, copy them back and paste them in the Gantt (Ctrl+V): rows are matched by Activity ID' },
                  { label: 'Export to Excel', icon: <IconDownload width={16} height={16} />, onClick: exportGantt, title: 'Export the Gantt to Excel as it is shown' },
                  { label: '-2', separator: true, onClick: () => {} },
                  { label: 'Undo', icon: <IconUndo width={16} height={16} />, disabled: !undoLabel, onClick: () => undo(), title: undoLabel ? `Undo: ${undoLabel} (Ctrl+Z)` : 'Nothing to undo' },
                  { label: 'Redo', icon: <IconRedo width={16} height={16} />, disabled: !redoLabel, onClick: () => redo(), title: redoLabel ? `Redo: ${redoLabel} (Ctrl+Y)` : 'Nothing to redo' },
                ]}
              />
            </span>
          </div>
        </div>
      </DockToolbar>
      <ListConfig
        id="gantt"
        searchable
        level={{ value: set.groupLevel, max: 8, set: set.setGroupLevel }}
        label="Gantt panel"
        badges={{ group: set.groupRules.length, sort: set.sortRules.length, color: set.colorRules.length }}
        panels={{
          columns: <ColumnsPanel catalog={catalog} views={[{ id: 'gantt', label: 'Gantt', selected: columnIds, defaults: DEFAULT_GANTT_COLUMNS, onChange: setColumnIds }]} calculated sort={{ rules: set.sortRules, onChange: set.setSortRules }} />,
          group: <GroupPanel bare fields={catalog} rules={set.groupRules} onChange={set.setGroupRules} onClose={() => {}} onCollapseAll={() => setCollapseAll((n) => n + 1)} onExpandAll={() => setExpandAll((n) => n + 1)} groupByWbs={set.groupByWbs} onToggleGroupByWbs={() => set.setGroupByWbs(!set.groupByWbs)} />,
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
