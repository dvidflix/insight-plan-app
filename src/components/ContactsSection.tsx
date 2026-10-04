import { useMemo, useState } from 'react';
import { usePersistedState } from '../utils/persistedState';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useProjectDbStore } from '../state/projectDbStore';
import { clashRows, useClashStore, type ClashView } from '../state/clashStore';
import { downloadCsv } from '../utils/csv';
import { IconDownload } from './icons';
import type { ContactRow, IdsByModel, VerticalPosition } from '../viewer/relations';
import { CollapsibleSection, useOpenSections } from './CollapsibleSection';
import { IconSectionChevron } from './icons';

const POSITION_LABEL: Record<VerticalPosition, string> = {
  below: 'Below',
  'mostly-below': 'Mostly below',
  side: 'Beside',
  'mostly-above': 'Mostly above',
  above: 'Above',
};
type Kind = 'touching' | 'linked';
type Filter = 'all' | 'overlap' | 'touch' | VerticalPosition;
/** Rows drawn in the table; the rest are still selectable and exported. */
const MAX_ROWS = 500;

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="disp__row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={on} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
        <span className="switch__thumb" />
      </button>
    </div>
  );
}

const addIds = (out: IdsByModel, modelId: string, localId: number) => {
  const list = (out[modelId] ??= []);
  if (!list.includes(localId)) list.push(localId);
};

const modelNameOf = (models: { modelId: string; name: string }[], id: string) => models.find((m) => m.modelId === id)?.name.replace(/\.(ifc|frag)$/i, '') ?? id;

/** Selects both elements of every pair in `list`. */
function useSelectRows() {
  const engine = useViewerEngine();
  return (list: ContactRow[], zoom = true) => {
    const ids: IdsByModel = {};
    for (const r of list) {
      addIds(ids, r.a.modelId, r.a.localId);
      addIds(ids, r.b.modelId, r.b.localId);
    }
    void engine.selectElements(ids, zoom);
  };
}

/** Models page > 3D & Related > Clashes & contacts: every loaded model is
    checked against itself and against every other model, in the background
    (useClashRunner), and the results kept in the project database so they
    are ready next time. Touching elements: pairs within a model. Linked
    elements: pairs across models (e.g. project A against project B). The
    pairs themselves are listed at the bottom of the pane (ClashResultsList). */
export function ContactsSection() {
  const models = useModelsStore((s) => s.models);
  const inProject = useProjectDbStore((s) => !!s.db);
  const sections = useOpenSections<'contacts'>('related.contactsSections', ['contacts']);
  const { settings, results, pending, running, error, view, setView, setSettings, requestRun, requestCancel } = useClashStore();
  const selectRows = useSelectRows();

  const { touching, linked } = useMemo(() => clashRows(results), [results]);

  /** Filters the list to one kind (again: back to all) and selects its pairs. */
  const pick = (k: Kind) => {
    const next = view === k ? 'all' : k;
    setView(next);
    if (next !== 'all') selectRows(next === 'touching' ? touching : linked);
  };

  const ready = Object.keys(results).length;
  const status = !models.length
    ? 'Load models to see how their elements touch.'
    : running
      ? null
      : pending
        ? settings.auto
          ? 'Starting…'
          : `${pending} check${pending === 1 ? '' : 's'} to run (automatic updates are off).`
        : ready
          ? `Up to date${inProject ? ', saved in the project' : ''}.`
          : 'Starting…';

  return (
    <CollapsibleSection
      title="Clashes & contacts"
      open={sections.isOpen('contacts')}
      onToggle={() => sections.toggle('contacts')}
      tip={
        <>
          <p>Every loaded model is checked against itself and against every other model, by itself in the background. <b>Touching elements</b> are pairs within one model; <b>Linked elements</b> are pairs across two models (e.g. project A against project B, once aligned with Model placement). The pairs are listed at the bottom of the pane.</p>
          <p>With a project folder open the results are kept in the project database, so they are ready when the models load again; only a model whose file changed, or a pair whose placement changed, is checked again.</p>
          <p><b>Exact geometry</b> tests the real triangles; off, only bounding boxes. <b>B is</b> says where B sits vertically relative to A. A model offset is included; a storey slide is not (it moves only what you see).</p>
        </>
      }
    >
      <div className="clash">
        <div className="clash__kinds">
          <button type="button" className={`clash__kind${view === 'touching' ? ' active' : ''}`} disabled={!touching.length} onClick={() => pick('touching')} title="Pairs of elements within the same model">
            <span>Touching elements</span>
            <b>{touching.length.toLocaleString()}</b>
          </button>
          <button type="button" className={`clash__kind${view === 'linked' ? ' active' : ''}`} disabled={!linked.length} onClick={() => pick('linked')} title="Pairs of elements across two models">
            <span>Linked elements</span>
            <b>{models.length < 2 ? '—' : linked.length.toLocaleString()}</b>
          </button>
        </div>

        {running ? (
          <div className="clash__status">
            <span>Checking {running.label}… {Math.round(running.progress * 100)}%</span>
            <button type="button" className="btn btn--small" onClick={requestCancel}>Cancel</button>
            <progress className="related__progress" value={running.progress} max={1} />
          </div>
        ) : (
          <div className="clash__status">
            <span>{status}</span>
            {pending > 0 && !settings.auto && (
              <button type="button" className="btn btn--small" onClick={requestRun}>
                Update now
              </button>
            )}
          </div>
        )}
        {error && <div className="flt__hint">{error}</div>}

        <details className="clash__settings">
          <summary>Settings</summary>
          <div className="disp">
            <label className="disp__row">
              <span>Tolerance (m)</span>
              <input type="number" min={0} step={0.005} value={settings.tolerance} onChange={(e) => setSettings({ tolerance: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 72 }} />
            </label>
            <Switch label="Exact geometry" on={settings.exact} onChange={(exact) => setSettings({ exact })} />
            <Switch label="Keep up to date automatically" on={settings.auto} onChange={(auto) => setSettings({ auto })} />
          </div>
        </details>
      </div>
    </CollapsibleSection>
  );
}

const VIEW_LABEL: Record<ClashView, string> = { all: 'All', touching: 'Touching', linked: 'Linked' };

/** The clash / contact pairs, kept at the bottom of the Models tab (its own
    scroll): filter by kind and by contact, click a row to select both
    elements, export what is shown or everything to CSV. */
export function ClashResultsList() {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const results = useClashStore((s) => s.results);
  const view = useClashStore((s) => s.view);
  const setView = useClashStore((s) => s.setView);
  const [open, setOpen] = usePersistedState('related.clashListOpen', true);
  const [filter, setFilter] = useState<Filter>('all');
  const selectRows = useSelectRows();
  const modelName = (id: string) => modelNameOf(models, id);

  const { touching, linked } = useMemo(() => clashRows(results), [results]);
  const all = useMemo(() => [...touching, ...linked], [touching, linked]);
  const rows = view === 'touching' ? touching : view === 'linked' ? linked : all;
  const shown = useMemo(() => {
    if (filter === 'all') return rows;
    if (filter === 'overlap') return rows.filter((r) => r.overlap);
    if (filter === 'touch') return rows.filter((r) => !r.overlap);
    return rows.filter((r) => r.position === filter);
  }, [rows, filter]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { overlap: 0, touch: 0 };
    for (const r of rows) {
      c[r.overlap ? 'overlap' : 'touch']++;
      c[r.position] = (c[r.position] ?? 0) + 1;
    }
    return c;
  }, [rows]);

  const exportCsv = (list: ContactRow[], name: string) => {
    const guid = (modelId: string, localId: number) => engine.getIndexes().get(modelId)?.elements.get(localId)?.guid ?? '';
    downloadCsv(
      name,
      ['Kind', 'A model', 'A GlobalId', 'A name', 'A class', 'B model', 'B GlobalId', 'B name', 'B class', 'Contact', 'B is (relative to A)', 'Gap (mm)'],
      list.map((r) => [
        r.a.modelId === r.b.modelId ? 'Touching' : 'Linked',
        modelName(r.a.modelId), guid(r.a.modelId, r.a.localId), r.a.name, r.a.category,
        modelName(r.b.modelId), guid(r.b.modelId, r.b.localId), r.b.name, r.b.category,
        r.overlap ? 'Overlap' : 'Touch', POSITION_LABEL[r.position], Math.round(r.distance * 1000),
      ]),
    );
  };

  if (!models.length) return null;

  return (
    <div className={`clash-list config-section${open ? ' is-open' : ''}`}>
      {/* The same header as the pane's other sections (CollapsibleSection). */}
      <div className="config-section__head">
        <button type="button" className="settings-section__header" onClick={() => setOpen(!open)} aria-expanded={open}>
          <IconSectionChevron className="section-chevron" />
          <span className="section-title">Clash results <span className="clash-list__count">{shown.length.toLocaleString()}</span></span>
        </button>
        <div className="clash-list__actions" style={{ paddingRight: 10 }}>
          <button type="button" className="btn btn--small" disabled={!shown.length} onClick={() => exportCsv(shown, view === 'all' ? 'clashes.csv' : `${view}-elements.csv`)} title="The pairs shown (kind and contact filter applied)">
            <IconDownload /> CSV
          </button>
          <button type="button" className="btn btn--small" disabled={!all.length} onClick={() => exportCsv(all, 'clashes-all.csv')} title="Every pair, touching and linked">
            <IconDownload /> All
          </button>
        </div>
      </div>
      {open && (
        <>
          <div className="clash-list__bar">
            <div className="segmented-choice">
              {(['all', 'touching', 'linked'] as const).map((v) => (
                <button key={v} type="button" className={view === v ? 'active' : ''} onClick={() => setView(v)}>
                  {VIEW_LABEL[v]} ({(v === 'all' ? all : v === 'touching' ? touching : linked).length.toLocaleString()})
                </button>
              ))}
            </div>
            <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} title="Contact">
              <option value="all">Any contact ({rows.length})</option>
              <option value="overlap">Overlaps ({counts.overlap})</option>
              <option value="touch">Touching only ({counts.touch})</option>
              {(Object.keys(POSITION_LABEL) as VerticalPosition[]).map((p) => (
                <option key={p} value={p}>B {POSITION_LABEL[p].toLowerCase()} ({counts[p] ?? 0})</option>
              ))}
            </select>
            <button type="button" className="btn btn--small" disabled={!shown.length} onClick={() => selectRows(shown)}>Select</button>
          </div>
          <div className="clash-list__body">
            {shown.length === 0 ? (
              <div className="flt__hint">{Object.keys(results).length ? 'No pairs match.' : 'No results yet.'}</div>
            ) : (
              <table className="seq-grid">
                <thead>
                  <tr>
                    <th>A</th>
                    <th>B</th>
                    <th title="Where B sits relative to A">B is</th>
                    <th className="seq-grid__num" title="Gap between the two (0 = overlapping)">mm</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, MAX_ROWS).map((r) => (
                    <tr key={`${r.a.modelId}:${r.a.localId}|${r.b.modelId}:${r.b.localId}`} onClick={() => selectRows([r])} title="Select both">
                      <td className="seq-grid__name" title={`${r.a.name} (${r.a.category}) in ${modelName(r.a.modelId)}`}>
                        {r.a.name}
                        <span className="related__model">{modelName(r.a.modelId)}</span>
                      </td>
                      <td className="seq-grid__name" title={`${r.b.name} (${r.b.category}) in ${modelName(r.b.modelId)}`}>
                        {r.b.name}
                        {r.a.modelId !== r.b.modelId && <span className="related__model">{modelName(r.b.modelId)}</span>}
                      </td>
                      <td className={r.overlap ? 'related__overlap' : undefined} title={r.overlap ? 'Overlapping: the two pass through each other' : 'Touching'}>{POSITION_LABEL[r.position]}</td>
                      <td className="seq-grid__num">{r.overlap ? '0' : Math.round(r.distance * 1000)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {shown.length > MAX_ROWS && <div className="flt__hint">Showing the first {MAX_ROWS} of {shown.length.toLocaleString()}; Select and CSV cover every pair.</div>}
          </div>
        </>
      )}
    </div>
  );
}
