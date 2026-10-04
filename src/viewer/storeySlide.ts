import type * as FRAGS from '@thatopen/fragments';

export interface Storey {
  name: string;
  ids: number[];
}

/** Where each element of a model sat before any storey slide, along fragments'
    own vertical axis, so a slide is always absolute (never accumulates). */
export type BaseHeights = Map<number, number>;

/** Lifts storey n by n x `step` metres (storeys in spatial-tree order, lowest
    first) by editing each element's placement in `core`'s copy of the model.
    Step 0 puts everything back. The edited elements are then drawn by a
    separate delta model (`model.deltaModelId`). Returns whether anything moved. */
export async function slideStoreys(core: FRAGS.FragmentsModels, modelId: string, storeys: Storey[], step: number, bases: BaseHeights): Promise<boolean> {
  const lift = new Map<number, number>();
  storeys.forEach((s, i) => { for (const id of s.ids) lift.set(id, i * step); });
  const ids = [...lift.keys()];
  if (ids.length === 0 || (step === 0 && bases.size === 0)) return false;

  const editor = core.editor;
  const elements = await editor.getElements(modelId, ids);
  const requests: FRAGS.EditRequest[] = [];
  const moves: { el: (typeof elements)[number]; delta: number }[] = [];
  for (const el of elements) {
    const gt = Object.values(el.core.globalTransforms)[0];
    if (!gt) continue;
    if (!bases.has(el.localId)) bases.set(el.localId, gt.position[1]);
    const delta = bases.get(el.localId)! + (lift.get(el.localId) ?? 0) - gt.position[1];
    if (Math.abs(delta) >= 1e-6) moves.push({ el, delta });
  }
  // Each element's mesh round-trip goes to the worker; a chunk at a time keeps big models quick.
  const CHUNK = 64;
  for (let i = 0; i < moves.length; i += CHUNK) {
    await Promise.all(
      moves.slice(i, i + CHUNK).map(async ({ el, delta }) => {
        const meshes = await el.getMeshes();
        meshes.position.y += delta;
        await el.setMeshes(meshes);
      }),
    );
  }
  for (const { el } of moves) requests.push(...(el.getRequests() ?? []));
  if (requests.length === 0) return false;
  await editor.edit(modelId, requests);
  await core.update(true);
  return true;
}

/** The models that actually draw a (possibly edited) model: itself and its delta. */
export function renderTargets(core: FRAGS.FragmentsModels, model: FRAGS.FragmentsModel): FRAGS.FragmentsModel[] {
  const delta = model.deltaModelId ? core.models.list.get(model.deltaModelId) : undefined;
  return delta ? [model, delta] : [model];
}
