import * as THREE from 'three';
import type { InteractionMode, ViewerEngine, ViewId } from './ViewerEngine';
import { useModelsStore } from '../state/modelsStore';
import { useSequenceTimelineStore } from '../state/sequenceTimelineStore';

/** What a scene keeps of the 3D view itself, beyond the settings stores: the cameras, what Hide / Isolate left out in each view, the selection,
    each view's Select / Isolate / Ghost mode and Pin, X-ray and the 4D date. It is one browser key, so the scene's snapshot carries it like any
    other layout key (state/scenes.ts), and it is put back once the scene's models are loaded (components/SceneViewSync.tsx).
    Models are named by file name, not by id: ids are new at every load. */
export const SCENE_VIEW_KEY = 'viewer.sceneState';

interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  ortho: boolean;
  zoom: number;
}
interface ViewState {
  mode: InteractionMode;
  /** Select or Isolate under Ghost. */
  base?: 'select' | 'isolate';
  pinned: boolean;
  /** Hidden by Hide / Isolate: ids as ranges ("5-9,12"), per model name. */
  hidden: Record<string, string>;
  /** After a hide-everything: the only ones shown (null: not in that state). */
  only: Record<string, string> | null;
  camera?: CameraState;
}
export interface SceneViewState {
  v: 1;
  views: Record<ViewId, ViewState>;
  selection: Record<string, string>;
  xray: boolean;
  timeline?: { date: number; basis: 'planned' | 'actual' };
}

// ---- ids as ranges: a big isolated set stays small in the browser's storage ----
const encode = (ids: number[]) => {
  const sorted = [...ids].sort((a, b) => a - b);
  const out: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return out.join(',');
};
const decode = (text: string) => {
  const out: number[] = [];
  for (const part of text.split(',')) {
    if (!part) continue;
    const [a, b] = part.split('-').map(Number);
    if (!Number.isFinite(a)) continue;
    for (let n = a; n <= (Number.isFinite(b) ? b : a); n++) out.push(n);
  }
  return out;
};

type World = ViewerEngine['world'];
const cameraOf = (world: World | undefined): CameraState | undefined => {
  if (!world) return undefined;
  const position = new THREE.Vector3();
  const target = new THREE.Vector3();
  world.camera.controls.getPosition(position);
  world.camera.controls.getTarget(target);
  return { position: position.toArray(), target: target.toArray(), ortho: world.camera.projection.current !== 'Perspective', zoom: world.camera.three.zoom };
};

const names = () => {
  const models = useModelsStore.getState().models;
  return { byId: new Map(models.map((m) => [m.modelId, m.name])), byName: new Map(models.map((m) => [m.name, m.modelId])) };
};

/** The 3D view as it is now. */
export function captureSceneView(engine: ViewerEngine): SceneViewState {
  const { byId } = names();
  const rename = (r: Record<string, number[]>) => {
    const out: Record<string, string> = {};
    for (const [id, ids] of Object.entries(r)) {
      const name = byId.get(id);
      if (name && ids.length) out[name] = encode(ids);
    }
    return out;
  };
  const vis = engine.getVisibilityState();
  const view = (id: ViewId): ViewState => ({
    mode: engine.getInteractionMode(id),
    base: engine.getBaseMode(id),
    pinned: engine.isRevealPinned(id),
    hidden: rename(vis[id].hidden),
    only: vis[id].only ? rename(vis[id].only!) : null,
    camera: cameraOf(id === 'main' ? engine.world : engine.secondary?.overlayWorld),
  });
  const selection: Record<string, number[]> = {};
  for (const [id, ids] of Object.entries(engine.highlighter.selection.select)) if (ids.size) selection[id] = [...ids];
  const t = useSequenceTimelineStore.getState();
  return {
    v: 1,
    views: { main: view('main'), second: view('second') },
    selection: rename(selection),
    xray: engine.isXray(),
    ...(t.date !== null ? { timeline: { date: t.date, basis: t.basis } } : {}),
  };
}

export function readSceneView(): SceneViewState | null {
  try {
    const v = JSON.parse(localStorage.getItem(SCENE_VIEW_KEY) ?? 'null') as SceneViewState | null;
    return v && v.v === 1 && v.views ? v : null;
  } catch {
    return null;
  }
}

async function applyCamera(world: World | undefined, c: CameraState | undefined) {
  if (!world || !c) return;
  world.camera.projection.set(c.ortho ? 'Orthographic' : 'Perspective');
  await world.camera.controls.setLookAt(...c.position, ...c.target, false);
  if (c.ortho && c.zoom > 0) await world.camera.controls.zoomTo(c.zoom, false);
}

/** Puts the selection, X-ray and the 4D date back (once the models are loaded). */
export async function applySceneShared(engine: ViewerEngine, s: SceneViewState) {
  const { byName } = names();
  const ids: Record<string, number[]> = {};
  for (const [name, text] of Object.entries(s.selection)) {
    const id = byName.get(name);
    if (id) ids[id] = decode(text);
  }
  if (Object.keys(ids).length) await engine.selectElements(ids, false);
  engine.setXray(!!s.xray);
  if (s.timeline) {
    const t = useSequenceTimelineStore.getState();
    t.setBasis(s.timeline.basis);
    t.setDate(s.timeline.date);
  }
}

/** Puts one view back: its mode and pin, what it had hidden, its camera. */
export async function applySceneView(engine: ViewerEngine, s: SceneViewState, view: ViewId) {
  const st = s.views[view];
  if (!st || (view === 'second' && !engine.secondary)) return;
  const { byName } = names();
  const back = (r: Record<string, string>) => {
    const out: Record<string, number[]> = {};
    for (const [name, text] of Object.entries(r)) {
      const id = byName.get(name);
      if (id) out[id] = decode(text);
    }
    return out;
  };
  if (st.mode !== 'select') await engine.setInteractionMode(st.mode, view, st.base);
  if (st.pinned) await engine.setRevealPinned(true, view);
  // The exact Hide / Isolate state last: a pinned set is not always the selection.
  if (st.only || Object.keys(st.hidden).length) await engine.restoreVisibility(view, { hidden: back(st.hidden), only: st.only ? back(st.only) : null });
  await applyCamera(view === 'main' ? engine.world : engine.secondary?.overlayWorld, st.camera);
}
