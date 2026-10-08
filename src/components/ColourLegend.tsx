import { useMemo } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelColorStore } from '../state/modelColorStore';
import { useViewSettingsStore, type ViewKey } from '../state/viewSettingsStore';
import { useSearchSetsStore } from '../state/searchSetsStore';
import { useModelFields } from './modelFields';
import { useColourValues } from './useColourValues';
import { isSetFolderField, makeValueOf, setFolderOf } from '../viewer/setFolderValues';
import { legendRows, valuesOfRow, type LegendRow } from '../viewer/colourLegend';
import { usePersistedState } from '../utils/persistedState';

const MAX_ROWS = 40;

/** Bottom-left of the viewer while Models > Colour is on: the property and a row per colour with its
    object count. A row selects its objects (Ctrl+click adds to the selection); the × turns colouring off.
    With the view split, each view's colouring has its own block. */
export function ColourLegend() {
  const split = useViewSettingsStore((s) => s.pages.model.split);
  const main = useModelColorStore((s) => s.views.main.enabled);
  const second = useModelColorStore((s) => s.views.second.enabled);
  const blocks: ViewKey[] = split ? [...(main ? ['main' as const] : []), ...(second ? ['second' as const] : [])] : main ? ['main'] : [];
  if (blocks.length === 0) return null;
  return (
    <div className="colour-legend-stack">
      {blocks.map((view) => <LegendBlock key={view} view={view} title={split ? (view === 'main' ? 'Left view' : 'Right view') : null} />)}
    </div>
  );
}

function LegendBlock({ view, title }: { view: ViewKey; title: string | null }) {
  const engine = useViewerEngine();
  const { field, colors, others } = useModelColorStore((s) => s.views[view]);
  const patch = useModelColorStore((s) => s.patch);
  const sets = useSearchSetsStore((s) => s.sets);
  const fields = useModelFields();
  const values = useColourValues(field);
  const [open, setOpen] = usePersistedState('colourLegend.open', true);
  const rows = useMemo(() => legendRows(values, colors, others), [values, colors, others]);
  const label = isSetFolderField(field)
    ? `Set folder › ${setFolderOf(field) || '(no folder)'}`
    : fields.find((f) => f.id === field)?.label ?? field;
  const total = rows.reduce((n, r) => n + r.count, 0);

  /** Selects the objects of a row's values (Ctrl: on top of the selection, so several rows can be added). */
  const select = (row: LegendRow, add: boolean) => {
    const wanted = new Set(valuesOfRow(row, values, colors));
    const valueOf = makeValueOf(field, engine.getIndexes(), sets);
    const out: Record<string, number[]> = {};
    for (const [modelId, index] of engine.getIndexes()) for (const [id, e] of index.elements) if (wanted.has(valueOf(e))) (out[modelId] ??= []).push(id);
    void engine.selectElements(out, false, add);
  };

  return (
    <div className="colour-legend" role="group" aria-label={`Colour legend${title ? `, ${title}` : ''}`}>
      <div className="colour-legend__head">
        <button type="button" className="colour-legend__toggle" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? 'Collapse the legend' : 'Show the legend'}>
          <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          <span className="colour-legend__title">{title ? `${title}: ` : ''}{label}</span>
        </button>
        <span className="colour-legend__n" title="Objects coloured">{total.toLocaleString()}</span>
        <button type="button" className="colour-legend__close" onClick={() => patch(view, { enabled: false })} title="Turn colouring off" aria-label="Turn colouring off">×</button>
      </div>
      {open && (
        <div className="colour-legend__rows">
          {rows.length === 0 && <div className="colour-legend__empty">Nothing to colour yet.</div>}
          {rows.slice(0, MAX_ROWS).map((r) => (
            <button key={`${r.kind}:${r.value ?? r.label}`} type="button" className="colour-legend__row" onClick={(e) => select(r, e.ctrlKey || e.metaKey)} title={`${r.label}: ${r.count.toLocaleString()} objects. Click to select them (Ctrl+click adds)`}>
              <span className={`colour-legend__swatch${r.color === null ? ' is-own' : ''}`} style={r.color ? { background: r.color } : undefined} />
              <span className="colour-legend__label">{r.label}</span>
              <span className="colour-legend__count">{r.count.toLocaleString()}</span>
            </button>
          ))}
          {rows.length > MAX_ROWS && <div className="colour-legend__empty">… and {rows.length - MAX_ROWS} more (see Models › Colour)</div>}
        </div>
      )}
    </div>
  );
}
