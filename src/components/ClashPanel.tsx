import { useMemo, useRef, useState } from 'react';
import { queryMatcher } from '../schedule/search';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useSearchSetsStore } from '../state/searchSetsStore';
import { useAppPrefsStore } from '../state/appPrefsStore';
import { useTopicsStore } from '../state/topicsStore';
import { CLASH_KINDS, CLASH_STATUSES, useClashTestsStore, type ClashItemRef, type ClashResult, type ClashSide, type ClashStatus, type ClashTest } from '../state/clashTestsStore';
import { runClashTest } from '../viewer/clashTests';
import type { IdsByModel } from '../viewer/relations';
import type { ModelIndex } from '../viewer/ViewerEngine';
import { downloadCsv } from '../utils/csv';
import { usePersistedState } from '../utils/persistedState';
import { IconExpander } from './icons';

const MAX_ROWS = 400;
type GroupBy = 'none' | 'a' | 'b' | 'classes';
const statusOf = (s: ClashStatus) => CLASH_STATUSES.find((x) => x.id === s)!;
const short = (name: string) => name.replace(/\.(ifc|frag)$/i, '');
const mm = (m: number) => (m <= 0 ? 'clash' : `${Math.round(m * 1000)} mm`);
const className = (c: string) => c.replace(/^IFC/i, '').toLowerCase() || '—';

const guidMaps = new WeakMap<ModelIndex, Map<string, number>>();
function guidMap(index: ModelIndex): Map<string, number> {
  let map = guidMaps.get(index);
  if (!map) {
    map = new Map();
    for (const [id, e] of index.elements) if (e.guid) map.set(e.guid, id);
    guidMaps.set(index, map);
  }
  return map;
}

const sideValue = (s: ClashSide) => (s.kind === 'all' ? 'all' : s.kind === 'model' ? `model:${s.model}` : `set:${s.setId}`);
const sideOf = (v: string): ClashSide => (v.startsWith('model:') ? { kind: 'model', model: v.slice(6) } : v.startsWith('set:') ? { kind: 'set', setId: v.slice(4) } : { kind: 'all' });

function SidePicker({ label, value, onChange }: { label: string; value: ClashSide; onChange: (s: ClashSide) => void }) {
  const models = useModelsStore((s) => s.models);
  const sets = useSearchSetsStore((s) => s.sets);
  const v = sideValue(value);
  const known = v === 'all' || models.some((m) => v === `model:${m.name}`) || sets.some((s) => v === `set:${s.id}`);
  return (
    <label className="clash__field">
      <span>{label}</span>
      <select value={v} onChange={(e) => onChange(sideOf(e.target.value))}>
        <option value="all">All loaded models</option>
        {!known && <option value={v}>(missing)</option>}
        {models.length > 0 && <optgroup label="A model">{models.map((m) => <option key={m.modelId} value={`model:${m.name}`}>{short(m.name)}</option>)}</optgroup>}
        {sets.length > 0 && <optgroup label="A search set">{sets.map((s) => <option key={s.id} value={`set:${s.id}`}>{s.group ? `${s.group} / ` : ''}{s.name}</option>)}</optgroup>}
      </select>
    </label>
  );
}

/** The clash tool: tests (selection A against selection B, with a rule), their results to work through, and 3D that follows. */
export function ClashPanel() {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const bcf = useAppPrefsStore((s) => s.experimental.bcf);
  const { tests, selectedId, add, update, remove, select, setResults, setStatus, patchResult } = useClashTestsStore();
  const test: ClashTest | null = tests.find((t) => t.id === selectedId) ?? tests[0] ?? null;
  const [running, setRunning] = useState<{ progress: number } | null>(null);
  const [message, setMessage] = useState('');
  const abort = useRef<AbortController | null>(null);
  const [filter, setFilter] = usePersistedState<ClashStatus[]>('clash.statusFilter', CLASH_STATUSES.map((s) => s.id));
  const [groupBy, setGroupBy] = usePersistedState<GroupBy>('clash.groupBy', 'none');
  const [search, setSearch] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const [limit, setLimit] = useState(MAX_ROWS);
  const [closed, setClosed] = useState<Set<string>>(new Set());

  const locate = (refs: ClashItemRef[]): IdsByModel => {
    const out: IdsByModel = {};
    for (const r of refs) {
      const m = models.find((x) => x.name === r.model);
      const index = m && engine.getIndexes().get(m.modelId);
      const id = index && guidMap(index).get(r.guid);
      if (m && id !== undefined) (out[m.modelId] ??= []).push(id);
    }
    return out;
  };
  const show = (rs: ClashResult[], isolate = false) => {
    const ids = locate(rs.flatMap((r) => [r.a, r.b]));
    if (isolate) void engine.isolateElements(ids, true);
    else void engine.selectElements(ids, true);
  };

  const run = async () => {
    if (!test || running) return;
    const controller = new AbortController();
    abort.current = controller;
    setRunning({ progress: 0 });
    setMessage('');
    try {
      const { found } = await runClashTest(engine, test, { signal: controller.signal, onProgress: (d, t) => setRunning({ progress: t ? d / t : 0 }) });
      if (controller.signal.aborted) {
        setMessage('Stopped: the results are as they were.');
        return;
      }
      const r = setResults(test.id, found);
      setMessage(`${r.total.toLocaleString()} found · ${r.added.toLocaleString()} new${r.gone ? ` · ${r.gone.toLocaleString()} no longer found (marked resolved)` : ''}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(null);
      abort.current = null;
    }
  };

  const results = test?.results ?? [];
  const counts = useMemo(() => {
    const c = new Map<ClashStatus, number>();
    for (const r of results) c.set(r.status, (c.get(r.status) ?? 0) + 1);
    return c;
  }, [results]);
  const shown = useMemo(() => {
    const hit = queryMatcher(search);
    return results.filter((r) => filter.includes(r.status) && hit(`${r.n} ${r.a.name} ${r.b.name} ${r.a.category} ${r.b.category} ${r.comment ?? ''}`));
  }, [results, filter, search]);
  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: '', label: '', rows: shown }];
    const by = new Map<string, ClashResult[]>();
    for (const r of shown) {
      const key = groupBy === 'a' ? `${r.a.name || r.a.guid} (${className(r.a.category)})` : groupBy === 'b' ? `${r.b.name || r.b.guid} (${className(r.b.category)})` : `${className(r.a.category)} × ${className(r.b.category)}`;
      (by.get(key) ?? by.set(key, []).get(key)!).push(r);
    }
    return [...by].sort((x, y) => y[1].length - x[1].length).map(([key, rows]) => ({ key, label: key, rows }));
  }, [shown, groupBy]);
  const flat = useMemo(() => groups.flatMap((g) => (closed.has(g.key) ? [] : g.rows)), [groups, closed]);

  const step = (d: 1 | -1) => {
    if (!flat.length) return;
    const i = flat.findIndex((r) => r.key === current);
    const next = flat[Math.min(flat.length - 1, Math.max(0, i < 0 ? (d === 1 ? 0 : flat.length - 1) : i + d))];
    setCurrent(next.key);
    show([next]);
    document.getElementById(`clash-row-${next.key}`)?.scrollIntoView({ block: 'nearest' });
  };

  const exportCsv = () => {
    if (!test) return;
    downloadCsv(`${test.name}-clashes.csv`, ['No', 'Status', 'Item A', 'Class A', 'Model A', 'GUID A', 'Item B', 'Class B', 'Model B', 'GUID B', 'Distance (mm)', 'Comment'],
      shown.map((r) => [String(r.n), statusOf(r.status).label, r.a.name, r.a.category, r.a.model, r.a.guid, r.b.name, r.b.category, r.b.model, r.b.guid, String(Math.round(r.distance * 1000)), r.comment ?? '']));
  };

  const makeTopic = (r: ClashResult) => {
    if (!test) return;
    const id = useTopicsStore.getState().add({
      title: `${test.name} #${r.n}: ${r.a.name || className(r.a.category)} × ${r.b.name || className(r.b.category)}`,
      type: 'Clash',
      description: `${CLASH_KINDS.find((k) => k.id === test.kind)?.label}: ${r.a.name} (${short(r.a.model)}) and ${r.b.name} (${short(r.b.model)}), ${mm(r.distance)}.\nGUIDs: ${r.a.guid} / ${r.b.guid}`,
    });
    patchResult(test.id, r.key, { topicId: id });
  };

  const toggleStatus = (id: ClashStatus) => setFilter(filter.includes(id) ? filter.filter((x) => x !== id) : [...filter, id]);
  const kind = CLASH_KINDS.find((k) => k.id === test?.kind);

  const row = (r: ClashResult) => (
    <tr
      key={r.key}
      id={`clash-row-${r.key}`}
      className={`${current === r.key ? 'is-current' : ''}${r.gone ? ' is-gone' : ''}`}
      onClick={() => { setCurrent(r.key); show([r]); }}
      onDoubleClick={() => show([r], true)}
      title="Click: select the pair in 3D · double-click: isolate it"
    >
      <td className="clash__n">{r.n}</td>
      <td>
        <select className="clash__status" style={{ color: statusOf(r.status).color }} value={r.status} onClick={(e) => e.stopPropagation()} onChange={(e) => test && setStatus(test.id, [r.key], e.target.value as ClashStatus)} aria-label="Status">
          {CLASH_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </td>
      <td className="clash__item" title={`${r.a.name} · ${r.a.category} · ${r.a.model}`}>{r.a.name || '—'}<small>{className(r.a.category)}</small></td>
      <td className="clash__item" title={`${r.b.name} · ${r.b.category} · ${r.b.model}`}>{r.b.name || '—'}<small>{className(r.b.category)}</small></td>
      <td className="clash__dist">{mm(r.distance)}</td>
      <td className="clash__tools" onClick={(e) => e.stopPropagation()}>
        {bcf && (r.topicId && useTopicsStore.getState().topics.some((t) => t.id === r.topicId)
          ? <button type="button" className="mini-btn" onClick={() => useTopicsStore.getState().select(r.topicId!)} title="Open its topic">#{useTopicsStore.getState().topics.find((t) => t.id === r.topicId)?.index}</button>
          : <button type="button" className="mini-btn" onClick={() => makeTopic(r)} title="Make a topic (issue) from this clash">Topic</button>)}
        <input className="clash__comment" value={r.comment ?? ''} placeholder="Note" onChange={(e) => test && patchResult(test.id, r.key, { comment: e.target.value })} aria-label="Note" />
      </td>
    </tr>
  );

  let drawn = 0;
  return (
    <div className="clash">
      <div className="clash__bar">
        <select value={test?.id ?? ''} onChange={(e) => select(e.target.value)} disabled={tests.length === 0} aria-label="Clash test" className="clash__tests">
          {tests.length === 0 && <option value="">No test yet</option>}
          {tests.map((t) => <option key={t.id} value={t.id}>{t.name}{t.results.length ? ` (${t.results.length.toLocaleString()})` : ''}</option>)}
        </select>
        <button type="button" className="btn btn--small" onClick={() => add()} title="A new clash test">+ New</button>
        {test && <button type="button" className="btn btn--small" onClick={() => { const n = window.prompt('Name of the test', test.name); if (n?.trim()) update(test.id, { name: n.trim() }); }}>Rename</button>}
        {test && <button type="button" className="btn btn--small" onClick={() => { if (window.confirm(`Delete "${test.name}" and its ${test.results.length} results?`)) remove(test.id); }}>Delete</button>}
        <span className="clash__spacer" />
        {running
          ? <button type="button" className="btn btn--small" onClick={() => abort.current?.abort()}>Stop · {Math.round(running.progress * 100)}%</button>
          : <button type="button" className="btn btn--small primary" disabled={!test || models.length === 0} onClick={() => void run()} title="Run the test now (results keep their status)">▶ Run test</button>}
      </div>

      {!test ? (
        <div className="clash__empty">
          <p>A clash test pits one selection of objects against another and lists where they meet. Load two or more models (or one, against itself), then make a test: choose the rule, what is in A and B, and run it.</p>
          <button type="button" className="btn primary" onClick={() => add()}>+ New clash test</button>
        </div>
      ) : (
        <>
          <details className="clash__setup" open={results.length === 0}>
            <summary>Setup — {kind?.label}{test.kind === 'clearance' ? ` ${Math.round(test.clearance * 1000)} mm` : ''}, {test.a.kind === 'all' ? 'all models' : test.a.kind === 'model' ? short(test.a.model) : 'a set'} against {test.b.kind === 'all' ? 'all models' : test.b.kind === 'model' ? short(test.b.model) : 'a set'}</summary>
            <div className="clash__grid">
              <label className="clash__field">
                <span>Rule</span>
                <select value={test.kind} onChange={(e) => update(test.id, { kind: e.target.value as ClashTest['kind'] })} title={kind?.hint}>
                  {CLASH_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                </select>
              </label>
              <label className="clash__field" style={{ opacity: test.kind === 'clearance' ? 1 : 0.4 }}>
                <span>Clearance (mm)</span>
                <input type="number" min={0} step={5} disabled={test.kind !== 'clearance'} value={Math.round(test.clearance * 1000)} onChange={(e) => update(test.id, { clearance: Math.max(0, Number(e.target.value) || 0) / 1000 })} />
              </label>
              <SidePicker label="Selection A" value={test.a} onChange={(a) => update(test.id, { a })} />
              <SidePicker label="Selection B" value={test.b} onChange={(b) => update(test.id, { b })} />
            </div>
            <div className="clash__opts">
              <label><input type="checkbox" checked={test.exact} onChange={(e) => update(test.id, { exact: e.target.checked })} /> Exact (real triangles, not just boxes)</label>
              <label title="Only what is shown in the 3D view now — with the 4D timeline, what is built by its date"><input type="checkbox" checked={test.onlyVisible} onChange={(e) => update(test.id, { onlyVisible: e.target.checked })} /> Only what is visible now (follows 4D)</label>
              <label><input type="checkbox" checked={test.skipSameClass} onChange={(e) => update(test.id, { skipSameClass: e.target.checked })} /> Skip pairs of the same IFC class</label>
            </div>
            <div className="clash__hint">{kind?.hint} Selections can be a model or a search set (Search sets tab): e.g. A = structure, B = services.</div>
          </details>

          {message && <div className="clash__msg">{message}</div>}

          {results.length > 0 && (
            <>
              <div className="clash__filters">
                {CLASH_STATUSES.map((s) => (
                  <button key={s.id} type="button" className={`clash__chip${filter.includes(s.id) ? ' is-on' : ''}`} style={{ '--chip': s.color } as React.CSSProperties} onClick={() => toggleStatus(s.id)} aria-pressed={filter.includes(s.id)}>
                    {s.label} <b>{counts.get(s.id) ?? 0}</b>
                  </button>
                ))}
                <span className="clash__spacer" />
                <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as GroupBy)} aria-label="Group by" title="Group the results">
                  <option value="none">No groups</option>
                  <option value="a">Group by item A</option>
                  <option value="b">Group by item B</option>
                  <option value="classes">Group by classes</option>
                </select>
                <input type="search" className="clash__search" placeholder="Search…" value={search} onChange={(e) => { setSearch(e.target.value); setLimit(MAX_ROWS); }} />
              </div>
              <div className="clash__actions">
                <button type="button" className="btn btn--small" onClick={() => step(-1)} disabled={!flat.length} title="Previous result">◀</button>
                <button type="button" className="btn btn--small" onClick={() => step(1)} disabled={!flat.length} title="Next result">▶</button>
                <button type="button" className="btn btn--small" onClick={() => show(shown)} disabled={!shown.length} title="Select every pair shown, in 3D">Show all</button>
                <button type="button" className="btn btn--small" onClick={() => show(shown, true)} disabled={!shown.length} title="Isolate every pair shown">Isolate</button>
                <select value="" onChange={(e) => { if (e.target.value && test) setStatus(test.id, shown.map((r) => r.key), e.target.value as ClashStatus); }} aria-label="Set the results shown to a status" title="Give every result shown a status" disabled={!shown.length}>
                  <option value="">Mark shown as…</option>
                  {CLASH_STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
                <button type="button" className="btn btn--small" onClick={exportCsv} disabled={!shown.length}>Export CSV</button>
                <span className="clash__count">{shown.length.toLocaleString()} of {results.length.toLocaleString()}{test.lastRun ? ` · run ${new Date(test.lastRun).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : ''}</span>
              </div>
              <div className="clash__list" tabIndex={0} onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); step(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); } }}>
                <table className="clash__table">
                  <thead><tr><th>#</th><th>Status</th><th>Item A</th><th>Item B</th><th>Gap</th><th /></tr></thead>
                  <tbody>
                    {groups.flatMap((g) => {
                      const head = g.key
                        ? [<tr key={`g-${g.key}`} className="clash__group" onClick={() => setClosed((c) => { const n = new Set(c); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}>
                            <td colSpan={5}><IconExpander open={!closed.has(g.key)} width={14} height={14} /> <b>{g.label}</b> <span className="clash__count">{g.rows.length}</span></td>
                            <td className="clash__tools"><button type="button" className="mini-btn" onClick={(e) => { e.stopPropagation(); show(g.rows); }} title="Select these in 3D">Show</button></td>
                          </tr>]
                        : [];
                      if (closed.has(g.key)) return head;
                      const rows = g.rows.filter(() => drawn++ < limit).map(row);
                      return [...head, ...rows];
                    })}
                  </tbody>
                </table>
                {shown.length > limit && <button type="button" className="btn btn--small clash__more" onClick={() => setLimit(limit + MAX_ROWS)}>Show {Math.min(MAX_ROWS, shown.length - limit).toLocaleString()} more of {(shown.length - limit).toLocaleString()}</button>}
                {shown.length === 0 && <div className="clash__empty">No result matches the status filter or search.</div>}
              </div>
            </>
          )}
          {results.length === 0 && !running && test.lastRun && <div className="clash__empty">No clash found with this rule.</div>}
        </>
      )}
    </div>
  );
}
