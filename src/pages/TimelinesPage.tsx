import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { HexColorInput } from '../components/HexColorInput';
import { ticksBetween, tiersForScale, type Tick, type TickKind } from '../schedule/ganttModel';
import {
  DAY_MS,
  PALETTE,
  progressOf,
  type Holiday,
  type SummaryBar,
  shortName,
  addDays,
  dayMs,
  dayStr,
  daysBetween,
  newId,
  newTimeline,
  todayStr,
  useTimelinesStore,
  type Person,
  type Span,
  type Timeline,
  type TimelineRow,
} from '../state/timelinesStore';
import { usePersistedState } from '../utils/persistedState';
import { IconChevronDown, IconClose, IconCopy, IconDownload, IconFlag, IconInfoOutlined, IconPencil, IconPlus, IconSidePanel, IconTrash } from '../components/icons';
import { InfoTip } from '../components/InfoTip';
import { FullscreenButton } from '../components/ViewerToolbar';
import { ukBankHolidays } from '../components/timelines/holidays';
import { canvasToPdf, canvasToPng, downloadBlob, renderTimelineCanvas } from '../components/timelines/exportImage';
import { Avatar, editSpan } from '../components/timelines/shared';
import { GroupPanel } from '../components/schedule/GroupPanel';
import { ExpandCollapseToggle } from '../components/ExpandCollapseToggle';
import { GROUP_NAME, GROUP_PLANNER, buildView, mergesOf } from '../components/timelines/view';
import { TimelineTable } from '../components/timelines/TimelineTable';

/** Timelines tab: a row per building with the stages of its planning as
    bars on one date axis, the planner allocated to it, and events common to
    every row as lines across the whole timeline. Everything is editable: drag
    a bar to move it (its edges to resize), double-click a row to add dates,
    and the side pane edits the rows, stages, events and people. */

const TIER_H = 24;
const EVENT_LANE_H = 26;
const GROUP_H = 28;
const SUM_H = 30;
const MERGE_W = 90;
const NAME_W = 220;
const PLANNER_W = 110;
const MIN_COL = 50;
/** A month starts on the Monday on or after its 1st, so month lines fall on week lines (a week belongs to the month its Monday is in). */
const toMonday = (ms: number) => {
  const d = new Date(ms);
  const behind = (d.getDay() + 6) % 7;
  if (behind) d.setDate(d.getDate() + 7 - behind);
  return d.getTime();
};
const alignMonths = (kind: TickKind | null, ticks: Tick[]): Tick[] => (kind === 'month' || kind === 'quarter' || kind === 'year' ? ticks.map((t) => ({ ...t, start: toMonday(t.start), end: toMonday(t.end) })) : ticks);
const ZOOM_PRESETS: [string, number][] = [['day', 36], ['week', 14], ['month', 5], ['quarter', 1.4], ['year', 0.4]];
const HEADER_H = TIER_H * 2 + EVENT_LANE_H;
const MIN_PX = 0.3;
const MAX_PX = 80;

type PaneTab = 'row' | 'fields' | 'group' | 'stages' | 'summary' | 'events' | 'people';

export function TimelinesPage() {
  const timelines = useTimelinesStore((s) => s.timelines);
  const people = useTimelinesStore((s) => s.people);
  const activeId = useTimelinesStore((s) => s.activeId);
  const timeline = timelines.find((t) => t.id === activeId) ?? timelines[0] ?? null;
  const [tab, setTab] = usePersistedState<PaneTab>('timelines.tab', 'row');
  const [view, setView] = usePersistedState<'timeline' | 'table'>('timelines.view', 'timeline');
  const [selectedRow, setSelectedRow] = useState<string | null>(null);
  const [widths, setWidths] = usePersistedState<Record<string, number>>('timelines.widths', {});
  const [paneOpen, setPaneOpen] = usePersistedState('timelines.pane', true);
  const [barLabels, setBarLabels] = usePersistedState('timelines.barLabels', false);
  const [frozen, setFrozen] = usePersistedState('timelines.frozen', 2);
  const [rowH, setRowH] = usePersistedState('timelines.rowH', 40);
  const ROW_H = rowH;
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pxPerDay, setPxPerDay] = usePersistedState('timelines.zoom', 6);
  const scrollRef = useRef<HTMLDivElement>(null);
  const store = useTimelinesStore.getState;

  // Keeps the active id pointing at a timeline that exists.
  useEffect(() => {
    if (timeline && timeline.id !== activeId) useTimelinesStore.setState({ activeId: timeline.id });
  }, [timeline, activeId]);

  const patch = (fn: (t: Timeline) => Timeline) => timeline && store().patchTimeline(timeline.id, fn);
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const shown = useMemo(() => (timeline ? buildView(timeline, people, collapsed, filter) : null), [timeline, people, collapsed, filter]);
  const merged = !!timeline?.mergeGroups && (timeline.groups?.length ?? 0) > 0;
  const mergeCells = useMemo(() => (timeline && shown && merged ? mergesOf(shown.rows, timeline.groups, people) : []), [timeline, shown, merged, people]);
  const levelW = (i: number) => widths[`g${i}`] ?? MERGE_W;
  const levelsTotal = merged && timeline ? timeline.groups.reduce((n, _g, i) => n + levelW(i), 0) : 0;
  const nameW = widths.name ?? NAME_W;
  const plannerW = widths.planner ?? PLANNER_W;
  const LABEL_W = levelsTotal + nameW + plannerW;
  const levelLeft = (i: number) => Array.from({ length: i }, (_, k) => levelW(k)).reduce((a, b) => a + b, 0);
  const fieldLabel = (field: string) => (field === GROUP_PLANNER ? 'Planner' : field === GROUP_NAME ? 'Building' : timeline?.fields.find((f) => f.id === field)?.name ?? field);
  /** Drag a column's edge to resize it. */
  const startResize = (key: string, current: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const move = (ev: PointerEvent) => setWidths((w) => ({ ...w, [key]: Math.max(MIN_COL, Math.round(current + ev.clientX - x0)) }));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  /** Prints the timeline (a copy of the chart, scaled to one page wide) from a window of its own, so the rest of the app isn't in it. */
  const printTimeline = () => {
    const grid = scrollRef.current?.querySelector('.tl-grid');
    if (!grid || !timeline) return;
    const width = LABEL_W + chartW;
    const zoom = Math.min(1, 1040 / width);
    const win = window.open('', '_blank');
    if (!win) {
      window.alert('The print window was blocked: allow pop-ups for this page and try again.');
      return;
    }
    const styles = [...document.querySelectorAll('style, link[rel="stylesheet"]')].map((n) => n.outerHTML).join(' ');
    const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(timeline.name)}</title>${styles}
      <style>
        @page { size: landscape; margin: 10mm; }
        body { margin: 0; background: #fff; overflow: visible; display: block; height: auto; }
        .print-title { font: 600 16px sans-serif; margin: 0 0 8px; }
        .print-title small { font-weight: 400; color: #666; margin-left: 10px; }
        .tl-page { display: block; }
        .tl-head, .tl-left, .tl-mergelayer { position: static; }
        .tl-mergelayer { position: relative; }
        .tl-grid { zoom: ${zoom}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        /* A white page: the grey of the app is left out of the print. */
        html, body, .tl-page, .tl-grid, .tl-scroll, .tl-head, .tl-axis, .tl-rows, .tl-summaries, .tl-row, .tl-lane, .tl-sumlane { background: #fff !important; background-image: none !important; }
        .tl-left, .tl-corner, .tl-sumleft, .tl-hcell { background: #fff !important; background-image: none !important; }
        .tl-row--group .tl-left, .tl-row--group .tl-lane { background: #f1f3f5 !important; }
        .tl-mergecell { background: #f6f7f8 !important; }
        .tl-row--alt .tl-lane, .tl-row--alt .tl-left { background: #f6f7f8 !important; }
        .tl-row--alt .tl-left { background: #f6f7f8 !important; }
      </style></head><body>
      <p class="print-title">${esc(timeline.name)}<small>${new Date().toLocaleDateString()}</small></p>
      <div class="tl-page" style="--tl-row-h:${rowH}px;--tl-bar-h:${Math.min(28, Math.max(14, rowH - 14))}px">${grid.outerHTML}</div>
      </body></html>`);
    win.document.close();
    win.onload = () => { win.focus(); win.print(); };
    // Some browsers have already loaded it by now.
    setTimeout(() => { if (!win.closed) { win.focus(); win.print(); } }, 700);
  };
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  useEffect(() => {
    if (!exportOpen) return;
    const close = (e: PointerEvent) => { if (!(e.target as Element).closest?.('.tl-exportmenu')) setExportOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [exportOpen]);
  /** Saves the chart as a sharp PNG, or as a one-page PDF. */
  const exportAs = async (kind: 'pdf' | 'png') => {
    const grid = scrollRef.current?.querySelector('.tl-grid') as HTMLElement | null;
    if (!grid || !timeline || !shown) return;
    setExportOpen(false);
    setExporting(kind);
    try {
      const height = HEADER_H + summaryBars.length * (SUM_H + 1) + 2 + rowsHeight + 8;
      const canvas = await renderTimelineCanvas({ grid, title: timeline.name, rowHeight: rowH, size: { width: LABEL_W + chartW, height } });
      const base = timeline.name.replace(/[\/:*?"<>|]+/g, '_').trim() || 'timeline';
      if (kind === 'png') downloadBlob(await canvasToPng(canvas), `${base}.png`);
      else downloadBlob(await canvasToPdf(canvas), `${base}.pdf`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(null);
    }
  };
  /** Height of all the rows together (what the column lines run down). */
  const rowsHeight = shown ? shown.items.reduce((n, it) => n + (it.kind === 'group' ? GROUP_H : ROW_H), 0) : 0;
  const toggleGroup = (key: string) => setCollapsed((s) => { const n = new Set(s); if (!n.delete(key)) n.add(key); return n; });

  // ---- date range ----
  const today = todayStr();
  /** The summary bars with their dates and how much is done (weighted by the length of each span). */
  const summaryBars = useMemo(() => {
    if (!timeline) return [];
    return (timeline.summaries ?? []).map((bar) => {
      let lo = '';
      let hi = '';
      let w = 0;
      let done = 0;
      for (const r of timeline.rows) {
        for (const [stageId, span] of Object.entries(r.spans)) {
          if (bar.stageId && bar.stageId !== stageId) continue;
          if (!lo || span.start < lo) lo = span.start;
          if (!hi || span.end > hi) hi = span.end;
          const len = daysBetween(span.start, span.end) + 1;
          w += len;
          done += len * progressOf(span, today);
        }
      }
      // Fixed dates: how far today is through that period. Otherwise the work done in the rows' spans.
      const fixed = bar.start && bar.end;
      return { bar, start: bar.start || lo, end: bar.end || hi, pct: fixed ? progressOf({ start: bar.start!, end: bar.end! }, today) : w ? Math.round(done / w) : 0 };
    });
  }, [timeline, today]);
  const range = useMemo(() => {
    // The extent of everything on the timeline (bars, summary bars, events), with a little more either side; today only when there is nothing yet.
    let lo = Infinity;
    let hi = -Infinity;
    const take = (from: string, to: string = from) => {
      lo = Math.min(lo, dayMs(from));
      hi = Math.max(hi, dayMs(to));
    };
    if (timeline) {
      for (const r of timeline.rows) for (const s of Object.values(r.spans)) take(s.start, s.end);
      for (const e of timeline.events) take(e.date);
      for (const b of summaryBars) if (b.start && b.end) take(b.start, b.end);
    }
    if (!Number.isFinite(lo)) take(today);
    const from = new Date(lo - 10 * DAY_MS);
    from.setDate(from.getDate() - ((from.getDay() + 6) % 7)); // a Monday
    return { from: from.getTime(), to: hi + 30 * DAY_MS };
  }, [timeline, today, summaryBars]);
  const totalDays = Math.max(1, Math.ceil((range.to - range.from) / DAY_MS));
  const px = Math.min(Math.max(pxPerDay, MIN_PX), MAX_PX);
  const chartW = totalDays * px;
  const xFor = (ms: number) => ((ms - range.from) / DAY_MS) * px;

  const tiers = tiersForScale(px);
  const bottomTicks = useMemo(() => alignMonths(tiers.bottom, ticksBetween(tiers.bottom, range.from, range.to, false)), [tiers.bottom, range.from, range.to]);
  const weekTicks = useMemo(() => (px >= 1.2 ? ticksBetween('week', range.from, range.to, false) : []), [px, range.from, range.to]);
  const dayTicks = useMemo(() => (px >= 22 ? ticksBetween('day', range.from, range.to, false) : []), [px, range.from, range.to]);
  const monthTicks = useMemo(() => (px >= 0.7 ? alignMonths('month', ticksBetween('month', range.from, range.to, false)) : []), [px, range.from, range.to]);
  const topTicks = useMemo(() => (tiers.top ? alignMonths(tiers.top, ticksBetween(tiers.top, range.from, range.to, true)) : []), [tiers.top, range.from, range.to]);

  const zoomBy = (f: number) => setPxPerDay(Math.min(Math.max(px * f, MIN_PX), MAX_PX));
  const fit = () => {
    const w = (scrollRef.current?.clientWidth ?? 900) - LABEL_W - 24;
    setPxPerDay(Math.min(Math.max(w / totalDays, MIN_PX), MAX_PX));
  };
  // Ctrl + wheel zooms the time axis in small steps.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });
  const scrollToToday = () => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = Math.max(0, xFor(dayMs(today)) - el.clientWidth / 2 + LABEL_W / 2);
  };
  useLayoutEffect(() => {
    scrollToToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline?.id]);

  // ---- editing rows ----
  const setRow = (id: string, fn: (r: TimelineRow) => TimelineRow) => patch((t) => ({ ...t, rows: t.rows.map((r) => (r.id === id ? fn(r) : r)) }));
  const addRow = () => {
    if (!timeline) return;
    const row: TimelineRow = { id: newId(), name: `Building ${timeline.rows.length + 1}`, plannerId: null, note: '', values: {}, spans: {} };
    patch((t) => ({ ...t, rows: [...t.rows, row] }));
    setSelectedRow(row.id);
    setTab('row');
  };
  const removeRow = (id: string) => {
    const r = timeline?.rows.find((x) => x.id === id);
    if (!r || !window.confirm(`Delete "${r.name}" from this timeline?`)) return;
    patch((t) => ({ ...t, rows: t.rows.filter((x) => x.id !== id) }));
    if (selectedRow === id) setSelectedRow(null);
  };
  const moveRow = (id: string, dir: -1 | 1) =>
    patch((t) => {
      const i = t.rows.findIndex((r) => r.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= t.rows.length) return t;
      const rows = [...t.rows];
      [rows[i], rows[j]] = [rows[j], rows[i]];
      return { ...t, rows };
    });

  // ---- dragging a bar: move, or resize by an edge ----
  const [drag, setDrag] = useState<{ rowId: string; stageId: string; mode: 'move' | 'start' | 'end'; x0: number; orig: Span; now: Span } | null>(null);
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = Math.round((e.clientX - drag.x0) / px);
      const { start, end } = drag.orig;
      let now: Span = { start, end };
      if (drag.mode === 'move') now = { start: addDays(start, d), end: addDays(end, d) };
      else if (drag.mode === 'start') now = { start: addDays(start, Math.min(d, daysBetween(start, end))), end };
      else now = { start, end: addDays(end, Math.max(d, daysBetween(end, start))) };
      setDrag((cur) => (cur ? { ...cur, now } : cur));
    };
    const onUp = () => {
      setDrag((cur) => {
        if (cur) setRow(cur.rowId, (r) => ({ ...r, spans: { ...r.spans, [cur.stageId]: cur.now } }));
        return null;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.rowId, drag?.stageId, drag?.mode, drag?.x0, px]);

  const addSpanAt = (row: TimelineRow, e: React.MouseEvent<HTMLDivElement>) => {
    if (!timeline) return;
    const stage = timeline.stages.find((s) => !row.spans[s.id]);
    if (!stage) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const start = dayStr(range.from + Math.floor((e.clientX - rect.left) / px) * DAY_MS);
    setRow(row.id, (r) => ({ ...r, spans: { ...r.spans, [stage.id]: { start, end: addDays(start, 13) } } }));
    setSelectedRow(row.id);
  };

  // ---- timeline management ----
  const create = () => {
    const name = window.prompt('Name of the new timeline', `Timeline ${timelines.length + 1}`)?.trim();
    if (name) store().addTimeline(newTimeline(name));
  };
  const rename = () => {
    if (!timeline) return;
    const name = window.prompt('Rename the timeline', timeline.name)?.trim();
    if (name) patch((t) => ({ ...t, name }));
  };
  const duplicate = () => {
    if (!timeline) return;
    const copy: Timeline = JSON.parse(JSON.stringify(timeline));
    copy.id = newId();
    copy.name = `${timeline.name} (copy)`;
    store().addTimeline(copy);
  };
  const remove = () => {
    if (timeline && window.confirm(`Delete the timeline "${timeline.name}" and everything in it? This cannot be undone.`)) store().removeTimeline(timeline.id);
  };

  const todayX = xFor(dayMs(today));
  const row = timeline?.rows.find((r) => r.id === selectedRow) ?? null;

  return (
    <div className="tl-page" style={{ ['--tl-row-h' as string]: `${rowH}px`, ['--tl-bar-h' as string]: `${Math.min(28, Math.max(14, rowH - 14))}px` }}>
      <div className="filterbar schedule-toolbar">
        <div className="schedule-toolbar__left">
          <div className="workspaces-picker" aria-label="Timeline selector">
            <label className="workspaces-picker__label" htmlFor="timeline-select">Timeline</label>
            <div className="workspaces-picker__select-wrap">
              <select id="timeline-select" value={timeline?.id ?? ''} onChange={(e) => useTimelinesStore.setState({ activeId: e.target.value })} disabled={!timelines.length}>
                {!timelines.length && <option value="">None yet</option>}
                {timelines.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <span className="workspaces-picker__chevron"><IconChevronDown /></span>
            </div>
          </div>
          <InfoTip icon={IconInfoOutlined}>
            <p>A row per building, with the stages of its planning as bars, the planner allocated, and events common to every row as lines across the timeline.</p>
            <p><b>Table:</b> click a cell and type, or paste a block from Excel (dates day-first, planners by name). <b>Timeline:</b> drag a bar to move it, its ends to resize, double-click a row to add a stage.</p>
          </InfoTip>
          <button className="btn btn--small scn-icon-btn" type="button" onClick={create} title="New timeline" aria-label="New timeline"><IconPlus width={16} height={16} /></button>
          {timeline && (
            <>
              <button className="btn btn--small scn-icon-btn" type="button" onClick={rename} title="Rename the timeline" aria-label="Rename"><IconPencil width={16} height={16} /></button>
              <button className="btn btn--small scn-icon-btn" type="button" onClick={duplicate} title="Duplicate the timeline" aria-label="Duplicate"><IconCopy width={16} height={16} /></button>
              <button className="btn btn--small danger scn-icon-btn" type="button" onClick={remove} title="Delete the timeline" aria-label="Delete"><IconTrash width={16} height={16} /></button>
              <div className="tl-viewswitch" role="tablist" aria-label="View">
                <button type="button" role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'is-on' : ''} onClick={() => setView('table')}>Table</button>
                <button type="button" role="tab" aria-selected={view === 'timeline'} className={view === 'timeline' ? 'is-on' : ''} onClick={() => setView('timeline')}>Timeline</button>
              </div>
              <input className="filterbar__search" type="search" placeholder="Search rows…" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <button className="btn btn--small" type="button" onClick={addRow}>+ Row</button>
              {timeline.groups.length > 0 && (
                <ExpandCollapseToggle
                  className="btn btn--small"
                  collapsed={!!shown?.groupKeys.length && shown.groupKeys.every((k) => collapsed.has(k))}
                  onCollapse={() => setCollapsed(new Set(shown?.groupKeys ?? []))}
                  onExpand={() => setCollapsed(new Set())}
                />
              )}
              {view === 'table' && (
                <div className="groupby-panel">
                  <span className="groupby-panel__title">Freeze:</span>
                  <select value={frozen} onChange={(e) => setFrozen(Number(e.target.value))} title="How many columns stay in view when scrolling sideways">
                    <option value={0}>None</option>
                    {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} column{n > 1 ? 's' : ''}</option>)}
                  </select>
                </div>
              )}
              <div className="groupby-panel">
                <span className="groupby-panel__title">Rows:</span>
                <select value={rowH} onChange={(e) => setRowH(Number(e.target.value))} title="Height of the rows">
                  <option value={28}>Compact</option>
                  <option value={40}>Normal</option>
                  <option value={56}>Tall</option>
                  <option value={72}>Extra tall</option>
                </select>
              </div>
              {view === 'timeline' && (
                <>
                  <span className="groupby-panel__title">Zoom: </span>
                  <select value={ZOOM_PRESETS.find(([, v]) => Math.abs(v - px) / v < 0.05)?.[0] ?? ''} onChange={(e) => setPxPerDay(ZOOM_PRESETS.find(([k]) => k === e.target.value)?.[1] ?? px)}>
                    {!ZOOM_PRESETS.some(([, v]) => Math.abs(v - px) / v < 0.05) && <option value="">Custom</option>}
                    {ZOOM_PRESETS.map(([k]) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}
                  </select>
                  <button className="btn btn--small" type="button" onClick={scrollToToday} title="Scroll to today">Today</button>
                  <button className="btn btn--small" type="button" onClick={fit} title="Fit the whole timeline in view">Fit</button>
                  <input
                    className="tl-zoomnum"
                    type="number"
                    min={MIN_PX}
                    max={MAX_PX}
                    step={px < 2 ? 0.1 : px < 10 ? 0.5 : 1}
                    value={Math.round(px * 10) / 10}
                    onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0) setPxPerDay(Math.min(Math.max(n, MIN_PX), MAX_PX)); }}
                    title="Width of a day, in pixels: type a number or use the arrows for small steps (Ctrl + wheel zooms too)"
                    aria-label="Pixels per day"
                  />
                </>
              )}
            </>
          )}
        </div>

        <div className="schedule-toolbar__right">
          {timeline && (
            <div className="tl-exportmenu">
              <button className="icon-btn" type="button" onClick={() => setExportOpen(!exportOpen)} disabled={!!exporting} aria-haspopup="menu" aria-expanded={exportOpen} title={exporting ? 'Exporting…' : 'Export the timeline as a PDF or an image'} aria-label="Export">
                <IconDownload />
              </button>
              {exportOpen && (
                <div className="tl-exportmenu__pop" role="menu">
                  <button type="button" role="menuitem" onClick={() => void exportAs('pdf')}>Save as PDF</button>
                  <button type="button" role="menuitem" onClick={() => void exportAs('png')}>Save as image (PNG)</button>
                  <button type="button" role="menuitem" onClick={() => { setExportOpen(false); printTimeline(); }} title="The browser's print window, for paper or its own Save as PDF">Print…</button>
                </div>
              )}
            </div>
          )}
          <FullscreenButton />
          {timeline && (
            <div className="schedule-toolbar__segmented layouts-segment">
              <button className={`btn layouts-toggle${paneOpen ? ' primary' : ''}`} type="button" aria-pressed={paneOpen} onClick={() => setPaneOpen(!paneOpen)} title="Show or hide the editing pane: the selected row, fields, grouping, stages, events and people">
                <span className="toolbar-button__icon"><IconSidePanel /></span>
                Details
              </button>
            </div>
          )}
        </div>
      </div>

      {!timeline ? (
        <div className="tl-empty">
          <p>No timelines yet. A timeline has a row per building, bars for the stages of its planning, the planner allocated, and events that apply to all the buildings.</p>
          <button className="btn primary" type="button" onClick={create}>+ New timeline</button>
        </div>
      ) : (
        <div className="tl-body">
          {view === 'table' && (
            <TimelineTable
              timeline={timeline}
              people={people}
              selectedRow={selectedRow}
              onSelect={(id) => { setSelectedRow(id); setTab('row'); }}
              addRow={addRow}
              removeRow={removeRow}
              patch={patch}
              collapsed={collapsed}
              toggleGroup={toggleGroup}
              widths={widths}
              filter={filter}
              frozen={frozen}
              onResize={startResize}
            />
          )}
          <div className="tl-scroll" ref={scrollRef} style={view === 'table' ? { display: 'none' } : undefined}>
            <div className="tl-grid" style={{ width: LABEL_W + chartW }}>
              <div className={`tl-head${summaryBars.length ? ' tl-head--joined' : ''}`} style={{ height: HEADER_H }}>
                <div className="tl-left tl-corner" style={{ width: LABEL_W, padding: 0 }}>
                  {merged && timeline.groups.map((g, i) => (
                    <div key={g.id} className="tl-hcell" style={{ width: levelW(i) }} title={fieldLabel(g.field)}>
                      <span>{fieldLabel(g.field)}</span>
                      <span className="tl-resizer" onPointerDown={startResize(`g${i}`, levelW(i))} />
                    </div>
                  ))}
                  <div className="tl-hcell" style={{ width: plannerW }} title="Planner">
                    <span>Planner</span>
                    <span className="tl-resizer" onPointerDown={startResize('planner', plannerW)} />
                  </div>
                  <div className="tl-hcell" style={{ width: nameW }}>
                    <span>Building</span>
                    <span className="tl-resizer" onPointerDown={startResize('name', nameW)} />
                  </div>
                </div>
                <div className="tl-axis" style={{ width: chartW }}>
                  {topTicks.map((t) => (
                    <div key={t.start} className="tl-tick tl-tick--top" style={{ left: xFor(t.start), width: xFor(t.end) - xFor(t.start), height: TIER_H }}>{t.label}</div>
                  ))}
                  {bottomTicks.map((t) => (
                    <div key={t.start} className={`tl-tick${t.weekend ? ' is-weekend' : ''}`} style={{ left: xFor(t.start), width: xFor(t.end) - xFor(t.start), top: tiers.top ? TIER_H : 0, height: tiers.top ? TIER_H : TIER_H * 2 }}>{t.label}</div>
                  ))}
                  <div className="tl-eventlane" style={{ top: TIER_H * 2, height: EVENT_LANE_H }}>
                    {(timeline.holidays ?? []).map((h) => (
                      <span key={h.id} className="tl-holiday-mark" style={{ left: xFor(dayMs(h.start)), width: Math.max(xFor(dayMs(h.end) + DAY_MS) - xFor(dayMs(h.start)), 3) }} title={`${h.name}: ${h.start}${h.end !== h.start ? ` → ${h.end}` : ''}`} />
                    ))}
                    {timeline.events.map((e) => (
                      <div key={e.id} className="tl-event-chip" style={{ left: xFor(dayMs(e.date)), color: e.color }} title={`${e.name} · ${e.date}`} onClick={() => setTab('events')}>
                        <IconFlag width={13} height={13} /> <span>{e.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {summaryBars.length > 0 && (
                <div className="tl-summaries" style={{ top: HEADER_H }}>
                  {summaryBars.map((b) => (
                    <div key={b.bar.id} className="tl-sumrow" style={{ height: SUM_H }}>
                      <div className="tl-left tl-sumleft" style={{ width: LABEL_W }} aria-hidden="true" />
                      <div className="tl-lane tl-sumlane" style={{ width: chartW }}>
                        {b.start && b.end && (() => {
                          const left = xFor(dayMs(b.start));
                          const width = Math.max(xFor(dayMs(b.end) + DAY_MS) - left, 8);
                          const label = b.bar.description || b.bar.name;
                          return (
                            <>
                              <div className="tl-sumbar" style={{ left, width, ['--bar' as string]: b.bar.color }} title={`${b.bar.name}: ${b.start} → ${b.end} · ${b.pct}% done${b.bar.description ? `\n${b.bar.description}` : ''}`}>
                                <span className="tl-sumbar__fill" style={{ width: `${b.pct}%` }} />
                              </div>
                              {b.bar.labelPos === 'above' && <span className="tl-sumlabel tl-sumlabel--above" style={{ left: left + width / 2, transform: 'translateX(-50%)' }}>{label} <small>{b.pct}%</small></span>}
                              {b.bar.labelPos === 'end' && <span className="tl-sumlabel tl-sumlabel--end" style={{ left: left + width + 8 }}>{label} <small>{b.pct}%</small></span>}
                            </>
                          );
                        })()}
                        <span className="tl-sumtoday" style={{ left: todayX }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="tl-rows">
                {/* Holidays and bank holidays: hatched in yellow over every row. */}
                <div className="tl-holidays" style={{ left: LABEL_W, width: chartW }}>
                  {(timeline.holidays ?? []).map((h) => (
                    <span key={h.id} className="tl-holiday" style={{ left: xFor(dayMs(h.start)), width: Math.max(xFor(dayMs(h.end) + DAY_MS) - xFor(dayMs(h.start)), 2) }} />
                  ))}
                </div>
                {/* Vertical lines: every month, and the weeks or days when they are wide enough to read. */}
                <div className="tl-vlines" style={{ left: LABEL_W, width: chartW }}>
                  {dayTicks.map((t) => <span key={`d${t.start}`} className="tl-vline tl-vline--day" style={{ left: xFor(t.start) }} />)}
                  {weekTicks.map((t) => <span key={`w${t.start}`} className="tl-vline tl-vline--week" style={{ left: xFor(t.start) }} />)}
                  {monthTicks.map((t) => <span key={`m${t.start}`} className="tl-vline tl-vline--month" style={{ left: xFor(t.start) }} />)}
                </div>
                {/* The column lines of the left area run down all the rows. */}
                <div className="tl-collines" style={{ width: 0, height: 0 }}>
                  {[...(merged ? timeline.groups.map((_g, i) => levelLeft(i) + levelW(i)) : []), levelsTotal + plannerW].map((x) => (
                    <span key={x} className="tl-colline" style={{ left: x - 1, height: rowsHeight }} />
                  ))}
                </div>
                {mergeCells.length > 0 && (
                  <div className="tl-mergelayer" style={{ width: 0, height: 0 }}>
                    {mergeCells.map((m) => (
                      <div key={`${m.level}:${m.start}`} className="tl-mergecell" style={{ left: levelLeft(m.level), top: m.start * ROW_H, width: levelW(m.level), height: m.len * ROW_H }} title={m.label}>
                        <span>{m.label || '—'}</span>
                      </div>
                    ))}
                  </div>
                )}
                {(shown?.items ?? []).map((item, i) => item.kind === 'group' ? (
                  <div key={item.key} className="tl-row tl-row--group" style={{ height: GROUP_H }}>
                    <div className="tl-left tl-groupleft" style={{ width: LABEL_W, paddingLeft: 8 + item.depth * 14 }} onClick={() => toggleGroup(item.key)}>
                      <span className="tl-chev">{item.collapsed ? '▸' : '▾'}</span>
                      <span className="tl-grouplabel" title={item.label}>{item.label}</span>
                      <span className="tl-groupcount">{item.count}</span>
                    </div>
                    <div className="tl-lane tl-lane--group" style={{ width: chartW }} />
                  </div>
                ) : ((r) => (
                  <div key={r.id} className={`tl-row${i % 2 ? ' tl-row--alt' : ''}${r.id === selectedRow ? ' is-selected' : ''}`} style={{ height: ROW_H }}>
                    <div className="tl-left" style={{ width: LABEL_W, paddingLeft: merged ? levelsTotal : 0, paddingRight: 0, gap: 0 }} onClick={() => { setSelectedRow(r.id); setTab('row'); }}>
                      <div className="tl-lcol tl-lcol--planner" style={{ width: plannerW, ...(r.plannerId && personById.get(r.plannerId) ? { background: personById.get(r.plannerId)!.color, color: '#fff' } : undefined) }} title={r.plannerId ? personById.get(r.plannerId)?.name : 'No planner allocated'}>
                        {r.plannerId && personById.get(r.plannerId) ? shortName(personById.get(r.plannerId)!) : ''}
                      </div>
                      <div className="tl-lcol" style={{ width: nameW }}>
                        <span className="tl-rowname" title={r.note || r.name}>{r.name}</span>
                        {/* What the groups already show is not repeated beside the name. */}
                        <span className="tl-fieldvals" title={timeline.fields.map((f) => `${f.name}: ${r.values[f.id] ?? ''}`).join(', ')}>{timeline.fields.filter((f) => !timeline.groups.some((g) => g.field === f.id)).map((f) => r.values[f.id]).filter(Boolean).join(' · ')}</span>
                      </div>
                    </div>
                    <div className="tl-lane" style={{ width: chartW }} onDoubleClick={(e) => addSpanAt(r, e)} onClick={() => setSelectedRow(r.id)}>
                      {timeline.stages.map((s) => {
                        const live = drag && drag.rowId === r.id && drag.stageId === s.id ? drag.now : r.spans[s.id];
                        if (!live) return null;
                        const left = xFor(dayMs(live.start));
                        const width = Math.max(xFor(dayMs(live.end) + DAY_MS) - left, 6);
                        const begin = (mode: 'move' | 'start' | 'end') => (e: React.PointerEvent) => {
                          e.stopPropagation();
                          e.preventDefault();
                          setSelectedRow(r.id);
                          setDrag({ rowId: r.id, stageId: s.id, mode, x0: e.clientX, orig: r.spans[s.id], now: r.spans[s.id] });
                        };
                        return (
                          <div key={s.id} className="tl-bar" style={{ left, width, ['--bar' as string]: s.color }} title={`${s.name}: ${live.start} → ${live.end} · ${progressOf(live, today)}% done`} onPointerDown={begin('move')}>
                            <span className="tl-bar__fill" style={{ width: `${progressOf(live, today)}%` }} />
                            <span className="tl-bar__handle tl-bar__handle--l" onPointerDown={begin('start')} />
                            <span className="tl-bar__label">{barLabels && width > 70 ? s.name : ''}</span>
                            <span className="tl-bar__handle tl-bar__handle--r" onPointerDown={begin('end')} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))(item.row))}
                {timeline.rows.length === 0 && <div className="tl-hint" style={{ left: LABEL_W + 12 }}>No rows yet — "+ Row" adds a building.</div>}
                {/* Lines across every row: events (all rows), and today. */}
                <div className="tl-overlay" style={{ left: LABEL_W, width: chartW }}>
                  {timeline.events.map((e) => <div key={e.id} className="tl-eventline" style={{ left: xFor(dayMs(e.date)), borderColor: e.color }} />)}
                  <div className="tl-todayline" style={{ left: todayX }} title="Today" />
                </div>
              </div>
            </div>
          </div>

          {paneOpen && (
          <aside className="tl-pane">
            <div className="tl-pane__tabs" role="tablist">
              {([['row', 'Row'], ['fields', 'Fields'], ['group', 'Group'], ['stages', 'Stages'], ['summary', 'Summary'], ['events', 'Events'], ['people', 'People']] as [PaneTab, string][]).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-on' : ''} onClick={() => setTab(id)}>{label}</button>
              ))}
            </div>
            <div className="tl-pane__body">
              {tab === 'row' && (
                row ? (
                  <RowEditor
                    row={row}
                    timeline={timeline}
                    people={people}
                    onChange={(fn) => setRow(row.id, fn)}
                    onDelete={() => removeRow(row.id)}
                    onMove={(d) => moveRow(row.id, d)}
                  />
                ) : <div className="scn-dim">Click a row (or its bars) to edit it. Double-click an empty part of a row to add the next stage there. Drag a bar to move it, or its ends to resize.</div>
              )}
              {tab === 'fields' && <FieldsEditor timeline={timeline} patch={patch} />}
              {tab === 'group' && (
                <>
                  <label className="tl-mergeopt">
                    <input type="checkbox" checked={!!timeline.mergeGroups} onChange={(e) => patch((t) => ({ ...t, mergeGroups: e.target.checked }))} />
                    Merge cells (pivot style): show each group once beside its rows, instead of header rows
                  </label>
                <GroupPanel
                  bare
                  fields={[{ id: GROUP_PLANNER, label: 'Planner' }, { id: GROUP_NAME, label: 'Building' }, ...timeline.fields.map((f) => ({ id: f.id, label: f.name }))]}
                  rules={timeline.groups}
                  onChange={(groups) => patch((t) => ({ ...t, groups }))}
                  onClose={() => {}}
                  onCollapseAll={() => setCollapsed(new Set(shown?.groupKeys ?? []))}
                  onExpandAll={() => setCollapsed(new Set())}
                />
                </>
              )}
              {tab === 'stages' && <StagesEditor timeline={timeline} patch={patch} barLabels={barLabels} setBarLabels={setBarLabels} />}
              {tab === 'summary' && <SummaryEditor timeline={timeline} patch={patch} />}
              {tab === 'events' && <EventsEditor timeline={timeline} patch={patch} />}
              {tab === 'people' && <PeopleEditor />}
            </div>
          </aside>
          )}
        </div>
      )}
    </div>
  );
}

function RowEditor({ row, timeline, people, onChange, onDelete, onMove }: { row: TimelineRow; timeline: Timeline; people: Person[]; onChange: (fn: (r: TimelineRow) => TimelineRow) => void; onDelete: () => void; onMove: (d: -1 | 1) => void }) {
  const setSpan = (stageId: string, part: 'start' | 'end', value: string) => onChange((r) => editSpan(r, stageId, part, value));
  const setDone = (stageId: string, value: string) =>
    onChange((r) => {
      const cur = r.spans[stageId];
      if (!cur) return r;
      const n = Number(value);
      const { done: _old, ...rest } = cur;
      return { ...r, spans: { ...r.spans, [stageId]: value.trim() === '' || !Number.isFinite(n) ? rest : { ...rest, done: Math.max(0, Math.min(100, Math.round(n))) } } };
    });
  return (
    <div className="tl-form">
      <label>Name<input value={row.name} onChange={(e) => onChange((r) => ({ ...r, name: e.target.value }))} /></label>
      <label>
        Planner
        <span className="tl-inline">
          <Avatar person={people.find((p) => p.id === row.plannerId)} />
          <select value={row.plannerId ?? ''} onChange={(e) => onChange((r) => ({ ...r, plannerId: e.target.value || null }))}>
            <option value="">— none —</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </span>
      </label>
      {people.length === 0 && <div className="scn-dim">Add the planners in the People tab first.</div>}
      {timeline.fields.map((f) => (
        <label key={f.id}>{f.name}<input value={row.values[f.id] ?? ''} onChange={(e) => onChange((r) => ({ ...r, values: { ...r.values, [f.id]: e.target.value } }))} /></label>
      ))}
      <label>Note<input value={row.note} onChange={(e) => onChange((r) => ({ ...r, note: e.target.value }))} placeholder="Shown when hovering the name" /></label>
      <div className="tl-form__title">Stages</div>
      {timeline.stages.map((s) => {
        const span = row.spans[s.id];
        return (
          <div key={s.id} className="tl-stagerow">
            <span className="tl-swatch" style={{ background: s.color }} />
            <span className="tl-stagerow__name" title={s.name}>{s.name}</span>
            <input type="date" value={span?.start ?? ''} onChange={(e) => setSpan(s.id, 'start', e.target.value)} aria-label={`${s.name} start`} />
            <input type="date" value={span?.end ?? ''} disabled={!span} min={span?.start} onChange={(e) => setSpan(s.id, 'end', e.target.value)} aria-label={`${s.name} finish`} />
            <input className="tl-done" type="number" min={0} max={100} placeholder="auto" disabled={!span} value={span?.done ?? ''} onChange={(e) => setDone(s.id, e.target.value)} title="Percent done. Empty: follows today's date" aria-label={`${s.name} percent done`} />
          </div>
        );
      })}
      <div className="scn-dim">Clear the start date to take a stage off this row. The last box is the percent done: the bar is light while planned and fills with its colour as it progresses; empty, it follows today's date.</div>
      <div className="tl-actions">
        <button className="btn btn--small" type="button" onClick={() => onMove(-1)}>Move up</button>
        <button className="btn btn--small" type="button" onClick={() => onMove(1)}>Move down</button>
        <button className="btn btn--small danger" type="button" onClick={onDelete}>Delete row</button>
      </div>
    </div>
  );
}

function FieldsEditor({ timeline, patch }: { timeline: Timeline; patch: (fn: (t: Timeline) => Timeline) => void }) {
  return (
    <div className="tl-form">
      <div className="scn-dim">Your own fields for the rows (Unit, Phase…): a column in the table, a line in the row editor, and something to group by. Paste a whole column of values into the table.</div>
      {timeline.fields.map((f) => (
        <div key={f.id} className="tl-stagerow">
          <input value={f.name} onChange={(e) => patch((t) => ({ ...t, fields: t.fields.map((x) => (x.id === f.id ? { ...x, name: e.target.value } : x)) }))} />
          <button
            className="btn btn--small danger"
            type="button"
            title="Delete the field"
            onClick={() => {
              if (!window.confirm(`Delete the field "${f.name}" and its values on every row?`)) return;
              patch((t) => ({
                ...t,
                fields: t.fields.filter((x) => x.id !== f.id),
                groups: t.groups.filter((g) => g.field !== f.id),
                rows: t.rows.map((r) => { const { [f.id]: _g, ...values } = r.values; return { ...r, values }; }),
              }));
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button className="btn btn--small" type="button" onClick={() => patch((t) => ({ ...t, fields: [...t.fields, { id: newId(), name: `Field ${t.fields.length + 1}` }] }))}>+ Add field</button>
    </div>
  );
}

function SummaryEditor({ timeline, patch }: { timeline: Timeline; patch: (fn: (t: Timeline) => Timeline) => void }) {
  const list = timeline.summaries ?? [];
  const set = (id: string, p: Partial<SummaryBar>) => patch((t) => ({ ...t, summaries: (t.summaries ?? []).map((b) => (b.id === id ? { ...b, ...p } : b)) }));
  return (
    <div className="tl-form">
      <div className="scn-dim">Summary bars at the top of the timeline: from the earliest start to the latest finish of a stage (or all of them) over every row, filled as the work gets done. Dates left empty are taken from the rows.</div>
      {list.map((b) => (
        <div key={b.id} className="tl-sumedit">
          <div className="tl-stagerow">
            <HexColorInput value={b.color} onChange={(hex) => set(b.id, { color: hex })} />
            <input value={b.name} onChange={(e) => set(b.id, { name: e.target.value })} placeholder="Name" />
            <button className="btn btn--small danger" type="button" title="Delete the summary bar" onClick={() => window.confirm(`Delete the summary bar "${b.name}"?`) && patch((t) => ({ ...t, summaries: (t.summaries ?? []).filter((x) => x.id !== b.id) }))}>✕</button>
          </div>
          <label>Description (optional)<input value={b.description} onChange={(e) => set(b.id, { description: e.target.value })} placeholder="Shown with the bar" /></label>
          <div className="tl-stagerow">
            <select value={b.stageId ?? ''} onChange={(e) => set(b.id, { stageId: e.target.value || null })} title="The stage it summarises">
              <option value="">All stages</option>
              {timeline.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={b.labelPos} onChange={(e) => set(b.id, { labelPos: e.target.value as SummaryBar['labelPos'] })} title="Where the description goes">
              <option value="above">Text above</option>
              <option value="end">Text at the end</option>
              <option value="none">No text</option>
            </select>
          </div>
          <div className="tl-stagerow">
            <input type="date" value={b.start ?? ''} onChange={(e) => set(b.id, { start: e.target.value || undefined })} aria-label="Start (optional)" title="Start (empty: from the rows)" />
            <input type="date" value={b.end ?? ''} onChange={(e) => set(b.id, { end: e.target.value || undefined })} aria-label="Finish (optional)" title="Finish (empty: from the rows)" />
          </div>
        </div>
      ))}
      <button className="btn btn--small" type="button" onClick={() => patch((t) => ({ ...t, summaries: [...(t.summaries ?? []), { id: newId(), name: 'Summary', description: '', color: '#2b3441', stageId: null, labelPos: 'above' }] }))}>+ Add summary bar</button>
    </div>
  );
}

function StagesEditor({ timeline, patch, barLabels, setBarLabels }: { timeline: Timeline; patch: (fn: (t: Timeline) => Timeline) => void; barLabels: boolean; setBarLabels: (v: boolean) => void }) {
  const set = (id: string, p: Partial<{ name: string; color: string }>) => patch((t) => ({ ...t, stages: t.stages.map((s) => (s.id === id ? { ...s, ...p } : s)) }));
  return (
    <div className="tl-form">
      <label className="tl-mergeopt">
        <input type="checkbox" checked={barLabels} onChange={(e) => setBarLabels(e.target.checked)} />
        Show the stage name on the bars (Timeline view)
      </label>
      <div className="scn-dim">The stages every row can have, in drawing order. Rename or recolour them here.</div>
      {timeline.stages.map((s, i) => (
        <div key={s.id} className="tl-stagerow">
          <HexColorInput value={s.color} onChange={(hex) => set(s.id, { color: hex })} />
          <input value={s.name} onChange={(e) => set(s.id, { name: e.target.value })} />
          <button className="btn btn--small" type="button" disabled={i === 0} onClick={() => patch((t) => { const a = [...t.stages]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return { ...t, stages: a }; })} title="Earlier">↑</button>
          <button
            className="btn btn--small danger"
            type="button"
            title="Delete the stage"
            onClick={() => {
              if (!window.confirm(`Delete the stage "${s.name}" and its dates on every row?`)) return;
              patch((t) => ({ ...t, stages: t.stages.filter((x) => x.id !== s.id), rows: t.rows.map((r) => { const { [s.id]: _g, ...spans } = r.spans; return { ...r, spans }; }) }));
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <button className="btn btn--small" type="button" onClick={() => patch((t) => ({ ...t, stages: [...t.stages, { id: newId(), name: `Stage ${t.stages.length + 1}`, color: PALETTE[t.stages.length % PALETTE.length] }] }))}>+ Add stage</button>
    </div>
  );
}

function HolidaysEditor({ timeline, patch }: { timeline: Timeline; patch: (fn: (t: Timeline) => Timeline) => void }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const list = [...(timeline.holidays ?? [])].sort((a, b) => a.start.localeCompare(b.start));
  const set = (id: string, p: Partial<Holiday>) => patch((t) => ({ ...t, holidays: (t.holidays ?? []).map((h) => (h.id === id ? { ...h, ...p } : h)) }));
  const addBank = () =>
    patch((t) => {
      const have = new Set((t.holidays ?? []).map((h) => `${h.name}|${h.start}`));
      const fresh = ukBankHolidays(year).filter((h) => !have.has(`${h.name}|${h.date}`)).map((h) => ({ id: newId(), name: h.name, start: h.date, end: h.date }));
      return { ...t, holidays: [...(t.holidays ?? []), ...fresh] };
    });
  return (
    <div className="tl-form">
      <div className="tl-form__title">Holidays and bank holidays</div>
      <div className="scn-dim">Days off, hatched in yellow across every row.</div>
      {list.map((h) => (
        <div key={h.id} className="tl-holrow">
          <input value={h.name} onChange={(e) => set(h.id, { name: e.target.value })} placeholder="Name" />
          <input type="date" value={h.start} onChange={(e) => e.target.value && set(h.id, { start: e.target.value, end: h.end < e.target.value ? e.target.value : h.end })} aria-label="First day" />
          <input type="date" value={h.end} min={h.start} onChange={(e) => e.target.value && set(h.id, { end: e.target.value })} aria-label="Last day" />
          <button className="btn btn--small danger" type="button" title="Delete" onClick={() => patch((t) => ({ ...t, holidays: (t.holidays ?? []).filter((x) => x.id !== h.id) }))}>✕</button>
        </div>
      ))}
      <div className="tl-actions">
        <button className="btn btn--small" type="button" onClick={() => patch((t) => ({ ...t, holidays: [...(t.holidays ?? []), { id: newId(), name: 'Holiday', start: todayStr(), end: todayStr() }] }))}>+ Add holiday</button>
        <span className="tl-inline">
          <input type="number" value={year} min={2000} max={2100} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 70 }} aria-label="Year" />
          <button className="btn btn--small" type="button" onClick={addBank} title="Adds the bank holidays of England and Wales for that year">+ UK bank holidays</button>
        </span>
      </div>
    </div>
  );
}

function EventsEditor({ timeline, patch }: { timeline: Timeline; patch: (fn: (t: Timeline) => Timeline) => void }) {
  const set = (id: string, p: Partial<{ name: string; date: string; color: string }>) => patch((t) => ({ ...t, events: t.events.map((e) => (e.id === id ? { ...e, ...p } : e)) }));
  const sorted = [...timeline.events].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="tl-form">
      <div className="scn-dim">Events for all the rows (cut-off to integrate the programmes, a review…): a line across the timeline.</div>
      {sorted.map((e) => (
        <div key={e.id} className="tl-stagerow">
          <input type="color" value={e.color} onChange={(ev) => set(e.id, { color: ev.target.value })} aria-label="Colour" />
          <input value={e.name} onChange={(ev) => set(e.id, { name: ev.target.value })} />
          <input type="date" value={e.date} onChange={(ev) => ev.target.value && set(e.id, { date: ev.target.value })} />
          <button className="btn btn--small danger" type="button" title="Delete the event" onClick={() => window.confirm(`Delete the event "${e.name}"?`) && patch((t) => ({ ...t, events: t.events.filter((x) => x.id !== e.id) }))}>✕</button>
        </div>
      ))}
      <button className="btn btn--small" type="button" onClick={() => patch((t) => ({ ...t, events: [...t.events, { id: newId(), name: 'Event', date: todayStr(), color: PALETTE[3] }] }))}>+ Add event</button>
      <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '10px 0 4px' }} />
      <HolidaysEditor timeline={timeline} patch={patch} />
    </div>
  );
}

function PeopleEditor() {
  const people = useTimelinesStore((s) => s.people);
  const setPeople = useTimelinesStore((s) => s.setPeople);
  const set = (id: string, p: Partial<Person>) => setPeople(people.map((x) => (x.id === id ? { ...x, ...p } : x)));
  return (
    <div className="tl-form">
      <div className="scn-dim">The planners, shared by every timeline. Their avatar shows their initials in their colour.</div>
      {people.map((p) => (
        <div key={p.id} className="tl-person">
          <Avatar person={p} />
          <div className="tl-person__fields">
            <input value={p.name} onChange={(e) => set(p.id, { name: e.target.value })} placeholder="Name" />
            <input value={p.knownAs ?? ''} onChange={(e) => set(p.id, { knownAs: e.target.value })} placeholder="Known as (shown on the rows)" />
            <input value={p.role} onChange={(e) => set(p.id, { role: e.target.value })} placeholder="Role" />
          </div>
          <HexColorInput value={p.color} onChange={(hex) => set(p.id, { color: hex })} />
          <button
            className="btn btn--small danger"
            type="button"
            title="Delete the person"
            onClick={() => {
              if (!window.confirm(`Delete ${p.name || 'this person'}? They are taken off the rows they are allocated to.`)) return;
              setPeople(people.filter((x) => x.id !== p.id));
              for (const t of useTimelinesStore.getState().timelines) {
                if (t.rows.some((r) => r.plannerId === p.id)) useTimelinesStore.getState().patchTimeline(t.id, (tl) => ({ ...tl, rows: tl.rows.map((r) => (r.plannerId === p.id ? { ...r, plannerId: null } : r)) }));
              }
            }}
          >
            <IconClose width={12} height={12} />
          </button>
        </div>
      ))}
      <button className="btn btn--small" type="button" onClick={() => setPeople([...people, { id: newId(), name: `Planner ${people.length + 1}`, role: 'Planner', color: PALETTE[people.length % PALETTE.length] }])}>+ Add person</button>
    </div>
  );
}
