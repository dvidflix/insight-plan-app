import { useEffect, useMemo, useState } from 'react';
import type * as OBC from '@thatopen/components';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useSelectionStore } from '../state/selectionStore';
import { useModelsStore } from '../state/modelsStore';
import { usePropertyVisibilityStore } from '../state/propertyVisibilityStore';
import { buildProperties, objectsWithValue, type PropertyRow } from '../viewer/bimTables';
import { CollapsibleSection } from './CollapsibleSection';
import { ExpandCollapseToggle } from './ExpandCollapseToggle';
import { withUnit } from '../viewer/units';
import { IconChevronRight, IconExpandMore } from './icons';
import { queryMatcher } from '../schedule/search';

interface Row {
  data: PropertyRow;
  children?: Row[];
}

/** The Properties tab: the selected objects' properties (or the whole model's when nothing is
    selected) as collapsible property sets, each a compact ruled grid like the Activity pane.
    Several objects with different values show "<N different values>" with a value | count
    breakdown. Click a value to select the objects that have it (Ctrl+click: among all objects). */
export function PropertiesGrid() {
  const engine = useViewerEngine();
  const byModel = useSelectionStore((s) => s.byModel);
  const hiddenPsets = usePropertyVisibilityStore((s) => s.hiddenPsets);
  const hiddenProps = usePropertyVisibilityStore((s) => s.hiddenProps);
  const expandMode = usePropertyVisibilityStore((s) => s.expandMode);
  const setExpandMode = usePropertyVisibilityStore((s) => s.setExpandMode);
  const models = useModelsStore((s) => s.models);
  const [tick, setTick] = useState(0);
  const [filter, setFilter] = useState('');
  // Sets opened or closed by hand, against the Collapse / Expand all default; breakdowns opened.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [openValues, setOpenValues] = useState<Set<string>>(new Set());

  useEffect(() => {
    const refresh = () => setTick((t) => t + 1);
    engine.onSetsReady.add(refresh);
    return () => {
      engine.onSetsReady.remove(refresh);
    };
  }, [engine]);

  const table = useMemo(() => {
    const selection: OBC.ModelIdMap = {};
    for (const [modelId, ids] of Object.entries(byModel)) if (ids.length) selection[modelId] = new Set(ids);
    return buildProperties(engine.getIndexes(), selection, { psets: new Set(hiddenPsets), props: new Set(hiddenProps) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, byModel, hiddenPsets, hiddenProps, models, tick]);

  // A new selection starts with the breakdowns closed.
  useEffect(() => setOpenValues(new Set()), [byModel]);
  useEffect(() => setToggled(new Set()), [expandMode]);

  const hit = useMemo(() => queryMatcher(filter), [filter]);
  const filtering = filter.trim() !== '';
  const rows = table.rows as unknown as Row[];

  const matches = (r: Row) => hit(r.data.Property) || hit(r.data.Value) || (r.children ?? []).some((c) => hit(c.data.Value));
  const sets = rows
    .map((set) => ({ set, children: filtering ? (set.children ?? []).filter(matches) : set.children ?? [] }))
    .filter((s) => !filtering || s.children.length > 0);

  const isOpen = (name: string) => (filtering ? true : (expandMode === 'expanded') !== toggled.has(name));
  const toggle = (name: string) =>
    setToggled((cur) => {
      const next = new Set(cur);
      if (!next.delete(name)) next.add(name);
      return next;
    });

  const pick = async (row: PropertyRow, e: React.MouseEvent) => {
    if (!row.Key || !row.Match) return;
    const scope: OBC.ModelIdMap = {};
    if (!(e.ctrlKey || e.metaKey)) for (const [modelId, ids] of Object.entries(byModel)) if (ids.length) scope[modelId] = new Set(ids);
    const ids = objectsWithValue(engine.getIndexes(), scope, row.Key, row.Match);
    if (Object.keys(ids).length) await engine.selectElements(ids, false);
  };

  const value = (row: PropertyRow) =>
    row.Match ? (
      <button type="button" className="props-value" onClick={(e) => void pick(row, e)} title="Click: select the objects with this value (Isolate / Ghost follow). Ctrl+click: search all objects.">
        {withUnit(row.Property, row.Value)}
      </button>
    ) : (
      withUnit(row.Property, row.Value)
    );

  return (
    <div className="props-grid">
      <div className="props-grid__bar">
        <b className="props-grid__title" title={table.title}>{table.title}</b>
      </div>
      <div className="props-grid__tools">
        <input type="search" value={filter} placeholder="Filter…" onChange={(e) => setFilter(e.target.value)} />
        <ExpandCollapseToggle className="btn btn--small" collapsed={expandMode === 'collapsed'} onCollapse={() => setExpandMode('collapsed')} onExpand={() => setExpandMode('expanded')} />
      </div>
      {sets.length === 0 && <div className="scn-dim" style={{ padding: 10 }}>{filtering ? 'No property matches.' : 'No properties.'}</div>}
      {sets.map(({ set, children }) => (
        <CollapsibleSection key={set.data.Property} title={`${set.data.Property} (${children.length})`} flush open={isOpen(set.data.Property)} onToggle={() => toggle(set.data.Property)}>
          <table className="ad-grid props-table">
            <tbody>
              {children.map((r) => {
                const key = `${set.data.Property}.${r.data.Property}`;
                const many = !!r.children?.length;
                const open = many && (openValues.has(key) || (filtering && (r.children ?? []).some((c) => hit(c.data.Value))));
                return (
                  <FragmentRows key={key}>
                    <tr>
                      <th scope="row" title={r.data.Property}>
                        {!many && <span className="props-twisty props-twisty--blank" aria-hidden="true" />}
                        {many && (
                          <button
                            type="button"
                            className="props-twisty"
                            aria-expanded={open}
                            aria-label={open ? 'Hide the values' : 'Show the values'}
                            onClick={() =>
                              setOpenValues((cur) => {
                                const next = new Set(cur);
                                if (!next.delete(key)) next.add(key);
                                return next;
                              })
                            }
                          >
                            {open ? <IconExpandMore width={14} height={14} /> : <IconChevronRight width={14} height={14} />}
                          </button>
                        )}
                        {r.data.Property}
                      </th>
                      <td title={r.data.Value}>{value(r.data)}</td>
                    </tr>
                    {open &&
                      (r.children ?? []).map((c, i) => (
                        <tr key={`${key}#${i}`} className="props-sub">
                          <th scope="row" />
                          <td title={c.data.Value}>
                            <span className="props-sub__value">{value(c.data)}</span>
                            <span className="props-sub__count" title="Objects with this value">{c.data.Count}</span>
                          </td>
                        </tr>
                      ))}
                  </FragmentRows>
                );
              })}
            </tbody>
          </table>
        </CollapsibleSection>
      ))}
    </div>
  );
}

/** Rows of a property and its value breakdown, kept together under one key. */
function FragmentRows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
