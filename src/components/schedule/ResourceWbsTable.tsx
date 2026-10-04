import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import type { Activity } from '../../schedule/types';
import { buildWbsTree, allWbsPaths, type WbsTreeNode } from '../../schedule/wbsTree';
import { queryMatcher } from '../../schedule/search';
import { inUnloadedWbs } from '../../state/unloadedWbsStore';
import { wbsGroupColors } from '../../schedule/wbsPalette';
import { finishOf, startOf, totalsOfSpan, type ActivitySpan, type LoadedResource } from '../../schedule/resourceLoading';
import { usePersistedState } from '../../utils/persistedState';
import { downloadCsv } from '../../utils/csv';
import { fmtNum } from './ResourceCharts';
import { IconExpander, IconEye, IconEyeOff } from '../icons';

interface Totals {
  sums: Map<string, number>;
  count: number;
  start: number | null;
  finish: number | null;
}

type Sort = { col: string; dir: 'asc' | 'desc' } | null;
export const WBS_NAME_COL = '__name';
const COUNT_COL = '__count';
const START_COL = '__start';
const FINISH_COL = '__finish';
const unitOf = (name: string) => /\(([^)]+)\)\s*$/.exec(name)?.[1] ?? '';
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const fmtDate = (ms: number | null) => (ms === null ? '' : new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));

export interface WbsColumn {
  id: string;
  label: string;
  /** Default width in px. */
  width: number;
  numeric: boolean;
  resource?: LoadedResource;
}

/** The WBS column (always shown) and the optional ones: counts, dates, then one per resource. */
export function wbsColumns(resources: LoadedResource[]): WbsColumn[] {
  return [
    { id: WBS_NAME_COL, label: 'WBS', width: 380, numeric: false },
    { id: COUNT_COL, label: 'Activities', width: 90, numeric: true },
    { id: START_COL, label: 'Start', width: 110, numeric: true },
    { id: FINISH_COL, label: 'Finish', width: 110, numeric: true },
    ...resources.map((r): WbsColumn => {
      const u = r.type === 'labor' ? 'man-hours' : unitOf(r.name);
      const base = r.name.replace(/\s*\([^)]+\)\s*$/, '');
      return { id: r.name, label: `${r.virtual ? '◇ ' : ''}${u ? `${base} (${u})` : base}`, width: 150, numeric: true, resource: r };
    }),
  ];
}

/** What the toolbar drives. */
export interface WbsTableHandle {
  /** Moves the selected WBS row up (-1) or down (+1) among its siblings. */
  move: (delta: -1 | 1) => void;
  expandAll: () => void;
  collapseAll: () => void;
  /** Opens the tree down to this depth (0 = top band only) and closes what is below; null = everything open. */
  setLevel: (level: number | null) => void;
  resetOrder: () => void;
  exportCsv: () => void;
}

export interface WbsTableState {
  canUp: boolean;
  canDown: boolean;
  hasOrder: boolean;
}

interface ResourceWbsTableProps {
  /** The activities shown (levels without resources are listed too). */
  activities: Activity[];
  spans: ActivitySpan[];
  /** Labour first, then materials / equipment. */
  resources: LoadedResource[];
  /** WBS palette id: rows are coloured by depth, as in the Table View. */
  wbsPalette: string;
  /** Optional columns switched off. */
  hidden: string[];
  widths: Record<string, number>;
  /** WBS paths left out of the programme ("unloaded"): listed greyed, with an eye to load them again, and not counted in the totals above them. */
  unloaded?: string[];
  onToggleUnloaded?: (path: string) => void;
  /** Search text: only the WBS levels whose name matches (with their parents and children) are listed. */
  query?: string;
  onWidth: (id: string, width: number) => void;
  onState: (state: WbsTableState) => void;
}

/** Programmes > WBS: the WBS tree as a table in the Table View's style and
    colours, with each level's activity count, dates and resource totals
    (man-hours for labour, the resource's own unit otherwise) rolled up
    through its children. The selected row moves up and down among its
    siblings with the toolbar arrows, or siblings sort by any column; the
    order is kept. */
export const ResourceWbsTable = forwardRef<WbsTableHandle, ResourceWbsTableProps>(function ResourceWbsTable(
  { activities, spans, resources, wbsPalette, hidden, widths, query, unloaded = [], onToggleUnloaded, onWidth, onState },
  ref,
) {
  const [order, setOrder] = usePersistedState<Record<string, string[]>>('schedule.wbsResourceOrder', {});
  const [sort, setSort] = usePersistedState<Sort>('schedule.wbsResourceSort', null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const labour = useMemo(() => new Set(resources.filter((r) => r.type === 'labor').map((r) => r.name)), [resources]);
  const columns = useMemo(() => wbsColumns(resources).filter((c) => c.id === WBS_NAME_COL || !hidden.includes(c.id)), [resources, hidden]);
  const widthOf = (c: WbsColumn) => widths[c.id] ?? c.width;
  const spanById = useMemo(() => new Map(spans.map((s) => [s.activity.id, s])), [spans]);
  const tree = useMemo(() => buildWbsTree(activities, (a) => a.wbsPath, (a) => a.wbsCodePath), [activities]);
  const isOut = (path: string) => inUnloadedWbs(unloaded, path);

  const { totals, grand } = useMemo(() => {
    const m = new Map<string, Totals>();
    const empty = (): Totals => ({ sums: new Map(), count: 0, start: null, finish: null });
    const add = (into: Totals, from: Totals) => {
      for (const [k, v] of from.sums) into.sums.set(k, (into.sums.get(k) ?? 0) + v);
      into.count += from.count;
      if (from.start !== null) into.start = into.start === null ? from.start : Math.min(into.start, from.start);
      if (from.finish !== null) into.finish = into.finish === null ? from.finish : Math.max(into.finish, from.finish);
    };
    const walk = (node: WbsTreeNode<Activity>): Totals => {
      const t = empty();
      for (const a of node.rows) {
        const span = spanById.get(a.id);
        add(t, { sums: span ? totalsOfSpan(span, labour) : new Map(), count: 1, start: startOf(a, 'current')?.getTime() ?? null, finish: finishOf(a, 'current')?.getTime() ?? null });
      }
      for (const c of node.children) {
        const ct = walk(c);
        if (!isOut(c.path)) add(t, ct);
      }
      m.set(node.path, t);
      return t;
    };
    const all = empty();
    for (const n of tree) {
      const nt = walk(n);
      if (!isOut(n.path)) add(all, nt);
    }
    return { totals: m, grand: all };
  }, [tree, labour, spanById, unloaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const valueOf = (node: WbsTreeNode<Activity>, col: string) => {
    const t = totals.get(node.path);
    if (col === COUNT_COL) return t?.count ?? 0;
    if (col === START_COL) return t?.start ?? 0;
    if (col === FINISH_COL) return t?.finish ?? 0;
    return t?.sums.get(col) ?? 0;
  };

  /** The children of one parent in the order shown: sorted by a column, else
      the kept manual order, else the programme's WBS order. */
  const ordered = (nodes: WbsTreeNode<Activity>[], parentKey: string) => {
    if (sort) {
      const sign = sort.dir === 'asc' ? 1 : -1;
      return [...nodes].sort((a, b) => sign * (sort.col === WBS_NAME_COL ? byName(a.label, b.label) : valueOf(a, sort.col) - valueOf(b, sort.col)));
    }
    const list = order[parentKey];
    if (!list) return nodes;
    const rank = (n: WbsTreeNode<Activity>) => {
      const i = list.indexOf(n.path);
      return i < 0 ? list.length : i;
    };
    return [...nodes].sort((a, b) => rank(a) - rank(b));
  };

  interface Line {
    node: WbsTreeNode<Activity>;
    parentKey: string;
    siblings: string[];
    index: number;
  }
  // Searching: the levels whose name matches, their parents (to reach them) and their children.
  const found = useMemo(() => {
    if (!query?.trim()) return null;
    const hit = queryMatcher(query);
    const keep = new Set<string>();
    const addAll = (n: WbsTreeNode<Activity>) => { keep.add(n.path); n.children.forEach(addAll); };
    const mark = (n: WbsTreeNode<Activity>): boolean => {
      const own = hit(n.label);
      const below = n.children.map(mark).some(Boolean);
      if (own) addAll(n);
      else if (below) keep.add(n.path);
      return own || below;
    };
    tree.forEach(mark);
    return keep;
  }, [tree, query]);

  const lines = useMemo(() => {
    const out: Line[] = [];
    const walk = (nodes: WbsTreeNode<Activity>[], parentKey: string) => {
      const list = ordered(nodes, parentKey);
      const siblings = list.map((n) => n.path);
      list.forEach((node, index) => {
        if (found && !found.has(node.path)) return;
        out.push({ node, parentKey, siblings, index });
        if (found || !collapsed.has(node.path)) walk(node.children, node.path);
      });
    };
    walk(tree, '');
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, totals, order, sort, collapsed, found]);

  const current = selected ? lines.find((l) => l.node.path === selected) ?? null : null;
  const hasOrder = sort !== null || Object.keys(order).length > 0;
  const canUp = !!current && current.index > 0;
  const canDown = !!current && current.index < current.siblings.length - 1;
  useEffect(() => onState({ canUp, canDown, hasOrder }), [canUp, canDown, hasOrder, onState]);

  const move = (delta: -1 | 1) => {
    if (!current) return;
    const next = [...current.siblings];
    const j = current.index + delta;
    if (j < 0 || j >= next.length) return;
    [next[current.index], next[j]] = [next[j], next[current.index]];
    // Moving fixes the order as shown: any column sort gives way to it.
    setOrder({ ...order, [current.parentKey]: next });
    setSort(null);
  };
  const toggleSort = (col: string) => {
    const first = col === WBS_NAME_COL ? 'asc' : 'desc';
    if (sort?.col !== col) setSort({ col, dir: first });
    else if (sort.dir === first) setSort({ col, dir: first === 'asc' ? 'desc' : 'asc' });
    else setSort(null);
  };
  const arrow = (col: string) => (sort?.col === col ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');

  const cellText = (c: WbsColumn, t: Totals | undefined) => {
    if (c.id === COUNT_COL) return fmtNum(t?.count ?? 0);
    if (c.id === START_COL) return fmtDate(t?.start ?? null);
    if (c.id === FINISH_COL) return fmtDate(t?.finish ?? null);
    const v = t?.sums.get(c.id);
    return v ? fmtNum(v) : '';
  };

  const exportCsv = () =>
    downloadCsv(
      'wbs.csv',
      columns.map((c) => c.label),
      lines.map((l) =>
        columns.map((c) => {
          if (c.id === WBS_NAME_COL) return l.node.path;
          const t = totals.get(l.node.path);
          if (c.resource) return +(t?.sums.get(c.id) ?? 0).toFixed(2);
          return cellText(c, t);
        }),
      ),
    );

  useImperativeHandle(ref, () => ({
    move,
    expandAll: () => setCollapsed(new Set()),
    collapseAll: () => setCollapsed(new Set(allWbsPaths(tree))),
    setLevel: (level) => {
      if (level === null) return setCollapsed(new Set());
      const shut = new Set<string>();
      const walk = (nodes: WbsTreeNode<Activity>[]) => {
        for (const n of nodes) {
          if (n.depth >= level && n.children.length > 0) shut.add(n.path);
          walk(n.children);
        }
      };
      walk(tree);
      setCollapsed(shut);
    },
    resetOrder: () => {
      setOrder({});
      setSort(null);
    },
    exportCsv,
  }));

  const startResize = (c: WbsColumn) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = widthOf(c);
    const onMove = (m: MouseEvent) => onWidth(c.id, Math.max(50, Math.min(900, startW + m.clientX - startX)));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="activity-table-shell rv-wbs-shell">
      <div className="activity-table-scroll">
        <table className="data-table no-resize wrap-headers">
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.id}
                  onClick={() => toggleSort(c.id)}
                  style={{ width: widthOf(c), minWidth: widthOf(c), maxWidth: widthOf(c), textAlign: c.numeric ? 'right' : undefined }}
                  title={c.label}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: c.numeric ? 'flex-end' : 'space-between', gap: 6 }}>
                    <span className="th-label">{c.label}{arrow(c.id)}</span>
                    <span
                      aria-label={`Resize ${c.label}`}
                      onMouseDown={startResize(c)}
                      onClick={(e) => e.stopPropagation()}
                      style={{ display: 'inline-block', width: 8, height: 16, cursor: 'col-resize', borderLeft: '1px solid rgba(60,64,68,0.12)', paddingLeft: 4, color: 'var(--text-dim)', flexShrink: 0 }}
                    >
                      │
                    </span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const t = totals.get(l.node.path);
              const open = !collapsed.has(l.node.path);
              const { bg, fg } = wbsGroupColors(l.node.path, wbsPalette);
              const out = isOut(l.node.path);
              const outHere = unloaded.includes(l.node.path); // unloaded itself, not just inside an unloaded branch
              return (
                <tr
                  key={l.node.path}
                  className={`group-header-row${selected === l.node.path ? ' rv-wbs-selected' : ''}${out ? ' rv-wbs-out' : ''}`}
                  style={{ background: bg, color: fg }}
                  onClick={() => setSelected(selected === l.node.path ? null : l.node.path)}
                >
                  {columns.map((c) =>
                    c.id === WBS_NAME_COL ? (
                      <td key={c.id} style={{ paddingLeft: 10 + l.node.depth * 18 }}>
                        {l.node.children.length > 0 ? (
                          <button
                            type="button"
                            className="rv-twisty"
                            aria-expanded={open}
                            aria-label={open ? 'Collapse' : 'Expand'}
                            style={{ color: fg }}
                            onClick={(e) => {
                              e.stopPropagation();
                              const next = new Set(collapsed);
                              if (open) next.add(l.node.path);
                              else next.delete(l.node.path);
                              setCollapsed(next);
                            }}
                          >
                            <IconExpander open={open} />
                          </button>
                        ) : (
                          <span className="rv-twisty" />
                        )}
                        <span className="rv-wbs-label">{l.node.label}</span>
                        {onToggleUnloaded && (
                          <button
                            type="button"
                            className="rv-wbs-eye"
                            style={{ color: fg }}
                            disabled={out && !outHere}
                            aria-pressed={out}
                            aria-label={out ? 'Load this WBS again' : 'Unload this WBS'}
                            title={out ? (outHere ? 'Unloaded: its activities are out of the programme in every view. Click to load them again.' : 'Inside an unloaded WBS.') : 'Unload this WBS: leave its activities out of the programme in every view (nothing is deleted).'}
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleUnloaded(l.node.path);
                            }}
                          >
                            {out ? <IconEyeOff width={14} height={14} /> : <IconEye width={14} height={14} />}
                          </button>
                        )}
                      </td>
                    ) : (
                      <td key={c.id} style={{ textAlign: 'right' }}>{cellText(c, t)}</td>
                    ),
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="rv-wbs-total">
              {columns.map((c) => (
                <td key={c.id} style={{ textAlign: c.numeric ? 'right' : undefined }}>
                  {c.id === WBS_NAME_COL ? 'Total' : c.id === START_COL || c.id === FINISH_COL ? cellText(c, grand) : cellText(c, grand)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
});
