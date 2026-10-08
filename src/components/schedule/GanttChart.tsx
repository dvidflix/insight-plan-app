import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Activity, Relationship } from '../../schedule/types';
import { wbsGroupColors, DEFAULT_WBS_PALETTE } from '../../schedule/wbsPalette';
import { allWbsPaths, buildRuleTree, buildWbsTree, wbsPathsAtOrBeyondDepth } from '../../schedule/wbsTree';
import {
  DAY_MS,
  ROW_H,
  buildGanttRows,
  buildLinkIndex,
  computeGroupAggregates,
  extent,
  flattenLayout,
  linkEnds,
  linkPath,
  tiersForScale,
  ticksBetween,
  type GanttRow,
} from '../../schedule/ganttModel';
import { useResizableWidth } from '../ResizeHandle';
import type { ColumnCtx, ColumnDef } from '../../schedule/columns';
import { usePersistedState } from '../../utils/persistedState';
import type { GroupRule } from './GroupPanel';
import { useTableStyleStore } from '../../state/tableStyleStore';
import { useAggregateStore } from '../../state/aggregateStore';
import { applyWbsOrder, useWbsOrder } from '../../state/wbsOrder';
import type { GanttExport, GanttExportRow } from '../../schedule/exportGanttXlsx';
import { aggregate, aggType, defaultAgg, type AggKind } from '../../schedule/aggregates';
import { AggCell } from './AggCell';
import { IconExpander } from '../icons';
import { useActivitySelectionStore } from '../../state/activitySelectionStore';

export type Zoom = 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
export const ZOOMS: Zoom[] = ['hour', 'day', 'week', 'month', 'quarter', 'year'];
const ZOOM_PX_PER_DAY: Record<Zoom, number> = { hour: 600, day: 36, week: 14, month: 5, quarter: 1.4, year: 0.4 };

/** Imperative controls the Schedule toolbar drives (Today / Fit / +/-). */
export interface GanttHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  scrollToToday: () => void;
  /** The label grid as shown (columns, groups, subtotals, folded state) for the Excel export. */
  getExport: () => GanttExport;
}

interface GanttChartProps {
  activities: Activity[];
  relationships?: Relationship[];
  selectedId: string | null;
  /** Activities to paint with a green background band — e.g. every activity
      linked to the object currently selected in the 3D viewer. Distinct
      from `selectedId` (a single row's blue "clicked" highlight), since a
      3D selection can touch several activities at once. */
  highlightedIds?: Set<string>;
  /** Rows faded back (the curtain: what the filters or the driving path leave out). */
  dimmedIds?: Set<string>;
  /** Scrolls the chart to this activity whenever it changes — same as
      double-clicking its row, but triggered externally (e.g. by a 3D
      viewer selection instead of a click inside the Gantt itself). */
  scrollToId?: string | null;
  getColor?: (activity: Activity) => string | null;
  groupByWbs?: boolean;
  /** Group rules (Configuration > Group): one nesting level per rule, by the
      field's value, sorted up or down. When set they replace the WBS grouping. */
  groupRules?: GroupRule[];
  /** The column catalog, to read each rule's field value. */
  catalog?: ColumnDef[];
  /** Programmes: totals bar and group subtotals as set with Σ Totals. */
  aggregatable?: boolean;
  /** '' leaves the WBS tree fully expanded; '0'-'4' collapses every group at
      that depth and deeper — the shared "Group Levels" control (also used
      by the Activities table). */
  wbsLevel?: string;
  /** Which WBS_PALETTES entry colors group headers by nesting depth. */
  wbsPalette?: string;
  /** Draw predecessor/successor connector lines between bars. The links of
      the selected activity are always drawn, even when this is off. */
  showLinks?: boolean;
  /** Paint critical activities red (unless a color rule overrides). */
  showCritical?: boolean;
  /** Thin grey bar under each activity showing its target (baseline) dates. */
  showBaseline?: boolean;
  /** Activity name to the right of each bar. */
  showLabels?: boolean;
  /** Vertical marker for the schedule's data (status) date. */
  dataDate?: Date | null;
  zoom?: Zoom;
  /** Label-grid columns to show, in display order. */
  columns: ColumnDef[];
  columnCtx: ColumnCtx;
  /** Bumped by the shared Configuration pane's Collapse/Expand all buttons. */
  collapseAllSignal?: number;
  expandAllSignal?: number;
  onSelect: (activity: Activity) => void;
  /** Double-click on a row (after the chart has scrolled to it). */
  onOpen?: (activity: Activity) => void;
}

const HEADER_H = 44;
const TIER_H = HEADER_H / 2;
const OVERSCAN_ROWS = 12;
const MAX_LINKS = 3000;
const MIN_PX = 0.05;
const MAX_PX = 2400;
/** Browsers stop laying out boxes past ~33M px — stay well under it. */
const MAX_CHART_PX = 30_000_000;

function fmtDate(d: Date | null) {
  return d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}

function toDays(hours: number | null) {
  return hours === null ? null : Math.round((hours / 8) * 10) / 10;
}

interface Tip {
  activity: Activity;
  x: number;
  y: number;
}

export const GanttChart = forwardRef<GanttHandle, GanttChartProps>(function GanttChart(
  {
    activities,
    relationships = [],
    selectedId,
    dimmedIds,
    highlightedIds,
    scrollToId = null,
    getColor,
    groupByWbs = true,
    groupRules,
    catalog,
    aggregatable = false,
    wbsLevel = '',
    wbsPalette = DEFAULT_WBS_PALETTE,
    showLinks = false,
    showCritical = false,
    showBaseline = false,
    showLabels = false,
    dataDate = null,
    zoom = 'week',
    columns,
    columnCtx,
    collapseAllSignal = 0,
    expandAllSignal = 0,
    onSelect,
    onOpen,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Settings > Tables > Wrap column headers, as in the Activities table.
  const wrapHeaders = useTableStyleStore((s) => s.wrapHeaders);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const [view, setView] = useState({ w: 900, h: 600 });
  const [customPx, setCustomPx] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const labelWidth = useResizableWidth('schedule.ganttLabelWidth', 480, 340, 1800);
  const LABEL_W = labelWidth.width;
  const visibleLabelColumns = columns;
  const [colWidths, setColWidths] = usePersistedState<Record<string, number>>('gantt.columnWidths', {});
  const widthOf = (c: ColumnDef) => colWidths[c.id] ?? c.width;
  const cellStyle = (c: ColumnDef): React.CSSProperties => ({ width: widthOf(c), flexShrink: 0 });

  // Dragging a header edge resizes that column and moves the divider with it,
  // so the columns to its right are pushed along instead of being clipped.
  const startColumnResize = (c: ColumnDef) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(c);
    const startLabel = LABEL_W;
    const onMove = (m: MouseEvent) => {
      const w = Math.max(40, Math.min(800, startW + m.clientX - startX));
      setColWidths((prev) => ({ ...prev, [c.id]: w }));
      labelWidth.setWidth(startLabel + (w - startW));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Adding or removing columns re-fits the label grid to them (capped so the
  // bars keep some room); resizing by hand afterwards still wins.
  const columnKey = columns.map((c) => c.id).join('|');
  const setLabelWidth = labelWidth.setWidth;
  const firstFit = useRef(true);
  useEffect(() => {
    const total = columns.reduce((n, c) => n + widthOf(c), 0);
    const fit = Math.min(total, Math.max(340, window.innerWidth * 0.8));
    // On load the pane grows to show every column (up to the cap): a column
    // left half outside it has its right-aligned values cut off.
    if (firstFit.current) {
      firstFit.current = false;
      if (LABEL_W < fit) setLabelWidth(fit);
      return;
    }
    setLabelWidth(fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnKey]);

  // ---- data ---------------------------------------------------------------

  const rows = useMemo(() => buildGanttRows(activities), [activities]);
  const rowById = useMemo(() => new Map(rows.map((r) => [r.activity.id, r])), [rows]);
  // Group rules win over the WBS tree; both become the same kind of tree
  // (a " / " path per row), so headers, collapsing and Group level work alike.
  const [wbsOrder] = useWbsOrder();
  const byRules = !!(groupRules?.length && catalog);
  const grouped = byRules || groupByWbs;
  const wbsTree = useMemo(() => {
    if (byRules) {
      const byId = new Map(catalog!.map((c) => [c.id, c]));
      return buildRuleTree(rows, groupRules!, (r, field) => byId.get(field)?.text(r.activity, columnCtx) ?? '');
    }
    return groupByWbs ? applyWbsOrder(buildWbsTree(rows, (r) => r.activity.wbsPath, (r) => r.activity.wbsCodePath), wbsOrder) : [];
  }, [rows, groupByWbs, byRules, groupRules, catalog, columnCtx, wbsOrder]);
  const groupAggs = useMemo(() => computeGroupAggregates(wbsTree), [wbsTree]);

  // Σ Totals: a totals bar under the chart and subtotals on group headers,
  // each label column summarised its own way.
  const aggShow = useAggregateStore((s) => s.showTotals);
  const aggKinds = useAggregateStore((s) => s.kinds);
  const setAggKind = useAggregateStore((s) => s.setKind);
  const totalsOn = aggregatable && aggShow;
  const kindOf = (c: ColumnDef): AggKind => aggKinds[c.id] ?? defaultAgg(c);
  const groupActs = useMemo(() => {
    const m = new Map<string, Activity[]>();
    if (!totalsOn) return m;
    const collect = (n: (typeof wbsTree)[number]): Activity[] => {
      const all = [...n.rows.map((r) => r.activity), ...n.children.flatMap(collect)];
      m.set(n.path, all);
      return all;
    };
    wbsTree.forEach(collect);
    return m;
  }, [totalsOn, wbsTree]);
  const layout = useMemo(() => flattenLayout(rows, wbsTree, grouped, collapsedGroups), [rows, wbsTree, grouped, collapsedGroups]);
  const linkIndex = useMemo(() => buildLinkIndex(relationships), [relationships]);
  const items = layout.items;
  // Ctrl+click adds or removes a row, Shift+click picks the rows between (in the order listed now); see activitySelectionStore.
  const multi = useActivitySelectionStore((s) => s.ids);
  const pickRow = (a: Activity, e: React.MouseEvent) => {
    const order = items.flatMap((i) => (i.kind === 'row' ? [i.row.activity.id] : []));
    useActivitySelectionStore.getState().click(a.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }, order);
    onSelect(a);
  };
  const contentHeight = items.length * ROW_H;

  // Picking a Group Level re-seeds which nodes start collapsed (depth >= N);
  // after that, clicks toggle individual nodes same as before, until the
  // level control is changed again.
  useEffect(() => {
    if (!grouped) return;
    if (wbsLevel === '') setCollapsedGroups(new Set());
    else setCollapsedGroups(new Set(wbsPathsAtOrBeyondDepth(wbsTree, Number(wbsLevel))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wbsLevel, grouped]);

  const seenSignals = useRef({ collapse: collapseAllSignal, expand: expandAllSignal });
  useEffect(() => {
    if (collapseAllSignal !== seenSignals.current.collapse) {
      seenSignals.current.collapse = collapseAllSignal;
      setCollapsedGroups(new Set(allWbsPaths(wbsTree)));
    }
    if (expandAllSignal !== seenSignals.current.expand) {
      seenSignals.current.expand = expandAllSignal;
      setCollapsedGroups(new Set());
    }
  }, [collapseAllSignal, expandAllSignal, wbsTree]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ---- time axis ----------------------------------------------------------

  const now = Date.now();
  const dataDateMs = dataDate ? dataDate.getTime() : null;
  const { rangeStartMs, totalDays } = useMemo(() => {
    const { min, max } = extent(rows, [dataDateMs]);
    if (!isFinite(min)) return { rangeStartMs: 0, totalDays: 1 };
    const start = new Date(min);
    start.setHours(0, 0, 0, 0);
    start.setDate(1);
    const end = max + 14 * DAY_MS;
    return { rangeStartMs: start.getTime(), totalDays: Math.max(1, (end - start.getTime()) / DAY_MS) };
  }, [rows, dataDateMs]);

  const pxPerDay = Math.min(Math.max(customPx ?? ZOOM_PX_PER_DAY[zoom], MIN_PX), MAX_PX, MAX_CHART_PX / totalDays);
  const chartWidth = Math.max(totalDays * pxPerDay, view.w - LABEL_W);
  const totalWidth = LABEL_W + chartWidth;
  const xFor = (ms: number) => ((ms - rangeStartMs) / DAY_MS) * pxPerDay;

  // A preset picked from the toolbar drops any ctrl+wheel/fit override.
  useEffect(() => setCustomPx(null), [zoom]);

  // Keeps whatever date is under the pointer (or the viewport centre) fixed
  // while the scale changes. Captured during render — before the DOM commit
  // rescales the content and the browser clamps scrollLeft — and applied in
  // the layout effect below.
  const lastPx = useRef<number | null>(null);
  const zoomAnchor = useRef<{ ms: number; pointerX: number } | null>(null);
  const pointerHint = useRef<number | null>(null);
  if (lastPx.current !== pxPerDay) {
    const el = containerRef.current;
    if (el && lastPx.current !== null) {
      const pointerX = pointerHint.current ?? LABEL_W + (el.clientWidth - LABEL_W) / 2;
      const chartX = el.scrollLeft + pointerX - LABEL_W;
      zoomAnchor.current = { ms: rangeStartMs + (chartX / lastPx.current) * DAY_MS, pointerX };
    }
    lastPx.current = pxPerDay;
  }
  useLayoutEffect(() => {
    pointerHint.current = null;
    const a = zoomAnchor.current;
    const el = containerRef.current;
    if (!a || !el) return;
    zoomAnchor.current = null;
    el.scrollLeft = Math.max(0, ((a.ms - rangeStartMs) / DAY_MS) * pxPerDay + LABEL_W - a.pointerX);
  }, [pxPerDay, rangeStartMs, LABEL_W]);

  const zoomTo = (px: number, pointerX?: number) => {
    pointerHint.current = pointerX ?? null;
    setCustomPx(Math.min(Math.max(px, MIN_PX), MAX_PX));
  };
  const zoomBy = (factor: number, pointerX?: number) => zoomTo(pxPerDay * factor, pointerX);
  const fit = () => zoomTo((view.w - LABEL_W - 24) / totalDays);
  const scrollToToday = () => {
    const el = containerRef.current;
    if (el) el.scrollTo({ left: Math.max(0, xFor(now) - (el.clientWidth - LABEL_W) / 3), behavior: 'smooth' });
  };

  const controls = useRef({ zoomBy, fit, scrollToToday });
  controls.current = { zoomBy, fit, scrollToToday };
  // The label grid as it is on screen, for the Excel export. Every row is included; those under a collapsed group are marked hidden.
  const exportData = () => {
    const out: GanttExportRow[] = [];
    const totalCells = (acts: Activity[], first: string) => columns.map((c, i) => (totalsOn && aggType(c) ? String(aggregate(c, kindOf(c), acts, columnCtx) ?? '') : i === 0 ? first : ''));
    if (grouped) {
      const walk = (nodes: typeof wbsTree, folded: boolean) => {
        for (const node of nodes) {
          const first = `${node.label} (${node.descendantCount})`;
          out.push({ kind: 'group', depth: node.depth, hidden: folded, cells: totalCells(groupActs.get(node.path) ?? [], first) });
          const closed = folded || collapsedGroups.has(node.path);
          for (const r of node.rows) out.push({ kind: 'row', depth: node.depth + 1, hidden: closed, cells: columns.map((c) => c.text(r.activity, columnCtx)) });
          walk(node.children, closed);
        }
      };
      walk(wbsTree, false);
    } else {
      for (const r of rows) out.push({ kind: 'row', depth: 0, hidden: false, cells: columns.map((c) => c.text(r.activity, columnCtx)) });
    }
    if (totalsOn) out.push({ kind: 'total', depth: 0, hidden: false, cells: totalCells(activities, `Total · ${activities.length.toLocaleString()} tasks`) });
    return { columns: columns.map((c) => c.label), rows: out };
  };
  const controls2 = useRef(exportData);
  controls2.current = exportData;

  useImperativeHandle(
    ref,
    () => ({
      getExport: () => controls2.current(),
      zoomIn: () => controls.current.zoomBy(1.5),
      zoomOut: () => controls.current.zoomBy(1 / 1.5),
      fit: () => controls.current.fit(),
      scrollToToday: () => controls.current.scrollToToday(),
    }),
    [],
  );

  // ---- scrolling / viewport ----------------------------------------------

  const rafRef = useRef(0);
  const onScroll = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = containerRef.current;
      if (el) setScroll((p) => (p.top === el.scrollTop && p.left === el.scrollLeft ? p : { top: el.scrollTop, left: el.scrollLeft }));
    });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setView((p) => (p.w === el.clientWidth && p.h === el.clientHeight ? p : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // ctrl/cmd + wheel zooms the time axis around the cursor (needs a
    // non-passive listener to suppress the browser's page zoom).
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      controls.current.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - el.getBoundingClientRect().left);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('wheel', onWheel);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const bodyH = Math.max(0, view.h - HEADER_H);
  const scrollRowIntoView = (index: number) => {
    const el = containerRef.current;
    if (!el) return;
    const top = index * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + bodyH) el.scrollTop = top + ROW_H - bodyH;
  };

  const jumpToActivity = (activity: Activity) => {
    const el = containerRef.current;
    const index = layout.indexById.get(activity.id);
    if (!el || index === undefined) return;
    const row = rowById.get(activity.id);
    const top = Math.max(0, index * ROW_H - bodyH / 2);
    if (row) el.scrollTo({ left: Math.max(0, xFor(row.s) - (el.clientWidth - LABEL_W) / 3), top, behavior: 'smooth' });
    else el.scrollTo({ top, behavior: 'smooth' });
  };
  const jumpRef = useRef(jumpToActivity);
  jumpRef.current = jumpToActivity;

  useEffect(() => {
    if (!scrollToId) return;
    const row = rowById.get(scrollToId);
    if (row) jumpRef.current(row.activity);
  }, [scrollToId, rowById]);

  const moveSelection = (delta: number) => {
    const cur = selectedId ? layout.indexById.get(selectedId) : undefined;
    const dir = delta > 0 ? 1 : -1;
    let i = cur === undefined ? (dir > 0 ? -1 : items.length) : cur;
    i = Math.min(Math.max(i + delta, 0), items.length - 1);
    while (i >= 0 && i < items.length && items[i].kind !== 'row') i += dir;
    const item = items[i];
    if (item && item.kind === 'row') {
      useActivitySelectionStore.getState().click(item.row.activity.id, {}, []);
      onSelect(item.row.activity);
      scrollRowIntoView(i);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const page = Math.max(1, Math.floor(bodyH / ROW_H) - 1);
    const delta = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'PageDown' ? page : e.key === 'PageUp' ? -page : 0;
    if (delta !== 0) {
      e.preventDefault();
      moveSelection(delta);
    } else if (e.key === 'Enter' && selectedId) {
      const row = rowById.get(selectedId);
      if (row) jumpToActivity(row.activity);
    }
  };

  // ---- visible window -----------------------------------------------------

  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - OVERSCAN_ROWS);
  const last = Math.min(items.length, Math.ceil((scroll.top + bodyH) / ROW_H) + OVERSCAN_ROWS);
  const yLo = first * ROW_H;
  const yHi = last * ROW_H;
  const xLo = Math.max(0, scroll.left - view.w);
  const xHi = Math.min(chartWidth, scroll.left + view.w * 2);
  const msAt = (x: number) => rangeStartMs + (x / pxPerDay) * DAY_MS;
  const winW = Math.max(0, xHi - xLo);
  const winH = Math.max(0, yHi - yLo);

  const tiers = tiersForScale(pxPerDay);
  const bottomTicks = useMemo(
    () => ticksBetween(tiers.bottom, msAt(xLo), msAt(xHi), false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tiers.bottom, xLo, xHi, pxPerDay, rangeStartMs],
  );
  const topTicks = useMemo(
    () => (tiers.top ? ticksBetween(tiers.top, msAt(xLo), msAt(xHi), true) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tiers.top, xLo, xHi, pxPerDay, rangeStartMs],
  );

  // Weeks split every month with light lines and months are drawn darker,
  // from week zoom out to month zoom (a week is wide enough to see).
  const showWeekLines = pxPerDay >= 2.5;
  const weekLines = useMemo(
    () => (showWeekLines ? ticksBetween('week', msAt(xLo), msAt(xHi), false) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showWeekLines, xLo, xHi, pxPerDay, rangeStartMs],
  );
  const monthLines = useMemo(
    () => (showWeekLines ? ticksBetween('month', msAt(xLo), msAt(xHi), false) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showWeekLines, xLo, xHi, pxPerDay, rangeStartMs],
  );

  // Weekend shading, only where a day is wide enough to be worth drawing.
  const weekendBands: { x: number; w: number }[] = [];
  if (pxPerDay >= 5) {
    const d = new Date(msAt(xLo));
    d.setHours(0, 0, 0, 0);
    let guard = 0;
    while (xFor(d.getTime()) < xHi && guard++ < 4000) {
      const dow = d.getDay();
      if (dow === 6) {
        const x = xFor(d.getTime());
        weekendBands.push({ x, w: pxPerDay * 2 });
        d.setDate(d.getDate() + 2);
      } else if (dow === 0) {
        weekendBands.push({ x: xFor(d.getTime()), w: pxPerDay });
        d.setDate(d.getDate() + 1);
      } else {
        d.setDate(d.getDate() + 1);
      }
    }
  }

  // Links: only those touching visible rows (plus the selection's, always).
  interface LinkDraw {
    key: string;
    d: string;
    cls: string;
    marker: string;
  }
  const links: LinkDraw[] = [];
  if (rows.length > 0) {
    const drawn = new Set<Relationship>();
    const addLink = (rel: Relationship, selected: boolean) => {
      if (drawn.has(rel) || links.length >= MAX_LINKS) return;
      const p = rowById.get(rel.predId);
      const s = rowById.get(rel.succId);
      const pi = layout.indexById.get(rel.predId);
      const si = layout.indexById.get(rel.succId);
      if (!p || !s || pi === undefined || si === undefined) return;
      drawn.add(rel);
      const { fromRight, toLeft } = linkEnds(rel.type);
      const d = linkPath(
        xFor(fromRight ? p.f : p.s),
        pi * ROW_H + ROW_H / 2,
        xFor(toLeft ? s.s : s.f),
        si * ROW_H + ROW_H / 2,
        fromRight,
        toLeft,
      );
      const critical = showCritical && p.activity.isCritical && s.activity.isCritical;
      links.push({
        key: `${rel.predId}>${rel.succId}:${rel.type}:${rel.lagHours}:${links.length}`,
        d,
        cls: selected ? 'gantt-link gantt-link--selected' : critical ? 'gantt-link gantt-link--critical' : 'gantt-link',
        marker: selected ? 'gantt-arrow-sel' : critical ? 'gantt-arrow-crit' : 'gantt-arrow',
      });
    };
    if (selectedId) for (const rel of linkIndex.get(selectedId) ?? []) addLink(rel, true);
    if (showLinks) {
      for (let i = first; i < last; i++) {
        const item = items[i];
        if (item.kind !== 'row') continue;
        for (const rel of linkIndex.get(item.row.activity.id) ?? []) addLink(rel, false);
      }
    }
  }

  // ---- row rendering ------------------------------------------------------

  const renderRow = (r: GanttRow, index: number) => {
    const a = r.activity;
    const barLeft = xFor(r.s);
    const barWidth = Math.max(xFor(r.f) - barLeft, 4);
    const isMilestone = a.type === 'milestone-start' || a.type === 'milestone-finish';
    const isLoe = a.type === 'loe';
    const selected = a.id === selectedId || (multi.size > 1 && multi.has(a.id));
    const linked = highlightedIds?.has(a.id) ?? false;
    const critical = showCritical && a.isCritical;
    const color = getColor?.(a) ?? (critical ? 'var(--bar-critical)' : a.status === 'completed' ? 'var(--bar-done)' : 'var(--bar-normal)');
    const labelLeft = (isMilestone ? barLeft + 12 : barLeft + barWidth) + 6;
    const baseline = showBaseline && a.targetStart && a.targetFinish ? { l: xFor(a.targetStart.getTime()), w: Math.max(xFor(a.targetFinish.getTime()) - xFor(a.targetStart.getTime()), 3) } : null;
    const onTip = (e: React.MouseEvent) => setTip({ activity: a, x: e.clientX, y: e.clientY });
    return (
      <div
        key={a.id}
        className={`gantt-row${linked ? ' gantt-row--linked' : ''}${dimmedIds?.has(a.id) ? ' gantt-row--dim' : ''}`}
        style={{ top: index * ROW_H, width: totalWidth }}
      >
        <div
          onClick={(e) => pickRow(a, e)}
          onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
          onDoubleClick={() => { jumpToActivity(a); onOpen?.(a); }}
          className={`gantt-row-label gantt-row-label--cols${selected ? ' selected' : ''}${linked ? ' gantt-row-label--linked' : ''}`}
          style={{ width: LABEL_W }}
        >
          {visibleLabelColumns.map((c) => (
            <span
              key={c.id}
              className="gantt-row-label__cell"
              title={c.text(a, columnCtx)}
              style={{ ...cellStyle(c), justifyContent: c.align ? 'flex-end' : undefined }}
            >
              {c.text(a, columnCtx)}
            </span>
          ))}
        </div>
        <div className="gantt-row-chart" style={{ width: chartWidth }} onClick={(e) => pickRow(a, e)} onDoubleClick={() => { jumpToActivity(a); onOpen?.(a); }}>
          {baseline && <div className="gantt-baseline" style={{ left: baseline.l, width: baseline.w }} />}
          {isMilestone ? (
            <div
              className={`gantt-milestone${selected ? ' selected' : ''}`}
              style={{ left: barLeft - 6, top: ROW_H / 2 - 6, background: color }}
              onMouseEnter={onTip}
              onMouseMove={onTip}
              onMouseLeave={() => setTip(null)}
            />
          ) : (
            <div
              className={`gantt-bar${isLoe ? ' gantt-bar--loe' : ''}${selected ? ' selected' : ''}`}
              style={{ left: barLeft, width: barWidth, background: color }}
              onMouseEnter={onTip}
              onMouseMove={onTip}
              onMouseLeave={() => setTip(null)}
            >
              {a.percentComplete > 0 && <div className="gantt-bar__progress" style={{ width: `${a.percentComplete}%` }} />}
            </div>
          )}
          {showLabels && (
            <span className="gantt-bar-label" style={{ left: labelLeft }}>
              {a.name}
            </span>
          )}
        </div>
      </div>
    );
  };

  const renderGroup = (item: Extract<(typeof items)[number], { kind: 'group' }>, index: number) => {
    const { bg, fg } = wbsGroupColors(item.path, wbsPalette);
    const agg = groupAggs.get(item.path);
    const collapsed = collapsedGroups.has(item.path);
    const left = agg ? xFor(agg.s) : 0;
    const width = agg ? Math.max(xFor(agg.f) - left, 4) : 0;
    return (
      <div
        key={`g:${item.path}`}
        className="gantt-row gantt-group-header"
        style={{ top: index * ROW_H, width: totalWidth, background: bg, color: fg }}
        onClick={() => toggleGroup(item.path)}
      >
        <span className="gantt-row-label" style={{ width: LABEL_W, background: bg, color: fg, paddingLeft: 10 + item.depth * 16 }}>
          <IconExpander open={!collapsed} /> {item.label}
          <span style={{ opacity: 0.7, marginLeft: 6 }}>({item.count})</span>
          {totalsOn && (() => {
            // Subtotals sit over their own columns (the label shows to the left of them).
            let x = 0;
            return visibleLabelColumns.map((c) => {
              const left = x;
              x += widthOf(c);
              const k = kindOf(c);
              if (k === 'none') return null;
              return (
                <span key={c.id} className="gantt-subtotal" style={{ left, width: widthOf(c), background: bg, justifyContent: c.align ? 'flex-end' : undefined }}>
                  {aggregate(c, k, groupActs.get(item.path) ?? [], columnCtx)}
                </span>
              );
            });
          })()}
        </span>
        <div className="gantt-row-chart" style={{ width: chartWidth }}>
          {agg && (
            <div className="gantt-summary" style={{ left, width, color: fg }} title={`${Math.round(agg.pct)}% complete`}>
              <div className="gantt-summary__track" />
              <div className="gantt-summary__done" style={{ width: `${agg.pct}%` }} />
            </div>
          )}
        </div>
      </div>
    );
  };

  const visibleRows: React.ReactNode[] = [];
  for (let i = first; i < last; i++) {
    const item = items[i];
    visibleRows.push(item.kind === 'group' ? renderGroup(item, i) : renderRow(item.row, i));
  }

  const todayX = now >= rangeStartMs && rows.length > 0 ? xFor(now) : null;
  const dataDateX = dataDateMs !== null && rows.length > 0 ? xFor(dataDateMs) : null;

  const tipActivity = tip?.activity;
  const tipLeft = tip ? (tip.x > window.innerWidth - 320 ? tip.x - 300 : tip.x + 14) : 0;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <div
        ref={containerRef}
        className="gantt-scroll"
        tabIndex={0}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
        style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'auto', position: 'relative' }}
      >
        {rows.length === 0 ? (
          <div style={{ padding: 12, color: 'var(--text-dim)' }}>No activities with dates to display.</div>
        ) : (
          <div style={{ width: totalWidth, height: HEADER_H + contentHeight, position: 'relative' }}>
            {/* Zero-size sticky anchor so the column resize handle stays put
                while scrolling horizontally. */}
            <div style={{ position: 'sticky', left: 0, width: 0, height: 0, zIndex: 9 }}>
              <div
                className="gantt-resize-handle"
                style={{ position: 'absolute', left: LABEL_W - 2, top: 0, height: HEADER_H + contentHeight }}
                onMouseDown={labelWidth.startDrag(false)}
              />
            </div>

            <div className={`gantt-header${wrapHeaders ? ' gantt-header--wrap' : ''}`} style={{ height: HEADER_H }}>
              <div className="gantt-header__corner" style={{ width: LABEL_W }}>
                {visibleLabelColumns.map((c) => (
                  <span
                    key={c.id}
                    className="gantt-header__cell"
                    style={{ ...cellStyle(c), justifyContent: c.align ? 'flex-end' : undefined }}
                    title={c.label}
                  >
                    {c.label}
                    <span className="col-resizer" onMouseDown={startColumnResize(c)} role="separator" aria-label={`Resize ${c.label}`} />
                  </span>
                ))}
              </div>
              <div style={{ position: 'relative', width: chartWidth, height: HEADER_H, flexShrink: 0 }}>
                {topTicks.map((t) => {
                  const x = xFor(t.start);
                  const w = xFor(t.end) - x;
                  // Keep the label readable while its period straddles the left edge.
                  const shift = Math.min(Math.max(0, scroll.left - x), Math.max(0, w - 90));
                  return (
                    <div key={t.start} className="gantt-tick gantt-tick--top" style={{ left: x, width: w, height: TIER_H }}>
                      <span style={{ transform: `translateX(${shift}px)` }}>{t.label}</span>
                    </div>
                  );
                })}
                {bottomTicks.map((t) => {
                  const x = xFor(t.start);
                  return (
                    <div
                      key={t.start}
                      className={`gantt-tick gantt-tick--bottom${t.weekend ? ' gantt-tick--weekend' : ''}`}
                      style={{ left: x, width: xFor(t.end) - x, top: tiers.top ? TIER_H : 0, height: tiers.top ? TIER_H : HEADER_H }}
                    >
                      <span>{t.label}</span>
                    </div>
                  );
                })}
                {todayX !== null && <div className="gantt-header-marker gantt-header-marker--today" style={{ left: todayX }} />}
              </div>
            </div>

            <div style={{ position: 'absolute', left: 0, top: HEADER_H, width: totalWidth, height: contentHeight }}>
              <div className="gantt-grid" style={{ left: LABEL_W + xLo, top: yLo, width: winW, height: winH }}>
                {weekendBands.map((b, i) => (
                  <div key={i} className="gantt-weekend-band" style={{ left: b.x - xLo, width: b.w }} />
                ))}
                {showWeekLines ? (
                  <>
                    {(tiers.bottom === 'day' || tiers.bottom === 'hour') && bottomTicks.map((t) => <div key={`d${t.start}`} className="gantt-grid-line" style={{ left: xFor(t.start) - xLo }} />)}
                    {weekLines.map((t) => <div key={`w${t.start}`} className="gantt-grid-line gantt-grid-line--week" style={{ left: xFor(t.start) - xLo }} />)}
                    {monthLines.map((t) => <div key={`m${t.start}`} className="gantt-grid-line gantt-grid-line--month" style={{ left: xFor(t.start) - xLo }} />)}
                    {tiers.top === 'year' && topTicks.map((t) => <div key={`y${t.start}`} className="gantt-grid-line gantt-grid-line--major" style={{ left: xFor(t.start) - xLo }} />)}
                  </>
                ) : (
                  <>
                    {bottomTicks.map((t) => (
                      <div key={t.start} className="gantt-grid-line" style={{ left: xFor(t.start) - xLo }} />
                    ))}
                    {topTicks.map((t) => (
                      <div key={t.start} className="gantt-grid-line gantt-grid-line--major" style={{ left: xFor(t.start) - xLo }} />
                    ))}
                  </>
                )}
              </div>

              {visibleRows}

              {todayX !== null && todayX >= scroll.left && <div className="gantt-today-line" style={{ left: LABEL_W + todayX, height: contentHeight }} title="Today" />}
              {dataDateX !== null && dataDateX >= scroll.left && (
                <div className="gantt-datadate-line" style={{ left: LABEL_W + dataDateX, height: contentHeight }} title="Data date" />
              )}

              {links.length > 0 && (
                <svg
                  className="gantt-links"
                  style={{ position: 'absolute', left: LABEL_W + xLo, top: yLo, width: winW, height: winH, pointerEvents: 'none' }}
                  viewBox={`${xLo} ${yLo} ${winW} ${winH}`}
                >
                  <defs>
                    <marker id="gantt-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                      <path d="M0,0 L6,3 L0,6 Z" fill="var(--text-dim)" />
                    </marker>
                    <marker id="gantt-arrow-crit" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                      <path d="M0,0 L6,3 L0,6 Z" fill="var(--danger)" />
                    </marker>
                    <marker id="gantt-arrow-sel" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                      <path d="M0,0 L6,3 L0,6 Z" fill="var(--accent)" />
                    </marker>
                  </defs>
                  {links.map((l) => (
                    <path key={l.key} d={l.d} className={l.cls} markerEnd={`url(#${l.marker})`} />
                  ))}
                </svg>
              )}
            </div>
          </div>
        )}
      </div>

      </div>
      {totalsOn && (
        <div className="gantt-totals">
          <div className="gantt-totals__cells" style={{ width: LABEL_W }}>
            {visibleLabelColumns.map((c, i) => (
              <span key={c.id} className="gantt-totals__cell" style={{ ...cellStyle(c), justifyContent: c.align ? 'flex-end' : undefined }}>
                {aggType(c)
                  ? <AggCell column={c} kind={kindOf(c)} value={aggregate(c, kindOf(c), activities, columnCtx)} onKind={(k) => setAggKind(c.id, k)} />
                  : i === 0 ? `Total · ${activities.length.toLocaleString()}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {tip && tipActivity && (
        <div className="gantt-tooltip" style={{ left: tipLeft, top: tip.y + 14 }}>
          <div className="gantt-tooltip__title">
            {tipActivity.code} — {tipActivity.name}
          </div>
          <div>
            {fmtDate(tipActivity.earlyStart ?? tipActivity.targetStart)} → {fmtDate(tipActivity.earlyFinish ?? tipActivity.targetFinish)}
          </div>
          <div>
            {toDays(tipActivity.durationHours) ?? 0} d · {tipActivity.percentComplete}% complete · {tipActivity.status}
          </div>
          <div>
            Float: {toDays(tipActivity.totalFloatHours) ?? '—'} d{tipActivity.isCritical ? ' · Critical' : ''}
          </div>
          {tipActivity.targetStart && tipActivity.targetFinish && (
            <div className="gantt-tooltip__dim">
              Target: {fmtDate(tipActivity.targetStart)} → {fmtDate(tipActivity.targetFinish)}
            </div>
          )}
        </div>
      )}

    </div>
  );
});
