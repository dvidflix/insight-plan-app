import { useState, type ClipboardEvent } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { newMarker, useMarkersStore, type Marker } from '../state/markersStore';
import { DEFAULT_MARKER_ICON, MARKER_ICONS, iconFromText, markerIcon } from '../viewer/markerIcons';
import { parseTsv, toTsv } from './timelines/gridText';
import { usePersistedState } from '../utils/persistedState';
import { CollapsibleSection } from './CollapsibleSection';
import { InfoTip } from './InfoTip';
import { IconCopy, IconEye, IconEyeOff, IconRemove, IconExpander } from './icons';
import { RichNoteEditor } from './RichNoteEditor';
import { MarkerActivityPicker } from './MarkerActivityPicker';
import { isEmptyNote } from '../utils/richText';

/** Models page and 4D Sequencing > 3D & Related > Markers: points in the
    model's coordinates with a name and an icon, drawn in the 3D view. Click one
    to fly to it; Edit opens a table to type or paste many from Excel. */

type Field = 'name' | 'x' | 'y' | 'z' | 'icon';
const FIELDS: Field[] = ['name', 'x', 'y', 'z', 'icon'];

const toNumber = (text: string): number | null => {
  const t = text.trim().replace(/\s/g, '');
  if (!t) return null;
  const n = Number(/^-?\d+,\d+$/.test(t) ? t.replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
};

/** One pasted row of cells -> a partial marker, starting at column `start`. A row
    that starts with three numbers is read as X, Y, Z (then icon / name), as
    that is how coordinates usually come from a sheet. */
function rowToMarker(cells: string[], start: number): Partial<Marker> | null {
  if (!cells.some((c) => toNumber(c) !== null)) return null; // a header row, or empty
  const out: Partial<Marker> = {};
  const set = (field: Field, text: string) => {
    if (field === 'name') out.name = text.trim();
    else if (field === 'icon') out.icon = iconFromText(text) ?? DEFAULT_MARKER_ICON;
    else {
      const n = toNumber(text);
      if (n !== null) out[field] = n;
    }
  };
  if (start === 0 && cells.length >= 3 && [0, 1, 2].every((i) => toNumber(cells[i]) !== null)) {
    set('x', cells[0]);
    set('y', cells[1]);
    set('z', cells[2]);
    for (const extra of cells.slice(3)) {
      if (iconFromText(extra)) out.icon = iconFromText(extra)!;
      else if (extra.trim() && !out.name) out.name = extra.trim();
    }
    return out;
  }
  cells.forEach((text, i) => {
    const field = FIELDS[start + i];
    if (field) set(field, text);
  });
  return out;
}

export function MarkersPanel() {
  const engine = useViewerEngine();
  const markers = useMarkersStore((s) => s.markers);
  const visible = useMarkersStore((s) => s.visible);
  const { setVisible, add, update, remove, duplicate, setAll, setAllHidden, clear } = useMarkersStore.getState();
  const [open, setOpen] = usePersistedState('markers.open', true);
  const [editing, setEditing] = useState(false);
  const [more, setMore] = useState<string | null>(null);
  const [defaultIcon, setDefaultIcon] = usePersistedState('markers.defaultIcon', DEFAULT_MARKER_ICON);

  /** A block pasted into the table lands from the cell it was pasted in, adding rows as needed. */
  const onPaste = (e: ClipboardEvent, row: number, col: number) => {
    const text = e.clipboardData.getData('text/plain');
    if (!/[\t\n]/.test(text.trim())) return; // one value: the box takes it
    e.preventDefault();
    const rows = parseTsv(text.replace(/\n+$/, ''));
    const next = [...markers];
    let at = row;
    for (const cells of rows) {
      const m = rowToMarker(cells, col);
      if (!m) continue;
      if (at < next.length) next[at] = { ...next[at], ...m };
      else next.push(newMarker({ icon: defaultIcon, ...m }));
      at++;
    }
    setAll(next);
  };

  const copyAll = () => {
    const rows = [['Name', 'X', 'Y', 'Z', 'Icon'], ...markers.map((m) => [m.name, String(m.x), String(m.y), String(m.z), markerIcon(m.icon).label])];
    void navigator.clipboard?.writeText(toTsv(rows)).catch(() => {});
  };

  const num = (v: number) => (Number.isFinite(v) ? String(v) : '');

  return (
    <CollapsibleSection
      title={`Markers${markers.length ? ` (${markers.length})` : ''}`}
      open={open}
      onToggle={() => setOpen(!open)}
      tip={
        <>
          <p>Points in the model's coordinates (project axes: X east, Y north, Z up, metres — the same as the Point coordinates tool), drawn in the 3D view with an icon. Hover one for its name and coordinates; click a row to fly to it. Markers that overlap on screen merge into a numbered cluster.</p>
          <p>Link a marker to an <b>activity</b> (the arrow in the Edit table) and in 4D Sequencing it shows only from that activity's start to its finish. Add a formatted <b>note</b> (bold, lists, colours, links) that shows with the marker on hover.</p>
          <p><b>Edit</b> opens a table: type values, or paste a block from Excel into any cell (columns Name, X, Y, Z, Icon — or just X, Y, Z, with a name and icon after if you like). Rows are added as needed.</p>
        </>
      }
    >
      <div className="mkt">
        <div className="mkt__bar">
          {(() => {
            // The eye of the whole list, like a folder's in Search sets: shut when none is shown, dimmed when some are not.
            const off = visible ? markers.filter((m) => m.hidden).length : markers.length;
            const shut = markers.length > 0 && off === markers.length;
            const part = off > 0 && !shut;
            return (
              <button
                type="button"
                className={`ss__eye${shut ? ' is-off' : ''}${part ? ' is-part' : ''}`}
                disabled={markers.length === 0}
                onClick={() => { if (shut || part) { setVisible(true); setAllHidden(false); } else setAllHidden(true); }}
                title={shut ? 'Show all the markers' : part ? 'Some markers are hidden: click to show them all' : 'Hide all the markers'}
                aria-label={shut ? 'Show all the markers' : 'Hide all the markers'}
              >
                {shut ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
              </button>
            );
          })()}
          <span className="mkt__spacer" />
          <button type="button" className={`btn btn--small${editing ? ' primary' : ''}`} onClick={() => setEditing((v) => !v)}>{editing ? 'Done' : 'Edit'}</button>
        </div>

        {markers.length === 0 && !editing && <div className="flt__hint">No markers yet. Press Edit, then paste X, Y, Z (and a name and icon) from Excel.</div>}

        {!editing && markers.length > 0 && (
          <div className="mkt__list">
            {markers.map((m) => {
              const def = markerIcon(m.icon);
              return (
                <div key={m.id} className={`mkt__line${m.hidden ? ' is-off' : ''}`}>
                  <button type="button" className="mkt__row" title={`${def.label} — click to fly to it`} onClick={() => void engine.focusMarker(m)}>
                    <span className="mkt__icon" style={{ background: def.color }}>{def.path ? <svg viewBox="0 0 24 24"><path d={def.path} /></svg> : null}</span>
                    <span className="mkt__name">{m.name || def.label}</span>
                    {m.activityId && <span className="mkt__tag" title={`Shown during ${[m.activityCode, m.activityName].filter(Boolean).join(' — ')}`}>{m.activityCode || 'activity'}</span>}
                    {!isEmptyNote(m.note) && <span className="mkt__tag" title="Has a note">note</span>}
                    <span className="mkt__xyz">{m.x.toFixed(2)}, {m.y.toFixed(2)}, {m.z.toFixed(2)}</span>
                  </button>
                  <button type="button" className={`ss__eye${m.hidden ? ' is-off' : ''}`} onClick={() => update(m.id, { hidden: !m.hidden })} title={m.hidden ? 'Show this marker' : 'Hide this marker'} aria-label={m.hidden ? 'Show this marker' : 'Hide this marker'}>
                    {m.hidden ? <IconEyeOff width={16} height={16} /> : <IconEye width={16} height={16} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {editing && (
          <>
            <div className="mkt__tools">
              <button type="button" className="btn btn--small" onClick={() => add({ icon: defaultIcon })}>+ Row</button>
              <label className="mkt__def" title="The icon new rows get">
                Icon
                <select value={defaultIcon} onChange={(e) => setDefaultIcon(e.target.value)}>
                  {MARKER_ICONS.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                </select>
              </label>
              <span className="mkt__spacer" />
              <button type="button" className="btn btn--small" onClick={copyAll} disabled={!markers.length} title="Copy the table (to paste into Excel)">Copy</button>
              <button type="button" className="btn btn--small btn--danger" onClick={() => { if (window.confirm(`Delete all ${markers.length} markers?`)) clear(); }} disabled={!markers.length}>Clear</button>
            </div>
            <div className="mkt__grid">
              <div className="mkt__head">
                <span>Name</span><span>X</span><span>Y</span><span>Z</span><span>Icon</span><span /><span /><span />
              </div>
              {markers.map((m, row) => (
                <div className="mkt__item" key={m.id}>
                <div className="mkt__edit">
                  <input value={m.name} placeholder="name" onChange={(e) => update(m.id, { name: e.target.value })} onPaste={(e) => onPaste(e, row, 0)} />
                  {(['x', 'y', 'z'] as const).map((axis, i) => (
                    <input key={axis} className="mkt__num" inputMode="decimal" value={num(m[axis])} onChange={(e) => { const n = toNumber(e.target.value); if (n !== null || e.target.value === '') update(m.id, { [axis]: n ?? 0 }); }} onPaste={(e) => onPaste(e, row, i + 1)} />
                  ))}
                  <select value={m.icon} onChange={(e) => update(m.id, { icon: e.target.value })} onPaste={(e) => onPaste(e, row, 4)}>
                    {MARKER_ICONS.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
                  </select>
                  <button type="button" className={`mkt__more${more === m.id ? ' on' : ''}${m.activityId || !isEmptyNote(m.note) ? ' has' : ''}`} title="Activity and note" aria-label="Activity and note" aria-expanded={more === m.id} onClick={() => setMore(more === m.id ? null : m.id)}><IconExpander open={more === m.id} width={14} height={14} /></button>
                  <button type="button" className="mkt__del" title="Duplicate this marker" aria-label="Duplicate this marker" onClick={() => duplicate(m.id)}><IconCopy /></button>
                  <button type="button" className="mkt__del" title="Delete this marker" aria-label="Delete this marker" onClick={() => remove(m.id)}><IconRemove /></button>
                </div>
                {more === m.id && (
                  <div className="mkt__detail">
                    <MarkerActivityPicker marker={m} onChange={(patch) => update(m.id, patch)} />
                    <span className="mkt__lbl">Note</span>
                    <RichNoteEditor key={m.id} value={m.note ?? ''} onChange={(note) => update(m.id, { note })} />
                  </div>
                )}
                </div>
              ))}
            </div>
            {markers.length === 0 && <div className="flt__hint">Click a cell and paste (Ctrl+V) from Excel, or add a row.</div>}
            <div className="flt__hint">Paste a block into any cell: Name, X, Y, Z, Icon — or X, Y, Z first. <InfoTip>Icons by name: {MARKER_ICONS.map((i) => i.label).join(', ')}. Anything else becomes Point coordinates.</InfoTip></div>
          </>
        )}
      </div>
    </CollapsibleSection>
  );
}
