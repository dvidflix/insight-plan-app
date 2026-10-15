import { useEffect, useReducer } from 'react';
import * as OBC from '@thatopen/components';
import type { ViewerEngine, ViewerStyle } from './ViewerEngine';
import { LEGACY_SAVED_VIEW_ATTRS, useSavedViewAttrsStore, type SavedViewAttr } from '../state/savedViewAttrsStore';
import { useViewSettingsStore, type ViewSettings } from '../state/viewSettingsStore';
import { useModelPlacementStore, type Offset } from '../state/modelPlacementStore';
import { useSequenceTimelineStore } from '../state/sequenceTimelineStore';
import { useModelsStore } from '../state/modelsStore';
import { useViewpointStore } from '../state/viewpointStore';

/** Viewpoints (Views > Viewpoints): the camera plus whichever attributes are
    ticked in Views > Viewpoint attributes — what the Hider has hidden, the
    Clipper's planes, the style, display settings, model placement, the
    selection and, on 4D Sequencing, the timeline position. Held as
    @thatopen/components Viewpoints (so they go into BCF topics); what the
    library has no field for rides in `customData`, and the thumbnail is the
    library's snapshot (it goes into a BCF export too). */

export interface ViewpointData {
  attrs?: Partial<Record<SavedViewAttr, boolean>>;
  style?: ViewerStyle;
  display?: Partial<ViewSettings>;
  placement?: { offsets: Record<string, Offset>; storeySlides: Record<string, number> };
  timeline?: { date: number; basis: 'planned' | 'actual' };
  /** The folder it is filed in (Views > Viewpoints); none: not in a folder. */
  folder?: string;
  /** Names of the models loaded when it was taken: it is kept with them. */
  models?: string[];
}

export const dataOf = (vp: OBC.Viewpoint) => vp.customData as ViewpointData;
export const attrsOf = (vp: OBC.Viewpoint): Record<SavedViewAttr, boolean> => ({ ...LEGACY_SAVED_VIEW_ATTRS, ...(dataOf(vp).attrs ?? {}) });
export const viewpointTitle = (vp: OBC.Viewpoint) => vp.title?.trim() || 'Viewpoint';

// ---- thumbnails ----------------------------------------------------------

const thumbs = new Map<string, string>();

/** The thumbnail as a displayable URL (made once per picture), or null when the viewpoint has none. */
export function thumbnailUrl(engine: ViewerEngine, vp: OBC.Viewpoint): string | null {
  const cached = thumbs.get(vp.guid);
  if (cached) return cached;
  const bytes = vp.snapshot ? engine.viewpoints.snapshots.get(vp.snapshot) : undefined;
  if (!bytes) return null;
  const type = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  thumbs.set(vp.guid, url);
  return url;
}

async function takeThumbnail(engine: ViewerEngine, vp: OBC.Viewpoint) {
  const bytes = await engine.captureThumbnail();
  if (!bytes) return;
  vp.snapshot ||= `${vp.guid}.jpeg`;
  engine.viewpoints.snapshots.set(vp.snapshot, bytes);
  const old = thumbs.get(vp.guid);
  if (old) URL.revokeObjectURL(old);
  thumbs.delete(vp.guid);
}

// ---- kept with the models --------------------------------------------------

const loadedModelNames = () => [...new Set(useModelsStore.getState().models.map((m) => m.name))];

const toBase64 = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Writes `vp` to the saved viewpoints (the app configuration), so it is still there after a reload. */
function persistViewpoint(engine: ViewerEngine, vp: OBC.Viewpoint) {
  const bytes = vp.snapshot ? engine.viewpoints.snapshots.get(vp.snapshot) : undefined;
  const data = dataOf(vp);
  useViewpointStore.getState().upsert({
    guid: vp.guid,
    bcf: { ...vp.toJSON(), title: vp.title },
    data: JSON.parse(JSON.stringify(data)),
    models: data.models ?? [],
    snapshot: bytes ? toBase64(bytes) : undefined,
  });
}

/** Brings the saved viewpoints of the loaded models back, and sets aside the ones of models that are not loaded.
    Call it whenever the loaded models change. */
export function syncViewpoints(engine: ViewerEngine) {
  const loaded = new Set(loadedModelNames());
  const fits = (names: string[]) => names.every((n) => loaded.has(n));
  const { list, snapshots } = engine.viewpoints;
  for (const vp of [...list.values()]) {
    if (!fits(dataOf(vp).models ?? [])) list.delete(vp.guid);
  }
  for (const r of useViewpointStore.getState().records) {
    if (list.has(r.guid) || !fits(r.models)) continue;
    const vp = engine.viewpoints.create(r.bcf);
    vp.title = r.bcf.title;
    vp.customData = { ...r.data };
    if (r.snapshot) {
      vp.snapshot = `${vp.guid}.jpeg`;
      snapshots.set(vp.snapshot, fromBase64(r.snapshot));
    }
    vp.go = (config) => openViewpoint(engine, vp, config?.transition ?? true);
    list.set(vp.guid, vp);
  }
}

// ---- save / update / open / delete ---------------------------------------

/** Writes the current state of the viewer into `vp`, with the attributes ticked now. */
async function fillViewpoint(engine: ViewerEngine, vp: OBC.Viewpoint) {
  const { components, highlighter, hider } = engine;
  const fragments = components.get(OBC.FragmentsManager);
  const settings = useViewSettingsStore.getState();
  const page = settings.activePage;
  const main = settings.pages[page].main;
  const attrs = { ...useSavedViewAttrsStore.getState().attrs };
  // Timeline position only means something on 4D Sequencing.
  if (page !== 'sequence') attrs.timeline = false;

  await vp.updateCamera(true);
  const before = vp.customData as ViewpointData | undefined;
  vp.customData = { attrs, models: loadedModelNames(), ...(before?.folder ? { folder: before.folder } : {}) } satisfies ViewpointData;
  const data = vp.customData as ViewpointData;
  vp.defaultVisibility = true;
  vp.exceptionComponents.clear();
  vp.selectionComponents.clear();
  if (attrs.visibility) {
    const hidden = await hider.getVisibilityMap(false);
    const hiddenMap: OBC.ModelIdMap = {};
    for (const [modelId, ids] of Object.entries(hidden)) if (ids.length) hiddenMap[modelId] = new Set(ids);
    if (!OBC.ModelIdMapUtils.isEmpty(hiddenMap)) {
      for (const guid of await fragments.modelIdMapToGuids(hiddenMap)) vp.exceptionComponents.add(guid);
    }
  }
  if (attrs.selection) {
    const selected = highlighter.selection.select;
    if (!OBC.ModelIdMapUtils.isEmpty(selected)) {
      for (const guid of await fragments.modelIdMapToGuids(selected)) vp.selectionComponents.add(guid);
    }
  }
  if (attrs.sections) vp.updateClippingPlanes();
  if (attrs.style) data.style = main.style;
  if (attrs.display) {
    const display: Partial<ViewSettings> = { ...main };
    delete display.storeySlides;
    delete display.hiddenModels;
    delete display.style;
    data.display = display;
  }
  if (attrs.placement) data.placement = { offsets: { ...useModelPlacementStore.getState().offsets }, storeySlides: { ...main.storeySlides } };
  if (attrs.timeline) {
    const t = useSequenceTimelineStore.getState();
    if (t.date !== null) data.timeline = { date: t.date, basis: t.basis };
    else attrs.timeline = false;
  }
  await takeThumbnail(engine, vp);
}

/** A new viewpoint of the viewer as it is now. */
export async function createViewpoint(engine: ViewerEngine): Promise<OBC.Viewpoint> {
  const { viewpoints } = engine;
  const vp = viewpoints.create();
  const taken = [...viewpoints.list.values()].map((v) => Number(/^Viewpoint (\d+)$/.exec(v.title ?? '')?.[1] ?? 0));
  vp.title = `Viewpoint ${Math.max(0, ...taken) + 1}`;
  await fillViewpoint(engine, vp);
  // The library's own "go to" calls go(); open with the saved attributes instead.
  vp.go = (config) => openViewpoint(engine, vp, config?.transition ?? true);
  viewpoints.list.set(vp.guid, vp);
  persistViewpoint(engine, vp);
  return vp;
}

/** Re-takes `vp` from the viewer as it is now (same name), with the attributes ticked now. */
export async function updateViewpoint(engine: ViewerEngine, vp: OBC.Viewpoint) {
  await fillViewpoint(engine, vp);
  engine.viewpoints.list.set(vp.guid, vp);
  persistViewpoint(engine, vp);
}

export function renameViewpoint(engine: ViewerEngine, vp: OBC.Viewpoint, title: string) {
  vp.title = title.trim() || viewpointTitle(vp);
  engine.viewpoints.list.set(vp.guid, vp);
  persistViewpoint(engine, vp);
}

/** Files `vp` in a folder ('' takes it out of any). */
export function setViewpointFolder(engine: ViewerEngine, vp: OBC.Viewpoint, folder: string) {
  const data = dataOf(vp);
  if (folder) data.folder = folder;
  else delete data.folder;
  engine.viewpoints.list.set(vp.guid, vp);
  persistViewpoint(engine, vp);
}

export function deleteViewpoint(engine: ViewerEngine, vp: OBC.Viewpoint) {
  const url = thumbs.get(vp.guid);
  if (url) URL.revokeObjectURL(url);
  thumbs.delete(vp.guid);
  if (vp.snapshot) engine.viewpoints.snapshots.delete(vp.snapshot);
  engine.viewpoints.list.delete(vp.guid);
  useViewpointStore.getState().remove(vp.guid);
}

/** Opens a viewpoint, bringing back only the attributes it was saved with.
    Style, display settings and placement go through the settings stores, so
    the panels follow; the rest ride in the viewpoint's customData. */
export async function openViewpoint(engine: ViewerEngine, vp: OBC.Viewpoint, transition = true) {
  const { highlighter } = engine;
  const a = attrsOf(vp);
  const data = dataOf(vp);
  const settings = useViewSettingsStore.getState();
  const page = settings.activePage;
  const jobs: Promise<unknown>[] = [];
  // The viewer shows the frame it had until the new state is complete: applying visibility, style and colours goes in steps (all
  // shown, then the hidden ones taken out, the colours put back a moment later), and drawing in between flashed the whole
  // building in its own colours.
  const renderer = engine.world.renderer;
  const wasOn = renderer ? renderer.enabled : true;
  if (renderer) renderer.enabled = false;
  try {
    if (a.sections) {
      vp.setClippingState(true);
      vp.setClippingVisibility(true);
    }
    if (a.visibility) jobs.push(vp.applyVisibility().then(() => engine.onExternalVisibilityChange.trigger()));
    if (a.selection && vp.selectionComponents.size > 0) {
      jobs.push(vp.getSelectionMap().then((map) => highlighter.highlightByID('select', map, true, false)));
    }
    const patch: Partial<ViewSettings> = {};
    if (a.style && data.style) patch.style = data.style;
    if (a.display && data.display) Object.assign(patch, data.display);
    if (a.placement && data.placement) {
      patch.storeySlides = { ...data.placement.storeySlides };
      const { setOffset } = useModelPlacementStore.getState();
      for (const [name, offset] of Object.entries(data.placement.offsets)) setOffset(name, offset);
    }
    if (Object.keys(patch).length) settings.patch(page, 'main', patch);
    if (a.timeline && data.timeline && page === 'sequence') {
      const t = useSequenceTimelineStore.getState();
      t.setPlaying(false);
      t.setBasis(data.timeline.basis);
      t.setDate(data.timeline.date);
    }
    await Promise.all(jobs);
    // The colours and the 4D appearance are put back by effects that run after the state changes: let them finish first.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(resolve, 120))));
  } finally {
    if (renderer) {
      renderer.enabled = wasOn;
      renderer.needsUpdate = true;
    }
  }
  // The camera last, so its move (or its jump) is drawn with the new state.
  if (a.camera) {
    const camera = engine.world.camera;
    camera.projection.set(vp.projection);
    const p = vp.position;
    const d = vp.direction;
    await camera.controls.setLookAt(p.x, p.y, p.z, p.x + d.x * 80, p.y + d.y * 80, p.z + d.z * 80, transition);
  }
}

/** The viewpoints, in creation order; re-renders when they change (added, updated, renamed, deleted, BCF import). */
export function useViewpoints(engine: ViewerEngine): OBC.Viewpoint[] {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const list = engine.viewpoints.list;
    list.onItemSet.add(bump);
    list.onItemDeleted.add(bump);
    list.onItemUpdated.add(bump);
    list.onCleared.add(bump);
    return () => {
      list.onItemSet.remove(bump);
      list.onItemDeleted.remove(bump);
      list.onItemUpdated.remove(bump);
      list.onCleared.remove(bump);
    };
  }, [engine]);
  return [...engine.viewpoints.list.values()];
}
