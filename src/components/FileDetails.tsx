import { useEffect, useMemo, useState } from 'react';
import { IconClose, IconList } from './icons';
import { useInputDetailsStore } from '../state/inputDetailsStore';

/** The Inputs page's File details pane (like the Programmes page's Activity details): the selected file's own facts, and its details
    (the fields of SeaTable's "Insight Plan Files": Discipline, Building, Status ...) to edit. With several files selected a field shows the
    value they share (or "mixed") and what is typed goes to all of them. A field with several values (Building) takes them separated by commas. */

export interface FileSummary {
  key: string;
  name: string;
  /** Model, Programme, Site context mesh. */
  kind: string;
  format: string;
  items: number;
  size: string;
  uploaded: string;
  version: number | null;
  bounds: string;
}

const LONG = new Set(['Notes']);

function FieldEditor({ field, files, listId }: { field: string; files: string[]; listId: string }) {
  const values = useInputDetailsStore((s) => s.values);
  const pending = useInputDetailsStore((s) => s.pending);
  const shared = useMemo(() => {
    const lists = files.map((f) => (values[f]?.[field] ?? []).join(', '));
    return lists.every((l) => l === lists[0]) ? { text: lists[0] ?? '', mixed: false } : { text: '', mixed: true };
  }, [files, values, field]);
  const [draft, setDraft] = useState(shared.text);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setDraft(shared.text); setNote(null); }, [shared.text, shared.mixed, files.join('|')]);
  const unsaved = files.some((f) => pending.includes(`${f}\u0001${field}`));

  const commit = async () => {
    if (shared.mixed ? draft === '' : draft === shared.text) return; // nothing typed: the files stay as they are
    const r = await useInputDetailsStore.getState().saveDetails(files, field, draft.split(',').map((v) => v.trim()));
    setNote({ ok: r.ok, text: r.message });
  };
  const common = { className: 'ad-edit', value: draft, placeholder: shared.mixed ? 'mixed' : '', spellCheck: false, 'aria-label': field } as const;
  return (
    <>
      {LONG.has(field) ? (
        <textarea {...common} className="ad-edit ad-edit--long" rows={3} onChange={(e) => setDraft(e.target.value)} onBlur={() => void commit()} />
      ) : (
        <input {...common} list={listId} onChange={(e) => setDraft(e.target.value)} onBlur={() => void commit()} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      )}
      {unsaved && !note && <div className="file-details__note is-warn">Not written to SeaTable yet</div>}
      {note && <div className={`file-details__note${note.ok ? '' : ' is-warn'}`} role="status">{note.text}</div>}
    </>
  );
}

export function FileDetails({ files, onClose }: { files: FileSummary[]; onClose: () => void }) {
  const fields = useInputDetailsStore((s) => s.fields);
  const values = useInputDetailsStore((s) => s.values);
  const names = useMemo(() => files.map((f) => f.name), [files]);
  const options = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const f of fields) out[f] = [...new Set(Object.values(values).flatMap((v) => v[f] ?? []))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    return out;
  }, [fields, values]);
  const one = files.length === 1 ? files[0] : null;
  const kinds = [...new Set(files.map((f) => f.kind))].join(', ');

  const grid = (rows: [string, React.ReactNode][]) => (
    <table className="ad-grid">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row" title={k}>{k}</th>
            <td title={typeof v === 'string' ? v : undefined}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="activity-details file-details">
      <div className="side-pane__bar scn-dock__bar">
        <span className="layouts-dock__title"><IconList /> File details{files.length > 1 ? ` (${files.length} files)` : ''}</span>
        <button type="button" className="side-pane__hide layouts-dock__close" title="Close file details" aria-label="Close file details" onClick={onClose}><IconClose /></button>
      </div>
      {files.length === 0 ? (
        <div className="scn-dim file-details__empty">Click a file to see and edit its details. Shift or Ctrl select several: what you type goes to all of them.</div>
      ) : (
        <>
          <div className="file-details__section">File</div>
          {one
            ? grid([
              ['Name', one.name],
              ['Type', one.kind],
              ['Format', one.format || '—'],
              ['Items', one.items ? one.items.toLocaleString() : '—'],
              ['File size', one.size],
              ['Uploaded', one.uploaded],
              ['Version', one.version ?? '—'],
              ['Min / max XYZ (m)', one.bounds || '—'],
            ])
            : grid([['Selected', `${files.length} files`], ['Types', kinds], ['Names', files.map((f) => f.name).join(', ')]])}
          <div className="file-details__section">Details</div>
          {fields.length === 0 ? (
            <div className="scn-dim file-details__empty">No detail fields yet. They are the columns of SeaTable's "Insight Plan Files" table: switch on "SeaTable: file details" in Settings (Experimental features), push the files, then read the details.</div>
          ) : (
            <table className="ad-grid">
              <tbody>
                {fields.map((f) => (
                  <tr key={f}>
                    <th scope="row" title={f}>{f}</th>
                    <td><FieldEditor field={f} files={names} listId={`file-details-${f}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {fields.map((f) => <datalist key={f} id={`file-details-${f}`}>{options[f].map((o) => <option key={o} value={o} />)}</datalist>)}
        </>
      )}
    </div>
  );
}
