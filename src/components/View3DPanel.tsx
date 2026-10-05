import { useEffect, useState, type ReactNode } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { DEFAULT_QUALITY, QUALITY_PRESETS, type RenderQuality } from '../viewer/renderQuality';
import { DEFAULT_OUTLINE, DEFAULT_SECTION_STYLE, SECTION_CATEGORY_DEFS, type OutlineSettings, type SectionStyle } from '../viewer/visualAids';
import { MATERIAL_CLASSES, MATERIAL_CLASS_LABELS, type ClassChoice, type MaterialEntry } from '../viewer/materialClasses';
import { useModelsStore } from '../state/modelsStore';
import type { ViewId } from '../state/colorModeStore';
import { useViewSettingsStore, type CompareMode, type Projection, type ViewKey, type ViewPage, type ViewStyle } from '../state/viewSettingsStore';
import { InfoTip } from './InfoTip';
import { CollapsibleSection } from './CollapsibleSection';
import { useViewSettingsGroups, type ViewSettingsGroup } from '../state/viewSettingsGroups';
import { useExperimental } from '../state/appPrefsStore';
import { DEFAULT_FLOOR_PLAN_RANGE, FLOOR_PLAN_RANGE_KEY } from '../viewer/floorPlanRange';
import { DEFAULT_SELECTION_COLOR, SELECTION_COLORS, SELECTION_COLOR_KEY } from '../viewer/selectionColor';

type SectionId = ViewSettingsGroup;
type Sections = { isOpen: (id: SectionId) => boolean; toggle: (id: SectionId) => void };

function Group({ id, title, tip, sections, children }: { id: SectionId; title: string; tip?: ReactNode; sections: Sections; children: ReactNode }) {
  return <CollapsibleSection title={title} tip={tip} open={sections.isOpen(id)} onToggle={() => sections.toggle(id)}>{children}</CollapsibleSection>;
}

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
  const openGroups = useViewSettingsGroups((st) => st.open);
  const toggleGroup = useViewSettingsGroups((st) => st.toggle);
  const sections: Sections = { isOpen: (id) => openGroups.includes(id), toggle: toggleGroup };
  const cutsOn = useExperimental('sectionCuts');

  return (
    <div className="disp vsp">
      <Group id="views" title="Views" sections={sections}>
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
            <ViewModels page={page} view={view === 'a' ? 'main' : 'second'} />
          </>
        )}
        {cutsOn && <FloorPlanRange />}
        {/* View cube and north arrow are switched on / off from the toolbar's Visibility menu. */}
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
      </Group>

      {colorSection && <Group id="colour" title="Colour" sections={sections}>{colorSection(view)}</Group>}
      <DisplaySettings page={page} view={view === 'a' ? 'main' : 'second'} sections={sections} />
      {extra && <Group id="page" title="Gantt & playback" sections={sections}>{extra}</Group>}
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

function DisplaySettings({ page, view, sections }: { page: ViewPage; view: ViewKey; sections: Sections }) {
  const s = useViewSettingsStore((st) => st.pages[page][view]);
  const patch = useViewSettingsStore((st) => st.patch);
  const cutsOn = useExperimental('sectionCuts');
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => patch(page, view, { [k]: v });

  return (
    <>
      <Group id="display" title="Display" sections={sections}>
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
            <option value="COLOR">Color</option>
            <option value="PEN">Pen</option>
            <option value="PEN_SHADOWS">Pen shadows</option>
            <option value="COLOR_PEN">Color pen</option>
            <option value="COLOR_SHADOWS">Color shadows</option>
            <option value="COLOR_PEN_SHADOWS">Color pen shadows</option>
          </select>
        </label>
        <Switch label="Ambient occlusion" on={s.ambientOcclusion} onChange={(v) => set('ambientOcclusion', v)} />
        <Switch label="Anti-aliasing" on={s.antiAliasing} onChange={(v) => set('antiAliasing', v)} />
        <Switch label="Edge lines" on={s.edgeLines} onChange={(v) => set('edgeLines', v)} />
        {s.edgeLines && (
          <>
            <label className="disp__row">
              <span>Edge width ({s.edgeWidth.toFixed(1)})</span>
              <input type="range" min={0.5} max={4} step={0.1} value={s.edgeWidth} onChange={(e) => set('edgeWidth', Number(e.target.value))} />
            </label>
            <label className="disp__row">
              <span>Edge colour</span>
              <input type="color" value={s.quality?.edgeColor || '#2a2a2a'} onChange={(e) => set('quality', { ...s.quality, edgeColor: e.target.value })} />
            </label>
          </>
        )}
        <label className="disp__row">
          <span>Background</span>
          <input type="color" value={s.background} onChange={(e) => set('background', e.target.value)} />
        </label>
      </Group>
      <Group id="quality" title="Render quality" tip="Occlusion, resolution and edges of this view. Lower values are faster on big models; Presentation is for stills and recording." sections={sections}>
        <RenderQualitySettings quality={s.quality} onChange={(quality) => set('quality', quality)} />
      </Group>
      {view === 'main' && (
        <Group id="outline" title="Selection" tip="How selected objects look: the colour they are painted in, and optionally a line around them. Main view." sections={sections}>
          <SelectionColour />
          <OutlineControls outline={s.outline} onChange={(outline) => set('outline', outline)} />
        </Group>
      )}
      {view === 'main' && cutsOn && (
        <Group id="cuts" title="Section cuts & plans (experimental)" tip="Section cuts fill and outline what a section plane cuts through, like a drawn section: one fill, or a colour per kind of element. Plan views are a floor plan per storey, cut at its level." sections={sections}>
          <SectionStyleControls style={s.sectionStyle} onChange={(sectionStyle) => set('sectionStyle', sectionStyle)} />
          <PlanViews />
        </Group>
      )}
      <Group id="realistic" title="Realistic" sections={sections}>
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
      </Group>
    </>
  );
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

/** How far a floor plan looks down from its storey (m); applies to plan views opened from now on. */
function FloorPlanRange() {
  const engine = useViewerEngine();
  const [range, setRange] = useState(() => {
    try {
      return Number(localStorage.getItem(FLOOR_PLAN_RANGE_KEY)) || DEFAULT_FLOOR_PLAN_RANGE;
    } catch {
      return DEFAULT_FLOOR_PLAN_RANGE;
    }
  });
  const change = (v: number) => {
    const next = Math.min(20, Math.max(1, v || 1));
    setRange(next);
    try {
      localStorage.setItem(FLOOR_PLAN_RANGE_KEY, String(next));
    } catch {
      // not remembered
    }
    engine.setFloorPlanRange(next);
  };
  return (
    <label className="disp__row">
      <span>Floor plan range (m) <InfoTip>How far a floor plan looks down from its storey's level. Applies to plan views opened from now on.</InfoTip></span>
      <input type="number" min={1} max={20} step={1} value={range} onChange={(e) => change(Number(e.target.value))} style={{ width: 72 }} />
    </label>
  );
}

/** The colour of selected objects (one for the whole viewer). */
function SelectionColour() {
  const engine = useViewerEngine();
  const [color, setColor] = useState(() => {
    try {
      return localStorage.getItem(SELECTION_COLOR_KEY) ?? DEFAULT_SELECTION_COLOR;
    } catch {
      return DEFAULT_SELECTION_COLOR;
    }
  });
  const choose = (hex: string) => {
    setColor(hex);
    try {
      localStorage.setItem(SELECTION_COLOR_KEY, hex);
    } catch {
      // not remembered
    }
    void engine.ready.then(() => engine.setSelectionColor(hex));
  };
  return (
    <div className="settings-field">
      <span className="settings-field__label">Selection colour <InfoTip>The colour selected objects are painted in. The outline below adds a line around them.</InfoTip></span>
      <div className="sel-colors">
        {SELECTION_COLORS.map((c) => (
          <button key={c.hex} type="button" className={`sel-colors__swatch${color.toLowerCase() === c.hex ? ' active' : ''}`} style={{ background: c.hex }} title={c.label} aria-label={c.label} onClick={() => choose(c.hex)} />
        ))}
        <input type="color" value={color} onChange={(e) => choose(e.target.value)} title="Custom colour" />
      </div>
    </div>
  );
}

/** Outline of the selection: a line around it and a tinted fill (the Outliner). */
function OutlineControls({ outline, onChange }: { outline: Partial<OutlineSettings> | undefined; onChange: (o: Partial<OutlineSettings>) => void }) {
  const o: OutlineSettings = { ...DEFAULT_OUTLINE, ...outline };
  const patch = (p: Partial<OutlineSettings>) => onChange({ ...outline, ...p });
  return (
    <>
      <Switch label="Outline the selection" on={o.enabled} onChange={(v) => patch({ enabled: v })} />
      {o.enabled && (
        <>
          <label className="disp__row"><span>Line colour</span><input type="color" value={o.color} onChange={(e) => patch({ color: e.target.value })} /></label>
          <label className="disp__row">
            <span>Line width ({o.thickness})</span>
            <input type="range" min={1} max={5} step={0.5} value={o.thickness} onChange={(e) => patch({ thickness: Number(e.target.value) })} />
          </label>
        </>
      )}
    </>
  );
}

/** Section cuts: the fill and outline of what a section plane cuts through (the ClipStyler). */
function SectionStyleControls({ style, onChange }: { style: Partial<SectionStyle> | undefined; onChange: (s: Partial<SectionStyle>) => void }) {
  const c: SectionStyle = { ...DEFAULT_SECTION_STYLE, ...style, categories: { ...DEFAULT_SECTION_STYLE.categories, ...style?.categories } };
  const patch = (p: Partial<SectionStyle>) => onChange({ ...style, ...p });
  return (
    <>
      <div className="cols__heading"><span>Section cuts</span></div>
      <Switch label="Styled cuts" on={c.enabled} onChange={(v) => patch({ enabled: v })} />
      {c.enabled && (
        <>
          <Switch label="Colour per kind of element" on={c.byCategory} onChange={(v) => patch({ byCategory: v })} />
          {!c.byCategory && <label className="disp__row"><span>Fill colour</span><input type="color" value={c.fill} onChange={(e) => patch({ fill: e.target.value })} /></label>}
          <label className="disp__row"><span>Outline colour</span><input type="color" value={c.lineColor} onChange={(e) => patch({ lineColor: e.target.value })} /></label>
          <label className="disp__row">
            <span>Outline width ({c.lineWidth})</span>
            <input type="range" min={0.5} max={6} step={0.5} value={c.lineWidth} onChange={(e) => patch({ lineWidth: Number(e.target.value) })} />
          </label>
        </>
      )}
      {c.byCategory && (
        <details className="matmap__more">
          <summary>Colours per kind of element</summary>
          {SECTION_CATEGORY_DEFS.map((d) => (
            <label key={d.id} className="disp__row">
              <span>{d.label}</span>
              <input type="color" value={c.categories[d.id] ?? d.color} onChange={(e) => patch({ categories: { ...c.categories, [d.id]: e.target.value } })} />
            </label>
          ))}
        </details>
      )}
    </>
  );
}

/** The floor plans made from the storeys: open one to see it cut at that level, with the cut styles. */
function PlanViews() {
  const engine = useViewerEngine();
  const [names, setNames] = useState<string[]>(() => engine.planViewNames());
  useEffect(() => {
    const update = () => setNames(engine.planViewNames());
    update();
    engine.onPlanViewsChange.add(update);
    engine.views.list.onItemSet.add(update);
    engine.views.list.onItemDeleted.add(update);
    return () => {
      engine.onPlanViewsChange.remove(update);
      engine.views.list.onItemSet.remove(update);
      engine.views.list.onItemDeleted.remove(update);
    };
  }, [engine]);
  if (names.length === 0) return null;
  return (
    <>
      <div className="cols__heading">
        <span>Plan views <InfoTip>A floor plan per storey, cut at its level. Open one to look at it from above; Close returns to the 3D view.</InfoTip></span>
        <button type="button" className="btn btn--small" onClick={() => engine.closePlanViews()}>Close plan</button>
      </div>
      <div className="matmap">
        {names.map((n) => (
          <button key={n} type="button" className="mini-btn" style={{ textAlign: 'left' }} onClick={() => engine.openPlanView(n)}>{n}</button>
        ))}
      </div>
    </>
  );
}

/** Render quality of one view: presets, occlusion, resolution and adaptive resolution. */
function RenderQualitySettings({ quality, onChange }: { quality: Partial<RenderQuality> | undefined; onChange: (q: Partial<RenderQuality>) => void }) {
  const q: RenderQuality = { ...DEFAULT_QUALITY, ...quality };
  const patch = (p: Partial<RenderQuality>) => onChange({ ...quality, ...p });
  const slider = (label: string, key: 'aoRadius' | 'aoScale' | 'aoThickness' | 'aoSamples', min: number, max: number, step: number, tip: string) => (
    <label className="disp__row" title={tip}>
      <span>{label} ({q[key]})</span>
      <input type="range" min={min} max={max} step={step} value={q[key]} onChange={(e) => patch({ [key]: Number(e.target.value) })} />
    </label>
  );
  return (
    <>
      <div className="disp__row">
        <span>Preset</span>
        <span className="segmented-choice" role="group" aria-label="Quality preset">
          {QUALITY_PRESETS.map((p) => {
            const on = (Object.keys(p.values) as (keyof RenderQuality)[]).every((k) => q[k] === p.values[k]);
            return (
              <button key={p.id} type="button" className={on ? 'active' : ''} aria-pressed={on} title={p.tip} onClick={() => onChange({ ...quality, ...p.values })}>{p.label}</button>
            );
          })}
        </span>
      </div>
      {slider('Occlusion radius', 'aoRadius', 0.1, 2, 0.05, 'How far the shading around corners reaches')}
      {slider('Occlusion strength', 'aoScale', 0.2, 2, 0.05, 'How strongly occlusion darkens')}
      {slider('Occlusion thickness', 'aoThickness', 0.5, 5, 0.5, 'Thickness assumed behind a surface: higher darkens thin objects less')}
      {slider('Occlusion samples', 'aoSamples', 8, 64, 4, 'More samples are smoother and slower')}
      <label className="disp__row" title="Resolution relative to the screen's own: above 1 draws more pixels than the screen shows (sharper, slower)">
        <span>Render scale</span>
        <select value={q.renderScale} onChange={(e) => patch({ renderScale: Number(e.target.value) })}>
          {[0.5, 0.75, 1, 1.5, 2].map((v) => <option key={v} value={v}>{v}×{v === 1 ? ' (native)' : ''}</option>)}
        </select>
      </label>
      <Switch label="Adaptive resolution" on={q.adaptive} onChange={(v) => patch({ adaptive: v })} tip="Lowers the resolution while the frame rate is under the target and raises it again when there is room, up to the render scale." />
      {q.adaptive && (
        <label className="disp__row">
          <span>Target frame rate</span>
          <select value={q.targetFps} onChange={(e) => patch({ targetFps: Number(e.target.value) })}>
            {[24, 30, 45, 60].map((v) => <option key={v} value={v}>{v} fps</option>)}
          </select>
        </label>
      )}
    </>
  );
}

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
  const materialsOn = useExperimental('realisticMaterials');
  return (
    <>
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
      {materialsOn && <Switch label="Realistic materials" on={materials} onChange={onMaterials} tip="Brick, glass, timber, metal, stone, grass, asphalt... drawn with their own surface, matched from the names in the model (its IFC materials, element names and classes). Glass is see-through and, like metal, reflects the sky. Change a match below." />}
      {materialsOn && materials && <MaterialMapping />}
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
