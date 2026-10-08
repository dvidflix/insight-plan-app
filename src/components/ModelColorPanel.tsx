import { useEffect, useMemo, useRef, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useModelColorStore, type ColourConfig } from '../state/modelColorStore';
import { useViewSettingsStore, type ViewKey } from '../state/viewSettingsStore';
import { useSearchSetsStore } from '../state/searchSetsStore';
import { SET_FOLDER, isSetFolderField, makeValueOf, setFolderOf } from '../viewer/setFolderValues';
import { useIndexTick, useModelFields } from './modelFields';
import { useColourValues } from './useColourValues';
import { MODEL_PALETTES, paletteColors } from '../viewer/colorPalettes';
import { FieldPicker } from './schedule/FieldRules';
import { CollapsibleSection, useOpenSections } from './CollapsibleSection';
import { InfoTip } from './InfoTip';

const MAX_VALUES = 150;

/** Models > Colour: colour the models by any property — pick the field,
    a palette (or random colours), and adjust any value's colour. Split
    into two views, each view is coloured on its own. */
export function ModelColorPanel() {
  const engine = useViewerEngine();
  const split = useViewSettingsStore((s) => s.pages.model.split);
  const [picked, setPicked] = useState<ViewKey>('main');
  const view: ViewKey = split ? picked : 'main';
  const { enabled, field, palette, seed, colors, others } = useModelColorStore((s) => s.views[view]);
  const patchView = useModelColorStore((s) => s.patch);
  const patch = (p: Partial<ColourConfig>) => patchView(view, p);
  const fields = useModelFields();
  const sets = useSearchSetsStore((s) => s.sets);
  const setFolder = isSetFolderField(field);
  // A property's values, or a set folder's (the names of its sets), most objects first.
  const values = useColourValues(field);
  const folders = useMemo(() => [...new Set(sets.map((x) => x.group ?? ''))].sort((a, b) => a.localeCompare(b)), [sets]);
  const sections = useOpenSections<'values' | 'field'>('models.colourSections', ['values', 'field']);
  const fieldLabel = fields.find((f) => f.id === field);
  const pickField = (id: string) => {
    patch({ field: id });
    setPendingField(id);
  };

  /** One colour per value (most common first) from the palette. */
  const recolour = (f: string, pal: string, sd: number, list = values) => {
    const shown = list.slice(0, MAX_VALUES);
    const cs = paletteColors(pal, shown.length, sd);
    patch({ field: f, palette: pal, seed: sd, colors: shown.map((v, i) => ({ value: v.value, color: cs[i] })), enabled: true });
  };
  // Colours for a newly picked field are made once its values are known.
  const [pendingField, setPendingField] = useState<string | null>(null);
  useEffect(() => {
    if (pendingField && pendingField === field) {
      recolour(field, palette, seed);
      setPendingField(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingField, field, values]);

  const colorOf = new Map(colors.map((c) => [c.value, c.color]));
  const setColor = (value: string, color: string) => {
    const next = colors.some((c) => c.value === value) ? colors.map((c) => (c.value === value ? { ...c, color } : c)) : [...colors, { value, color }];
    patch({ colors: next });
  };
  const selectValue = (value: string) => {
    const valueOf = makeValueOf(field, engine.getIndexes(), sets);
    const out: Record<string, number[]> = {};
    for (const [modelId, index] of engine.getIndexes()) for (const [id, e] of index.elements) if (valueOf(e) === value) (out[modelId] ??= []).push(id);
    void engine.selectElements(out, false);
  };
  const shownValues = values.slice(0, MAX_VALUES);

  return (
    <div>
      <div className="disp model-colour__top">
        {split && (
          <div className="cols__views" role="tablist" style={{ margin: '4px 0 6px' }}>
            <button type="button" role="tab" aria-selected={view === 'main'} className={view === 'main' ? 'active' : ''} onClick={() => setPicked('main')}>Left view</button>
            <button type="button" role="tab" aria-selected={view === 'second'} className={view === 'second' ? 'active' : ''} onClick={() => setPicked('second')}>Right view</button>
          </div>
        )}
        <div className="disp__row">
          <span>Colour the models</span>
          <button type="button" role="switch" aria-checked={enabled} className={`switch${enabled ? ' on' : ''}`} onClick={() => (enabled ? patch({ enabled: false }) : colors.length ? patch({ enabled: true }) : recolour(field, palette, seed))}>
            <span className="switch__thumb" />
          </button>
        </div>
        <div className="disp__row">
          <span>Colour by</span>
          <b className="model-colour__field" title={field}>
            {setFolder ? `Set folder › ${setFolderOf(field) || '(no folder)'}` : fieldLabel ? `${fieldLabel.group} › ${fieldLabel.label}` : field}
          </b>
        </div>
        <label className="disp__row">
          <span>
            Set folder{' '}
            <InfoTip>Colour each object by the search or selection set that holds it, from one folder of Search sets. An object in several sets takes the first one in the list.</InfoTip>
          </span>
          <select
            value={setFolder ? field : ''}
            onChange={(e) => pickField(e.target.value || 'Attributes.Class')}
            disabled={folders.length === 0}
            title={folders.length === 0 ? 'No search or selection sets saved yet' : undefined}
          >
            <option value="">— a property —</option>
            {folders.map((g) => (
              <option key={g} value={`${SET_FOLDER}${g}`}>{g || '(no folder)'}</option>
            ))}
          </select>
        </label>
        <label className="disp__row">
          <span>Palette</span>
          <select value={palette} onChange={(e) => recolour(field, e.target.value, seed)}>
            {MODEL_PALETTES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            <option value="random">Random</option>
          </select>
        </label>
        <div className="model-colour__palette">
          {paletteColors(palette, 12, seed).map((c, i) => <span key={i} style={{ background: c }} />)}
          <button type="button" className="btn btn--small" onClick={() => recolour(field, 'random', Math.random())} title="New random colours">Shuffle</button>
          <button type="button" className="btn btn--small" onClick={() => recolour(field, palette, seed)} title="Recolour every value from the palette (undoes hand-picked colours)">Reset colours</button>
        </div>
        <div className="disp__row">
          <span>
            Other values{' '}
            <InfoTip>Values without a colour of their own (beyond the {MAX_VALUES} most common): one colour for all, or keep their own colours.</InfoTip>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label className="cols__check" style={{ margin: 0 }}>
              <input type="checkbox" checked={others === null} onChange={(e) => patch({ others: e.target.checked ? null : '#d4d4d8' })} />
              <span>Own colours</span>
            </label>
            {others !== null && <input type="color" value={others} onChange={(e) => patch({ others: e.target.value })} />}
          </span>
        </div>
      </div>

      <CollapsibleSection
        title={`Values (${values.length})`}
        open={sections.isOpen('values')}
        onToggle={() => sections.toggle('values')}
        flush
        tip="Each value's colour: click the swatch to change it. Click a value to select its objects (Isolate / Ghost follow)."
      >
        {values.length === 0 ? (
          <div className="disp"><div className="flt__hint">Load a model to colour it.</div></div>
        ) : (
          <table className="seq-grid">
            <thead>
              <tr>
                <th className="seq-grid__swatch" />
                <th>Value</th>
                <th className="seq-grid__num">Objects</th>
              </tr>
            </thead>
            <tbody>
              {shownValues.map((v) => (
                <tr key={v.value}>
                  <td className="seq-grid__swatch">
                    <input type="color" className="model-colour__swatch" value={colorOf.get(v.value) ?? others ?? '#ffffff'} onChange={(e) => setColor(v.value, e.target.value)} title="Change colour" />
                  </td>
                  <td className="seq-grid__name" title={`${v.value}: select these objects`} onClick={() => selectValue(v.value)}>{v.value}</td>
                  <td className="seq-grid__num">{v.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="Colour by…" open={sections.isOpen('field')} onToggle={() => sections.toggle('field')}>
        <div className="cols">
          <FieldPicker
            catalog={fields}
            picked={new Set([field])}
            placeholder="Search properties…"
            onPick={(f) => {
              patch({ field: f.id });
              setPendingField(f.id);
            }}
          />
        </div>
      </CollapsibleSection>
    </div>
  );
}

/** Applies Models > Colour to the models while the Models page shows, and
    takes the colours off again when it hides or colouring is turned off —
    the main view's colouring on it, the right view's on the split's second view. */
export function ModelColorSync() {
  return (
    <>
      <ViewColourSync view="main" />
      <ViewColourSync view="second" />
    </>
  );
}

function ViewColourSync({ view }: { view: ViewKey }) {
  const engine = useViewerEngine();
  const { enabled, field, colors, others } = useModelColorStore((s) => s.views[view]);
  const sets = useSearchSetsStore((s) => s.sets);
  const models = useModelsStore((s) => s.models);
  const tick = useIndexTick();
  const secondaryTick = useSecondaryTick();
  // Applying and removing are async: queue them so a removal never lands on
  // top of the colours applied after it.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = (job: () => Promise<void>) => { queue.current = queue.current.then(job, job); };
  useEffect(() => {
    const target = view === 'main' ? engine : engine.secondary;
    if (!enabled || !target) return;
    const byValue = new Map(colors.map((c) => [c.value, c.color]));
    const valueOf = makeValueOf(field, engine.getIndexes(), sets);
    const applied: [string, number[]][] = [];
    enqueue(async () => {
      for (const [modelId, index] of engine.getIndexes()) {
        const byColor = new Map<string, number[]>();
        for (const [id, e] of index.elements) {
          const c = byValue.get(valueOf(e)) ?? others;
          if (c) (byColor.get(c) ?? byColor.set(c, []).get(c)!).push(id);
        }
        const all: number[] = [];
        for (const [color, ids] of byColor) {
          await target.setColor(modelId, ids, color, true);
          all.push(...ids);
        }
        applied.push([modelId, all]);
      }
      await target.forceUpdate();
    });
    return () => {
      enqueue(async () => {
        for (const [modelId, ids] of applied) await target.setColor(modelId, ids, null, true);
        await target.forceUpdate();
      });
    };
  }, [engine, view, enabled, field, colors, others, models, sets, tick, secondaryTick]);
  return null;
}

/** Bumps when the split's second view appears (it needs the colours too). */
function useSecondaryTick() {
  const engine = useViewerEngine();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    engine.onSecondaryChange.add(bump);
    return () => { engine.onSecondaryChange.remove(bump); };
  }, [engine]);
  return tick;
}
