import { useRef, useState, type DragEvent } from 'react';
import { IconChevronDown, IconChevronRight, IconFolder, IconPencil, IconSync, IconRemove } from '../icons';
import { usePersistedState } from '../../utils/persistedState';
import { decodePlf, plfToLayout } from '../../schedule/plfLayout';
import type { ColumnDef } from '../../schedule/columns';
import type { FilterFieldDef } from '../../schedule/filterFields';
import {
  addFolder,
  addImportedLayout,
  applyLayout,
  deleteFolder,
  deleteLayout,
  moveFolder,
  moveLayout,
  renameFolder,
  renameLayout,
  saveLayout,
  updateLayout,
  useScheduleLayoutsStore,
  type ScheduleLayout,
  type ViewFilters,
} from '../../state/scheduleLayoutsStore';

const DRAG_LAYOUT = 'application/x-ip-layout';
const DRAG_FOLDER = 'application/x-ip-layout-folder';

type Drop =
  | { kind: 'layout'; id: string; after: boolean }
  | { kind: 'folder'; name: string; after: boolean }
  | { kind: 'inside'; name: string }
  | { kind: 'loose' };

/** Programmes > Layouts: a panel docked beside the activity views (like the
    Scenario panel in 4D) to save the view as a named layout and switch
    between layouts. Layouts can be filed in folders, and dragged to reorder:
    onto another layout (before / after it), onto a folder (into it) or
    onto "No folder"; folders are dragged by their header to reorder. */
export function LayoutsDock({ filters, tab, importContext }: { filters: ViewFilters; /** The Programmes view that is open (saved with the layout). */ tab: string; /** The schedule's columns and filter fields, for importing P6 layouts (null: no schedule loaded). */ importContext: { catalog: ColumnDef[]; filterFields: FilterFieldDef[] } | null }) {
  const layouts = useScheduleLayoutsStore((s) => s.layouts);
  const folders = useScheduleLayoutsStore((s) => s.folders);
  const currentId = useScheduleLayoutsStore((s) => s.currentId);
  const [name, setName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<{ kind: 'ok' | 'error'; text: string; notes: string[] } | null>(null);
  const [saveFolder, setSaveFolder] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [closed, setClosed] = usePersistedState<string[]>('programmes.layoutsFoldersClosed', []);
  const [dragLayout, setDragLayout] = useState<string | null>(null);
  const [dragFolder, setDragFolder] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  // Drag its left edge to resize (remembered).
  const taken = layouts.some((l) => l.name.toLowerCase() === name.trim().toLowerCase());

  const inFolder = (f: string) => layouts.filter((l) => l.folder === f);
  const loose = layouts.filter((l) => !l.folder || !folders.includes(l.folder));
  const folderOf = (f: string | undefined) => (f && folders.includes(f) ? f : null);
  const endDrag = () => {
    setDragLayout(null);
    setDragFolder(null);
    setDrop(null);
  };
  const half = (e: DragEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  };
  const toggleClosed = (f: string) => setClosed((c) => (c.includes(f) ? c.filter((x) => x !== f) : [...c, f]));


  /** P6 layouts (.plf) -> layouts in the "P6" folder; what could not carry over is listed under the button. */
  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !importContext) return;
    const notes: string[] = [];
    const done: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const r = plfToLayout(decodePlf(await file.arrayBuffer()), importContext, file.name.replace(/\.plf$/i, ''));
        const unique = addImportedLayout(r.name, r.settings, r.filters, 'P6');
        done.push(unique);
        for (const n of r.notes) notes.push(`${unique}: ${n}`);
      } catch (e) {
        notes.push(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setImportMsg({ kind: done.length ? 'ok' : 'error', text: done.length ? `Imported ${done.length} P6 layout${done.length === 1 ? '' : 's'} into the "P6" folder.` : 'Nothing was imported.', notes });
    if (fileInput.current) fileInput.current.value = '';
  };

  const row = (l: ScheduleLayout, indent: boolean, n: number) => {
    const current = l.id === currentId;
    const mark = drop?.kind === 'layout' && drop.id === l.id && dragLayout !== l.id ? (drop.after ? ' drop-after' : ' drop-before') : '';
    return (
      <div
        key={l.id}
        className={`rgrid__row ld-row${current ? ' is-current' : ''}${indent ? ' ld-row--in' : ''}${dragLayout === l.id ? ' is-dragging' : ''}${mark}`}
        draggable={renaming?.id !== l.id}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_LAYOUT, l.id);
          e.dataTransfer.effectAllowed = 'move';
          setDragLayout(l.id);
        }}
        onDragOver={(e) => {
          if (!dragLayout) return;
          e.preventDefault();
          e.stopPropagation();
          const after = half(e);
          if (drop?.kind !== 'layout' || drop.id !== l.id || drop.after !== after) setDrop({ kind: 'layout', id: l.id, after });
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (dragLayout && drop?.kind === 'layout') moveLayout(dragLayout, folderOf(l.folder), { id: l.id, after: drop.after });
          endDrag();
        }}
        onDragEnd={endDrag}
      >
        <span className="rgrid__n">
          <span className="rgrid__num">{n}</span>
          <button
            type="button"
            className="rgrid__del"
            onClick={() => window.confirm(`Delete the layout "${l.name}"?`) && deleteLayout(l.id)}
            title="Delete this layout"
            aria-label={`Delete ${l.name}`}
          >
            <IconRemove />
          </button>
        </span>
        {renaming?.id === l.id ? (
          <form
            className="scn-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (renaming.name.trim()) renameLayout(l.id, renaming.name.trim());
              setRenaming(null);
            }}
          >
            <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: l.id, name: e.target.value })} onBlur={() => setRenaming(null)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} />
          </form>
        ) : (
          <button type="button" className="layouts-dock__apply ld-row__name" onClick={() => applyLayout(l.id)} onDoubleClick={() => setRenaming({ id: l.id, name: l.name })} title="Apply this layout (double-click to rename, drag to reorder or into a folder)">
            <span className="layouts-dock__name">{l.name}</span>
          </button>
        )}
        <span className="rgrid__cell rgrid__cell--act ld-row__act">
          <button type="button" className="rgrid__ib" onClick={() => updateLayout(l.id, filters, tab)} title="Update: overwrite this layout with the current view" aria-label={`Update ${l.name}`}>
            <IconSync />
          </button>
        </span>
      </div>
    );
  };

  const folderHead = (f: string, count: number) => {
    const isClosed = closed.includes(f);
    const into = drop?.kind === 'inside' && drop.name === f;
    const mark = drop?.kind === 'folder' && drop.name === f && dragFolder !== f ? (drop.after ? ' drop-after' : ' drop-before') : '';
    return (
      <div
        key={`head-${f}`}
        className={`rgrid__row ld-row ld-row--folder${into ? ' ld-folder--into' : ''}${dragFolder === f ? ' is-dragging' : ''}${mark}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_FOLDER, f);
          e.dataTransfer.effectAllowed = 'move';
          setDragFolder(f);
        }}
        onDragOver={(e) => {
          if (dragLayout) {
            e.preventDefault();
            if (!(drop?.kind === 'inside' && drop.name === f)) setDrop({ kind: 'inside', name: f });
          } else if (dragFolder) {
            e.preventDefault();
            const after = half(e);
            if (drop?.kind !== 'folder' || drop.name !== f || drop.after !== after) setDrop({ kind: 'folder', name: f, after });
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragLayout) moveLayout(dragLayout, f);
          else if (dragFolder && drop?.kind === 'folder') moveFolder(dragFolder, f, drop.after);
          endDrag();
        }}
        onDragEnd={endDrag}
      >
        <button type="button" className="rgrid__n ld-row__chev" onClick={() => toggleClosed(f)} aria-expanded={!isClosed} title={isClosed ? 'Open the folder' : 'Close the folder'} aria-label={isClosed ? `Open ${f}` : `Close ${f}`}>
          {isClosed ? <IconChevronRight width={14} height={14} /> : <IconChevronDown width={14} height={14} />}
        </button>
        <span className="ld-row__name ld-row__folder" onClick={() => toggleClosed(f)}>
          <IconFolder width={15} height={15} />
          <b>{f}</b>
          <span className="ld-folder__count">{count}</span>
        </span>
        <span className="rgrid__cell rgrid__cell--act ld-row__act">
          <button
            type="button"
            className="rgrid__ib"
            title="Rename the folder"
            aria-label={`Rename folder ${f}`}
            onClick={() => {
              const n = window.prompt('Rename the folder:', f);
              if (n !== null && n.trim() !== f && !renameFolder(f, n)) window.alert('Give the folder a name that is not used yet.');
            }}
          >
            <IconPencil width={14} height={14} />
          </button>
          <button
            type="button"
            className="rgrid__ib rgrid__ib--danger"
            title="Delete the folder (its layouts stay, loose)"
            aria-label={`Delete folder ${f}`}
            onClick={() => window.confirm(`Delete the folder "${f}"? Its ${count} layout${count === 1 ? '' : 's'} stay, without a folder.`) && deleteFolder(f)}
          >
            <IconRemove />
          </button>
        </span>
      </div>
    );
  };

  return (
    <div className="scn-dock layouts-dock" aria-label="Layouts" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="scn-panel scn-panel__body scn-dock__body">
        <section className="scn-card">
          <div className="scn-card__title" title="Columns, filters, grouping, sorting, colours, zoom and Gantt options, under a name to come back to">Save the current view</div>
          <form
            className="scn-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim() || taken) return;
              saveLayout(name.trim(), filters, folderOf(saveFolder) ?? undefined, tab);
              setName('');
            }}
          >
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Layout name" />
            <button className="btn primary" type="submit" disabled={!name.trim() || taken}>Save</button>
          </form>
          {folders.length > 0 && (
            <select className="ld-savefolder" value={folderOf(saveFolder) ?? ''} onChange={(e) => setSaveFolder(e.target.value)} title="The folder the new layout is filed in">
              <option value="">No folder</option>
              {folders.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
          {taken && <div className="scn-error">There is already a layout with that name — use its Update to overwrite it.</div>}
        </section>

        <section className="scn-card scn-card--grow">
          <div className="scn-card__title ld-title">
            <span>Layouts</span>
            <button
              type="button"
              className="cols__link"
              onClick={() => {
                const n = window.prompt('Folder name:');
                if (n !== null && !addFolder(n)) window.alert('Give the folder a name that is not used yet.');
              }}
              title="Make a folder to file layouts in; drag layouts into it"
            >
              + New folder
            </button>
          </div>
          <div className="ld-import">
            <input ref={fileInput} type="file" accept=".plf" multiple hidden onChange={(e) => void importFiles(e.target.files)} />
            <button
              type="button"
              className="btn btn--small"
              disabled={!importContext}
              onClick={() => fileInput.current?.click()}
              title={importContext ? 'Bring in layouts saved from Primavera P6 (.plf): columns, widths, sort, group and filters, as far as this app has them' : 'Load a programme first: the layouts are matched to its columns'}
            >
              Import P6 layouts…
            </button>
            {importMsg && (
              <div className={importMsg.kind === 'error' ? 'scn-error' : 'scn-dim'}>
                {importMsg.text}
                {importMsg.notes.length > 0 && (
                  <details>
                    <summary>{importMsg.notes.length} note{importMsg.notes.length === 1 ? '' : 's'}</summary>
                    <ul className="ld-import__notes">{importMsg.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
                  </details>
                )}
              </div>
            )}
          </div>
          {layouts.length === 0 && folders.length === 0 && <div className="scn-dim">No layouts yet.</div>}
          <div className="layouts-dock__list rgrid">
            {folders.map((f) => (
              <div key={f} className="ld-section">
                {folderHead(f, inFolder(f).length)}
                {!closed.includes(f) && inFolder(f).map((l, i) => row(l, true, i + 1))}
                {!closed.includes(f) && inFolder(f).length === 0 && <div className="scn-dim ld-empty">Drag layouts here.</div>}
              </div>
            ))}
            {folders.length > 0 && (
              <div
                className={`rgrid__row ld-row ld-row--folder ld-folder--loose${drop?.kind === 'loose' ? ' ld-folder--into' : ''}`}
                onDragOver={(e) => {
                  if (!dragLayout) return;
                  e.preventDefault();
                  if (drop?.kind !== 'loose') setDrop({ kind: 'loose' });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragLayout) moveLayout(dragLayout, null);
                  endDrag();
                }}
              >
                <span className="rgrid__n" /><span className="ld-row__name ld-row__folder"><b>No folder</b><span className="ld-folder__count">{loose.length}</span></span>
              </div>
            )}
            {loose.map((l, i) => row(l, false, i + 1))}
          </div>
        </section>
      </div>
    </div>
  );
}
