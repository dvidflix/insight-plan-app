import { useEffect, useRef, useState } from 'react';
import { queryMatcher } from '../schedule/search';
import { scenes, START_PAGE_KEY, type Scene } from '../state/scenes';
import { FREE_MODE } from '../licence/freeMode';
import { InfoTip } from './InfoTip';
import { RowButtonsChooser, useRowButtons } from './RowButtonsChooser';
import { IconDownload, IconFolderOpen, IconPencil, IconPlus, IconUpload, IconRemove } from './icons';

/** The buttons on each scene that can be hidden. */
const SCENE_BUTTONS = [
  { id: 'open', glyph: <IconFolderOpen width={14} height={14} />, label: 'Open' },
  { id: 'rename', glyph: <IconPencil width={14} height={14} />, label: 'Rename' },
  { id: 'export', glyph: <IconDownload width={14} height={14} />, label: 'Download' },
  { id: 'delete', glyph: <IconRemove />, label: 'Delete' },
] as const;
type SceneButton = (typeof SCENE_BUTTONS)[number]['id'];

const START_PAGES = [
  { id: 'home', label: 'Home' },
  { id: 'inputs', label: 'Files' },
  { id: 'model', label: 'Models' },
  { id: 'schedule', label: 'Programmes' },
  { id: 'sequence', label: '4D Sequencing' },
  { id: 'scenarios', label: 'Scenarios' },
  { id: 'timelines', label: 'Timelines' },
  { id: 'external', label: 'External data' },
  { id: 'dashboards', label: 'Dashboards' },
  { id: 'wiki', label: 'Wiki' },
];

/** "2 viewpoints · 1 topic", or a note that there are none. */
const contents = (s: Scene) => {
  if (!s.counts) return 'Layout only';
  const counts = [
    { n: s.counts.viewpoints, one: 'viewpoint' },
    { n: s.counts.topics, one: 'topic' },
    { n: s.counts.markers, one: 'marker' },
  ].filter((c) => c.n > 0);
  return counts.length ? counts.map((c) => `${c.n} ${c.one}${c.n === 1 ? '' : 's'}`).join(' · ') : 'No viewpoints, topics or markers yet';
};

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
};

/** Inputs side pane › Scenes. A scene is the app as you arranged it (page, pane tabs and sizes, columns, group /
    filter / sort rules, view settings) plus its own viewpoints, topics, search sets and markers.
    The scene you are in is saved as you work (nothing to press); New scene adds one; Open on another reloads
    the page with that one's arrangement and lists. */
export function ScenesPanel() {
  const [store, setStore] = useState(scenes.get);
  const [, setTick] = useState(0);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [startPage, setStartPage] = useState(() => localStorage.getItem(START_PAGE_KEY) ?? 'home');
  const importRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const refresh = () => setStore(scenes.get());
    window.addEventListener('ip-scenes', refresh);
    // "saved 3 min ago" keeps counting.
    const tick = window.setInterval(() => setTick((n) => n + 1), 30000);
    return () => { window.removeEventListener('ip-scenes', refresh); window.clearInterval(tick); };
  }, []);

  const current = store.scenes.find((s) => s.id === store.activeId) ?? null;
  const hit = queryMatcher(query);
  const others = store.scenes.filter((s) => s.id !== store.activeId);
  const listed = query.trim() ? others.filter((s) => hit(s.name)) : others;

  /** Runs a scene action; a failure (e.g. the browser is out of space) is shown instead of lost. */
  const attempt = async (what: string, run: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await run();
      return true;
    } catch (e) {
      setError(`${what}: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };
  const rb = useRowButtons<SceneButton>('scenes.hiddenButtons');
  const open = (s: Scene) => {
    if (window.confirm(`Open the scene “${s.name}”?\n\nThe page reloads with its layout and lists (models loaded now are unloaded). “${current?.name ?? 'This scene'}” is saved first.`)) void attempt('The scene was not opened', () => scenes.activate(s.id));
  };
  const create = async () => {
    const n = name.trim();
    if (!n) return;
    if (empty && !window.confirm(`Start “${n}” empty: no viewpoints, topics, search sets or markers?\n\nThe page reloads (models loaded now are unloaded).`)) return;
    if (!(await attempt('The scene was not created', () => scenes.create(n, empty)))) return;
    setName('');
    setEmpty(false);
    setCreating(false);
  };
  const finishRename = (s: Scene, value: string) => {
    setRenaming(null);
    const n = value.trim();
    if (n && n !== s.name) void attempt('The scene was not renamed', () => scenes.rename(s.id, n));
  };
  const remove = (s: Scene, isCurrent: boolean) => {
    if (window.confirm(`Delete the scene “${s.name}” with its viewpoints and topics?${isCurrent ? ' Another scene opens.' : ''}`)) void attempt('The scene was not deleted', () => scenes.remove(s.id));
  };
  const nameOf = (s: Scene, cls: string) =>
    renaming === s.id ? (
      <input
        autoFocus
        type="text"
        className="scene-card__rename"
        defaultValue={s.name}
        onBlur={(e) => finishRename(s, e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') finishRename(s, (e.target as HTMLInputElement).value); if (e.key === 'Escape') setRenaming(null); }}
      />
    ) : (
      <span className={cls} title={s.name}>{s.name}</span>
    );
  const tools = (s: Scene, isCurrent: boolean) => (
    <div className="scene-card__actions">
      {rb.shown('rename') && <button type="button" className="mini-btn mini-btn--icon" onClick={() => setRenaming(s.id)} title="Rename" aria-label={`Rename ${s.name}`}><IconPencil width={14} height={14} /></button>}
      {rb.shown('export') && <button type="button" className="mini-btn mini-btn--icon" onClick={() => void attempt('The scene was not exported', () => scenes.exportScene(s.id))} title="Download as a JSON file, with its viewpoints and topics" aria-label={`Export ${s.name}`}><IconDownload width={14} height={14} /></button>}
      {rb.shown('delete') && store.scenes.length > 1 && (
        <button type="button" className="cols__icon cols__icon--remove" onClick={() => remove(s, isCurrent)} title="Delete this scene" aria-label={`Delete ${s.name}`}><IconRemove /></button>
      )}
    </div>
  );

  if (FREE_MODE) return <p style={{ padding: 12 }}>Scenes keep your arrangement and lists between visits. The free edition keeps nothing when you close the page, so they come with a licence.</p>;

  return (
    <div className="flt scenes">
      {current && (
        <div className="scene-card is-current scene-here">
          <div className="scene-here__label">You are in</div>
          <div className="scene-card__top">
            {nameOf(current, 'scene-here__name')}
            <span className="scene-card__spacer" />
            <InfoTip>Everything you change here (layout, grouping, filters, sorting, pane sizes, viewpoints, topics…) is kept in this scene.</InfoTip>
          </div>
          <div className="scene-here__saved"><span className="scene-here__dot" aria-hidden /> Saved automatically · last {ago(current.savedAt)}</div>
          <div className="scene-card__meta">{contents(current)}</div>
          {tools(current, true)}
        </div>
      )}

      {!creating ? (
        <button type="button" className="scenes__create" onClick={() => setCreating(true)}>
          <IconPlus width={16} height={16} />
          <span><b>New scene</b><small>Keep this one as it is and start another</small></span>
        </button>
      ) : (
        <div className="scene-new">
          <div className="scene-new__title">New scene</div>
          <input autoFocus type="text" value={name} placeholder="Name, e.g. “Level 3 pours”" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void create(); if (e.key === 'Escape') setCreating(false); }} />
          <label className={`scene-new__opt${!empty ? ' on' : ''}`}>
            <input type="radio" name="scene-start" checked={!empty} onChange={() => setEmpty(false)} />
            <span><b>Copy of {current ? `“${current.name}”` : 'this scene'}</b><small>Same layout, viewpoints and topics. Carry on from here.</small></span>
          </label>
          <label className={`scene-new__opt${empty ? ' on' : ''}`}>
            <input type="radio" name="scene-start" checked={empty} onChange={() => setEmpty(true)} />
            <span><b>Empty</b><small>Same layout, but no viewpoints, topics, search sets or markers. The page reloads.</small></span>
          </label>
          {error && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</div>}
          <div className="scene-new__buttons">
            <button type="button" className="btn btn--small" onClick={() => setCreating(false)}>Cancel</button>
            <button type="button" className="btn btn--small btn--primary" onClick={() => void create()} disabled={!name.trim()}>Create scene</button>
          </div>
        </div>
      )}

      <div className="cols__heading">
        <span>Other scenes <b>{query.trim() ? `${listed.length} of ${others.length}` : others.length}</b></span>
        <RowButtonsChooser compact buttons={SCENE_BUTTONS} rb={rb} title="Choose which buttons show on each scene" />
      </div>
      {others.length > 0 && <input className="cols__search" type="search" placeholder="Search scenes…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search scenes" />}
      <div className="scenes__list">
        {others.length === 0 && <div className="flt__hint">No other scenes yet. Use New scene to make one; then Open switches between them.</div>}
        {others.length > 0 && listed.length === 0 && <div className="flt__hint">No scene matches “{query}”.</div>}
        {listed.map((s) => (
          <div key={s.id} className="scene-card scene-card--row" title={`${contents(s)} · saved ${ago(s.savedAt)}`}>
            {rb.shown('open') && <button type="button" className="mini-btn mini-btn--icon scene-card__open-icon" onClick={() => open(s)} title="Open this scene (the page reloads)" aria-label={`Open ${s.name}`}><IconFolderOpen width={16} height={16} /></button>}
            {nameOf(s, 'scene-card__name')}
            <span className="scene-card__spacer" />
            {tools(s, false)}
          </div>
        ))}
      </div>

      <div className="cols__heading"><span>Start-up and sharing</span></div>
      <label className="scenes__start">
        <span>Open the app on</span>
        <select value={startPage} onChange={(e) => { setStartPage(e.target.value); localStorage.setItem(START_PAGE_KEY, e.target.value); }}>
          {START_PAGES.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </label>
      <button type="button" className="btn btn--small scenes__import" onClick={() => importRef.current?.click()} title="Add a scene from a JSON file made with Export"><IconUpload width={14} height={14} /> Import scene…</button>
      <input
        ref={importRef}
        type="file"
        accept=".json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setError(null);
          scenes.importScene(f).catch((err) => setError(err instanceof Error ? err.message : String(err)));
        }}
      />
      {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 6 }}>{error}</div>}
    </div>
  );
}
