import { useState } from 'react';
import { HexColorInput } from './HexColorInput';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useConstructionPlanesStore, type ConstructionPlane } from '../state/constructionPlanesStore';
import { usePersistedState } from '../utils/persistedState';
import { CollapsibleSection } from './CollapsibleSection';
import { IconCopy, IconEye, IconEyeOff, IconRemove } from './icons';
import { formatCoord, parseCoord, type Coord } from '../viewer/coordText';

/** Views > Decorators > Construction planes: translucent boxes in the model's coordinates, from a
    minimum X Y Z to a maximum X Y Z (a plane where min and max meet on an axis), drawn in the 3D view.
    Click one to fly to it; Edit opens the table. */

/** One corner as "X, Y, Z" text: typed, or pasted from the Point coordinates tool. It is kept while you type and tidied
    when you leave the box; text that is not three numbers is flagged and does not change the plane. */
function CornerInput({ value, label, onChange }: { value: Coord; label: string; onChange: (c: Coord) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parseCoord(draft) === null;
  return (
    <input
      className={`cpl__corner${invalid ? ' is-invalid' : ''}`}
      value={draft ?? formatCoord(value)}
      placeholder="X, Y, Z"
      title={invalid ? 'Three numbers: X, Y, Z' : `${label}: X, Y, Z in metres (paste the text the Point coordinates tool copies)`}
      aria-label={label}
      aria-invalid={invalid}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        setDraft(e.target.value);
        const c = parseCoord(e.target.value);
        if (c) onChange(c);
      }}
      onBlur={() => setDraft(null)}
    />
  );
}

const sizeText = (p: ConstructionPlane) => {
  const d = [p.maxX - p.minX, p.maxY - p.minY, p.maxZ - p.minZ].map((v) => Math.abs(v));
  const flat = d.filter((v) => v < 1e-6).length;
  return `${d.map((v) => v.toFixed(2)).join(' × ')} m${flat ? ' · plane' : ''}`;
};

export function ConstructionPlanesPanel() {
  const engine = useViewerEngine();
  const planes = useConstructionPlanesStore((s) => s.planes);
  const visible = useConstructionPlanesStore((s) => s.visible);
  const { setVisible, add, update, remove, duplicate, setAllVisible, clear } = useConstructionPlanesStore.getState();
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
          {(() => {
            // The eye of the whole list: shut when none is shown, dimmed when some are not.
            const off = visible ? planes.filter((p) => !p.visible).length : planes.length;
            const shut = planes.length > 0 && off === planes.length;
            const part = off > 0 && !shut;
            return (
              <button
                type="button"
                className={`ss__eye${shut ? ' is-off' : ''}${part ? ' is-part' : ''}`}
                disabled={planes.length === 0}
                onClick={() => { if (shut || part) { setVisible(true); setAllVisible(true); } else setAllVisible(false); }}
                title={shut ? 'Show all the construction planes' : part ? 'Some planes are hidden: click to show them all' : 'Hide all the construction planes'}
                aria-label={shut ? 'Show all the construction planes' : 'Hide all the construction planes'}
              >
                {shut ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
              </button>
            );
          })()}
          <span className="mkt__spacer" />
          <button type="button" className={`btn btn--small${editing ? ' primary' : ''}`} onClick={() => setEditing((v) => !v)}>{editing ? 'Done' : 'Edit'}</button>
        </div>

        {planes.length === 0 && !editing && <div className="flt__hint">No construction planes yet. Press Edit, then add one and give its min and max corner (X, Y, Z).</div>}

        {!editing && planes.length > 0 && (
          <div className="mkt__list">
            {planes.map((p) => (
              <div key={p.id} className={`mkt__line${p.visible ? '' : ' is-off'}`}>
                <button type="button" className="cpl__row" title={`${p.name || 'Plane'} — click to fly to it`} onClick={() => flyTo(p)}>
                  <span className="cpl__swatch" style={{ background: p.color, opacity: Math.max(p.opacity, 0.35) }} />
                  <span className="mkt__name">{p.name || 'Plane'}</span>
                  <span className="mkt__xyz">{sizeText(p)}</span>
                </button>
                <button type="button" className={`ss__eye${p.visible ? '' : ' is-off'}`} onClick={() => update(p.id, { visible: !p.visible })} title={p.visible ? 'Hide this plane' : 'Show this plane'} aria-label={p.visible ? 'Hide this plane' : 'Show this plane'}>
                  {p.visible ? <IconEye width={16} height={16} /> : <IconEyeOff width={16} height={16} />}
                </button>
              </div>
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
                <span>Min corner (X, Y, Z)</span><span>Max corner (X, Y, Z)</span><span /><span /><span /><span />
              </div>
              {planes.map((p) => (
                <div className="cpl__item" key={p.id}>
                  <div className="cpl__edit">
                    <input className="cpl__name" value={p.name} placeholder="name" onChange={(e) => update(p.id, { name: e.target.value })} />
                  </div>
                  <div className="cpl__edit">
                    <CornerInput label="Min corner" value={[p.minX, p.minY, p.minZ]} onChange={([minX, minY, minZ]) => update(p.id, { minX, minY, minZ })} />
                    <CornerInput label="Max corner" value={[p.maxX, p.maxY, p.maxZ]} onChange={([maxX, maxY, maxZ]) => update(p.id, { maxX, maxY, maxZ })} />
                    <HexColorInput value={p.color} onChange={(hex) => update(p.id, { color: hex })} />
                    <button type="button" className="mkt__del" title={p.visible ? 'Hide this plane' : 'Show this plane'} aria-label={p.visible ? 'Hide this plane' : 'Show this plane'} onClick={() => update(p.id, { visible: !p.visible })}>{p.visible ? <IconEye width={14} height={14} /> : <IconEyeOff width={14} height={14} />}</button>
                    <button type="button" className="mkt__del" title="Duplicate this plane" aria-label="Duplicate this plane" onClick={() => duplicate(p.id)}><IconCopy /></button>
                    <button type="button" className="mkt__del" title="Delete this plane" aria-label="Delete this plane" onClick={() => remove(p.id)}><IconRemove /></button>
                  </div>
                  <label className="mkt__def" title="How see-through it is">
                    Opacity
                    <input type="range" min={0.05} max={1} step={0.05} value={p.opacity} onChange={(e) => update(p.id, { opacity: Number(e.target.value) })} />
                  </label>
                </div>
              ))}
            </div>
            {planes.length === 0 && <div className="flt__hint">Add a plane, then type or paste its two corners (metres, project axes).</div>}
          </>
        )}
      </div>
    </CollapsibleSection>
  );
}
