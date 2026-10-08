import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Activity } from '../../schedule/types';
import { downloadCsv } from '../../utils/csv';
import { wbsGroupColors } from '../../schedule/wbsPalette';
import { type WbsTreeNode, allWbsPaths, buildRuleTree, buildWbsTree, wbsPathsAtOrBeyondDepth } from '../../schedule/wbsTree';
import { usePersistedState } from '../../utils/persistedState';
import { applyWbsOrder, useWbsOrder } from '../../state/wbsOrder';
import type { ColumnCtx, ColumnDef } from '../../schedule/columns';
import { useTableStyleStore } from '../../state/tableStyleStore';
import type { GroupRule } from './GroupPanel';
import { useAggregateStore } from '../../state/aggregateStore';
import { aggregate, aggType, defaultAgg, type AggKind } from '../../schedule/aggregates';
import { AggCell } from './AggCell';
import { IconExpander } from '../icons';
import { useActivitySelectionStore } from '../../state/activitySelectionStore';

export interface ActivityTableHandle {
  download: () => void;
}

interface ActivityTableProps {
  activities: Activity[];
  selectedId: string | null;
  groupBy: string;
  /** Group rules (Configuration > Group): one nesting level per rule. Used
      instead of the single `groupBy` field when not grouping by WBS. */
  groupRules?: GroupRule[];
  /** '' leaves the WBS tree fully expanded; '0'-'4' collapses every group at
      that depth and deeper. Only meaningful when groupBy === 'wbs'. */
  wbsLevel?: string;
  /** Columns to show, in display order. */
  columns: ColumnDef[];
  /** Every column the schedule offers (sort/group may use hidden ones). */
  catalog: ColumnDef[];
  columnCtx: ColumnCtx;
  getColor?: (activity: Activity) => string | null;
  sortField?: string;
  sortDirection?: 'up' | 'down';
  collapseAllSignal?: number;
  expandAllSignal?: number;
  wbsPalette?: string;
  /** localStorage prefix for sort and column widths (default 'table'), so a
      second table doesn't share them with the Table View. */
  persistKey?: string;
  /** Adds a bar under the rows with the total of each summable column. */
  showTotals?: boolean;
  /** Programmes: totals row and group subtotals as set with Σ Totals, each
      column summarised its own way (sum, average, min, max, dates…). */
  aggregatable?: boolean;
  /** Rows faded back (the curtain: what the filters or the driving path leave out). */
  dimmedIds?: Set<string>;
  /** Rows picked out (the driving path). */
  markedIds?: Set<string>;
  onSelect: (activity: Activity) => void;
  /** Double-click on a row. */
  onOpen?: (activity: Activity) => void;
}

/** Resolves a group-by field id (any catalog column, including activity-code
    and user-field columns) to the group a row falls in. WBS grouping is
    handled separately as a real tree (see buildWbsTree) so "Group Levels"
    can collapse it. */
function groupValue(catalog: ColumnDef[], ctx: ColumnCtx, a: Activity, fieldId: string): string {
  return catalog.find((c) => c.id === fieldId)?.text(a, ctx) ?? '';
}

export const ActivityTable = forwardRef<ActivityTableHandle, ActivityTableProps>(function ActivityTable({
  activities,
  selectedId,
  dimmedIds,
  markedIds,
  groupBy,
  groupRules,
  wbsLevel = '',
  columns,
  catalog,
  columnCtx,
  getColor,
  sortField,
  sortDirection,
  collapseAllSignal,
  expandAllSignal,
  wbsPalette = 'project',
  persistKey = 'table',
  showTotals = false,
  aggregatable = false,
  onSelect,
  onOpen,
}, ref) {
  const [sortCol, setSortCol] = usePersistedState(`${persistKey}.sortCol`, 'start');
  const [sortAsc, setSortAsc] = usePersistedState(`${persistKey}.sortAsc`, true);
  const [columnWidths, setColumnWidths] = usePersistedState<Record<string, number>>(`${persistKey}.columnWidths`, {});
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const widthOf = (c: ColumnDef) => columnWidths[c.id] ?? c.width;

  // The Sort pane drives the table's sort the same way clicking a column
  // header does — it just sets the same state from outside.
  useEffect(() => {
    if (!sortField) return;
    setSortCol(sortField);
    setSortAsc(sortDirection !== 'down');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortField, sortDirection]);

  const rows = useMemo(() => {
    const col = catalog.find((c) => c.id === sortCol) ?? catalog[0];
    if (!col) return activities;
    const dir = sortAsc ? 1 : -1;
    const keyed = activities.map((a) => ({ a, k: col.sort(a, columnCtx) }));
    keyed.sort((x, y) =>
      typeof x.k === 'number' && typeof y.k === 'number' ? dir * (x.k - y.k) : dir * String(x.k).localeCompare(String(y.k)));
    return keyed.map((e) => e.a);
  }, [activities, catalog, columnCtx, sortCol, sortAsc]);

  // Σ Totals (Programmes): how each column is summarised.
  const aggShow = useAggregateStore((s) => s.showTotals);
  const aggKinds = useAggregateStore((s) => s.kinds);
  const setAggKind = useAggregateStore((s) => s.setKind);
  const totalsOn = showTotals || (aggregatable && aggShow);
  const kindOf = (c: ColumnDef): AggKind => (aggregatable ? aggKinds[c.id] ?? defaultAgg(c) : c.summable ? 'sum' : 'none');

  // Column totals over every row shown (grouping doesn't change them).
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    if (!showTotals || aggregatable) return m;
    for (const c of columns) {
      if (!c.summable) continue;
      let n = 0;
      for (const a of rows) {
        const v = c.sort(a, columnCtx);
        if (typeof v === 'number' && Number.isFinite(v)) n += v;
      }
      m.set(c.id, Math.round(n * 100) / 100);
    }
    return m;
  }, [rows, columns, columnCtx, showTotals, aggregatable]);

  // The totals row is pinned just under the header, so it needs the header's height.
  const wrapHeaders = useTableStyleStore((s) => s.wrapHeaders);
  const headRowRef = useRef<HTMLTableRowElement>(null);
  const [headHeight, setHeadHeight] = useState(28);
  useLayoutEffect(() => {
    if (headRowRef.current) setHeadHeight(headRowRef.current.offsetHeight);
  }, [columns, totalsOn, wrapHeaders, columnWidths]);

  const resizeColumn = (columnId: string, nextX: number) => {
    const nextWidth = Math.max(60, Math.min(600, nextX));
    setColumnWidths((prev) => ({ ...prev, [columnId]: nextWidth }));
  };

  const headerClick = (id: string) => {
    if (id === sortCol) setSortAsc(!sortAsc);
    else {
      setSortCol(id);
      setSortAsc(true);
    }
  };

  const toggleGroupCollapsed = (key: string) => {
    const next = new Set(collapsedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsedGroups(next);
  };

  const isWbsGroup = groupBy === 'wbs';

  const [wbsOrder] = useWbsOrder();
  const wbsTree = useMemo(
    () => (isWbsGroup ? applyWbsOrder(buildWbsTree(rows, (a) => a.wbsPath, (a) => a.wbsCodePath), wbsOrder) : []),
    [rows, isWbsGroup, wbsOrder],
  );
  // Field grouping: every rule is one level (the first outermost).
  const ruleTree = useMemo(() => {
    if (isWbsGroup || !groupRules?.length) return null;
    const byId = new Map(catalog.map((c) => [c.id, c]));
    return buildRuleTree(rows, groupRules, (a, field) => byId.get(field)?.text(a, columnCtx) ?? '');
  }, [rows, isWbsGroup, groupRules, catalog, columnCtx]);

  type GroupItem =
    | { kind: 'group'; path: string; label: string; depth: number; count: number }
    | { kind: 'row'; row: Activity };

  const groupItems = useMemo((): GroupItem[] | null => {
    if (!groupBy) return null;
    const items: GroupItem[] = [];
    if (isWbsGroup || ruleTree) {
      const walk = (nodes: WbsTreeNode<Activity>[]) => {
        for (const node of nodes) {
          items.push({ kind: 'group', path: node.path, label: node.label, depth: node.depth, count: node.descendantCount });
          if (collapsedGroups.has(node.path)) continue;
          for (const r of node.rows) items.push({ kind: 'row', row: r });
          walk(node.children);
        }
      };
      walk(ruleTree ?? wbsTree);
      return items;
    }
    const map = new Map<string, Activity[]>();
    for (const r of rows) {
      const key = groupValue(catalog, columnCtx, r, groupBy) || '(none)';
      (map.get(key) ?? map.set(key, []).get(key)!).push(r);
    }
    for (const [key, groupRows] of map) {
      items.push({ kind: 'group', path: key, label: key, depth: 0, count: groupRows.length });
      if (!collapsedGroups.has(key)) for (const r of groupRows) items.push({ kind: 'row', row: r });
    }
    return items;
  }, [rows, groupBy, isWbsGroup, wbsTree, ruleTree, collapsedGroups, catalog, columnCtx]);

  // Every group's activities (all levels below it), for the subtotals.
  const subtotalsOn = aggregatable && aggShow && !!groupItems;
  const groupActs = useMemo(() => {
    const m = new Map<string, Activity[]>();
    if (!subtotalsOn) return m;
    const collect = (n: WbsTreeNode<Activity>): Activity[] => {
      const all = [...n.rows, ...n.children.flatMap(collect)];
      m.set(n.path, all);
      return all;
    };
    if (isWbsGroup) wbsTree.forEach(collect);
    else if (ruleTree) ruleTree.forEach(collect);
    else if (groupBy) {
      for (const r of rows) {
        const key = groupValue(catalog, columnCtx, r, groupBy) || '(none)';
        (m.get(key) ?? m.set(key, []).get(key)!).push(r);
      }
    }
    return m;
  }, [subtotalsOn, isWbsGroup, wbsTree, ruleTree, groupBy, rows, catalog, columnCtx]);

  // Picking a Group Level re-seeds which WBS nodes start collapsed (depth
  // >= N); after that, clicks toggle individual nodes same as before, until
  // the level control is changed again. Only meaningful while grouped by WBS.
  useEffect(() => {
    if (!isWbsGroup) return;
    if (wbsLevel === '') setCollapsedGroups(new Set());
    else setCollapsedGroups(new Set(wbsPathsAtOrBeyondDepth(wbsTree, Number(wbsLevel))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wbsLevel, isWbsGroup]);

  useEffect(() => {
    if (collapseAllSignal === undefined || !groupBy) return;
    if (isWbsGroup) setCollapsedGroups(new Set(allWbsPaths(wbsTree)));
    else if (ruleTree) setCollapsedGroups(new Set(allWbsPaths(ruleTree)));
    else if (groupItems) setCollapsedGroups(new Set(groupItems.filter((i): i is Extract<GroupItem, { kind: 'group' }> => i.kind === 'group').map((i) => i.path)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapseAllSignal]);

  useEffect(() => {
    if (expandAllSignal === undefined) return;
    setCollapsedGroups(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandAllSignal]);

  // Ctrl+click adds or removes a row, Shift+click picks the rows between (in the order listed now).
  const multi = useActivitySelectionStore((s) => s.ids);
  const listedIds = (): string[] => (groupItems ? groupItems.flatMap((i) => (i.kind === 'row' ? [i.row.id] : [])) : rows.map((r) => r.id));
  const renderRow = (a: Activity) => {
    const ruleColor = getColor?.(a) ?? null;
    const picked = multi.size > 1 && multi.has(a.id);
    return (
      <tr
        key={a.id}
        className={`${a.id === selectedId || picked ? 'selected' : ''}${dimmedIds?.has(a.id) ? ' is-dim' : ''}${markedIds?.has(a.id) ? ' is-marked' : ''}`}
        onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
        onClick={(e) => {
          useActivitySelectionStore.getState().click(a.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }, listedIds());
          onSelect(a);
        }}
        onDoubleClick={onOpen ? () => onOpen(a) : undefined}
        style={{
          ...(ruleColor ? { background: ruleColor } : undefined),
          ...(a.id === selectedId || picked ? { outline: '1px solid var(--accent)' } : undefined),
        }}
      >
        {columns.map((c) => {
          const value = c.text(a, columnCtx);
          return (
            <td key={c.id} title={value} style={{ width: widthOf(c), minWidth: widthOf(c), maxWidth: widthOf(c), textAlign: c.align }}>
              {value}
            </td>
          );
        })}
      </tr>
    );
  };

  useImperativeHandle(ref, () => ({
    download: () => {
      downloadCsv(
        'activities.csv',
        columns.map((c) => c.label),
        rows.map((a) => columns.map((c) => c.text(a, columnCtx))),
      );
    },
  }));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="activity-table-shell">
        <div className="activity-table-scroll">
          <table className={`data-table no-resize${wrapHeaders ? ' wrap-headers' : ''}`}>
            <thead>
              <tr ref={headRowRef}>
                {columns.map((c) => (
                  <th
                    key={c.id}
                    onClick={() => headerClick(c.id)}
                    style={{ width: widthOf(c), minWidth: widthOf(c), maxWidth: widthOf(c) }}
                    title={c.label}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                      <span className="th-label">{c.label}{sortCol === c.id ? (sortAsc ? ' ▲' : ' ▼') : ''}</span>
                      <span
                        aria-label={`Resize ${c.label}`}
                        onMouseDown={(e) => {
                          const startX = e.clientX;
                          const startWidth = widthOf(c);
                          const onMove = (moveEvent: MouseEvent) => resizeColumn(c.id, startWidth + (moveEvent.clientX - startX));
                          const onUp = () => {
                            window.removeEventListener('mousemove', onMove);
                            window.removeEventListener('mouseup', onUp);
                          };
                          window.addEventListener('mousemove', onMove);
                          window.addEventListener('mouseup', onUp);
                          e.preventDefault();
                        }}
                        style={{ display: 'inline-block', width: 8, height: 16, cursor: 'col-resize', borderLeft: '1px solid rgba(60,64,68,0.12)', paddingLeft: 4, color: 'var(--text-dim)' }}
                      >
                        │
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
              {totalsOn && (
                <tr className="totals-row">
                  {columns.map((c, i) => (
                    <td key={c.id} style={{ top: headHeight, width: widthOf(c), minWidth: widthOf(c), maxWidth: widthOf(c), textAlign: c.align }}>
                      {aggregatable && aggType(c) ? (
                        <AggCell column={c} kind={kindOf(c)} value={aggregate(c, kindOf(c), rows, columnCtx)} onKind={(k) => setAggKind(c.id, k)} />
                      ) : c.summable
                        ? totals.get(c.id)?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? ''
                        : i === 0 ? `Total · ${rows.length.toLocaleString()} ${rows.length === 1 ? 'task' : 'tasks'}` : ''}
                    </td>
                  ))}
                </tr>
              )}
            </thead>
            <tbody>
              {groupItems
                ? groupItems.map((item) => {
                    if (item.kind === 'row') return renderRow(item.row);
                    const isCollapsed = collapsedGroups.has(item.path);
                    const { bg, fg } = isWbsGroup ? wbsGroupColors(item.path, wbsPalette) : { bg: undefined, fg: undefined };
                    // Subtotals: the label spans up to the first summarised column.
                    const firstAgg = subtotalsOn ? columns.findIndex((c) => kindOf(c) !== 'none') : -1;
                    const labelSpan = firstAgg <= 0 ? Math.max(1, firstAgg === 0 ? 1 : columns.length) : firstAgg;
                    const groupRows = groupActs.get(item.path) ?? [];
                    return (
                      <tr
                        key={`g:${item.path}`}
                        className="group-header-row"
                        onClick={() => toggleGroupCollapsed(item.path)}
                        style={bg ? { background: bg, color: fg } : undefined}
                      >
                        <td colSpan={labelSpan} style={{ paddingLeft: 10 + item.depth * 18 }}>
                          <IconExpander open={!isCollapsed} /> {item.label} <span style={{ color: fg ?? 'var(--text-dim)', opacity: fg ? 0.7 : 1 }}>({item.count})</span>
                        </td>
                        {firstAgg >= 0 && columns.slice(labelSpan).map((c) => (
                          <td key={c.id} className="group-subtotal" style={{ textAlign: c.align }}>
                            {kindOf(c) !== 'none' ? aggregate(c, kindOf(c), groupRows, columnCtx) : ''}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                : rows.map(renderRow)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});
