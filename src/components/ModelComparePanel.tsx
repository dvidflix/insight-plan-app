import { useEffect, useMemo, useRef, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useIndexTick } from './modelFields';
import { usePersistedState } from '../utils/persistedState';
import { downloadCsv } from '../utils/csv';
import { usePourMapStore } from '../state/pourMapStore';
import { DOUBTFUL_BELOW, compareModels, compareStats, pourKeysOf, pourMapOf, pourOf, type CompareResult, type MatchedPair } from '../viewer/modelCompare';
import type { ElementSummary } from '../viewer/types';
import { CollapsibleSection, useOpenSections } from './CollapsibleSection';
import { InfoTip } from './InfoTip';

type Status = 'added' | 'removed' | 'changed' | 'unchanged' | 'doubtful';
const STATUS_LABEL: Record<Status, string> = { added: 'Added', removed: 'Removed', changed: 'Changed', unchanged: 'Unchanged', doubtful: 'Doubtful match' };
const STATUS_COLOR: Record<Status, string> = { added: '#2ca25f', removed: '#d03b3b', changed: '#f0a30a', unchanged: '#9aa0a6', doubtful: '#7b5fd6' };
const MAX_ROWS = 400;

interface Row {
  key: string;
  status: Status;
  /** The object shown: the new one, or the old one for removed objects. */
  e: ElementSummary;
  pair?: MatchedPair;
  oldPour: string;
  newPour: string;
}

/** Models > Compare: two versions of a model (old → new), objects paired by
    GlobalId and then by properties, listed as added / removed / changed with
    each property that differs, coloured in the 3D view, and the old → new
    Pour IDs read from the pairs — the map Programmes > Renumber applies to
    the programme. */
export function ModelComparePanel() {
  const engine = useViewerEngine();
  const tick = useIndexTick();
  const indexes = useMemo(() => [...engine.getIndexes()], [engine, tick]);
  const sections = useOpenSections<'map' | 'objects'>('models.compareSections', ['map', 'objects']);
  const [oldId, setOldId] = usePersistedState<string>('models.compareOld', '');
  const [newId, setNewId] = usePersistedState<string>('models.compareNew', '');
  const [pourKey, setPourKey] = usePersistedState<string>('models.comparePourKey', '');
  const [fallback, setFallback] = usePersistedState<boolean>('models.compareFallback', true);
  const [colour, setColour] = usePersistedState<boolean>('models.compareColour', true);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [usedKey, setUsedKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Status | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const setEntries = usePourMapStore((s) => s.setEntries);
  const [saved, setSaved] = useState<number | null>(null);

  const idOf = (given: string, fallbackIndex: number) => (indexes.some(([id]) => id === given) ? given : indexes[fallbackIndex]?.[0] ?? '');
  const oldModel = idOf(oldId, 0);
  const newModel = idOf(newId, 1);
  const oldIndex = indexes.find(([id]) => id === oldModel)?.[1];
  const newIndex = indexes.find(([id]) => id === newModel)?.[1];
  const pourKeys = useMemo(() => [...new Set([...(oldIndex ? pourKeysOf(oldIndex) : []), ...(newIndex ? pourKeysOf(newIndex) : [])])], [oldIndex, newIndex]);
  const key = pourKeys.includes(pourKey) ? pourKey : pourKeys[0] ?? '';

  const run = () => {
    if (!oldIndex || !newIndex || oldModel === newModel) return;
    setBusy(true);
    // Let the button repaint before the (synchronous) pass.
    setTimeout(() => {
      try {
        setResult(compareModels(oldIndex, newIndex, { pourKey: key || null, fallback }));
        setUsedKey(key);
        setSelected(null);
        setSaved(null);
        setFilter(null);
      } finally {
        setBusy(false);
      }
    }, 20);
  };
  // A new run is needed once the models change.
  useEffect(() => setResult(null), [oldModel, newModel, tick]);

  const rows = useMemo<Row[]>(() => {
    if (!result) return [];
    const out: Row[] = [];
    result.pairs.forEach((p, i) => {
      const status: Status = p.kind === 'properties' && p.score < DOUBTFUL_BELOW ? 'doubtful' : p.diffs.length ? 'changed' : 'unchanged';
      out.push({ key: `p${i}`, status, e: p.b, pair: p, oldPour: pourOf(p.a, usedKey || null), newPour: pourOf(p.b, usedKey || null) });
    });
    result.removed.forEach((e, i) => out.push({ key: `r${i}`, status: 'removed', e, oldPour: pourOf(e, usedKey || null), newPour: '' }));
    result.added.forEach((e, i) => out.push({ key: `a${i}`, status: 'added', e, oldPour: '', newPour: pourOf(e, usedKey || null) }));
    return out;
  }, [result, usedKey]);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { added: 0, removed: 0, changed: 0, unchanged: 0, doubtful: 0 };
    for (const r of rows) c[r.status]++;
    return c;
  }, [rows]);
  const stats = useMemo(() => (result ? compareStats(result) : null), [result]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => (!filter || r.status === filter) && (!q || `${r.e.name} ${r.e.category} ${r.oldPour} ${r.newPour} ${r.e.guid}`.toLowerCase().includes(q)));
  }, [rows, filter, search]);
  const current = rows.find((r) => r.key === selected) ?? null;
  const pourMap = useMemo(() => (result && usedKey ? pourMapOf(result, usedKey) : []), [result, usedKey]);

  const modelOf = (r: Row) => (r.status === 'removed' ? oldModel : newModel);
  const select = (r: Row) => {
    setSelected(r.key);
    void engine.selectElements({ [modelOf(r)]: [r.e.localId] }, false);
  };

  // Colour the objects by status while this tab shows: removed in the old
  // model, added / changed / doubtful in the new one.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = (job: () => Promise<void>) => { queue.current = queue.current.then(job, job); };
  useEffect(() => {
    if (!colour || !result) return;
    const applied: [string, number[]][] = [];
    enqueue(async () => {
      const groups = new Map<string, { model: string; ids: number[]; color: string }>();
      for (const r of rows) {
        if (r.status === 'unchanged') continue;
        const model = r.status === 'removed' ? oldModel : newModel;
        const k = `${model}|${r.status}`;
        (groups.get(k) ?? groups.set(k, { model, ids: [], color: STATUS_COLOR[r.status] }).get(k)!).ids.push(r.e.localId);
      }
      for (const g of groups.values()) {
        await engine.setColor(g.model, g.ids, g.color, true);
        applied.push([g.model, g.ids]);
      }
      await engine.forceUpdate();
    });
    return () => {
      enqueue(async () => {
        for (const [model, ids] of applied) await engine.setColor(model, ids, null, true);
        await engine.forceUpdate();
      });
    };
  }, [engine, colour, result, rows, oldModel, newModel]);

  const exportObjects = () =>
    downloadCsv(
      'model-comparison.csv',
      ['Status', 'Class', 'Name', 'GlobalId', 'Old Pour ID', 'New Pour ID', 'Match', 'Score', 'Differences'],
      shown.map((r) => [STATUS_LABEL[r.status], r.e.category, r.e.name, r.e.guid, r.oldPour, r.newPour, r.pair?.kind ?? '', r.pair ? r.pair.score.toFixed(2) : '', r.pair?.diffs.map((d) => `${d.key}: ${d.from} → ${d.to}`).join('; ') ?? '']),
    );
  const exportMap = () => downloadCsv('pour-id-map.csv', ['Old Pour ID', 'New Pour ID', 'Objects', 'Status'], pourMap.map((m) => [m.oldPour, m.newPour, m.count, m.status]));
  const useForProgramme = () => {
    const entries = pourMap.filter((m) => (m.status === 'renumbered' || m.status === 'conflict') && m.oldPour && m.newPour).map((m) => ({ oldPour: m.oldPour, newPour: m.newPour }));
    setEntries(entries);
    setSaved(entries.length);
  };
  const mapCounts = useMemo(() => {
    const c = { same: 0, renumbered: 0, conflict: 0, removed: 0, new: 0 };
    for (const m of pourMap) c[m.status]++;
    return c;
  }, [pourMap]);

  if (indexes.length < 2) {
    return (
      <div className="disp">
        <div className="flt__hint">Load two versions of the model (the old and the new one) to compare them.</div>
      </div>
    );
  }

  return (
    <div>
      <div className="disp">
        <label className="disp__row">
          <span>Old model</span>
          <select value={oldModel} onChange={(e) => setOldId(e.target.value)}>
            {indexes.map(([id, ix]) => <option key={id} value={id}>{ix.name}</option>)}
          </select>
        </label>
        <label className="disp__row">
          <span>New model</span>
          <select value={newModel} onChange={(e) => setNewId(e.target.value)}>
            {indexes.map(([id, ix]) => <option key={id} value={id}>{ix.name}</option>)}
          </select>
        </label>
        <label className="disp__row">
          <span>Pour ID property <InfoTip>The property that holds each object's Pour ID, to read the old → new Pour IDs from the pairs.</InfoTip></span>
          <select value={key} onChange={(e) => setPourKey(e.target.value)}>
            {pourKeys.length === 0 && <option value="">(none found)</option>}
            {pourKeys.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <div className="disp__row">
          <span>Also match by properties <InfoTip>Objects whose GlobalId is not in the other model are paired by class, level, name, properties and volume. Each pairing is scored; doubtful ones are listed to check.</InfoTip></span>
          <button type="button" role="switch" aria-checked={fallback} className={`switch${fallback ? ' on' : ''}`} onClick={() => setFallback(!fallback)}>
            <span className="switch__thumb" />
          </button>
        </div>
        <div className="disp__row">
          <button type="button" className="btn btn--small primary" onClick={run} disabled={busy || oldModel === newModel}>{busy ? 'Comparing…' : result ? 'Compare again' : 'Compare'}</button>
          {oldModel === newModel && <span className="flt__hint">Pick two different models.</span>}
        </div>
      </div>

      {result && stats && (
        <>
          <div className="disp">
            <div className="disp__row">
              <span>Colour in 3D <InfoTip>Removed objects red (old model), added green, changed amber and doubtful matches purple (new model).</InfoTip></span>
              <button type="button" role="switch" aria-checked={colour} className={`switch${colour ? ' on' : ''}`} onClick={() => setColour(!colour)}>
                <span className="switch__thumb" />
              </button>
            </div>
            <div className="seq-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 0' }}>
              {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
                <button key={s} type="button" className={`btn btn--small${filter === s ? ' primary' : ''}`} onClick={() => setFilter(filter === s ? null : s)} title={`Show only ${STATUS_LABEL[s].toLowerCase()}`}>
                  <span style={{ display: 'inline-block', width: 9, height: 9, background: STATUS_COLOR[s], marginRight: 5 }} />
                  {STATUS_LABEL[s]} {counts[s].toLocaleString()}
                </button>
              ))}
            </div>
            <div className="flt__hint">
              {stats.byGuid.toLocaleString()} matched by GlobalId · {stats.byProperties.toLocaleString()} by properties ({stats.doubtful.toLocaleString()} doubtful)
            </div>
          </div>

          {usedKey && (
            <CollapsibleSection title={`Pour ID map (${mapCounts.renumbered + mapCounts.conflict} to change)`} open={sections.isOpen('map')} onToggle={() => sections.toggle('map')} flush>
              <div className="disp">
                <div className="flt__hint">
                  {mapCounts.renumbered} renumbered · {mapCounts.same} unchanged · {mapCounts.conflict} to settle · {mapCounts.removed} gone · {mapCounts.new} new
                </div>
                <div className="disp__row">
                  <button type="button" className="btn btn--small primary" onClick={useForProgramme} disabled={mapCounts.renumbered + mapCounts.conflict === 0} title="Keep the renumbered pours for Programmes › Renumber">Use for the programme</button>
                  <button type="button" className="btn btn--small" onClick={exportMap}>Export CSV</button>
                </div>
                {saved !== null && <div className="flt__hint">{saved} Pour IDs kept — open Programmes › Renumber to apply them.</div>}
              </div>
              <table className="seq-grid">
                <thead><tr><th>Old</th><th>New</th><th className="seq-grid__num">Objects</th><th>Status</th></tr></thead>
                <tbody>
                  {pourMap.filter((m) => m.status !== 'same').slice(0, MAX_ROWS).map((m, i) => (
                    <tr key={`${m.oldPour}|${m.newPour}|${i}`} title={m.alternatives?.map((a) => `${a.pour || '(none)'}: ${a.count}`).join(' · ')}>
                      <td>{m.oldPour}</td>
                      <td>{m.newPour}</td>
                      <td className="seq-grid__num">{m.count}</td>
                      <td>{m.status === 'conflict' ? 'split — check' : m.status === 'removed' ? 'gone' : m.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CollapsibleSection>
          )}

          <CollapsibleSection title={`Objects (${shown.length.toLocaleString()})`} open={sections.isOpen('objects')} onToggle={() => sections.toggle('objects')} flush>
            <div className="disp">
              <div className="disp__row">
                <input type="search" placeholder="Search name, class, GlobalId, Pour ID…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1 }} />
                <button type="button" className="btn btn--small" onClick={exportObjects}>Export CSV</button>
              </div>
            </div>
            <table className="seq-grid">
              <thead><tr><th className="seq-grid__swatch" /><th>Name</th><th>Pour</th></tr></thead>
              <tbody>
                {shown.slice(0, MAX_ROWS).map((r) => (
                  <tr key={r.key} className={r.key === selected ? 'selected' : undefined} onClick={() => select(r)} style={{ cursor: 'pointer' }}>
                    <td className="seq-grid__swatch"><span style={{ display: 'inline-block', width: 10, height: 10, background: STATUS_COLOR[r.status] }} title={STATUS_LABEL[r.status]} /></td>
                    <td className="seq-grid__name" title={`${r.e.category} · ${r.e.guid}`}>{r.e.name || r.e.category}</td>
                    <td>{r.oldPour && r.newPour && r.oldPour !== r.newPour ? `${r.oldPour} → ${r.newPour}` : r.newPour || r.oldPour}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > MAX_ROWS && <div className="flt__hint" style={{ padding: 8 }}>Showing the first {MAX_ROWS} of {shown.length.toLocaleString()} — filter or search to narrow it, or export the CSV.</div>}
          </CollapsibleSection>

          {current && (
            <div className="disp">
              <b>{current.e.name || current.e.category}</b>
              <div className="flt__hint">
                {STATUS_LABEL[current.status]}
                {current.pair ? ` · matched by ${current.pair.kind === 'guid' ? 'GlobalId' : `properties (score ${current.pair.score.toFixed(2)})`}` : ''}
              </div>
              {current.pair && current.pair.diffs.length > 0 ? (
                <table className="seq-grid">
                  <thead><tr><th>Property</th><th>Old</th><th>New</th></tr></thead>
                  <tbody>
                    {current.pair.diffs.slice(0, 60).map((d) => (
                      <tr key={d.key}><td title={d.key}>{d.key}</td><td>{d.from}</td><td>{d.to}</td></tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="flt__hint">{current.pair ? 'No property differs.' : 'Only in one of the models.'}</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
