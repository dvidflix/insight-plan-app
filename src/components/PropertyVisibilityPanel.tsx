import { SearchRow } from './SearchRow';
import { useEffect, useMemo, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { usePropertyVisibilityStore } from '../state/propertyVisibilityStore';
import { IconSectionChevron } from './icons';
import { InfoTip } from './InfoTip';
import { ATTRIBUTES, ATTRIBUTE_NAMES } from '../viewer/bimTables';
import { queryMatcher } from '../schedule/search';

/** Models page > Properties > Show / hide properties: tick which property
    sets, and which properties inside them, the Properties table shows.
    Hidden ones (and their values) are left out for every model, by name. */
export function PropertyVisibilityPanel() {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const { hiddenPsets, hiddenProps, setPsetHidden, setPropHidden, setAll } = usePropertyVisibilityStore();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  // The per-model indexes fill in after load; rebuild the list then.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    engine.onSetsReady.add(bump);
    return () => { engine.onSetsReady.remove(bump); };
  }, [engine]);

  /** Every property set in the loaded models, with its properties. */
  const catalog = useMemo(() => {
    const psets = new Map<string, Set<string>>();
    for (const index of engine.getIndexes().values()) {
      for (const e of index.elements.values()) {
        for (const key of Object.keys(e.props)) {
          const dot = key.indexOf('.');
          const pset = dot === -1 ? 'Other' : key.slice(0, dot);
          const prop = dot === -1 ? key : key.slice(dot + 1);
          (psets.get(pset) ?? psets.set(pset, new Set()).get(pset)!).add(prop);
        }
      }
    }
    const sets = [...psets].sort((a, b) => a[0].localeCompare(b[0])).map(([pset, props]) => ({ pset, props: [...props].sort((a, b) => a.localeCompare(b)) }));
    // The IFC attributes (Name, Class, GlobalId) come first, as in the table.
    return psets.size || engine.getIndexes().size ? [{ pset: ATTRIBUTES, props: ATTRIBUTE_NAMES }, ...sets] : sets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, models, tick]);

  const hiddenSetNames = new Set(hiddenPsets);
  const hiddenPropKeys = new Set(hiddenProps);
  const q = query.trim().toLowerCase();
  const hit = queryMatcher(query);
  const shown = catalog
    .map((c) => ({ ...c, props: q && !hit(c.pset) ? c.props.filter((p) => hit(p)) : c.props }))
    .filter((c) => !q || hit(c.pset) || c.props.length > 0);
  const toggleOpen = (pset: string) => setOpen((s) => {
    const next = new Set(s);
    if (next.has(pset)) next.delete(pset);
    else next.add(pset);
    return next;
  });

  if (catalog.length === 0) return <div className="disp"><div className="flt__hint">Load a model to list its properties.</div></div>;

  return (
    <div className="disp pvis-panel">
      <div className="info-tip-row">
        <SearchRow
          collapsed={open.size === 0}
          onCollapse={() => setOpen(new Set())}
          onExpand={() => setOpen(new Set(catalog.map((c) => c.pset)))}
        >
          <input className="cols__search" type="search" placeholder="Search property sets and properties…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </SearchRow>
        <InfoTip>Untick a property set, the Attributes (Name, Class, GlobalId), or a single property to leave it (and its values) out of the Properties table. Kept by name, so it applies to every model and next time too.</InfoTip>
      </div>
      <div className="related__actions">
        <button type="button" className="btn btn--small" onClick={() => setAll([], [])} disabled={!hiddenPsets.length && !hiddenProps.length}>Show all</button>
        <button type="button" className="btn btn--small" onClick={() => setAll(catalog.map((c) => c.pset), hiddenProps)}>Hide all</button>
        <span className="pvis__count">{hiddenPsets.length} sets · {hiddenProps.length} properties hidden</span>
      </div>
      <ul className="pvis">
        {shown.map(({ pset, props }) => {
          const setHidden = hiddenSetNames.has(pset);
          const isOpen = open.has(pset) || !!q;
          const hiddenInSet = props.filter((p) => hiddenPropKeys.has(`${pset}.${p}`)).length;
          return (
            <li key={pset}>
              <div className="pvis__set">
                <button type="button" className="pvis__chevron" aria-expanded={isOpen} aria-label={isOpen ? 'Collapse' : 'Expand'} onClick={() => toggleOpen(pset)}>
                  <IconSectionChevron className="section-chevron" />
                </button>
                <label className="pvis__label">
                  <input type="checkbox" checked={!setHidden} onChange={(e) => setPsetHidden(pset, !e.target.checked)} />
                  <span className={setHidden ? 'pvis__off' : ''}>{pset}</span>
                </label>
                <span className="pvis__count">{hiddenInSet ? `${props.length - hiddenInSet}/${props.length}` : props.length}</span>
              </div>
              {isOpen && (
                <ul className="pvis__props">
                  {props.map((p) => {
                    const key = `${pset}.${p}`;
                    return (
                      <li key={key}>
                        <label className="pvis__label">
                          <input type="checkbox" disabled={setHidden} checked={!setHidden && !hiddenPropKeys.has(key)} onChange={(e) => setPropHidden(key, !e.target.checked)} />
                          <span className={setHidden || hiddenPropKeys.has(key) ? 'pvis__off' : ''}>{p}</span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
