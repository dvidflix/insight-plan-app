import { useMemo, useState } from 'react';
import type { ActivityCodeTypeDef, ActivityCodeValue, ScheduleModel } from '../../schedule/types';
import { ToolbarSlot } from './ToolbarSlot';
import { queryMatcher } from '../../schedule/search';
import { ExpandCollapseToggle } from '../ExpandCollapseToggle';
import { IconExpander, IconRemove } from '../icons';
import { addCodeType, addCodeValue, assignCode, deleteCodeType, deleteCodeValue, moveCodeValue, renameCodeType, renameCodeValue } from '../../schedule/planCodes';
import type { Result } from '../../schedule/programmeCommands';
import { editStructure } from '../../state/programmeEdits';
import { commit } from '../../state/programmeHistory';
import { programmeKey } from '../../state/unloadedWbsStore';
import { useActivitySelectionStore } from '../../state/activitySelectionStore';

interface ActivityCodesViewProps {
  model: ScheduleModel;
  /** Pushes the given code type -> selected values onto the shared activity
      filters and switches to the Table View, so isolating codes here can
      double as "show me the activities with these codes". */
  onFilterActivities?: (byType: Map<string, Set<string>>) => void;
  /** Says what an edit did, or why it could not be done. */
  onNote?: (text: string) => void;
}

type FlatRow =
  | { kind: 'type'; type: ActivityCodeTypeDef; key: string }
  | { kind: 'value'; type: ActivityCodeTypeDef; node: ActivityCodeValue; key: string; depth: number; hasChildren: boolean };

function nodeMatches(node: ActivityCodeValue, hit: (text: string) => boolean): boolean {
  return hit(node.value) || hit(node.description);
}

export function ActivityCodesView({ model, onFilterActivities, onNote }: ActivityCodesViewProps) {
  // A type without values stays listed: it is where the values are added.
  const catalog = useMemo(() => model.activityCodeCatalog ?? [], [model.activityCodeCatalog]);
  const [editing, setEditing] = useState<{ key: string; draft: string } | null>(null);
  const pickedIds = useActivitySelectionStore((s) => s.ids);
  const anchor = useActivitySelectionStore((s) => s.anchor);
  const picked = useMemo(() => {
    const ids = new Set(pickedIds);
    if (anchor) ids.add(anchor);
    return model.activities.filter((a) => ids.has(a.id));
  }, [pickedIds, anchor, model.activities]);
  const say = (text: string) => onNote?.(text);
  /** Every change is one undoable edit, kept in the project database like the Planner's. */
  const run = <T extends object>(label: string, command: (m: ScheduleModel) => Result<T>): boolean => {
    if (!model.editable) { say('This programme is not edited in place: make an editable copy of it first (Inputs, the pencil).'); return false; }
    const r = commit(label, () => editStructure(programmeKey(model), command));
    if ('error' in r) { say(r.error); return false; }
    return true;
  };
  const finishEdit = (save: boolean) => {
    const e = editing;
    setEditing(null);
    if (!e || !save) return;
    const [kind, typeId, valueId] = e.key.split('::');
    if (kind === 'type') run('Rename code type', (m) => renameCodeType(m, typeId, e.draft));
    else run('Rename code', (m) => renameCodeValue(m, typeId, valueId, e.draft));
  };
  const addType = () => {
    const name = window.prompt('Name of the new code type:', '')?.trim();
    if (name) run('Add code type', (m) => addCodeType(m, name));
  };
  const addValue = (type: ActivityCodeTypeDef, parentId: string | null) => {
    const value = window.prompt(`New ${type.name} code${parentId ? ' under it' : ''}:`, '')?.trim();
    if (value) run('Add code', (m) => addCodeValue(m, type.id, value, parentId));
  };
  const assign = (type: ActivityCodeTypeDef, node: ActivityCodeValue | null) => {
    if (!picked.length) { say('Pick activities in the Gantt or the Table first, then assign them here.'); return; }
    const ids = picked.map((a) => a.id);
    const done = { n: 0 };
    if (run(node ? `Set ${type.name}` : `Clear ${type.name}`, (m) => { const r = assignCode(m, ids, type.name, node?.value ?? null); if (!('error' in r)) done.n = r.changed; return r; })) {
      say(node ? `${type.name} ${node.value}: ${done.n} of ${picked.length} activities changed.` : `${type.name} taken off ${done.n} of ${picked.length} activities.`);
    }
  };
  const indent = (type: ActivityCodeTypeDef, node: ActivityCodeValue) => {
    // Under the code just above it with the same parent.
    const siblings = type.values.filter((v) => v.parentId === node.parentId).sort((a, b) => a.value.localeCompare(b.value, undefined, { numeric: true }));
    const above = siblings[siblings.findIndex((v) => v.id === node.id) - 1];
    if (above) run('Indent code', (m) => moveCodeValue(m, type.id, node.id, above.id));
    else say('There is no code above it at this level to go under.');
  };
  const outdent = (type: ActivityCodeTypeDef, node: ActivityCodeValue) => {
    if (node.parentId === null) return;
    const parent = type.values.find((v) => v.id === node.parentId);
    run('Outdent code', (m) => moveCodeValue(m, type.id, node.id, parent?.parentId ?? null));
  };
  const removeValue = (type: ActivityCodeTypeDef, node: ActivityCodeValue, n: number) => {
    if (n && !window.confirm(`${type.name} ${node.value} is on ${n} activities. Delete it and take it off them?`)) return;
    run('Delete code', (m) => deleteCodeValue(m, type.id, node.id));
  };
  const removeType = (type: ActivityCodeTypeDef) => {
    if (window.confirm(`Delete the code type “${type.name}” with its ${type.values.length} values? They are taken off the activities.`)) run('Delete code type', (m) => deleteCodeType(m, type.id));
  };
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
        <button type="button" className="btn btn--small" onClick={addType} title="Add an activity code type, like Area or Trade; then add its values">New code type</button>
        <span style={{ flex: 1 }} />
        <span className="groupby-panel__title" title="The activities picked in the Gantt or the Table: the Assign buttons give them a code">{picked.length ? `${picked.length} ${picked.length === 1 ? 'activity' : 'activities'} picked` : 'No activities picked'}</span>
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
                <th style={{ width: 250 }}>Assign · edit</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                if (row.kind === 'type') {
                  const isCollapsed = collapsed.has(row.key);
                  return (
                    <tr key={row.key} className="group-header-row" onClick={() => toggleCollapsed(row.key)}>
                      <td colSpan={4} style={{ paddingLeft: 10 }} onDoubleClick={(e) => { e.stopPropagation(); setEditing({ key: `type::${row.type.id}`, draft: row.type.name }); }} title="Double-click to rename">
                        <IconExpander open={!isCollapsed} />{' '}
                        {editing?.key === `type::${row.type.id}`
                          ? <input className="plan-panel__text" autoFocus value={editing.draft} onClick={(e) => e.stopPropagation()} onChange={(e) => setEditing({ ...editing, draft: e.target.value })} onBlur={() => finishEdit(true)} onKeyDown={(e) => { if (e.key === 'Enter') finishEdit(true); else if (e.key === 'Escape') finishEdit(false); }} />
                          : row.type.name}{' '}
                        <span style={{ color: 'var(--text-dim)' }}>({row.type.values.length})</span>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                       <div style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 4, width: 'max-content' }}>
                        <button type="button" className="btn btn--small" onClick={() => addValue(row.type, null)} title={`Add a ${row.type.name} code`}>+ Code</button>
                        <button type="button" className="btn btn--small" disabled={!picked.length} onClick={() => assign(row.type, null)} title={`Take ${row.type.name} off the picked activities`}>Clear</button>{' '}
                        <button type="button" className="icon-btn" aria-label={`Delete ${row.type.name}`} title="Delete the type and its codes" onClick={() => removeType(row.type)}><IconRemove /></button>
                       </div>
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
                        {editing?.key === `value::${type.id}::${node.id}`
                          ? <input className="plan-panel__text" autoFocus value={editing.draft} onClick={(e) => e.preventDefault()} onChange={(e) => setEditing({ ...editing, draft: e.target.value })} onBlur={() => finishEdit(true)} onKeyDown={(e) => { if (e.key === 'Enter') finishEdit(true); else if (e.key === 'Escape') finishEdit(false); }} />
                          : <span title="Double-click to rename" onDoubleClick={(e) => { e.preventDefault(); setEditing({ key: `value::${type.id}::${node.id}`, draft: node.value }); }}>{node.value}</span>}
                      </label>
                    </td>
                    <td style={{ color: 'var(--text-dim)' }}>{node.description !== node.value ? node.description : ''}</td>
                    <td style={{ textAlign: 'right' }}>{countFor(type, node) || ''}</td>
                    <td>
                     <div style={{ display: 'flex', flexWrap: 'nowrap', alignItems: 'center', gap: 4, width: 'max-content' }}>
                      <button type="button" className="btn btn--small primary" disabled={!picked.length} onClick={() => assign(type, node)} title={`Give the ${picked.length || ''} picked activities ${type.name} ${node.value}`}>Assign</button>
                      <button type="button" className="icon-btn" aria-label="Add a code under it" title="Add a code under this one" onClick={() => addValue(type, node.id)}>+</button>
                      <button type="button" className="icon-btn" aria-label="Indent" title="Indent: put it under the code above" onClick={() => indent(type, node)}>⇥</button>
                      <button type="button" className="icon-btn" aria-label="Outdent" title="Outdent: take it up a level" disabled={node.parentId === null} onClick={() => outdent(type, node)}>⇤</button>
                      <button type="button" className="icon-btn" aria-label={`Delete ${node.value}`} title="Delete the code" onClick={() => removeValue(type, node, countFor(type, node))}><IconRemove /></button>
                     </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 16, color: 'var(--text-dim)' }}>{catalog.length === 0 ? 'This programme has no activity codes yet: add a code type, then its codes.' : 'No matching activity codes.'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
