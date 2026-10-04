import { useEffect, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useModelStoreState } from '../state/modelStoreState';
import { dbRoot, useProjectDbStore } from '../state/projectDbStore';
import { deleteStoredModel, getStoredIfc, listStoredVersions, restoreStoredVersion, type StoredModel, type StoredVersion } from '../db/modelsApi';
import { loadStoredModel } from '../viewer/modelStore';
import { downloadBlob } from '../utils/download';
import { FolderHeaderRow, FolderMenuButton, dragItemProps } from './InputFolders';
import { sectionsOf, useInputFoldersStore } from '../state/inputFoldersStore';
import { IconCheckboxChecked, IconCheckboxUnchecked, IconDownloadFile } from './icons';

const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Inputs › Models in the project database: the models kept in the project's model
    store (insight-plan-models.db). Opening one uses its converted copy when there is
    one (no IFC conversion); Export IFC gives back the stored IFC, with any edits made
    in the app (Properties › Edit properties, Model checks patches) applied. */
export function StoredModelsPanel() {
  const engine = useViewerEngine();
  const root = useProjectDbStore((s) => s.db?.root ?? null);
  const stored = useModelStoreState((s) => s.models);
  const error = useModelStoreState((s) => s.error);
  const refresh = useModelStoreState((s) => s.refresh);
  const models = useModelsStore((s) => s.models);
  const addModel = useModelsStore((s) => s.addModel);
  const folders = useInputFoldersStore((s) => s.folders);
  const folderOf = useInputFoldersStore((s) => s.assign);
  const collapsedFolders = useInputFoldersStore((s) => s.collapsed);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [versions, setVersions] = useState<{ name: string; list: StoredVersion[] } | null>(null);

  useEffect(() => {
    void refresh(root);
  }, [root, refresh]);

  if (!root) return null;
  const loaded = new Set(models.map((m) => m.name));

  const open = async (m: StoredModel) => {
    setBusy(m.name);
    setMessage(null);
    try {
      const { info, fast } = await loadStoredModel(engine, root, m.name, m.ifcHash);
      addModel(info);
      setMessage(`${m.name} opened${fast ? ' from its converted copy' : ' (converted from the IFC; the copy is kept for next time)'}.`);
      void refresh(root);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const exportIfc = async (m: StoredModel) => {
    setBusy(m.name);
    try {
      downloadBlob(m.name, new Blob([await getStoredIfc(root, m.name)], { type: 'application/octet-stream' }));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (m: StoredModel) => {
    if (!window.confirm(`Remove ${m.name} from the project's model store? Its stored IFC, converted copy and earlier versions are deleted (loaded models stay).`)) return;
    await deleteStoredModel(root, m.name);
    void refresh(root);
  };

  const showVersions = async (m: StoredModel) => {
    setVersions(versions?.name === m.name ? null : { name: m.name, list: await listStoredVersions(root, m.name) });
  };

  const restore = async (name: string, v: StoredVersion) => {
    if (!window.confirm(`Make the version of ${new Date(v.createdAt).toLocaleString()} the current ${name}? The current one goes to the history.`)) return;
    await restoreStoredVersion(root, name, v.id);
    setVersions(null);
    setMessage(`${name}: restored. Open it again from here (a loaded copy of the model is not replaced).`);
    void refresh(root);
  };

  return (
    <div className="stored-models">
      <div className="inputs-panel__header" style={{ marginTop: 16 }}>
        <span>Models in the project database</span>
        <span className="inputs-panel__count">{stored.length}</span>
      </div>
      {error && <div className="inputs-panel__error">{error}</div>}
      {message && <div className="scn-dim" style={{ padding: '4px 0' }}>{message}</div>}
      {stored.length === 0 && !error && <div className="scn-dim" style={{ padding: '6px 0' }}>Models you drop here are kept in the project folder's model store, so they open without converting the IFC again.</div>}
      {stored.length > 0 && (
        <table className="inputs-table">
          <thead>
            <tr>
              <th>Name</th>
              <th className="inputs-table__centre">IFC size</th>
              <th className="inputs-table__centre">Opens</th>
              <th className="inputs-table__centre">Versions</th>
              <th style={{ textAlign: 'right', width: 1 }}>Action</th>
            </tr>
          </thead>
          <tbody>
            {sectionsOf(stored, (m) => m.name, folders, folderOf).flatMap((section) => [
              ...(folders.length > 0 && (section.folder !== '' || section.items.length > 0)
                ? [<FolderHeaderRow key={`folder-${section.folder}`} folder={section.folder} count={section.items.length} colSpan={5} />]
                : []),
              ...(folders.length > 0 && collapsedFolders.includes(section.folder) ? [] : section.items).map((m) => (
              <tr key={m.name} className={folders.length > 0 ? 'inputs-in-folder' : undefined} {...dragItemProps(m.name)}>
                <td title={m.note ?? undefined}>{m.name}{loaded.has(m.name) && <span className="source-chip" title="Loaded now">loaded</span>}</td>
                <td className="inputs-table__centre">{formatBytes(m.ifcSize)}</td>
                <td className="inputs-table__centre">{m.cached ? 'fast' : 'converts the IFC'}</td>
                <td className="inputs-table__centre">
                  {m.versions > 0 ? <button type="button" className="mini-btn" onClick={() => void showVersions(m)} title="Earlier IFCs (kept when an edit or a new file replaces the model)">{m.versions}</button> : '—'}
                </td>
                <td style={{ textAlign: 'right' }}>
                  <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                    <button type="button" className="mini-btn mini-btn--icon" disabled={busy === m.name || loaded.has(m.name)} onClick={() => void open(m)} aria-pressed={loaded.has(m.name)} aria-label={loaded.has(m.name) ? 'Open (already loaded)' : 'Open'} title={loaded.has(m.name) ? 'Open: already loaded (remove it above to open it again)' : 'Open the model'}>
                      {loaded.has(m.name) ? <IconCheckboxChecked width={16} height={16} /> : <IconCheckboxUnchecked width={16} height={16} />}
                    </button>
                    <button type="button" className="mini-btn mini-btn--icon" disabled={busy === m.name} onClick={() => void exportIfc(m)} aria-label="Export IFC" title="Export IFC: download the stored IFC, with the edits made in the app">
                      <IconDownloadFile width={16} height={16} />
                    </button>
                    <FolderMenuButton name={m.name} />
                    <button type="button" className="mini-btn danger" onClick={() => void remove(m)} title="Remove from the model store">✕</button>
                  </div>
                </td>
              </tr>
              )),
            ])}
          </tbody>
        </table>
      )}
      {versions && (
        <div className="scn-dim" style={{ padding: '6px 0' }}>
          <b>{versions.name}: earlier versions</b>
          {versions.list.map((v) => (
            <div key={v.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}>
              <span>{new Date(v.createdAt).toLocaleString()} · {formatBytes(v.ifcSize)}{v.note ? ` · ${v.note}` : ''}</span>
              <button type="button" className="mini-btn" onClick={() => void restore(versions.name, v)}>Restore</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Whether a project folder (and so a model store) is open. */
export const modelStoreOpen = () => dbRoot() !== null;
