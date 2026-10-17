import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { FREE_MODE } from '../licence/freeMode';
import { scenes, type Scene } from '../state/scenes';
import { dropFiles } from '../state/fileDrop';
import { openDefaultWorkspace } from '../state/workspaces';
import { homeOpen, useHomeSelection } from '../state/homeSelection';
import { useHeaderSlotStore } from '../state/headerSlotStore';
import { DOCK_DEFAULTS, useDockStore } from '../state/dockStore';
import { usePersistedState } from '../utils/persistedState';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { thumbFromFile, thumbFromView } from '../components/sceneThumb';
import { IconCamera, IconChevronDown, IconChevronRight, IconCube, IconDownload, IconFolder, IconGantt, IconGear, IconBlocksFour, IconList, IconMoreHorizontal, IconPencil, IconPlus, IconRemove, IconUpload } from '../components/icons';
import { SceneTools } from '../components/SceneTools';
import { buildCombinedGroups, buildGroups, NO_VALUE, useInputDetailsStore, type GroupNode } from '../state/inputDetailsStore';
import { FILE_VIEW_PROPS, foreignView } from '../state/fileView';
import { sceneMatches, sortScenes, useSceneDetailsStore, valuesOfScene } from '../state/sceneDetailsStore';

/** What the list shows, top to bottom: a group's header, or the scenes under it (all of them when nothing is grouped). */
type HomeRow = { kind: 'group'; node: GroupNode<Scene> } | { kind: 'scenes'; items: Scene[] };

const groupKeys = (nodes: GroupNode<Scene>[]): string[] => nodes.flatMap((n) => [n.key, ...groupKeys(n.children)]);

const num = (n: number) => n.toLocaleString();
/** What a scene holds, a picture each: activities, objects, models. Nothing until the scene has been saved with them loaded. */
const stats = (s: Scene) => {
  const c = s.counts;
  if (c?.activities === undefined && c?.objects === undefined && c?.models === undefined) return <div className="home__stats home__stats--none">Open and save to see its numbers</div>;
  const none = !c?.models && !c?.activities;
  if (none) return <div className="home__stats home__stats--none">No models or programme loaded</div>;
  return (
    <div className="home__stats">
      <span title={`${num(c?.activities ?? 0)} activities`}><IconGantt width={16} height={16} />{num(c?.activities ?? 0)}<i> activities</i></span>
      <span title={`${num(c?.objects ?? 0)} objects`}><IconCube width={16} height={16} />{num(c?.objects ?? 0)}<i> objects</i></span>
      <span title={`${num(c?.models ?? 0)} models`}><IconFolder width={16} height={16} />{num(c?.models ?? 0)}<i> models</i></span>
    </div>
  );
};

/** A colour block with the scene's initials, for a scene without a picture. */
const initials = (name: string) => name.split(/[\s_\-–]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
const hueOf = (name: string) => { let h = 0; for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

const ago = (iso: string) => {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
};

/** Home: the first page of the app. The scenes of the project as tiles or a list, with the basics of each; a scene opens with its
    layout and lists (the page reloads), the one you are in is saved as you work. The files (models, site context, programmes) are
    one click away. */
export function HomePage({ picker, search }: { /** The global search, at the right end of the bar. */ search?: ReactNode; /** The top-left buttons (Home, Workspace, View, search), as the other pages hold them in their toolbar. */ picker?: ReactNode }) {
  const engine = useViewerEngine();
  const [store, setStore] = useState(scenes.get);
  const [view, setView] = usePersistedState<'tiles' | 'list'>('home.view', 'tiles');
  const [menu, setMenu] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const headerSlot = useHeaderSlotStore((h) => h.el);
  const settingsOpen = useDockStore((s) => (s.placement.settings ?? DOCK_DEFAULTS.settings) !== 'closed');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const thumbRef = useRef<HTMLInputElement>(null);
  const thumbFor = useRef<string | null>(null);
  useEffect(() => {
    const refresh = () => setStore(scenes.get());
    window.addEventListener('ip-scenes', refresh);
    const tick = window.setInterval(refresh, 30000);
    return () => { window.removeEventListener('ip-scenes', refresh); window.clearInterval(tick); };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('.home__menu, .home__more')) setMenu(null); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [menu]);

  const attempt = async (what: string, run: () => Promise<unknown>) => {
    setError(null);
    try { await run(); } catch (e) { setError(`${what}: ${e instanceof Error ? e.message : String(e)}`); }
  };
  const current = store.scenes.find((s) => s.id === store.activeId) ?? null;
  // Filtered, then sorted by the sort rules (pinned first), then grouped. The chosen scene's tile takes the top right of its grid by itself.
  const fields = useSceneDetailsStore((s) => s.fields);
  const details = useSceneDetailsStore((s) => s.values);
  const filters = useSceneDetailsStore((s) => s.filters);
  const sortRules = useSceneDetailsStore((s) => s.sortRules);
  const groupRules = useSceneDetailsStore((s) => s.groupRules);
  const groupCombine = useSceneDetailsStore((s) => s.groupCombine);
  const collapsed = useSceneDetailsStore((s) => s.collapsed);
  useEffect(() => { useSceneDetailsStore.getState().prune(store.scenes.map((s) => s.id)); }, [store.scenes]);
  const listed = useMemo(() => sortScenes(store.scenes.filter((s) => sceneMatches(s, filters, details)), sortRules, details), [store.scenes, filters, details, sortRules]);
  const groups = useMemo(() => {
    const valuesOf = (field: string, s: Scene) => valuesOfScene(field, s, details);
    return groupRules.length ? (groupCombine ? buildCombinedGroups(listed, groupRules, valuesOf) : buildGroups(listed, groupRules, valuesOf)) : [];
  }, [listed, groupRules, groupCombine, details]);
  const rows = useMemo(() => {
    if (!groups.length) return [{ kind: 'scenes', items: listed }] as HomeRow[];
    const out: HomeRow[] = [];
    const walk = (nodes: GroupNode<Scene>[]) => {
      for (const node of nodes) {
        out.push({ kind: 'group', node });
        if (collapsed.includes(node.key)) continue;
        if (node.children.length) walk(node.children);
        else out.push({ kind: 'scenes', items: node.items });
      }
    };
    walk(groups);
    return out;
  }, [groups, listed, collapsed]);
  const listFields = fields.filter((f) => f !== 'Notes');
  // The chosen scene (the one you are in until you choose another): the Files panel lists its files.
  const [chosenId, setChosenId] = usePersistedState<string | null>('home.chosen', null);
  const chosen = store.scenes.find((x) => x.id === chosenId) ?? store.scenes.find((x) => x.id === store.activeId) ?? null;
  // The Files panel shows the Files view (filters, grouping, sorting, columns) of the chosen scene. The scene you are in already has its own in
  // the store; for another one its saved view is loaded into the store, edits go back into that scene, and the scene you are in gets its own back after.
  useEffect(() => {
    if (!chosen) return;
    useHomeSelection.getState().select(chosen.id, chosen.name, null);
    if (chosen.id === store.activeId) return;
    const pick = () => { const st = useInputDetailsStore.getState(); return Object.fromEntries(FILE_VIEW_PROPS.map((p) => [p, st[p]])); };
    let live = true;
    let unsub: (() => void) | null = null;
    let timer: number | undefined;
    let last = '';
    const save = () => { window.clearTimeout(timer); const v = pick(); const text = JSON.stringify(v); if (text !== last) { last = text; void scenes.setFileView(chosen.id, v); } };
    void scenes.fileView(chosen.id).then((view) => {
      if (!live) return;
      foreignView.on = true;
      const initial = useInputDetailsStore.getInitialState();
      useInputDetailsStore.setState({ ...Object.fromEntries(FILE_VIEW_PROPS.map((p) => [p, initial[p]])), ...view });
      last = JSON.stringify(pick());
      unsub = useInputDetailsStore.subscribe(() => { window.clearTimeout(timer); timer = window.setTimeout(save, 400); });
    });
    return () => {
      live = false;
      unsub?.();
      if (foreignView.on) {
        save();
        foreignView.on = false;
        void useInputDetailsStore.persist.rehydrate(); // the scene you are in: its own view from the browser's key
      }
    };
  }, [chosen?.id, store.activeId]);
  useEffect(() => () => useHomeSelection.getState().clear(), []);

  const open = (s: Scene) => {
    // The scene you are in: the models the filters leave in the Files list are added to the ones it brings back, then its workspace opens (the page
    // reloads, as a new session does, and the viewer loads them there: it is not running on Home).
    if (s.id === store.activeId) {
      try {
        const names = homeOpen.names();
        if (names.length) {
          let have: string[] = [];
          try { const v = JSON.parse(localStorage.getItem('models.loaded') ?? 'null'); if (Array.isArray(v)) have = v as string[]; } catch { /* none */ }
          localStorage.setItem('models.loaded', JSON.stringify([...new Set([...have, ...names])]));
        }
        if (!openDefaultWorkspace()) setError('Open: no workspace to open. Choose one in the workspace menu at the bottom right.');
        else window.location.reload();
      } catch (e) {
        setError(`The scene was not opened: ${e instanceof Error ? e.message : String(e)}`);
      }
      return;
    }
    const names = homeOpen.names();
    if (window.confirm(`Open the scene “${s.name}”?

The page reloads with its layout and lists and goes to your workspace${names.length ? `, loading ${names.length} more model${names.length === 1 ? '' : 's'} from its Files list` : ''}. “${current?.name ?? 'This scene'}” is saved first.`)) {
      openDefaultWorkspace();
      void attempt('The scene was not opened', async () => { await scenes.addLoaded(s.id, names); await scenes.activate(s.id); });
    }
  };
  const create = (empty: boolean) => {
    const name = window.prompt(empty ? 'Name of the new empty scene:' : `Name of the new scene (a copy of “${current?.name ?? 'this one'}”):`, 'Scene')?.trim();
    if (!name) return;
    if (empty && !window.confirm(`Start “${name}” empty: no viewpoints, topics, search sets or markers?\n\nThe page reloads (models loaded now are unloaded).`)) return;
    void attempt('The scene was not created', () => scenes.create(name, empty));
  };
  const finishRename = (s: Scene, value: string) => {
    setRenaming(null);
    const n = value.trim();
    if (n && n !== s.name) void attempt('The scene was not renamed', () => scenes.rename(s.id, n));
  };
  const remove = (s: Scene) => {
    if (window.confirm(`Delete the scene “${s.name}” with its viewpoints and topics?${s.id === store.activeId ? ' Another scene opens.' : ''}`)) void attempt('The scene was not deleted', () => scenes.remove(s.id));
  };

  /** The scene you are in can take its picture from the 3D view; any scene can take a picture file. */
  const fromView = (s: Scene) => void attempt('The picture was not made', async () => scenes.setThumb(s.id, await thumbFromView(engine)));
  const chooseImage = (s: Scene) => { thumbFor.current = s.id; thumbRef.current?.click(); };
  const picture = (s: Scene) => (s.thumb
    ? <img className="home__thumb" src={s.thumb} alt="" />
    : <div className="home__thumb home__thumb--none" aria-hidden style={{ background: `hsl(${hueOf(s.name)} 35% 88%)`, color: `hsl(${hueOf(s.name)} 40% 32%)` }}>{initials(s.name)}</div>);
  const nameOf = (s: Scene) => renaming === s.id
    ? (
      <input
        autoFocus
        type="text"
        className="home__rename"
        defaultValue={s.name}
        onBlur={(e) => finishRename(s, e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') finishRename(s, (e.target as HTMLInputElement).value); if (e.key === 'Escape') setRenaming(null); }}
      />
    )
    : <span className="home__name" title={s.name}>{s.name}</span>;

  /** The three dots of a scene: what there is to do with it besides opening it. */
  const more = (s: Scene) => (
    <span className="home__morewrap">
      <button type="button" className="icon-btn home__more" aria-label={`More for ${s.name}`} aria-haspopup="menu" aria-expanded={menu === s.id} onClick={(e) => { e.stopPropagation(); setMenu(menu === s.id ? null : s.id); }}><IconMoreHorizontal width={18} height={18} /></button>
      {menu === s.id && (
        <div className="home__menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenu(null); void attempt('The scene was not pinned', () => scenes.setPinned(s.id, !s.pinned)); }}>{s.pinned ? 'Unpin from the top' : 'Pin to the top'}</button>
          {s.id === store.activeId && <button type="button" role="menuitem" onClick={() => { setMenu(null); fromView(s); }}><IconCamera width={14} height={14} /> Picture from the 3D view</button>}
          <button type="button" role="menuitem" onClick={() => { setMenu(null); chooseImage(s); }}><IconUpload width={14} height={14} /> Choose a picture…</button>
          {s.thumb && <button type="button" role="menuitem" onClick={() => { setMenu(null); void attempt('The picture was not removed', () => scenes.setThumb(s.id, null)); }}><IconRemove width={14} height={14} /> Remove the picture</button>}
          <button type="button" role="menuitem" onClick={() => { setMenu(null); setRenaming(s.id); }}><IconPencil width={14} height={14} /> Rename</button>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); void attempt('The scene was not exported', () => scenes.exportScene(s.id)); }}><IconDownload width={14} height={14} /> Download as a file</button>
          {store.scenes.length > 1 && <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenu(null); remove(s); }}><IconRemove width={14} height={14} /> Delete</button>}
        </div>
      )}
    </span>
  );

  /** One scene's card. The chosen one keeps its place, marked with a border. */
  const tileOf = (s: Scene) => {
    const here = s.id === store.activeId;
    const isChosen = s.id === chosen?.id;
    return (
        <div key={s.id} className={`home__tile${here ? ' is-here' : ''}${isChosen ? ' is-selected' : ''}`} onClick={(e) => { if ((e.target as HTMLElement).closest('.home__tilemore, .home__menu')) return; if (!isChosen) setChosenId(s.id); }} onDoubleClick={() => open(s)} title={isChosen ? 'Chosen: press Open to open it in your default workspace' : `Choose ${s.name}: list its files below`}>
          <div className="home__thumbwrap">{picture(s)}</div>
          <div className="home__tilemore">
            {isChosen
              ? <button type="button" className="home__openpill is-shown" onClick={(e) => { e.stopPropagation(); open(s); }} title="Open it in your default workspace">Open</button>
              : <button type="button" className="home__selectpill" onClick={(e) => { e.stopPropagation(); setChosenId(s.id); }}>Select</button>}
            {more(s)}
          </div>
          <div className="home__tilebody">
            <div className="home__tilehead">
              {nameOf(s)}
              {s.pinned && <span className="home__pin" title="Pinned to the top" aria-label="Pinned">★</span>}
            </div>
            {s.counts?.programme && <div className="home__prog" title="The programme loaded">{s.counts.programme}</div>}
            {stats(s)}
            <div className="home__meta">{here && <span className="home__chip home__chip--here">You are in</span>}Saved {ago(s.savedAt)}</div>
          </div>
        </div>
    );
  };

  /** A group's header: collapse / expand, its name and how many scenes. */
  const groupHeader = (node: GroupNode<Scene>) => {
    const isCollapsed = collapsed.includes(node.key);
    return (
      <div className="inputs-folder__bar home__group" style={node.level ? { paddingLeft: node.level * 18 } : undefined}>
        <button type="button" className="inputs-folder__toggle" onClick={() => useSceneDetailsStore.getState().toggleCollapsed(node.key)} aria-expanded={!isCollapsed}>
          {isCollapsed ? <IconChevronRight width={14} height={14} /> : <IconChevronDown width={14} height={14} />}
          <b>{node.value === NO_VALUE ? '(none)' : node.value}</b>
          <span className="inputs-folder__count">{node.items.length}</span>
        </button>
      </div>
    );
  };

  if (FREE_MODE) return <div className="home"><p style={{ padding: 16 }}>Scenes keep your arrangement and lists between visits. The free edition keeps nothing when you close the page, so they come with a licence.</p></div>;

  return (
    <div className="home" onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }} onDragLeave={(e) => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false); }} onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDragging(false); useDockStore.getState().move('files', 'bottom'); dropFiles([...e.dataTransfer.files]); }}>
      {dragging && <div className="home__drop" aria-hidden><div>Drop to add to the project<small>Models (.ifc), site context (.glb) and programmes</small></div></div>}
      {/* The bar runs across the whole width: the panels on the sides start below it. */}
      {(() => { const bar = (
      <div className="home__bar viewer-toolbar-row schedule-toolbar">
        <div className="schedule-toolbar__left">
          {picker}
        </div>
        <div className="schedule-toolbar__right">
          <button type="button" className="home__tool home__tool--primary" onClick={() => create(false)} title="A copy of the scene you are in, under a name"><IconPlus width={18} height={18} /> New scene</button>
          <button type="button" className="home__tool" onClick={() => importRef.current?.click()} title="Add a scene from a file made with Download"><IconUpload width={18} height={18} /> Import</button>
          <span className="home__seg" role="group" aria-label="Tiles or list">
            <button type="button" className={view === 'tiles' ? 'is-on' : ''} aria-pressed={view === 'tiles'} onClick={() => setView('tiles')} title="Tiles" aria-label="Tiles"><IconBlocksFour width={20} height={20} /></button>
            <button type="button" className={view === 'list' ? 'is-on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')} title="List" aria-label="List"><IconList width={20} height={20} /></button>
          </span>
          <SceneTools scenes={store.scenes} onCollapseAll={() => useSceneDetailsStore.getState().setCollapsedAll(groupKeys(groups))} onExpandAll={() => useSceneDetailsStore.getState().setCollapsedAll([])} />
          {search}
          <button type="button" className={`ws-page__btn ws-top__btn home__settings${settingsOpen ? ' is-on' : ''}`} aria-pressed={settingsOpen} onClick={() => (settingsOpen ? useDockStore.getState().close('settings') : useDockStore.getState().reveal('settings'))} title="Settings" aria-label="Settings"><IconGear width={20} height={20} /></button>
        </div>
      </div>
      ); return headerSlot ? createPortal(bar, headerSlot) : bar; })()}
      <div className="home__head">
        <input
          ref={thumbRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            const id = thumbFor.current;
            if (f && id) void attempt('The picture was not set', async () => scenes.setThumb(id, await thumbFromFile(f)));
          }}
        />
        <input
          ref={importRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void attempt('The scene was not imported', () => scenes.importScene(f));
          }}
        />
      </div>
      {error && <div className="home__error">{error}</div>}
      {store.scenes.length === 0 && <div className="home__empty">No scenes yet. New scene makes one from how the app is now.</div>}
      {store.scenes.length > 0 && listed.length === 0 && (
        <div className="home__empty">No scene matches the filters. <button type="button" className="cols__link" onClick={() => useSceneDetailsStore.getState().clearFilters()}>Clear filters</button></div>
      )}

      <div className={`home__body${view === 'list' ? ' home__body--list' : ''}`}>
        <div className="home__main">
          {view === 'tiles' ? (
            <>
              {rows.map((r, i) => r.kind === 'group'
                ? <Fragment key={r.node.key}>{groupHeader(r.node)}</Fragment>
                : (
                  <div key={`s${i}`} className="home__tiles">
                    {r.items.map((s) => tileOf(s))}
                  </div>
                ))}
            </>
          ) : (
            <table className="home__list">
              <thead><tr><th /><th>Name</th><th>Contents</th>{listFields.map((f) => <th key={f}>{f}</th>)}<th>Saved</th><th /></tr></thead>
              <tbody>
                {rows.map((r, i) => r.kind === 'group'
                  ? <tr key={r.node.key} className="inputs-folder"><td colSpan={5 + listFields.length}>{groupHeader(r.node)}</td></tr>
                  : (
                    <Fragment key={`s${i}`}>
                      {r.items.map((s) => {
                        const here = s.id === store.activeId;
                        return (
                          <tr key={s.id} className={`${here ? 'is-here' : ''}${s.id === chosen?.id ? ' is-selected' : ''}`} style={{ cursor: 'pointer' }} onClick={(e) => { if (!(e.target as HTMLElement).closest('button, input')) setChosenId(s.id); }} onDoubleClick={() => open(s)}>
                            <td className="home__thumbcell">{picture(s)}</td>
                            <td>{nameOf(s)}{here && <span className="home__chip">You are in</span>}</td>
                            <td>{stats(s)}</td>
                            {listFields.map((f) => <td key={f}>{(details[s.id]?.[f] ?? []).join(', ') || <span className="inputs-detail__none">—</span>}</td>)}
                            <td>{ago(s.savedAt)}</td>
                            <td className="home__actions">
                              {more(s)}
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
