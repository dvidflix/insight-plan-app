import { useEffect, useState } from 'react';
import { hasExternalChanges, linkP6, openProject, reloadFromDb, useProjectDbStore } from '../state/projectDbStore';
import { fetchLegacyFolders, fetchP6Projects, migrateFolderLayout, type DbProjectInfo } from '../db/api';
import { ProjectPicker } from './schedule/ProjectPicker';
import { FEATURES } from '../features';
import { useWebFolderStore } from '../web/folderStore';

const baseName = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Inputs > Project database: the project folder and its database
    (insight-plan.db), reload, and P6 Professional databases to read from. */
export function ProjectDbBar({ bare = false }: { bare?: boolean } = {}) {
  const root = useProjectDbStore((s) => s.root);
  const db = useProjectDbStore((s) => s.db);
  const error = useProjectDbStore((s) => s.error);
  const busy = useProjectDbStore((s) => s.busy);
  const programmes = useProjectDbStore((s) => s.programmes);
  const changed = useProjectDbStore(hasExternalChanges);
  const [draft, setDraft] = useState(root);
  const [p6Path, setP6Path] = useState('');
  const [p6, setP6] = useState<{ file: string; projects: DbProjectInfo[] } | null>(null);
  const [p6Error, setP6Error] = useState<string | null>(null);
  const [p6Busy, setP6Busy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => setDraft(root), [root]);

  const findP6 = async () => {
    setP6Error(null);
    setP6Busy(true);
    try {
      const res = await fetchP6Projects(p6Path.trim().replace(/^"|"$/g, ''));
      if (!res.projects.length) throw new Error('That database has no projects.');
      setP6(res);
    } catch (e) {
      setP6Error(e instanceof Error ? e.message : String(e));
    } finally {
      setP6Busy(false);
    }
  };
  const linkChosen = async (ids: string[]) => {
    const found = p6;
    setP6(null);
    if (!found) return;
    setP6Busy(true);
    try {
      const names = found.projects.filter((p) => ids.includes(p.id)).map((p) => p.shortName || p.id);
      await linkP6(found.file, ids, `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''} (P6)`);
      setP6Path('');
    } catch (e) {
      setP6Error(e instanceof Error ? e.message : String(e));
    } finally {
      setP6Busy(false);
    }
  };

  return (
    <div className={bare ? "project-db" : "inputs-panel project-db"}>
      <div className={bare ? 'project-db__reload' : 'inputs-panel__header'}>
        {!bare && <span>Project database</span>}
        {db && (
          <button className={`mini-btn${changed ? ' project-db__changed' : ''}`} disabled={!!busy} onClick={() => void reloadFromDb()} title="Read programmes, scenarios, link groups, capacities and settings from the database again">
            ⟳ Reload from database{changed ? ' — changed outside the app' : ''}
          </button>
        )}
      </div>
      <div className={bare ? "project-db__body" : "inputs-panel__body project-db__body"}>
        {FEATURES.browserData && <WebFolderChooser busy={!!busy} />}
        {!FEATURES.browserData && (
        <form
          className="project-db__row"
          onSubmit={(e) => {
            e.preventDefault();
            const next = draft.trim().replace(/^"|"$/g, '');
            if (!next) { setNote('Type or paste the project folder first.'); return; }
            setNote(null);
            if (next === root) void openProject(next).then(() => setNote(useProjectDbStore.getState().error ? null : 'Opened again — the database was read from disk.'));
            else useProjectDbStore.setState({ root: next });
          }}
        >
          <label className="project-db__label" htmlFor="project-db-root">Project folder</label>
          <input id="project-db-root" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="C:\…\Project folder" title="The folder holding the project (and, for Scenarios, the buildings' models in the models folder). Its database is insight-plan.db in that folder, created on first open." />
          <button className="mini-btn" type="submit" disabled={!!busy}>Open</button>
        </form>
        )}
        <FolderLayoutNotice root={db?.root ?? null} />
        {busy && <div className="inputs-panel__busy">{busy}</div>}
        {note && !busy && <div className="project-db__dim">{note}</div>}
        {error && <div className="inputs-panel__error project-db__error">{error}</div>}
        {db ? (
          <div className="project-db__status">
            <span className="project-db__file" title={db.file}>{db.file}</span>
            <span className="project-db__dim">
              {programmes.length} programme{programmes.length === 1 ? '' : 's'} in P6 tables · {FEATURES.browserData ? <SaveState root={db.root} /> : 'open it in DBeaver or DB Browser for SQLite; edits made there come in with Reload.'}
            </span>
          </div>
        ) : (
          !busy && (
            <div className="project-db__dim">
              {root ? 'No database open.' : 'Pick a project folder to keep its programmes, scenarios and settings in one SQLite database (insight-plan.db). Without one, programmes load from files into memory as before.'}
            </div>
          )
        )}
        {db && !FEATURES.browserData && (
          <form
            className="project-db__row"
            onSubmit={(e) => {
              e.preventDefault();
              if (p6Path.trim()) void findP6();
              else setP6Error('Type or paste the full path to the P6 database file (PPMDBSQLite.db) first.');
            }}
          >
            <label className="project-db__label" htmlFor="project-db-p6">P6 Professional database</label>
            <input id="project-db-p6" value={p6Path} onChange={(e) => setP6Path(e.target.value)} placeholder="C:\…\PPMDBSQLite.db" title="A P6 Professional standalone (SQLite) database: its projects are read live, read-only — changes go back into P6 by XER / XML import." />
            <button className="mini-btn" type="submit" disabled={p6Busy}>{p6Busy ? 'Reading…' : 'Add projects…'}</button>
          </form>
        )}
        {p6Error && <div className="inputs-panel__error">{p6Error}</div>}
        {p6 && <ProjectPicker fileName={baseName(p6.file)} projects={p6.projects} onCancel={() => setP6(null)} onLoad={(ids) => void linkChosen(ids)} />}
      </div>
    </div>
  );
}

/** Top bar: the open project database, lit when it was changed outside the app. */
export function DbStatusChip() {
  const db = useProjectDbStore((s) => s.db);
  const busy = useProjectDbStore((s) => s.busy);
  const changed = useProjectDbStore(hasExternalChanges);
  if (!db) return null;
  return (
    <button
      type="button"
      className={`db-chip${changed ? ' db-chip--changed' : ''}`}
      disabled={!!busy}
      onClick={() => void reloadFromDb()}
      title={`${db.file}\n${changed ? 'Changed by another program — click to reload.' : 'Click to reload from the database.'}`}
    >
      <span className="db-chip__dot" aria-hidden="true" />
      {busy ? 'Loading…' : changed ? 'Database changed — Reload' : baseName(db.file)}
    </button>
  );
}

/** Browser edition: pick the project folder (a folder on this computer or in OneDrive), or use the browser's own storage. */
function WebFolderChooser({ busy }: { busy: boolean }) {
  const remembered = useWebFolderStore((s) => s.remembered);
  const root = useProjectDbStore((s) => s.root);
  const [note, setNote] = useState<string | null>(null);
  const use = (r: { root: string; name: string }) => {
    useWebFolderStore.setState({ remembered: { ...r, ready: true } });
    if (r.root === useProjectDbStore.getState().root) void openProject(r.root);
    else useProjectDbStore.setState({ root: r.root });
  };
  const run = (job: () => Promise<{ root: string; name: string } | null>) => {
    setNote(null);
    void job()
      .then((r) => r && use(r))
      .catch((e) => setNote(e instanceof DOMException && e.name === 'AbortError' ? null : e instanceof Error ? e.message : String(e)));
  };
  const canPick = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  return (
    <div className="project-db__web">
      <div className="project-db__row">
        <span className="project-db__label">Project folder</span>
        <b title={root}>{remembered?.ready ? remembered.name : 'None chosen'}</b>
      </div>
      <div className="project-db__row">
        {canPick && (
          <button className="mini-btn" type="button" disabled={busy} onClick={() => run(async () => (await import('../web/client')).chooseProjectFolder())} title="A folder on this computer or in your OneDrive. The project database (insight-plan.db) is kept in it; the browser asks permission once.">
            Choose folder…
          </button>
        )}
        <button className="mini-btn" type="button" disabled={busy} onClick={() => run(async () => (await import('../web/client')).useBrowserStorage())} title="Keep the project inside this browser (no folder to pick). Back it up by copying the database out, as the browser can clear it.">
          Use browser storage
        </button>
        {remembered && !remembered.ready && (
          <button className="mini-btn" type="button" disabled={busy} onClick={() => run(async () => (await import('../web/client')).grantRememberedFolder().then((r) => (r?.ready ? r : null)))} title="The browser asks again before using a folder in a new session.">
            Allow {remembered.name} again
          </button>
        )}
      </div>
      {!canPick && <div className="project-db__dim">This browser cannot pick a folder. Use Chrome or Edge to keep the project in a folder, or use browser storage.</div>}
      {note && <div className="inputs-panel__error">{note}</div>}
    </div>
  );
}

/** "Saved 14:02" / "Saving…" for the browser edition's project file. */
function SaveState({ root }: { root: string }) {
  const [state, setState] = useState<{ dirty: boolean; savedAt: number | null; error: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    const poll = () => fetch(`/api/db/save-status?root=${encodeURIComponent(root)}`).then((r) => r.json()).then((s) => alive && setState(s)).catch(() => undefined);
    void poll();
    const t = setInterval(poll, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [root]);
  if (!state) return null;
  if (state.error) return <span className="project-db__error">Could not save: {state.error}</span>;
  if (state.dirty) return <span>Saving…</span>;
  return <span>Saved{state.savedAt ? ` ${new Date(state.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''} in the project folder as a SQLite file.</span>;
}

const LAYOUT_NAMES: Record<string, string> = { '1-input-ifc': 'models', 'fixed-models': 'models/edited', '7-scenarios': 'scenarios' };

/** Offers to rename a project's folders from an earlier version (1-input-ifc, fixed-models, 7-scenarios) to the current layout. */
function FolderLayoutNotice({ root }: { root: string | null }) {
  const [legacy, setLegacy] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => {
    setDone(null);
    if (!root) return setLegacy([]);
    void fetchLegacyFolders(root).then(setLegacy).catch(() => setLegacy([]));
  }, [root]);
  if (!root) return null;
  if (done) return <div className="project-db__dim">{done}</div>;
  if (legacy.length === 0) return null;
  return (
    <div className="project-db__dim">
      This project still uses the old folder names ({legacy.map((f) => `${f} → ${LAYOUT_NAMES[f] ?? f}`).join(', ')}). They keep working.{' '}
      <button
        type="button"
        className="mini-btn"
        title="Rename them (nothing is overwritten). The full CWA workflow's own scripts expect the old names, so only do this if you don't run them on this folder."
        onClick={() => {
          void migrateFolderLayout(root)
            .then((r) => {
              setDone(`Renamed: ${r.renamed.join(', ') || 'nothing'}${r.skipped.length ? `. Left as they are: ${r.skipped.join(', ')}` : ''}.`);
              setLegacy([]);
            })
            .catch((e) => setDone(e instanceof Error ? e.message : String(e)));
        }}
      >
        Rename the folders
      </button>
    </div>
  );
}
