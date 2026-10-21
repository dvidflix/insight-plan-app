import type { ViewerEngine } from './ViewerEngine';
import type { LoadedModelInfo } from './types';
import { getStoredFrag, getStoredIfc, saveStoredFrag, saveStoredIfc } from '../db/modelsApi';
import { rememberModelFile, rememberStoredHash } from '../state/modelFiles';
import { useModelLoadStore } from '../state/modelLoadStore';

/** Putting models into the project's model store and opening them from it.
    The store keeps each model's IFC (the source of truth, what an export gives
    back) and a converted .frag that opening uses to skip the conversion. */

/** Keeps a model just loaded from an IFC: the IFC, then (in the background) its converted copy. */
export async function storeLoadedIfc(engine: ViewerEngine, root: string, name: string, ifc: ArrayBuffer, modelId: string, note?: string) {
  const { hash } = await saveStoredIfc(root, name, ifc, note);
  rememberStoredHash(name, hash);
  await storeConverted(engine, root, name, hash, modelId);
}

/** The loaded model's converted copy, filed against the stored IFC with that hash. */
export async function storeConverted(engine: ViewerEngine, root: string, name: string, hash: string, modelId: string) {
  const exported = await engine.exportModel(modelId);
  if (exported) await saveStoredFrag(root, name, hash, exported.buffer, exported.layers);
}

/** Opens a stored model: from its converted copy when one fits, else from the IFC (and keeps the converted copy for next time). */
async function loadStoredModelNow(engine: ViewerEngine, root: string, name: string, ifcHash: string): Promise<{ info: LoadedModelInfo; fast: boolean }> {
  rememberStoredHash(name, ifcHash);
  const log = useModelLoadStore.getState();
  log.begin(name, 'from the project model store', 0);
  log.step(name, 'Looking for the converted copy in the project database');
  const cached = await getStoredFrag(root, name);
  if (cached) {
    log.note(name, `Found the converted copy (${(cached.buffer.byteLength / 1024 / 1024).toFixed(1)} MB)`);
    const info = await engine.loadFrag(cached.buffer, name);
    if (cached.layers.length) engine.setLayers(info.modelId, cached.layers);
    else void getStoredIfc(root, name).then((bytes) => engine.attachLayers(info.modelId, new Uint8Array(bytes))).catch(() => {});
    return { info, fast: true };
  }
  log.step(name, 'No converted copy: reading the stored IFC from the project database');
  const ifc = await getStoredIfc(root, name);
  log.note(name, `Read the stored IFC (${(ifc.byteLength / 1024 / 1024).toFixed(1)} MB): it has to be converted first`);
  const info = await engine.loadIfc(ifc, name);
  rememberModelFile(new File([ifc], name));
  void storeConverted(engine, root, name, ifcHash, info.modelId).catch(() => {});
  return { info, fast: false };
}

export async function loadStoredModel(engine: ViewerEngine, root: string, name: string, ifcHash: string): Promise<{ info: LoadedModelInfo; fast: boolean }> {
  try {
    return await loadStoredModelNow(engine, root, name, ifcHash);
  } catch (e) {
    useModelLoadStore.getState().fail(name, e); // (a failure before the viewer took over)
    throw e;
  }
}
