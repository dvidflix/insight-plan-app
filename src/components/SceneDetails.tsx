import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { IconRemove } from './icons';
import { SCENE_BUILT_INS, useSceneDetailsStore } from '../state/sceneDetailsStore';
import type { Scene } from '../state/scenes';

/** Home's Scene details pane (like the Files page's File details): the chosen scene's own facts and its details (Project, Area,
    Status, Notes, and any field you add) to edit. The details are what the scenes are grouped, filtered and sorted by. A field
    with several values takes them separated by commas. */

const LONG = new Set(['Notes']);

function FieldEditor({ field, id, listId }: { field: string; id: string; listId: string }) {
  const stored = useSceneDetailsStore((s) => (s.values[id]?.[field] ?? []).join(', '));
  const [draft, setDraft] = useState(stored);
  useEffect(() => setDraft(stored), [stored, id]);
  const commit = () => {
    if (draft !== stored) useSceneDetailsStore.getState().setValues([id], field, draft.split(','));
  };
  const common = { className: 'ad-edit', value: draft, spellCheck: false, 'aria-label': field, onBlur: commit } as const;
  return LONG.has(field)
    ? <textarea {...common} className="ad-edit ad-edit--long" rows={3} onChange={(e) => setDraft(e.target.value)} />
    : <input {...common} list={listId} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

export function SceneDetails({ scene, active, bar }: { scene: Scene | null; active: boolean; bar: ReactNode }) {
  const fields = useSceneDetailsStore((s) => s.fields);
  const values = useSceneDetailsStore((s) => s.values);
  const [adding, setAdding] = useState('');
  const [note, setNote] = useState('');
  const options = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of fields) out[f] = [...new Set(Object.values(values).flatMap((v) => v[f] ?? []))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    return out;
  }, [fields, values]);
  const c = scene?.counts;
  const num = (n: number | undefined) => (n === undefined ? '—' : n.toLocaleString());

  const add = () => {
    if (!adding.trim()) return;
    if (useSceneDetailsStore.getState().addField(adding)) { setAdding(''); setNote(''); }
    else setNote('There is already a field with that name.');
  };
  const grid = (rows: [string, React.ReactNode][]) => (
    <table className="ad-grid">
      <tbody>{rows.map(([k, v]) => <tr key={k}><th scope="row" title={k}>{k}</th><td title={typeof v === 'string' ? v : undefined}>{v}</td></tr>)}</tbody>
    </table>
  );

  return (
    <div className="activity-details file-details scene-details">
      {bar}
      {!scene ? (
        <div className="scn-dim file-details__empty">Click a scene to see and edit its details: project, area, status, notes ... Group, filter and sort the scenes by them.</div>
      ) : (
        <>
          <div className="file-details__section">Scene</div>
          {grid([
            ['Name', scene.name],
            ['State', active ? 'You are in it' : 'Saved'],
            ['Last saved', new Date(scene.savedAt).toLocaleString()],
            ['Programme', c?.programme ?? '—'],
            ['Models', num(c?.models)],
            ['Activities', num(c?.activities)],
            ['Objects', num(c?.objects)],
            ['Viewpoints', num(c?.viewpoints)],
            ['Topics', num(c?.topics)],
          ])}
          <div className="file-details__section">Details</div>
          <table className="ad-grid">
            <tbody>
              {fields.map((f) => (
                <tr key={f}>
                  <th scope="row" title={f}>
                    {f}
                    {!DEFAULTS.has(f) && <button type="button" className="cols__icon cols__icon--remove scene-details__drop" title={`Remove the field ${f} from every scene`} aria-label={`Remove field ${f}`} onClick={() => { if (window.confirm(`Remove the field “${f}” and its values from every scene?`)) useSceneDetailsStore.getState().removeField(f); }}><IconRemove /></button>}
                  </th>
                  <td><FieldEditor field={f} id={scene.id} listId={`scene-details-${f}`} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {fields.map((f) => <datalist key={f} id={`scene-details-${f}`}>{options[f].map((o) => <option key={o} value={o} />)}</datalist>)}
        </>
      )}
      <div className="file-details__section">Add a field</div>
      <div className="scene-details__add">
        <input type="text" className="ad-edit" value={adding} placeholder="e.g. Client, Phase" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} aria-label="New field name" />
        <button type="button" className="btn btn--small" onClick={add} disabled={!adding.trim()}>Add</button>
      </div>
      {note && <div className="file-details__note is-warn" role="status">{note}</div>}
    </div>
  );
}

const DEFAULTS = new Set(['Project', 'Area', 'Status', 'Notes']);
export const sceneFieldLabel = (id: string) => SCENE_BUILT_INS.find((b) => b.id === id)?.label ?? id;
