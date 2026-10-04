import { useEffect, useState, type ReactNode } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { MATERIAL_CLASSES, MATERIAL_CLASS_LABELS, type ClassChoice, type MaterialEntry } from '../viewer/materialClasses';
import { useModelsStore } from '../state/modelsStore';
import type { ViewId } from '../state/colorModeStore';
import { useViewSettingsStore, type CompareMode, type Projection, type ViewKey, type ViewPage, type ViewStyle } from '../state/viewSettingsStore';
import { InfoTip } from './InfoTip';

function Switch({ label, on, onChange, tip }: { label: string; on: boolean; onChange: (v: boolean) => void; tip?: ReactNode }) {
  return (
    <div className="disp__row">
      <span>{label}{tip && <> <InfoTip>{tip}</InfoTip></>}</span>
      <button type="button" role="switch" aria-checked={on} className={`switch${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
        <span className="switch__thumb" />
      </button>
    </div>
  );
}

/** The "View settings" configuration: split into two views (and, when split, link
    cameras + which view's settings to edit), then `colorSection(view)` (the
    4D page's colour mode), that view's models and display settings, and any
    `extra` page-specific rows. Shared by the Models and 4D Sequencing pages. */
export function View3DPanel({ page, colorSection, extra }: { page: ViewPage; colorSection?: (view: ViewId) => ReactNode; extra?: ReactNode }) {
  const { split, linked, compare = 'side', showNorth = true, northRotation = 0 } = useViewSettingsStore((s) => s.pages[page]);
  const patchPage = useViewSettingsStore((s) => s.patchPage);
  const setSplit = (v: boolean) => patchPage(page, { split: v });
  const setLinked = (v: boolean) => patchPage(page, { linked: v });
  const setCompare = (v: CompareMode) => patchPage(page, { compare: v });
  const [picked, setPicked] = useState<ViewId>('a');
  const view: ViewId = split ? picked : 'a';

  return (
    <div className="disp">
      <Switch label="Split into two views" on={split} onChange={setSplit} tip="The right view keeps its own copy of the models, so it needs about as much graphics memory again." />
      {split && (
        <>
          <label className="disp__row">
            <span>
              Show views{' '}
              <InfoTip>
                <p><b>Side by side:</b> the two views next to each other, cameras linked or not.</p>
                <p><b>Compare slider:</b> both views fill the viewer with linked cameras; drag the divider to wipe between them. Pick each view's models to compare two projects in place.</p>
              </InfoTip>
            </span>
            <select value={compare} onChange={(e) => setCompare(e.target.value as CompareMode)}>
              <option value="side">Side by side</option>
              <option value="slider">Compare slider</option>
            </select>
          </label>
          {compare === 'side' && <Switch label="Link cameras" on={linked} onChange={setLinked} />}
          <div className="cols__views" role="tablist" style={{ margin: '8px 0 2px' }}>
            <button type="button" role="tab" aria-selected={view === 'a'} className={view === 'a' ? 'active' : ''} onClick={() => setPicked('a')}>Left view</button>
            <button type="button" role="tab" aria-selected={view === 'b'} className={view === 'b' ? 'active' : ''} onClick={() => setPicked('b')}>Right view</button>
          </div>
        </>
      )}

      {colorSection?.(view)}
      {split && <ViewModels page={page} view={view === 'a' ? 'main' : 'second'} />}
      <DisplaySettings page={page} view={view === 'a' ? 'main' : 'second'} />

      {/* View cube and north arrow are switched on / off from the toolbar's Visibility menu. */}
      {showNorth && <div className="cols__heading"><span>All views</span></div>}
      {showNorth && (
        <label className="disp__row">
          <span>
            North arrow rotation (°){' '}
            <InfoTip>The arrow points at north as seen from the camera — project north (+Y, the same the sun & shadows use), or turned by this many degrees clockwise, e.g. the site's true north angle. 0 = project north. Show or hide the arrow from the toolbar's eye menu.</InfoTip>
          </span>
          <input
            type="number"
            min={-360}
            max={360}
            step={0.5}
            value={northRotation}
            onChange={(e) => patchPage(page, { northRotation: Math.max(-360, Math.min(360, Number(e.target.value) || 0)) })}
            style={{ width: 72 }}
          />
        </label>
      )}
      {extra}
    </div>
  );
}

/** Which models one view of a split shows — e.g. one project on the
    left and another on the right. By name, so it survives reloading. */
function ViewModels({ page, view }: { page: ViewPage; view: ViewKey }) {
  const models = useModelsStore((st) => st.models);
  const hidden = useViewSettingsStore((st) => st.pages[page][view].hiddenModels);
  const patch = useViewSettingsStore((st) => st.patch);
  const out = new Set(hidden ?? []);
  const setShown = (name: string, shown: boolean) => {
    const next = new Set(out);
    if (shown) next.delete(name);
    else next.add(name);
    patch(page, view, { hiddenModels: [...next] });
  };
  const setAll = (shown: boolean) => patch(page, view, { hiddenModels: shown ? [] : models.map((m) => m.name) });

  return (
    <>
      <div className="cols__heading">
        <span>Models in this view</span>
        {models.length > 1 && (
          <span style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn--small" onClick={() => setAll(true)}>All</button>
            <button type="button" className="btn btn--small" onClick={() => setAll(false)}>None</button>
          </span>
        )}
      </div>
      {models.length === 0 ? (
        <div className="flt__hint">Load a model from the Inputs tab.</div>
      ) : (
        models.map((m) => (
          <label key={m.modelId} className="disp__row" style={{ justifyContent: 'flex-start', gap: 8 }}>
            <input type="checkbox" checked={!out.has(m.name)} onChange={(e) => setShown(m.name, e.target.checked)} />
            <span title={m.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
          </label>
        ))
      )}
    </>
  );
}

function DisplaySettings({ page, view }: { page: ViewPage; view: ViewKey }) {
  const s = useViewSettingsStore((st) => st.pages[page][view]);
  const patch = useViewSettingsStore((st) => st.patch);
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => patch(page, view, { [k]: v });

  return (
    <>
      <div className="cols__heading"><span>Display</span></div>
      <label className="disp__row">
        <span>Camera</span>
        <select value={s.projection} onChange={(e) => set('projection', e.target.value as Projection)}>
          <option value="Perspective">Perspective</option>
          <option value="Orthographic">Orthographic</option>
        </select>
      </label>
      <label className="disp__row">
        <span>View style</span>
        <select value={s.style} onChange={(e) => set('style', e.target.value as ViewStyle)}>
          <option value="COLOR_PEN">Color Pen</option>
          <option value="COLOR_PEN_SHADOWS">Color Pen Shadows</option>
        </select>
      </label>
      <Switch label="Ambient occlusion" on={s.ambientOcclusion} onChange={(v) => set('ambientOcclusion', v)} />
      <Switch label="Anti-aliasing" on={s.antiAliasing} onChange={(v) => set('antiAliasing', v)} />
      <Switch label="Edge lines" on={s.edgeLines} onChange={(v) => set('edgeLines', v)} />
      {s.edgeLines && (
        <label className="disp__row">
          <span>Edge width ({s.edgeWidth.toFixed(1)})</span>
          <input type="range" min={0.5} max={4} step={0.1} value={s.edgeWidth} onChange={(e) => set('edgeWidth', Number(e.target.value))} />
        </label>
      )}
      <label className="disp__row">
        <span>Background</span>
        <input type="color" value={s.background} onChange={(e) => set('background', e.target.value)} />
      </label>
      <RealisticSettings
        sun={!!s.realistic}
        onSun={(v) => set('realistic', v)}
        concrete={s.concrete ?? !!s.realistic}
        onConcrete={(v) => set('concrete', v)}
        sky={!!s.sky}
        onSky={(v) => set('sky', v)}
        materials={!!s.materials}
        onMaterials={(v) => set('materials', v)}
      />
    </>
  );
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** Realistic look (main / left view): a fixed sun with soft shadows, and a
    concrete colour and texture — each switched on its own. */
function RealisticSettings({ sun, onSun, concrete, onConcrete, sky, onSky, materials, onMaterials }: {
  sun: boolean;
  onSun: (v: boolean) => void;
  concrete: boolean;
  onConcrete: (v: boolean) => void;
  sky: boolean;
  onSky: (v: boolean) => void;
  materials: boolean;
  onMaterials: (v: boolean) => void;
}) {
  const r = useViewSettingsStore((st) => st.realism);
  const setR = useViewSettingsStore((st) => st.setRealism);
  return (
    <>
      <div className="cols__heading"><span>Realistic</span></div>
      <Switch label="Sun & shadows" on={sun} onChange={onSun} tip="A fixed sun: shadows stay put through the 4D playback. Left / main view only." />
      {sun && (
        <>
          <label className="disp__row" title="Compass bearing the sun shines from, clockwise from project north (180° = south)">
            <span>Sun direction ({Math.round(r.sunAzimuth)}°)</span>
            <input type="range" min={0} max={359} step={1} value={r.sunAzimuth} onChange={(e) => setR({ sunAzimuth: Number(e.target.value) })} />
          </label>
          <label className="disp__row" title="Sun height above the horizon">
            <span>Sun height ({Math.round(r.sunElevation)}°)</span>
            <input type="range" min={5} max={85} step={1} value={r.sunElevation} onChange={(e) => setR({ sunElevation: Number(e.target.value) })} />
          </label>
          <Switch label="Real-time sky" on={sky} onChange={onSky} tip="A sky behind the models that follows the sun: the horizon turns warm as the sun gets low, and the shaded sides and shiny surfaces pick up its colours." />
        </>
      )}
      <Switch label="Realistic materials" on={materials} onChange={onMaterials} tip="Brick, glass, timber, metal, stone, grass, asphalt... drawn with their own surface, matched from the names in the model (its IFC materials, element names and classes). Glass is see-through and, like metal, reflects the sky. Change a match below." />
      {materials && <MaterialMapping />}
      <Switch label="Concrete" on={concrete} onChange={onConcrete} />
      {concrete && (
        <>
          <label className="disp__row" title="Turns the model's own colours concrete grey; 4D appearance colours stay">
            <span>Concrete colour ({Math.round(r.concreteColor * 100)}%)</span>
            <input type="range" min={0} max={1} step={0.05} value={r.concreteColor} onChange={(e) => setR({ concreteColor: Number(e.target.value) })} />
          </label>
          <label className="disp__row">
            <span>Concrete texture ({Math.round(r.concrete * 100)}%)</span>
            <input type="range" min={0} max={1} step={0.05} value={r.concrete} onChange={(e) => setR({ concrete: Number(e.target.value) })} />
          </label>
        </>
      )}
    </>
  );
}

/** Realistic materials: each colour group of the loaded models, the class its
    names point to, and a choice to change it. */
function MaterialMapping() {
  const engine = useViewerEngine();
  const mapping = useViewSettingsStore((st) => st.realism.mapping ?? {});
  const setR = useViewSettingsStore((st) => st.setRealism);
  const [entries, setEntries] = useState<MaterialEntry[] | null>(engine.materialEntries);
  useEffect(() => {
    setEntries(engine.materialEntries);
    engine.materialEntryListeners.add(setEntries);
    void engine.ensureMaterialEntries();
    return () => { engine.materialEntryListeners.delete(setEntries); };
  }, [engine]);
  if (!entries) return <div className="flt__hint">Reading the models' materials…</div>;
  if (entries.length === 0) return <div className="flt__hint">Load a model to match its materials.</div>;
  const choose = (key: string, value: string) => {
    const next = { ...mapping };
    if (value === 'auto') delete next[key];
    else next[key] = value as ClassChoice;
    setR({ mapping: next });
  };
  return (
    <div className="matmap">
      {entries.map((e) => {
        const auto = e.auto ? MATERIAL_CLASS_LABELS[e.auto] : e.ambiguous ? 'unsure, kept as is' : 'none, kept as is';
        return (
          <label key={e.key} className="matmap__row" title={[e.label, e.detail && `Used by: ${e.detail}`, `${e.count} element${e.count === 1 ? '' : 's'}`].filter(Boolean).join('\n')}>
            <span className="matmap__swatch" style={{ background: e.key }} />
            <span className="matmap__label">{e.label}<small>{e.count}</small></span>
            <select value={mapping[e.key] ?? 'auto'} onChange={(ev) => choose(e.key, ev.target.value)}>
              <option value="auto">Automatic: {auto}</option>
              <option value="original">Keep the model's colour</option>
              {MATERIAL_CLASSES.map((c) => <option key={c} value={c}>{MATERIAL_CLASS_LABELS[c]}</option>)}
            </select>
          </label>
        );
      })}
    </div>
  );
}

/** Storey slide of `modelName` per view, for the 3D tab (Models and 4D
    Sequencing), which picks the model: when the page is split, a Left /
    Right switch picks which view's slide to set. */
export function ViewStoreySlide({ page, modelName }: { page: ViewPage; modelName: string }) {
  const split = useViewSettingsStore((st) => st.pages[page].split);
  const [picked, setPicked] = useState<ViewKey>('main');
  const view: ViewKey = split ? picked : 'main';
  const slides = useViewSettingsStore((st) => st.pages[page][view].storeySlides);
  const patch = useViewSettingsStore((st) => st.patch);
  return (
    <>
      <div className="cols__heading">
        <span>
          Storey slide{' '}
          <InfoTip>Lifts each storey above the one below by the offset; the lowest stays put. This view only. It changes how the model is drawn, so a large model takes a moment.</InfoTip>
        </span>
      </div>
      {split && (
        <div className="cols__views" role="tablist" style={{ margin: '8px 0 2px' }}>
          <button type="button" role="tab" aria-selected={view === 'main'} className={view === 'main' ? 'active' : ''} onClick={() => setPicked('main')}>Left view</button>
          <button type="button" role="tab" aria-selected={view === 'second'} className={view === 'second' ? 'active' : ''} onClick={() => setPicked('second')}>Right view</button>
        </div>
      )}
      <StoreySlide modelName={modelName} slides={slides} onChange={(storeySlides) => patch(page, view, { storeySlides })} />
    </>
  );
}

/** Storey slide of one view: lifts each storey of a model above the one below
    (lowest stays put), per model — this view only. */
function StoreySlide({ modelName, slides, onChange }: { modelName: string; slides: Record<string, number>; onChange: (s: Record<string, number>) => void }) {
  const models = useModelsStore((st) => st.models);
  const [amount, setAmount] = useState(10);
  const current = slides[modelName] ?? 0;
  const setFor = (step: number) => {
    const next = { ...slides };
    if (step) next[modelName] = step;
    else delete next[modelName];
    onChange(next);
  };

  return (
    <>
      {models.length === 0 ? (
        <div className="flt__hint">Load a model from the Inputs tab.</div>
      ) : (
        <>
          <div className="disp__row">
            <span>Offset (m)</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <input type="number" step="any" value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} style={{ width: 64 }} />
              <button type="button" className="btn btn--small primary" onClick={() => modelName && setFor(amount)}>Apply</button>
              <button type="button" className="btn btn--small" onClick={() => setFor(0)} disabled={!current}>Reset</button>
            </span>
          </div>
          {current !== 0 && <div className="flt__hint">Now {fmt(current)} m per storey.</div>}
        </>
      )}
    </>
  );
}
