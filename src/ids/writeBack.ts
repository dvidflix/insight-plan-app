import type { ViewerEngine } from '../viewer/ViewerEngine';
import { useModelsStore } from '../state/modelsStore';
import { useModelPlacementStore } from '../state/modelPlacementStore';
import { ensureModelFile, rememberModelFile, rememberStoredHash } from '../state/modelFiles';
import { saveStoredIfc } from '../db/modelsApi';
import { storeConverted } from '../viewer/modelStore';
import { useModelStoreState } from '../state/modelStoreState';
import { dbRoot } from '../state/projectDbStore';
import { downloadBlob } from '../utils/download';
import type { ApplyResult } from './patches';

/** Writing an edited model back: the IFC is saved as <name>_FIXED.ifc
    (into the project folder's models/edited when a project is open, else
    downloaded) with a JSON log of what changed beside it, and loaded in
    place of the model it came from (keeping its placement). The original
    file is never touched; a _FIXED file written again can be kept as a
    timestamped backup. Shared by Model checks' patches and the Properties
    tab's property editor. */

export const fixedName = (name: string) => name.replace(/(_FIXED)?\.ifc$/i, '_FIXED.ifc');

async function post<T>(path: string, body: BodyInit, json = true): Promise<T> {
  const res = await fetch(`/api/ids/${path}`, { method: 'POST', headers: json ? { 'Content-Type': 'application/json' } : undefined, body });
  const out = await res.json().catch(() => null);
  if (!res.ok) throw new Error(out?.error ?? (res.status === 404 ? 'Saving needs the app running with Autorun.bat / npm run dev.' : `Request failed (${res.status}).`));
  return out as T;
}

export async function postIds<T>(path: string, body: BodyInit, json = true): Promise<T> {
  return post<T>(path, body, json);
}

/** Edits one loaded model's IFC with `edit`, saves and reloads it. Returns
    a one-line report. `log` is merged into the saved change log. */
export async function writeBackModel(engine: ViewerEngine, modelId: string, edit: (text: string) => ApplyResult, log: Record<string, unknown>, backup = true): Promise<string> {
  const info = useModelsStore.getState().models.find((m) => m.modelId === modelId);
  const source = info ? await ensureModelFile(info.name, dbRoot()) : null;
  if (!info || !source) return `${info?.name ?? modelId}: its IFC isn't at hand — load the .ifc again from Inputs (a .frag or an earlier session's model can't be written back).`;
  const result = edit(await source.text());
  if (result.applied.length === 0) return `${info.name}: nothing changed${result.failed[0] ? ` (${result.failed[0].why})` : ''}.`;

  const name = fixedName(info.name);
  const bytes = new TextEncoder().encode(result.text);
  const record = {
    ...log,
    source: info.name,
    output: name,
    schema: result.schema,
    writtenAt: new Date().toISOString(),
    notes: result.notes,
    changed: result.applied.map((c) => ({ guid: c.guid, from: c.from || undefined, to: c.to, value: c.value })),
    notChanged: result.failed.map((f) => ({ guid: f.change.guid, why: f.why })),
  };
  const root = dbRoot();
  let where = 'downloaded';
  if (root) {
    const q = `root=${encodeURIComponent(root)}&name=${encodeURIComponent(name)}${backup ? '&backup=1' : ''}`;
    const saved = await post<{ path: string; backup?: string }>(`model?${q}`, new Blob([bytes]), false);
    await post(`log?root=${encodeURIComponent(root)}&name=${encodeURIComponent(name.replace(/\.ifc$/i, `.${Date.now()}.log.json`))}`, JSON.stringify(record));
    where = `saved to ${saved.path}${saved.backup ? ` (previous copy kept as ${saved.backup})` : ''}`;
  } else {
    downloadBlob(name, new Blob([bytes], { type: 'application/octet-stream' }));
  }

  // With a project folder open the edited IFC also becomes the model's current IFC in the model store
  // (the one before it stays in the history), so an export or a later open has the edits.
  let storedHash: string | null = null;
  if (root) {
    try {
      const saved = await saveStoredIfc(root, info.name, bytes, `Edited in the app: ${result.applied.length} changed`);
      storedHash = saved.hash;
      rememberStoredHash(info.name, saved.hash);
      where += '; kept in the model store';
    } catch (e) {
      where += `; NOT kept in the model store (${e instanceof Error ? e.message : String(e)})`;
    }
  }

  // Swap the model: the fixed one takes the original's placement.
  const placement = useModelPlacementStore.getState();
  if (placement.offsets[info.name] && !placement.offsets[name]) placement.setOffset(name, placement.offsets[info.name]);
  await engine.removeModel(modelId);
  useModelsStore.getState().removeModel(modelId);
  const file = new File([bytes], name);
  const loaded = await engine.loadIfc(await file.arrayBuffer(), name);
  useModelsStore.getState().addModel(loaded);
  rememberModelFile(file);
  if (root && storedHash) void storeConverted(engine, root, info.name, storedHash, loaded.modelId).then(() => useModelStoreState.getState().refresh(root)).catch(() => {});
  return `${info.name}: ${result.applied.length} changed${result.failed.length ? `, ${result.failed.length} not (see the log)` : ''}. ${result.notes.join(' ')} → ${name}, ${where}.`;
}
