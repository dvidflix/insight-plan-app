import type { ViewerEngine } from './ViewerEngine';
import type { LoadedModelInfo } from './types';
import { getStoredFrag, getStoredIfc, saveStoredFrag, saveStoredIfc } from '../db/modelsApi';
import { rememberModelFile, rememberStoredHash } from '../state/modelFiles';

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
export async function loadStoredModel(engine: ViewerEngine, root: string, name: string, ifcHash: string): Promise<{ info: LoadedModelInfo; fast: boolean }> {
  rememberStoredHash(name, ifcHash);
  const cached = await getStoredFrag(root, name);
  if (cached) {
    const info = await engine.loadFrag(cached.buffer, name);
    if (cached.layers.length) engine.setLayers(info.modelId, cached.layers);
    else void getStoredIfc(root, name).then((bytes) => engine.attachLayers(info.modelId, new Uint8Array(bytes))).catch(() => {});
    return { info, fast: true };
  }
  const ifc = await getStoredIfc(root, name);
  const info = await engine.loadIfc(ifc, name);
  rememberModelFile(new File([ifc], name));
  void storeConverted(engine, root, name, ifcHash, info.modelId).catch(() => {});
  return { info, fast: false };
}
