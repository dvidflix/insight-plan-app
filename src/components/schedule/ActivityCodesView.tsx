import { useMemo, useState } from 'react';
import type { ActivityCodeTypeDef, ActivityCodeValue, ScheduleModel } from '../../schedule/types';
import { ToolbarSlot } from './ToolbarSlot';
import { queryMatcher } from '../../schedule/search';
import { ExpandCollapseToggle } from '../ExpandCollapseToggle';
import { IconExpander } from '../icons';

interface ActivityCodesViewProps {
  model: ScheduleModel;
  /** Pushes the given code type -> selected values onto the shared activity
      filters and switches to the Table View, so isolating codes here can
      double as "show me the activities with these codes". */
  onFilterActivities?: (byType: Map<string, Set<string>>) => void;
}

type FlatRow =
  | { kind: 'type'; type: ActivityCodeTypeDef; key: string }
  | { kind: 'value'; type: ActivityCodeTypeDef; node: ActivityCodeValue; key: string; depth: number; hasChildren: boolean };

function nodeMatches(node: ActivityCodeValue, hit: (text: string) => boolean): boolean {
  return hit(node.value) || hit(node.description);
}

export function ActivityCodesView({ model, onFilterActivities }: ActivityCodesViewProps) {
  const catalog = useMemo(() => (model.activityCodeCatalog ?? []).filter((t) => t.values.length > 0), [model.activityCodeCatalog]);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  const usageCounts = useMemo(() => {
    const byType = new Map<string, Map<string, number>>();
    for (const type of catalog) {
      const counts = new Map<string, number>();
      for (const a of model.activities) {
        const assigned = a.activityCodes[type.name];
        if (assigned) counts.set(assigned, (counts.get(assigned) ?? 0) + 1);
      }
      byType.set(type.id, counts);
    }
    return byType;
  }, [catalog, model.activities]);

  const countFor = (type: ActivityCodeTypeDef, node: ActivityCodeValue) => {
    const counts = usageCounts.get(type.id);
    if (!counts) return 0;
    let n = counts.get(node.value) ?? 0;
    if (node.description !== node.value) n += counts.get(node.description) ?? 0;
    return n;
  };

  const q = search.trim().toLowerCase();
  const hit = queryMatcher(search);

  const rows = useMemo(() => {
    const out: FlatRow[] = [];
    for (const type of catalog) {
      const byParent = new Map<string, ActivityCodeValue[]>();
      const ids = new Set(type.values.map((v) => v.id));
      for (const v of type.values) {
        const parentKey = v.parentId && ids.has(v.parentId) ? v.parentId : '__root__';
        const list = byParent.get(parentKey) ?? [];
        list.push(v);
        byParent.set(parentKey, list);
      }
      for (const list of byParent.values()) list.sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));

      // A node "matches" the search/selection filter if it does itself, or
      // any descendant does — so ancestors of a hit stay visible too.
      const matchCache = new Map<string, boolean>();
      const selfMatches = (node: ActivityCodeValue) => {
        if (q && !nodeMatches(node, hit)) return false;
        if (showSelectedOnly && !selected.has(`${type.id}::${node.id}`)) return false;
        return true;
      };
      const subtreeMatches = (node: ActivityCodeValue): boolean => {
        if (matchCache.has(node.id)) return matchCache.get(node.id)!;
        matchCache.set(node.id, true); // break cycles defensively
        const children = byParent.get(node.id) ?? [];
        const result = selfMatches(node) || children.some(subtreeMatches);
        matchCache.set(node.id, result);
        return result;
      };
      for (const v of type.values) subtreeMatches(v);

      const typeMatches = !q && !showSelectedOnly ? true : type.values.some((v) => matchCache.get(v.id));
      if (!typeMatches) continue;
      const typeKey = `t:${type.id}`;
      out.push({ kind: 'type', type, key: typeKey });
      if (collapsed.has(typeKey)) continue;

      const walk = (parentKey: string, depth: number) => {
        for (const node of byParent.get(parentKey) ?? []) {
          if (!matchCache.get(node.id)) continue;
          const key = `${type.id}::${node.id}`;
          const hasChildren = (byParent.get(node.id) ?? []).length > 0;
          out.push({ kind: 'value', type, node, key, depth, hasChildren });
          if (hasChildren && !collapsed.has(key)) walk(node.id, depth + 1);
        }
      };
      walk('__root__', 1);
    }
    return out;
  }, [catalog, q, showSelectedOnly, selected, collapsed]);

  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const toggleSelected = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  const applyFilter = () => {
    const byType = new Map<string, Set<string>>();
    for (const key of selected) {
      const [typeId, nodeId] = key.split('::');
      const type = catalog.find((t) => t.id === typeId);
      const node = type?.values.find((v) => v.id === nodeId);
      if (!type || !node) continue;
      const set = byType.get(type.name) ?? new Set<string>();
      set.add(node.value);
      if (node.description !== node.value) set.add(node.description);
      byType.set(type.name, set);
    }
    if (byType.size > 0) onFilterActivities?.(byType);
  };

  if (catalog.length === 0) {
    return (
      <div className="page" style={{ padding: 24 }}>
        <div className="empty-input-state__text">This programme has no activity codes.</div>
      </div>
    );
  }

  return (
    <div className="activity-codes-view">
      <ToolbarSlot>
        <input
          className="filterbar__search"
          placeholder="Search code value or description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="cols__check" style={{ margin: 0 }}>
          <input type="checkbox" checked={showSelectedOnly} onChange={(e) => setShowSelectedOnly(e.target.checked)} disabled={selected.size === 0} />
          <span>Show selected only</span>
        </label>
        <ExpandCollapseToggle
          className="btn btn--small"
          collapsed={catalog.length > 0 && catalog.every((t) => collapsed.has(`t:${t.id}`))}
          onCollapse={() => setCollapsed(new Set(catalog.map((t) => `t:${t.id}`)))}
          onExpand={() => setCollapsed(new Set())}
        />
        <span style={{ flex: 1 }} />
        {selected.size > 0 && (
          <>
            <span className="groupby-panel__title">{selected.size} selected</span>
            <button type="button" className="btn btn--small" onClick={() => setSelected(new Set())}>Clear</button>
            {onFilterActivities && (
              <button type="button" className="btn btn--small primary" onClick={applyFilter}>Isolate in Table View →</button>
            )}
          </>
        )}
      </ToolbarSlot>
      <div className="activity-table-shell">
        <div className="activity-table-scroll">
          <table className="data-table no-resize">
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>Activity Code Value</th>
                <th>Description</th>
                <th style={{ width: 90, textAlign: 'right' }}>Activities</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (row.kind === 'type') {
                  const isCollapsed = collapsed.has(row.key);
                  return (
                    <tr key={row.key} className="group-header-row" onClick={() => toggleCollapsed(row.key)}>
                      <td colSpan={4} style={{ paddingLeft: 10 }}>
                        <IconExpander open={!isCollapsed} /> {row.type.name} <span style={{ color: 'var(--text-dim)' }}>({row.type.values.length})</span>
                      </td>
                    </tr>
                  );
                }
                const { type, node, depth, key, hasChildren } = row;
                return (
                  <tr key={key} className={selected.has(key) ? 'selected' : ''}>
                    <td
                      style={{ paddingLeft: 8 + depth * 18, cursor: hasChildren ? 'pointer' : 'default' }}
                      onClick={hasChildren ? () => toggleCollapsed(key) : undefined}
                    >
                      {hasChildren ? <IconExpander open={!collapsed.has(key)} /> : ''}
                    </td>
                    <td>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input type="checkbox" checked={selected.has(key)} onChange={() => toggleSelected(key)} />
                        <span>{node.value}</span>
                      </label>
                    </td>
                    <td style={{ color: 'var(--text-dim)' }}>{node.description !== node.value ? node.description : ''}</td>
                    <td style={{ textAlign: 'right' }}>{countFor(type, node) || ''}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 16, color: 'var(--text-dim)' }}>No matching activity codes.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
