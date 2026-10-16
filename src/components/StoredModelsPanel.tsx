import { useEffect, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useModelStoreState } from '../state/modelStoreState';
import { dbRoot, useProjectDbStore } from '../state/projectDbStore';
import { deleteStoredModel, getStoredIfc, listStoredVersions, restoreStoredVersion, type StoredModel, type StoredVersion } from '../db/modelsApi';
import { loadStoredModel } from '../viewer/modelStore';
import { downloadBlob } from '../utils/download';

export const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Inputs: the models kept in the project's model store (insight-plan-models.db), listed with the other files.
    Opening one uses its converted copy when there is one (no IFC conversion); Export IFC gives back the stored
    IFC, with any edits made in the app (Properties › Edit properties, Model checks patches) applied. */
export function useStoredModels() {
  const engine = useViewerEngine();
  const root = useProjectDbStore((s) => s.db?.root ?? null);
  const stored = useModelStoreState((s) => s.models);
  const error = useModelStoreState((s) => s.error);
  const refresh = useModelStoreState((s) => s.refresh);
  const addModel = useModelsStore((s) => s.addModel);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [versions, setVersions] = useState<{ name: string; list: StoredVersion[] } | null>(null);

  useEffect(() => {
    void refresh(root);
  }, [root, refresh]);

  const open = async (m: StoredModel) => {
    if (!root) { setMessage('Open the project database first: models are opened from its model store.'); return; }
    setBusy(m.name);
    setMessage(`Opening ${m.name}…`);
    try {
      // The 3D viewer starts in the background; if it never does, say so rather than wait for ever.
      const stuck = new Promise<never>((_, no) => window.setTimeout(() => no(new Error(`${m.name} did not open: the 3D viewer did not answer. Reload the page and try again.`)), 90000));
      const { info, fast } = await Promise.race([loadStoredModel(engine, root, m.name, m.ifcHash), stuck]);
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
    if (!root) return;
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
    if (!root) return;
    if (!window.confirm(`Remove ${m.name} from the project's model store? Its stored IFC, converted copy and earlier versions are deleted (loaded models stay).`)) return;
    await deleteStoredModel(root, m.name);
    void refresh(root);
  };

  const showVersions = async (m: StoredModel) => {
    if (!root) return;
    setVersions(versions?.name === m.name ? null : { name: m.name, list: await listStoredVersions(root, m.name) });
  };

  const restore = async (name: string, v: StoredVersion) => {
    if (!root) return;
    if (!window.confirm(`Make the version of ${new Date(v.createdAt).toLocaleString()} the current ${name}? The current one goes to the history.`)) return;
    await restoreStoredVersion(root, name, v.id);
    setVersions(null);
    setMessage(`${name}: restored. Open it again from here (a loaded copy of the model is not replaced).`);
    void refresh(root);
  };

  return { stored, error, busy, message, versions, open, exportIfc, remove, showVersions, restore };
}

/** The message after an open / restore, and the earlier versions of the model whose count was clicked. */
export function StoredModelsNotes({ actions }: { actions: ReturnType<typeof useStoredModels> }) {
  const { error, message, versions, restore } = actions;
  return (
    <>
      {error && <div className="inputs-panel__error">{error}</div>}
      {message && <div className="scn-dim" style={{ padding: '4px 0' }}>{message}</div>}
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
    </>
  );
}

/** Whether a project folder (and so a model store) is open. */
export const modelStoreOpen = () => dbRoot() !== null;
