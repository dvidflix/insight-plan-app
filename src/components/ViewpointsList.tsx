import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { create } from 'zustand';
import type * as OBC from '@thatopen/components';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { createViewpoint, dataOf, deleteViewpoint, openViewpoint, renameViewpoint, setViewpointFolder, thumbnailUrl, updateViewpoint, useViewpoints, viewpointTitle } from '../viewer/savedViews';
import { useViewSettingsStore } from '../state/viewSettingsStore';
import { useSavedViewAttrsStore } from '../state/savedViewAttrsStore';
import { usePersistedState } from '../utils/persistedState';
import { InfoTip } from './InfoTip';
import { IconCameraPhotoAdd, IconFolderNew, IconImage, IconPencil, IconSync, IconTrash } from './icons';
import { RowButtonsChooser, useRowButtons, type RowButtonDef } from './RowButtonsChooser';

const VP_BUTTONS = [
  { id: 'thumb', glyph: <IconImage width={14} height={14} />, label: 'Thumbnail' },
  { id: 'move', glyph: '🗀', label: 'Move to a folder' },
  { id: 'date', glyph: '◷', label: 'Timeline date (4D)' },
  { id: 'update', glyph: '⟳', label: 'Update from the view as it is now' },
  { id: 'rename', glyph: '✎', label: 'Rename' },
  { id: 'delete', glyph: '✕', label: 'Delete' },
] as const satisfies readonly RowButtonDef<string>[];
type VpButton = (typeof VP_BUTTONS)[number]['id'];

/** The section header's "New viewpoint" / "New folder" buttons ask the list (always mounted) to do it; it reports when it is busy. */
const useViewpointsUiStore = create<{ newViewpoint: number; newFolder: number; saving: boolean }>(() => ({ newViewpoint: 0, newFolder: 0, saving: false }));

/** The icons at the right end of the Viewpoints section's header. */
export function ViewpointsHeaderActions() {
  const saving = useViewpointsUiStore((s) => s.saving);
  const rb = useRowButtons<VpButton>('viewpoints.hiddenButtons');
  const bump = (k: 'newViewpoint' | 'newFolder') => useViewpointsUiStore.setState((s) => ({ [k]: s[k] + 1 }));
  return (
    <span className="config-section__actions">
      <RowButtonsChooser buttons={VP_BUTTONS} rb={rb} title="Choose which buttons show on each viewpoint" compact />
      <button type="button" className="mini-btn mini-btn--icon" onClick={() => bump('newFolder')} title="New folder" aria-label="New folder">
        <IconFolderNew width={18} height={18} />
      </button>
      <button type="button" className="mini-btn mini-btn--icon" disabled={saving} onClick={() => bump('newViewpoint')} title={saving ? 'Saving…' : 'New viewpoint: saves the camera and what is ticked in Viewpoint attributes'} aria-label="New viewpoint">
        <IconCameraPhotoAdd width={20} height={20} />
      </button>
    </span>
  );
}

/** Views > Viewpoints: one compact row per viewpoint — small thumbnail and name
    (click either to open it) with update, rename and delete icons on the right.
    Viewpoints can be filed in folders (drag a row onto a folder, or use its
    folder list). */
export function ViewpointsList({ layout = 'list', actions = false }: { /** cards: square cards in a row, with the options and folders in a pane at the left (the bottom dock). */ layout?: 'list' | 'cards'; /** Show the new viewpoint / folder buttons on the options row (when the panel has no header of its own). */ actions?: boolean }) {
  const engine = useViewerEngine();
  const list = useViewpoints(engine);
  const page = useViewSettingsStore((s) => s.activePage);
  const rb = useRowButtons<VpButton>('viewpoints.hiddenButtons');
  const withTimeline = useSavedViewAttrsStore((s) => s.attrs.timeline);
  const toggleAttr = useSavedViewAttrsStore((s) => s.toggle);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A viewpoint's folder is in its data; folders with nothing in them are kept here.
  const [savedFolders, setSavedFolders] = usePersistedState<string[]>('viewpoints.folders', []);
  const [closed, setClosed] = usePersistedState<string[]>('viewpoints.closedFolders', []);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Cards: which folder shows (null = all).
  const [cardFolder, setCardFolder] = useState<string | null>(null);
  // The cards row scrolls sideways with the mouse wheel (and with the arrow keys of the scrollbar).
  const cardsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = cardsRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [layout]);

  const folderOf = (vp: OBC.Viewpoint) => dataOf(vp).folder ?? '';
  const folders = [...new Set([...savedFolders, ...list.map(folderOf).filter(Boolean)])].sort((a, b) => a.localeCompare(b));
  const unfiled = list.filter((vp) => !folderOf(vp));

  const run = async (key: string, job: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const addFolder = () => {
    const name = window.prompt('Folder name:', '')?.trim();
    if (name && !folders.includes(name)) setSavedFolders([...savedFolders, name]);
  };
  // The header's buttons (ViewpointsHeaderActions). The latest handlers are kept in a ref so a request runs once.
  const vpRequests = useViewpointsUiStore((s) => s.newViewpoint);
  const folderRequests = useViewpointsUiStore((s) => s.newFolder);
  const seen = useRef({ vp: vpRequests, folder: folderRequests });
  const latest = useRef({ addFolder, run, engine });
  latest.current = { addFolder, run, engine };
  // The Models and 4D pages each keep a list mounted: only the one on screen answers.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const visible = !!root.current && getComputedStyle(root.current).visibility !== 'hidden' && root.current.getClientRects().length > 0;
    if (!visible) {
      seen.current = { vp: vpRequests, folder: folderRequests };
      return;
    }
    if (folderRequests !== seen.current.folder) latest.current.addFolder();
    if (vpRequests !== seen.current.vp) void latest.current.run('new', () => createViewpoint(latest.current.engine));
    seen.current = { vp: vpRequests, folder: folderRequests };
  }, [vpRequests, folderRequests]);
  useEffect(() => {
    useViewpointsUiStore.setState({ saving: busy !== null });
  }, [busy]);
  const renameFolder = (from: string, to: string) => {
    const name = to.trim();
    setRenamingFolder(null);
    if (!name || name === from || folders.includes(name)) return;
    for (const vp of list) if (folderOf(vp) === from) setViewpointFolder(engine, vp, name);
    setSavedFolders(savedFolders.map((f) => (f === from ? name : f)));
    setClosed(closed.map((f) => (f === from ? name : f)));
  };
  const deleteFolder = (name: string) => {
    const inside = list.filter((vp) => folderOf(vp) === name);
    const note = inside.length ? ` Its ${inside.length} viewpoint${inside.length === 1 ? '' : 's'} move out of it (they are not deleted).` : '';
    if (!window.confirm(`Delete the folder "${name}"?${note}`)) return;
    for (const vp of inside) setViewpointFolder(engine, vp, '');
    setSavedFolders(savedFolders.filter((f) => f !== name));
  };
  const drop = (folder: string, e: DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const vp = list.find((v) => v.guid === e.dataTransfer.getData('text/viewpoint'));
    if (vp && folderOf(vp) !== folder) setViewpointFolder(engine, vp, folder);
  };
  const dropProps = (folder: string) => ({
    onDragOver: (e: DragEvent) => { e.preventDefault(); setDragOver(folder); },
    onDragLeave: () => setDragOver(null),
    onDrop: (e: DragEvent) => drop(folder, e),
  });

  const renderRow = (vp: OBC.Viewpoint): ReactNode => {
    const url = thumbnailUrl(engine, vp);
    const when = dataOf(vp).timeline;
    const title = viewpointTitle(vp);
    return (
      <div
        key={vp.guid}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/viewpoint', vp.guid)}
        className={`vp__row${rb.shown('thumb') ? '' : ' vp__row--plain'}${busy === vp.guid ? ' is-busy' : ''}`}
      >
        {rb.shown('thumb') && (
          <button type="button" className="vp__thumb" title="Open this viewpoint" onClick={() => void run(vp.guid, () => openViewpoint(engine, vp))}>
            {url ? <img src={url} alt={title} draggable={false} /> : <span className="vp__nothumb">—</span>}
          </button>
        )}
        <div className="vp__text">
          {editing === vp.guid ? (
            <input
              className="vp__rename"
              autoFocus
              defaultValue={title}
              onBlur={(e) => {
                renameViewpoint(engine, vp, e.target.value);
                setEditing(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            <button type="button" className="vp__title" title="Open this viewpoint (double-click to rename)" onClick={() => void run(vp.guid, () => openViewpoint(engine, vp))} onDoubleClick={() => setEditing(vp.guid)}>{title}</button>
          )}
          {when && rb.shown('date') && <div className="vp__when" title="Timeline position">{new Date(when.date).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}</div>}
        </div>
        <div className="vp__actions">
          {rb.shown('move') && folders.length > 0 && (
            <select className="vp__move" value={folderOf(vp)} title="Move to a folder" aria-label="Move to a folder" onChange={(e) => setViewpointFolder(engine, vp, e.target.value)}>
              <option value="">No folder</option>
              {folders.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
          {rb.shown('update') && <button type="button" className="vp__icon" title="Update: re-take it from the view as it is now" aria-label="Update" disabled={busy !== null} onClick={() => void run(vp.guid, () => updateViewpoint(engine, vp))}><IconSync /></button>}
          {rb.shown('rename') && <button type="button" className="vp__icon" title="Rename" aria-label="Rename" onClick={() => setEditing(vp.guid)}><IconPencil /></button>}
          {rb.shown('delete') && <button type="button" className="vp__icon vp__icon--danger" title="Delete" aria-label="Delete" onClick={() => deleteViewpoint(engine, vp)}><IconTrash /></button>}
        </div>
      </div>
    );
  };

  if (layout === 'cards') {
    const shownCards = cardFolder === null ? list : list.filter((vp) => folderOf(vp) === cardFolder);
    const nav = (key: string | null, label: string, count: number) => (
      <div key={key ?? 'all'} className={`vp__nav${cardFolder === key ? ' is-on' : ''}${key !== null && dragOver === key ? ' is-over' : ''}`} {...(key === null ? {} : dropProps(key))}>
        <button type="button" className="vp__nav-name" onClick={() => setCardFolder(key)}>{renamingFolder === key && key ? (
          <input className="vp__rename" autoFocus defaultValue={key} onClick={(e) => e.stopPropagation()} onBlur={(e) => renameFolder(key, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenamingFolder(null); }} />
        ) : <span className="vp__folder-name">{label}</span>}<span className="vp__folder-count">{count}</span></button>
        {key && <span className="vp__actions">
          <button type="button" className="vp__icon" title="Rename the folder" aria-label="Rename the folder" onClick={() => setRenamingFolder(key)}><IconPencil /></button>
          <button type="button" className="vp__icon vp__icon--danger" title="Delete the folder (its viewpoints are kept)" aria-label="Delete the folder" onClick={() => { deleteFolder(key); if (cardFolder === key) setCardFolder(null); }}><IconTrash /></button>
        </span>}
      </div>
    );
    return (
      <div className="vp vp--cards" ref={root}>
        <div className="vp__side">
          <div className="vp__side-actions"><InfoTip>
          Saves the camera plus what is ticked in Viewpoint attributes (hidden objects, selection, sections, style, display, placement{page === 'sequence' ? ', timeline position' : ''}). Click a viewpoint to open it; the icons update it from the view as it is now, rename it or delete it. Drag a viewpoint onto a folder to file it.
        </InfoTip><ViewpointsHeaderActions /></div>
          <div className="vp__bar">
        {page === 'sequence' && (
          <label className="vp__opt" title="Remember the date the timeline is at, and jump to it when the viewpoint is opened">
            <input type="checkbox" checked={withTimeline} onChange={() => toggleAttr('timeline')} />
            Remember timeline date
          </label>
        )}
          </div>
          {nav(null, 'All', list.length)}
          {folders.map((f) => nav(f, f, list.filter((vp) => folderOf(vp) === f).length))}
          {folders.length > 0 && nav('', 'No folder', unfiled.length)}
        </div>
        <div className="vp__cards" ref={cardsRef}>
          {error && <div className="flt__hint" style={{ color: 'var(--danger)' }}>{error}</div>}
          <div className="vp__cards-grid">{shownCards.map(renderRow)}</div>
          {shownCards.length === 0 && <div className="flt__hint">{list.length === 0 ? 'No viewpoints yet. Set the view up, then press New viewpoint.' : 'Nothing in this folder: drag a viewpoint onto it.'}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="vp" ref={root}>
      <div className="vp__bar">
        {page === 'sequence' && (
          <label className="vp__opt" title="Remember the date the timeline is at, and jump to it when the viewpoint is opened">
            <input type="checkbox" checked={withTimeline} onChange={() => toggleAttr('timeline')} />
            Remember timeline date
          </label>
        )}
        <InfoTip>
          Saves the camera plus what is ticked in Viewpoint attributes (hidden objects, selection, sections, style, display, placement{page === 'sequence' ? ', timeline position' : ''}). Click a viewpoint to open it; the icons update it from the view as it is now, rename it or delete it. Drag a viewpoint onto a folder to file it.
        </InfoTip>
        {actions && <><span className="vp__spacer" /><ViewpointsHeaderActions /></>}
      </div>
      {error && <div className="flt__hint" style={{ color: 'var(--danger)' }}>{error}</div>}
      {list.length === 0 && folders.length === 0 ? (
        <div className="flt__hint">No viewpoints yet. Set the view up, then press New viewpoint.</div>
      ) : (
        <div className="vp__list">
          {folders.map((f) => {
            const inside = list.filter((vp) => folderOf(vp) === f);
            const open = !closed.includes(f);
            return (
              <div key={f} className="vp__folder">
                <div className={`vp__folder-head${dragOver === f ? ' is-over' : ''}`} {...dropProps(f)}>
                  <button type="button" className="vp__folder-toggle" aria-expanded={open} onClick={() => setClosed(open ? [...closed, f] : closed.filter((x) => x !== f))}>
                    <span className="vp__chev">{open ? '▾' : '▸'}</span>
                    {renamingFolder === f ? (
                      <input
                        className="vp__rename"
                        autoFocus
                        defaultValue={f}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => renameFolder(f, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                          if (e.key === 'Escape') setRenamingFolder(null);
                        }}
                      />
                    ) : <span className="vp__folder-name">{f}</span>}
                    <span className="vp__folder-count">{inside.length}</span>
                  </button>
                  <div className="vp__actions">
                    <button type="button" className="vp__icon" title="Rename the folder" aria-label="Rename the folder" onClick={() => setRenamingFolder(f)}><IconPencil /></button>
                    <button type="button" className="vp__icon vp__icon--danger" title="Delete the folder (its viewpoints are kept)" aria-label="Delete the folder" onClick={() => deleteFolder(f)}><IconTrash /></button>
                  </div>
                </div>
                {open && inside.map(renderRow)}
                {open && inside.length === 0 && <div className="flt__hint">Empty: drag a viewpoint here, or move one with its folder list.</div>}
              </div>
            );
          })}
          {folders.length > 0 && (
            <div className={`vp__folder-head vp__folder-head--root${dragOver === '' ? ' is-over' : ''}`} {...dropProps('')}>
              <span className="vp__folder-name">No folder</span>
              <span className="vp__folder-count">{unfiled.length}</span>
            </div>
          )}
          {unfiled.map(renderRow)}
        </div>
      )}
    </div>
  );
}
