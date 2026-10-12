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

const ZOOM_LABEL: Record<Zoom, string> = { hour: 'Hours', day: 'Days', week: 'Weeks', month: 'Months', quarter: 'Quarters', year: 'Years' };

/** The 4D page's Gantt: the Programmes Gantt in a dock — the same columns, grouping, sorting, colour rules, zoom and
    options (they are shared, set up once) — with the 4D timeline's date drawn as a line across it, and the colours the
    Appearance Profiles give the tasks in 3D when those apply. */
export function DockGantt({ model, getColor, selectedId, highlightedIds, scrollToId, onSelect, onOpen }: {
  model: ScheduleModel;
  /** The colour a task has in the 4D view now (an Appearance Profile stage), else null. */
  getColor?: (a: Activity) => string | null;
  selectedId: string | null;
  highlightedIds: Set<string>;
  scrollToId: string | null;
  onSelect: (a: Activity) => void;
  onOpen: (a: Activity) => void;
}) {
  const ref = useRef<GanttHandle>(null);
  const catalog = useColumnCatalog(model);
  const columnCtx = useMemo(() => buildColumnContext(model), [model]);
  const [columnIds] = usePersistedState<string[]>('gantt.columns', DEFAULT_GANTT_COLUMNS);
  const columns = useMemo(() => resolveColumns(catalog, columnIds), [catalog, columnIds]);
  const set = useViewSettings('gantt');
  const [zoom, setZoom] = usePersistedState<Zoom>('schedule.zoom', 'week');
  const [links, setLinks] = usePersistedState('schedule.showGanttLinks', false);
  const [critical, setCritical] = usePersistedState('schedule.showGanttCritical', true);
  const [baseline, setBaseline] = usePersistedState('schedule.showGanttBaseline', false);
  const [labels, setLabels] = usePersistedState('schedule.showGanttLabels', false);
  const [palette] = usePersistedState('schedule.wbsPalette', DEFAULT_WBS_PALETTE);
  const [follow, setFollow] = usePersistedState('sequence.ganttFollow', false);
  const [search, setSearch] = useState('');
  const [collapseAll, setCollapseAll] = useState(0);
  const [expandAll, setExpandAll] = useState(0);
  const date = useSequenceTimelineStore((s) => s.date);
  const basis = useSequenceTimelineStore((s) => s.basis);
  const setBasis = useSequenceTimelineStore((s) => s.setBasis);

  const activities = useMemo(() => {
    const tokens = searchTokens(search);
    return tokens.length ? model.activities.filter((a) => matchesSearchTokens(activitySearchText(a), tokens)) : model.activities;
  }, [model, search]);

  const catalogById = useMemo(() => new Map(catalog.map((c) => [c.id, c])), [catalog]);
  const ruleColour = (a: Activity) => resolveRuleColor(set.colorRules, a, (field, act) => catalogById.get(field)?.text(act, columnCtx));
  const colour = (a: Activity) => getColor?.(a) ?? ruleColour(a);

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
    ['WBS', set.groupByWbs, set.setGroupByWbs, 'Group by WBS (the Programmes Gantt\'s group rules, when set, win)'],
  ] as const;

  return (
    <div className="dockgantt">
      <div className="dockgantt__bar">
        <input className="filterbar__search dockgantt__search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search anything: ID, name, codes, UDFs, resources…" title="Matches any value of a task: ID, name, WBS, activity codes, user defined fields, resources. Several terms: separate with commas." />
        <select value={basis} onChange={(e) => setBasis(e.target.value as 'planned' | 'actual')} title="Date basis: which dates drive the 4D playback" aria-label="Date basis">
          <option value="planned">Planned</option>
          <option value="actual">Actual</option>
        </select>
        <select value={zoom} onChange={(e) => setZoom(e.target.value as Zoom)} title="Time scale" aria-label="Time scale">
          {ZOOMS.map((z) => <option key={z} value={z}>{ZOOM_LABEL[z]}</option>)}
        </select>
        <button type="button" className="btn btn--small" onClick={() => ref.current?.zoomOut()} title="Zoom out" aria-label="Zoom out">−</button>
        <button type="button" className="btn btn--small" onClick={() => ref.current?.zoomIn()} title="Zoom in" aria-label="Zoom in">+</button>
        <button type="button" className="btn btn--small" onClick={() => ref.current?.fit()} title="Fit the whole programme in the panel">Fit</button>
        <button type="button" className="btn btn--small" onClick={() => ref.current?.scrollToToday()} title="Scroll to today">Today</button>
        <button type="button" className="btn btn--small" disabled={date === null} onClick={() => date !== null && ref.current?.scrollToDate(date)} title="Scroll to the 4D timeline's date">4D date</button>
        <span className="dockgantt__sep" />
        {options.map(([label, on, setter, tip]) => (
          <button key={label} type="button" className={`tags__chip${on ? ' active' : ''}`} aria-pressed={on} title={tip} onClick={() => setter(!on)}>{label}</button>
        ))}
        <ExpandCollapseToggle className="btn btn--small" onCollapse={() => setCollapseAll((n) => n + 1)} onExpand={() => setExpandAll((n) => n + 1)} />
      </div>
      <div className="dockgantt__chart">
        <GanttChart
          ref={ref}
          getColor={colour}
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
        />
      </div>
    </div>
  );
}
