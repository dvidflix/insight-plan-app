import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { useViewerEngine } from '../../viewer/ViewerEngineContext';
import { useModelsStore } from '../../state/modelsStore';
import { useModelPlacementStore, ZERO_OFFSET, type Offset, type Rotation } from '../../state/modelPlacementStore';
import type { ViewPage } from '../../state/viewSettingsStore';
import { ViewStoreySlide } from '../View3DPanel';
import { CollapsibleSection, useOpenSections } from '../CollapsibleSection';

const fmt = (n: number) => (Math.round(n * 100) / 100).toString();

function AxisInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="mp__axis">
      <span>{label}</span>
      <input type="number" step="any" value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
    </label>
  );
}

/** The "3D" tab of the Models and 4D Sequencing pages: one Model picker at
    the top drives the storey slide under it and the placement below. Places
    each loaded model in project axes (X east, Y north, Z up, metres) —
    what lines several buildings up in one 4D view. Relative moves the model by
    the entered amount from where it is now; Absolute puts it at the entered
    offset from where it loaded. Offsets are remembered per model name. */
export function ModelsPanel({ page }: { page: ViewPage }) {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const offsets = useModelPlacementStore((s) => s.offsets);
  const presets = useModelPlacementStore((s) => s.presets);
  const setOffset = useModelPlacementStore((s) => s.setOffset);
  const addPreset = useModelPlacementStore((s) => s.addPreset);
  const removePreset = useModelPlacementStore((s) => s.removePreset);

  const [modelName, setModelName] = useState<string>('');
  const [mode, setMode] = useState<'relative' | 'absolute'>('relative');
  const [amount, setAmount] = useState<Offset>(ZERO_OFFSET);
  const [presetId, setPresetId] = useState<string | null>(null);
  const [turn, setTurn] = useState<Rotation>({ deg: 0, px: 0, py: 0, pz: 0 });
  // Starts collapsed (a new key: it used to start open), then remembered.
  const sections = useOpenSections<'placement'>(`${page}.modelsPanel.sections.v2`, []);

  useEffect(() => {
    if (!models.some((m) => m.name === modelName)) setModelName(models[0]?.name ?? '');
  }, [models, modelName]);

  if (models.length === 0) return <div style={{ padding: 12, color: 'var(--text-dim)' }}>Load a model from the Inputs tab.</div>;

  const current = offsets[modelName] ?? ZERO_OFFSET;
  const translate = () => {
    if (!modelName) return;
    const { rot } = current;
    setOffset(modelName, mode === 'relative' ? { x: current.x + amount.x, y: current.y + amount.y, z: current.z + amount.z, rot } : { x: amount.x, y: amount.y, z: amount.z, rot });
  };
  const applyPreset = () => {
    const p = presets.find((x) => x.id === presetId);
    if (p && modelName) setOffset(modelName, { x: p.x, y: p.y, z: p.z, rot: p.rot });
  };

  // The pivot at the middle of the model's footprint (project axes: X east, Y north, Z up).
  const pivotFromModel = () => {
    const m = models.find((x) => x.name === modelName);
    const object = m && engine.getFragmentsModel(m.modelId)?.object;
    if (!object) return;
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const g = engine.globalOffset();
    setTurn({ ...turn, px: Math.round((c.x + g.x) * 1000) / 1000, py: Math.round((-c.z + g.y) * 1000) / 1000, pz: Math.round((box.min.y + g.z) * 1000) / 1000 });
  };
  const rotate = () => modelName && setOffset(modelName, { x: current.x, y: current.y, z: current.z, rot: turn.deg ? { ...turn } : undefined });

  return (
    <CollapsibleSection
      title="Model placement"
      open={sections.isOpen('placement')}
      onToggle={() => sections.toggle('placement')}
      flush
      tip={<p>Pick a model, then pull its storeys apart (storey slide), rotate it about a pivot point, or move it in project axes (X east, Y north, Z up, metres) — e.g. to line several buildings up in one view. The rotation is applied first (from where the model loaded), then the move, like Navisworks’ Rotate Site Around Pivot Point followed by Move and Rotate Site. Values are in metres: divide Navisworks’ millimetres by 1000. Placement is remembered per model name.</p>}
    >
      <div className="mp">
        <label className="mp__field">
          <span>Model</span>
          <select value={modelName} onChange={(e) => setModelName(e.target.value)}>
            {models.map((m) => (
              <option key={m.modelId} value={m.name}>{m.name}</option>
            ))}
          </select>
        </label>

        <div className="disp"><ViewStoreySlide page={page} modelName={modelName} /></div>

        <div className="cols__heading"><span>Position</span></div>
        <div className="mp__current">
          Offset now: X {fmt(current.x)} · Y {fmt(current.y)} · Z {fmt(current.z)} m{current.rot ? ` · turned ${fmt(current.rot.deg)}° about (${fmt(current.rot.px)}, ${fmt(current.rot.py)}, ${fmt(current.rot.pz)})` : ''}
          <button type="button" className="btn btn--small" onClick={() => modelName && setOffset(modelName, ZERO_OFFSET)} disabled={!current.x && !current.y && !current.z && !current.rot}>Reset</button>
        </div>

        <div className="cols__heading"><span>Rotate about a pivot</span></div>
        <div className="mp__axes">
          <AxisInput label="Pivot X" value={turn.px} onChange={(px) => setTurn({ ...turn, px })} />
          <AxisInput label="Pivot Y" value={turn.py} onChange={(py) => setTurn({ ...turn, py })} />
          <AxisInput label="Pivot Z" value={turn.pz} onChange={(pz) => setTurn({ ...turn, pz })} />
        </div>
        <div className="mp__axes">
          <AxisInput label="Rotation (deg)" value={turn.deg} onChange={(deg) => setTurn({ ...turn, deg })} />
        </div>
        <div className="mp__row">
          <button type="button" className="btn btn--small" onClick={pivotFromModel} title="Put the pivot at the middle of the model, at its base">Pivot at model centre</button>
          <button type="button" className="btn primary" onClick={rotate} title="Turn the model about the vertical axis through the pivot, from where it loaded (anticlockwise seen from above); then Translate moves it">Rotate</button>
        </div>

        <div className="cols__heading"><span>Translate</span></div>
        <div className="segmented-choice">
          <button type="button" className={mode === 'relative' ? 'active' : ''} onClick={() => setMode('relative')}>Relative</button>
          <button type="button" className={mode === 'absolute' ? 'active' : ''} onClick={() => setMode('absolute')}>Absolute</button>
        </div>
        <div className="mp__axes">
          <AxisInput label="X" value={amount.x} onChange={(x) => setAmount({ ...amount, x })} />
          <AxisInput label="Y" value={amount.y} onChange={(y) => setAmount({ ...amount, y })} />
          <AxisInput label="Z" value={amount.z} onChange={(z) => setAmount({ ...amount, z })} />
        </div>
        <button type="button" className="btn primary" onClick={translate}>Translate</button>

        <div className="cols__heading"><span>Presets</span></div>
        <div className="mp__presets">
          {presets.length === 0 && <div className="flt__hint">No presets. + saves the rotation and translate values above as a preset.</div>}
          {presets.map((p) => (
            <div key={p.id} className={`mp__preset${p.id === presetId ? ' selected' : ''}`} onClick={() => setPresetId(p.id)}>
              {p.rot ? `Rotate ${fmt(p.rot.deg)}° about (${fmt(p.rot.px)}, ${fmt(p.rot.py)}, ${fmt(p.rot.pz)}), then ` : ''}X={fmt(p.x)}, Y={fmt(p.y)}, Z={fmt(p.z)}
              <button type="button" className="mp__x" title="Remove preset" onClick={(e) => { e.stopPropagation(); removePreset(p.id); if (presetId === p.id) setPresetId(null); }}>{'✕'}</button>
            </div>
          ))}
        </div>
        <div className="mp__row">
          <button type="button" className="btn btn--small" onClick={() => addPreset({ ...amount, rot: turn.deg ? { ...turn } : undefined })} title="Save the rotation (pivot and angle) and the translate X/Y/Z above as a preset">+ Add preset</button>
          <button type="button" className="btn btn--small" onClick={applyPreset} disabled={!presetId}>Apply selected preset</button>
        </div>
      </div>
    </CollapsibleSection>
  );
}
