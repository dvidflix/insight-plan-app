import { FEATURES } from '../features';
import { useMemo, useRef, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useModelChecksStore } from '../state/modelChecksStore';
import { usePersistedStringSet } from '../utils/persistedState';
import { downloadBlob } from '../utils/download';
import { postIds, writeBackModel } from '../ids/writeBack';
import { downloadCsv } from '../utils/csv';
import { idsFiles, patches as libraryPatches, patchesFor, rules as libraryRules } from '../ids/library';
import { RULES_FILE, runRules } from '../ids/rules';
import { runIdsFile, type SpecResult } from '../ids/runIds';
import { ancestorsOf, spatialItems, type Candidate, type ModelContext } from '../ids/evaluate';
import { applyPatch, planPatch, type Patch, type PatchPlan, type SpatialNode } from '../ids/patches';
import { originatingSystem } from '../ids/step';
import { ensureModelFile } from '../state/modelFiles';
import { dbRoot } from '../state/projectDbStore';
import { IconDownload, IconUpload } from './icons';
import { IconExpander } from './icons';

/** Models page › Model checks: the IDS files in docs/ids run against the
    loaded models, laid out like the programme quality checks — a ring and
    PASS / FAIL per specification, its failing elements (click to select),
    and the patches linked to it (docs/ids/patches), which rewrite the IFC,
    save it as <name>_FIXED.ifc and load it in place of the original. */

const ROW_CAP = 100;

type Band = 'green' | 'red' | 'info';
const bandOf = (r: SpecResult): Band => (r.error ? 'red' : r.applicable === 0 ? 'info' : r.failures.length ? 'red' : 'green');
const BADGE: Record<Band, string> = { green: 'PASS', red: 'FAIL', info: 'N/A' };
const pctOf = (r: SpecResult) => (r.applicable ? (r.passed / r.applicable) * 100 : null);
const fmtPct = (n: number) => (n === 100 ? '100%' : n > 99.9 ? '>99.9%' : `${n.toFixed(1)}%`);
/** The Originating System in a loaded IFC's header ('' for a model without its IFC at hand). */
async function originatingSystemOf(modelName: string): Promise<string> {
  try {
    const file = await ensureModelFile(modelName, dbRoot());
    return file ? originatingSystem(await file.slice(0, 20000).text()) : '';
  } catch {
    return '';
  }
}

export function ModelChecksPanel() {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const hidden = useModelsStore((s) => s.hiddenModelIds);
  const [off, setOff] = usePersistedStringSet('models.idsOff');
  // In a store, not the panel: a run keeps going (and its results stay) while another tab is open.
  const { results, testedNames, running, message } = useModelChecksStore();
  const setResults = (results: SpecResult[] | null) => useModelChecksStore.setState({ results });
  const setTestedNames = (testedNames: string[]) => useModelChecksStore.setState({ testedNames });
  const setRunning = (running: boolean) => useModelChecksStore.setState({ running });
  const setMessage = (message: { kind: 'ok' | 'error'; text: string } | null) => useModelChecksStore.setState({ message });
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const upload = useRef<HTMLInputElement>(null);

  const files = idsFiles();
  const rules = libraryRules();
  const allPatches = libraryPatches();
  const shown = models.filter((m) => !hidden.has(m.modelId));

  /** What evaluate.ts needs of a loaded model: its elements and spatial
      nodes, their spatial ancestors, and a reader for IFC attributes. */
  const contextOf = (modelId: string, originatingSystem = ''): ModelContext => {
    const index = engine.getIndexes().get(modelId);
    const candidates: Candidate[] = [...(index?.elements.values() ?? [])].map((e) => ({ localId: e.localId, category: e.category, guid: e.guid, name: e.name, description: e.description ?? '', props: e.props }));
    // Spatial nodes (site, building, storey…) too: they aren't in the element index.
    const seen = new Set(candidates.map((c) => c.localId));
    spatialItems(index?.tree, (localId, cls) => {
      if (seen.has(localId)) return;
      seen.add(localId);
      candidates.push({ localId, category: cls, guid: '', name: index?.names.get(localId) ?? '', description: '', props: {} });
    });
    return {
      modelId,
      candidates,
      originatingSystem,
      ancestors: ancestorsOf(index?.tree),
      attributes: async (localIds) => {
        const model = engine.getFragmentsModel(modelId);
        const out = new Map<number, Record<string, string | number | boolean | null>>();
        if (!model) return out;
        for (let i = 0; i < localIds.length; i += 500) {
          const chunk = localIds.slice(i, i + 500);
          const data = await model.getItemsData(chunk, { attributesDefault: true });
          data.forEach((item, k) => {
            const attrs: Record<string, string | number | boolean | null> = {};
            for (const [key, v] of Object.entries(item)) {
              if (key.startsWith('_') || !v || Array.isArray(v) || typeof v !== 'object' || !('value' in v)) continue;
              attrs[key] = (v as { value: string | number | boolean | null }).value;
            }
            out.set(chunk[k], attrs);
          });
        }
        return out;
      },
    };
  };

  /** `keepMessage`: after a patch, its report stays up while the checks run again. */
  const run = async (keepMessage = false) => {
    const list = useModelsStore.getState().models.filter((m) => !useModelsStore.getState().hiddenModelIds.has(m.modelId));
    if (list.length === 0) return setMessage({ kind: 'error', text: 'Load a model first (Inputs).' });
    setRunning(true);
    if (!keepMessage) setMessage(null);
    try {
      const out: SpecResult[] = [];
      const contexts = await Promise.all(list.map(async (m) => contextOf(m.modelId, await originatingSystemOf(m.name))));
      for (const f of idsFiles()) {
        if (off.has(f.name)) continue;
        out.push(...(await runIdsFile(engine.components, f.name, f.xml, contexts)));
      }
      if (!off.has(RULES_FILE) && libraryRules().length) out.push(...runRules(libraryRules(), contexts));
      setResults(out);
      setTestedNames(list.map((m) => m.name));
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  };

  const importIds = async (file: File) => {
    try {
      const saved = await postIds<{ name: string }>(`ids?name=${encodeURIComponent(file.name)}`, await file.text(), false);
      setMessage({ kind: 'ok', text: `Saved to docs/ids/${saved.name}. Commit and push it to share it with the team.` });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const summary = useMemo(() => {
    const list = results ?? [];
    const scored = list.filter((r) => bandOf(r) !== 'info');
    const applicable = scored.reduce((n, r) => n + r.applicable, 0);
    const passed = scored.reduce((n, r) => n + r.passed, 0);
    return {
      pass: list.filter((r) => bandOf(r) === 'green').length,
      fail: list.filter((r) => bandOf(r) === 'red').length,
      na: list.filter((r) => bandOf(r) === 'info').length,
      pct: applicable ? (passed / applicable) * 100 : null,
    };
  }, [results]);

  const exportCsv = () => {
    if (!results) return;
    const names = new Map(models.map((m) => [m.modelId, m.name]));
    downloadCsv(
      'model-checks.csv',
      ['IDS file', 'Specification', 'Result', 'Applicable', 'Passed', 'Model', 'GlobalId', 'Element', 'Class', 'Reason'],
      results.flatMap((r) => {
        const head = [r.file, r.name, BADGE[bandOf(r)], r.applicable, r.passed];
        if (!r.failures.length) return [[...head, '', '', '', '', r.error ?? '']];
        return r.failures.map((f) => {
          const el = engine.getIndexes().get(f.modelId)?.elements.get(f.localId);
          return [...head, names.get(f.modelId) ?? f.modelId, f.guid, el?.name ?? '', el?.category ?? '', f.reasons.join('; ')];
        });
      }),
    );
  };

  /** Applies a patch to every model it plans changes for (see writeBack.ts),
      then runs the checks again. */
  const apply = async (patch: Patch, spec: SpecResult, plan: PatchPlan) => {
    const byModel = new Map<string, PatchPlan['changes']>();
    for (const c of plan.changes) byModel.set(c.modelId, [...(byModel.get(c.modelId) ?? []), c]);
    const notes: string[] = [];
    setRunning(true);
    setMessage(null);
    try {
      for (const [modelId, changes] of byModel) {
        const log = { patch: patch.id, patchName: patch.name, specification: { ids: spec.file, name: spec.name, identifier: spec.identifier } };
        notes.push(await writeBackModel(engine, modelId, (text) => applyPatch(patch, text, changes), log));
      }
      setMessage({ kind: 'ok', text: notes.join(' ') });
    } catch (e) {
      setMessage({ kind: 'error', text: [...notes, e instanceof Error ? e.message : String(e)].join(' ') });
    } finally {
      setRunning(false);
    }
    await run(true);
  };

  const byFile = useMemo(() => {
    const m = new Map<string, SpecResult[]>();
    for (const r of results ?? []) m.set(r.file, [...(m.get(r.file) ?? []), r]);
    return m;
  }, [results]);

  return (
    <div className="model-checks">
      <div className="model-checks__bar">
        <button type="button" className="btn primary" disabled={running || shown.length === 0} onClick={() => void run()}>
          {running ? 'Checking…' : results ? 'Run again' : 'Run checks'}
        </button>
        {FEATURES.serverFiles && (
          <button type="button" className="btn" onClick={() => upload.current?.click()} title="Add an .ids file to docs/ids">
            <IconUpload /> Import IDS
          </button>
        )}
        {results && (
          <button type="button" className="btn" onClick={exportCsv} title="Every specification and failing element">
            <IconDownload /> CSV
          </button>
        )}
        <input
          ref={upload}
          type="file"
          accept=".ids,.xml"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importIds(f);
          }}
        />
      </div>

      <div className="model-checks__files">
        {files.length === 0 && <div className="model-checks__hint">No IDS files yet: import one, or put .ids files in docs/ids.</div>}
        {files.map((f) => (
          <label key={f.name} className="model-checks__file">
            <input
              type="checkbox"
              checked={!off.has(f.name)}
              onChange={() =>
                setOff((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(f.name)) next.add(f.name);
                  return next;
                })
              }
            />
            {f.name}
            <button
              type="button"
              className="icon-btn model-checks__export"
              title={`Export ${f.name}`}
              aria-label={`Export ${f.name}`}
              onClick={(e) => {
                e.preventDefault();
                downloadBlob(f.name, new Blob([f.xml], { type: 'application/xml' }));
              }}
            >
              <IconDownload />
            </button>
          </label>
        ))}
        {rules.length > 0 && (
          <label className="model-checks__file" title={rules.map((r) => r.name).join('\n')}>
            <input
              type="checkbox"
              checked={!off.has(RULES_FILE)}
              onChange={() =>
                setOff((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(RULES_FILE)) next.add(RULES_FILE);
                  return next;
                })
              }
            />
            {RULES_FILE} ({rules.length})
          </label>
        )}
      </div>

      {message && <div className={`model-checks__msg model-checks__msg--${message.kind}`}>{message.text}</div>}

      {results && (
        <div className="model-checks__summary">
          <span className="model-checks__score">{summary.pct === null ? '—' : fmtPct(summary.pct)}</span>
          <span className="model-checks__score-label">of checked elements pass</span>
          <span className="check-badge check-badge--green">{summary.pass} PASS</span>
          <span className="check-badge check-badge--red">{summary.fail} FAIL</span>
          {summary.na > 0 && <span className="check-badge check-badge--info">{summary.na} N/A</span>}
          <div className="model-checks__tested" title={testedNames.join('\n')}>
            {testedNames.length} model{testedNames.length === 1 ? '' : 's'}: {testedNames.join(', ')}
          </div>
        </div>
      )}

      {!results && !running && shown.length > 0 && <div className="model-checks__hint">Runs the ticked IDS files against the {shown.length} model{shown.length === 1 ? '' : 's'} shown.</div>}

      {[...byFile].map(([file, list]) => {
        const open = !collapsedFiles.has(file);
        return (
          <div key={file}>
            <div
              className="checks-section__header model-checks__section"
              role="button"
              tabIndex={0}
              onClick={() =>
                setCollapsedFiles((prev) => {
                  const next = new Set(prev);
                  if (!next.delete(file)) next.add(file);
                  return next;
                })
              }
            >
              <span>{file}</span>
              <span className="check-item__toggle"><IconExpander open={open} /></span>
            </div>
            {open && list.map((r) => <SpecRow key={r.key} result={r} patches={patchesFor(allPatches, r.file, r)} busy={running} onApply={apply} />)}
          </div>
        );
      })}
    </div>
  );
}

function Ring({ pct, band }: { pct: number | null; band: Band }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <div className={`check-ring check-ring--${band}`}>
      <svg viewBox="0 0 36 36" width="36" height="36" aria-hidden="true">
        <circle cx="18" cy="18" r={r} className="check-ring__track" />
        {pct !== null && <circle cx="18" cy="18" r={r} className="check-ring__value" strokeDasharray={`${Math.max((pct / 100) * c, band === 'green' ? 0 : 2)} ${c}`} transform="rotate(-90 18 18)" />}
      </svg>
      <span className="check-ring__label">{pct === null ? '—' : pct >= 99.95 && band !== 'green' ? '>99%' : `${Math.floor(pct)}%`}</span>
    </div>
  );
}

function SpecRow({ result: r, patches, busy, onApply }: { result: SpecResult; patches: Patch[]; busy: boolean; onApply: (p: Patch, spec: SpecResult, plan: PatchPlan) => Promise<void> }) {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const [expanded, setExpanded] = useState(false);
  const band = bandOf(r);
  const names = new Map(models.map((m) => [m.modelId, m.name]));
  const element = (modelId: string, localId: number) => engine.getIndexes().get(modelId)?.elements.get(localId);
  const select = (ids: Record<string, number[]>) => void engine.selectElements(ids, true);
  const allFailing = () => {
    const ids: Record<string, number[]> = {};
    for (const f of r.failures) (ids[f.modelId] ??= []).push(f.localId);
    select(ids);
  };

  return (
    <div className={`check-item model-checks__item check-item--${band}${expanded ? ' is-expanded' : ''}`}>
      <div className="model-checks__row" role="button" tabIndex={0} onClick={() => setExpanded((v) => !v)}>
        <Ring pct={pctOf(r)} band={band} />
        <div className="check-item__main">
          <div className="check-item__title">
            <span className="check-item__toggle"><IconExpander open={expanded} /></span>
            {r.name}
          </div>
          <div className="model-checks__counts">
            {r.error ? 'Could not run' : r.applicable === 0 ? 'No element it applies to' : `${r.failures.length} of ${r.applicable} fail`}
            {patches.length > 0 && band === 'red' && <span className="model-checks__fixable"> · fix available</span>}
          </div>
        </div>
        <span className={`check-badge check-badge--${band}`}>{BADGE[band]}</span>
      </div>

      {expanded && (
        <div className="check-item__detail model-checks__detail">
          {r.error && <div className="model-checks__msg model-checks__msg--error">{r.error}</div>}
          {r.description && <div className="check-item__description">{r.description}</div>}
          {r.instructions && <div className="model-checks__instructions">→ {r.instructions}</div>}
          {r.failures.length > 0 && (
            <>
              <div className="model-checks__table-head">
                <span>
                  Showing {Math.min(ROW_CAP, r.failures.length)} of {r.failures.length}
                </span>
                <button type="button" className="btn btn--small" onClick={allFailing}>
                  Select all failing
                </button>
              </div>
              <div className="check-item__table-wrap">
                <table className="check-item__table">
                  <thead>
                    <tr>
                      <th>Element</th>
                      <th>Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.failures.slice(0, ROW_CAP).map((f) => {
                      const el = element(f.modelId, f.localId);
                      return (
                        <tr key={`${f.modelId}:${f.localId}`} onClick={() => select({ [f.modelId]: [f.localId] })} title={`${names.get(f.modelId) ?? f.modelId}\n${f.guid}\nClick to select`}>
                          <td>
                            {el?.name || engine.getIndexes().get(f.modelId)?.names.get(f.localId) || f.localId}
                            {el && <div className="model-checks__class">{el.category}</div>}
                          </td>
                          <td className="model-checks__why">{f.reasons.join('; ')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {FEATURES.serverFiles && patches.length > 0 && r.failures.length > 0 && (
            <div className="model-checks__patches">
              <div className="check-item__callout-label check-item__callout-label--action">Fixes</div>
              {patches.map((p) => (
                <PatchCard key={p.id} patch={p} spec={r} busy={busy} onApply={onApply} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PatchCard({ patch, spec, busy, onApply }: { patch: Patch; spec: SpecResult; busy: boolean; onApply: (p: Patch, spec: SpecResult, plan: PatchPlan) => Promise<void> }) {
  const engine = useViewerEngine();
  const [plan, setPlan] = useState<PatchPlan | null>(null);
  const preview = () =>
    setPlan(
      planPatch(
        patch,
        spec.failures,
        (modelId) => engine.getIndexes().get(modelId)?.elements,
        (modelId) => {
          const index = engine.getIndexes().get(modelId);
          const out: SpatialNode[] = [];
          spatialItems(index?.tree, (localId, category) => {
            if (!index?.elements.has(localId)) out.push({ localId, category, name: index?.names.get(localId) ?? '' });
          });
          return out;
        },
      ),
    );
  const count = (keys: string[]) => [...keys.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);

  return (
    <div className="model-checks__patch">
      <div className="model-checks__patch-name">{patch.name}</div>
      {patch.description && <div className="model-checks__patch-desc">{patch.description}</div>}
      {!plan ? (
        <button type="button" className="btn btn--small" onClick={preview}>
          Preview
        </button>
      ) : (
        <>
          {plan.modelWide && <div className="model-checks__hint">Works on the whole model, not only the failing elements.</div>}
          {plan.changes.length > 0 && (
            <ul className="model-checks__plan">
              {count(plan.changes.map((c) => (c.from ? `${c.from} → ${c.to}` : `→ ${c.to}`))).map(([k, n]) => (
                <li key={k}>
                  <b>{n}</b> {k}
                </li>
              ))}
            </ul>
          )}
          {plan.skipped.length > 0 && (
            <details className="model-checks__skipped">
              <summary>{plan.skipped.length} left as they are</summary>
              <ul>
                {count(plan.skipped.map((s) => s.why)).map(([k, n]) => (
                  <li key={k}>
                    <b>{n}</b> {k}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {plan.changes.length > 0 ? (
            <button type="button" className="btn primary btn--small" disabled={busy} onClick={() => void onApply(patch, spec, plan)} title="Writes <name>_FIXED.ifc (the original is kept), loads it in place of the original and runs the checks again">
              Apply to {plan.changes.length} element{plan.changes.length === 1 ? '' : 's'} & reload
            </button>
          ) : (
            <div className="model-checks__hint">Nothing this patch can change.</div>
          )}
        </>
      )}
    </div>
  );
}
