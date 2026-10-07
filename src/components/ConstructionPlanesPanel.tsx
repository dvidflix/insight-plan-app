import { useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useConstructionPlanesStore, type ConstructionPlane } from '../state/constructionPlanesStore';
import { usePersistedState } from '../utils/persistedState';
import { CollapsibleSection } from './CollapsibleSection';
import { IconEye, IconEyeOff, IconTrash } from './icons';

/** Views > Decorators > Construction planes: translucent boxes in the model's coordinates, from a
    minimum X Y Z to a maximum X Y Z (a plane where min and max meet on an axis), drawn in the 3D view.
    Click one to fly to it; Edit opens the table. */

type Corner = 'minX' | 'minY' | 'minZ' | 'maxX' | 'maxY' | 'maxZ';
const CORNERS: Corner[] = ['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ'];

const toNumber = (text: string): number | null => {
  const t = text.trim().replace(/\s/g, '');
  if (!t) return null;
  const n = Number(/^-?\d+,\d+$/.test(t) ? t.replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
};

const sizeText = (p: ConstructionPlane) => {
  const d = [p.maxX - p.minX, p.maxY - p.minY, p.maxZ - p.minZ].map((v) => Math.abs(v));
  const flat = d.filter((v) => v < 1e-6).length;
  return `${d.map((v) => v.toFixed(2)).join(' × ')} m${flat ? ' · plane' : ''}`;
};

export function ConstructionPlanesPanel() {
  const engine = useViewerEngine();
  const planes = useConstructionPlanesStore((s) => s.planes);
  const visible = useConstructionPlanesStore((s) => s.visible);
  const { setVisible, add, update, remove, clear } = useConstructionPlanesStore.getState();
  const [open, setOpen] = usePersistedState('constructionPlanes.open', true);
  const [editing, setEditing] = useState(false);

  const flyTo = (p: ConstructionPlane) => void engine.focusConstructionPlane(p);

  return (
    <CollapsibleSection
      title={`Construction planes${planes.length ? ` (${planes.length})` : ''}`}
      open={open}
      onToggle={() => setOpen(!open)}
      tip={
        <>
          <p>Translucent boxes in the model's coordinates (project axes: X east, Y north, Z up, metres), set by a <b>minimum</b> X Y Z and a <b>maximum</b> X Y Z. Where the two meet on an axis the box is flat: a plane, e.g. the same Z for a floor level or a crane's working height.</p>
          <p>Click a row to fly to it; the eye shows or hides one. <b>Edit</b> opens a table with the corners, the colour and the opacity.</p>
        </>
      }
    >
      <div className="mkt">
        <div className="mkt__bar">
          <button type="button" role="switch" aria-checked={visible} className={`switch${visible ? ' on' : ''}`} onClick={() => setVisible(!visible)} title="Show the construction planes in the 3D view">
            <span className="switch__thumb" />
          </button>
          <span className="mkt__spacer" />
          <button type="button" className={`btn btn--small${editing ? ' primary' : ''}`} onClick={() => setEditing((v) => !v)}>{editing ? 'Done' : 'Edit'}</button>
        </div>

        {planes.length === 0 && !editing && <div className="flt__hint">No construction planes yet. Press Edit, then add one and type its min and max X Y Z.</div>}

        {!editing && planes.length > 0 && (
          <div className="mkt__list">
            {planes.map((p) => (
              <button key={p.id} type="button" className={`cpl__row${p.visible ? '' : ' is-off'}`} title={`${p.name || 'Plane'} — click to fly to it`} onClick={() => flyTo(p)}>
                <span className="cpl__swatch" style={{ background: p.color, opacity: Math.max(p.opacity, 0.35) }} />
                <span className="mkt__name">{p.name || 'Plane'}</span>
                <span className="mkt__xyz">{sizeText(p)}</span>
              </button>
            ))}
          </div>
        )}

        {editing && (
          <>
            <div className="mkt__tools">
              <button type="button" className="btn btn--small" onClick={() => add({ name: `Plane ${planes.length + 1}` })}>+ Plane</button>
              <span className="mkt__spacer" />
              <button type="button" className="btn btn--small btn--danger" onClick={() => { if (window.confirm(`Delete all ${planes.length} construction planes?`)) clear(); }} disabled={!planes.length}>Clear</button>
            </div>
            <div className="mkt__grid">
              <div className="cpl__head">
                <span>Min X</span><span>Min Y</span><span>Min Z</span><span>Max X</span><span>Max Y</span><span>Max Z</span><span /><span /><span />
              </div>
              {planes.map((p) => (
                <div className="cpl__item" key={p.id}>
                  <div className="cpl__edit">
                    <input className="cpl__name" value={p.name} placeholder="name" onChange={(e) => update(p.id, { name: e.target.value })} />
                  </div>
                  <div className="cpl__edit">
                    {CORNERS.map((c) => (
                      <input
                        key={c}
                        className="mkt__num"
                        inputMode="decimal"
                        value={Number.isFinite(p[c]) ? String(p[c]) : ''}
                        onChange={(e) => { const n = toNumber(e.target.value); if (n !== null || e.target.value === '') update(p.id, { [c]: n ?? 0 }); }}
                      />
                    ))}
                    <input type="color" value={p.color} onChange={(e) => update(p.id, { color: e.target.value })} title="Colour" aria-label="Colour" />
                    <button type="button" className="mkt__del" title={p.visible ? 'Hide this plane' : 'Show this plane'} aria-label={p.visible ? 'Hide this plane' : 'Show this plane'} onClick={() => update(p.id, { visible: !p.visible })}>{p.visible ? <IconEye width={14} height={14} /> : <IconEyeOff width={14} height={14} />}</button>
                    <button type="button" className="mkt__del" title="Delete this plane" aria-label="Delete this plane" onClick={() => remove(p.id)}><IconTrash /></button>
                  </div>
                  <label className="mkt__def" title="How see-through it is">
                    Opacity
                    <input type="range" min={0.05} max={1} step={0.05} value={p.opacity} onChange={(e) => update(p.id, { opacity: Number(e.target.value) })} />
                  </label>
                </div>
              ))}
            </div>
            {planes.length === 0 && <div className="flt__hint">Add a plane, then type its corners (metres, project axes).</div>}
          </>
        )}
      </div>
    </CollapsibleSection>
  );
}
