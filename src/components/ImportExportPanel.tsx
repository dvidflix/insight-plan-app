import { useRef, useState, type DragEvent } from 'react';
import { DATA_PORTS, exportPort, importPortFile, type DataPort } from '../state/dataPorts';
import { IconDownload, IconUpload } from './icons';

/** Settings > Import / Export: one row per kind of thing (global options, sets, viewpoints, data table presets, Gantt
    layouts, decorators), each with Export and Import. A file can also be dropped on the list, or picked with "Import
    any file", and goes to the row it belongs to. */
export function ImportExportPanel() {
  const [message, setMessage] = useState<{ text: string; error?: boolean; reload?: boolean } | null>(null);
  const [, bump] = useState(0);
  const [over, setOver] = useState(false);
  const anyRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLInputElement>(null);
  const rowFor = useRef<DataPort['id'] | undefined>(undefined);

  const run = async (files: FileList | File[], only?: DataPort['id']) => {
    const out: string[] = [];
    let reload = false;
    let error = false;
    for (const file of Array.from(files)) {
      try {
        const r = await importPortFile(file, only);
        const parts = [r.added ? `${r.added} added` : '', r.updated ? `${r.updated} replaced` : ''].filter(Boolean).join(', ');
        out.push(`${r.port.label}: ${parts || 'nothing new'}${r.note ? `. ${r.note}` : ''}`);
        if (r.port.id === 'options') reload = true;
      } catch (e) {
        error = true;
        out.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setMessage({ text: out.join('\n'), error, reload });
    bump((n) => n + 1);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void run(e.dataTransfer.files);
  };

  return (
    <div
      className={`ie${over ? ' is-over' : ''}`}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <div className="ie__rows">
        {DATA_PORTS.map((p) => (
          <div key={p.id} className="ie__row">
            <div className="ie__name" title={p.hint}>
              <b>{p.label}</b>
              <small>{p.count()}</small>
            </div>
            <button type="button" className="btn btn--small" onClick={() => exportPort(p)} title={`Export the ${p.label.toLowerCase()} to a file. ${p.hint}`} aria-label={`Export ${p.label}`}><IconDownload width={14} height={14} /> Export</button>
            <button type="button" className="btn btn--small" onClick={() => { rowFor.current = p.id; rowRef.current?.click(); }} title={`Import ${p.label.toLowerCase()} from a file: new ones are added, ones with the same id are replaced, nothing is removed.`} aria-label={`Import ${p.label}`}><IconUpload width={14} height={14} /> Import</button>
          </div>
        ))}
      </div>
      <button type="button" className="btn btn--small ie__any" onClick={() => anyRef.current?.click()} title="Pick one or more export files; each goes to the list it belongs to. You can also drop them on this box.">Import any file…</button>
      <div className="ie__drop">or drop export files here</div>
      <input ref={rowRef} type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => { if (e.target.files?.length) void run(e.target.files, rowFor.current); e.target.value = ''; }} />
      <input ref={anyRef} type="file" accept=".json" multiple style={{ display: 'none' }} onChange={(e) => { if (e.target.files?.length) void run(e.target.files); e.target.value = ''; }} />
      {message && (
        <div className={`ie__msg${message.error ? ' is-error' : ''}`} role="status">
          {message.text.split('\n').map((l, i) => <div key={i}>{l}</div>)}
          {message.reload && <button type="button" className="btn btn--small" onClick={() => window.location.reload()}>Reload now</button>}
        </div>
      )}
    </div>
  );
}
