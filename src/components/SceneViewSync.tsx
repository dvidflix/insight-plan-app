import { useEffect, useRef } from 'react';
import type { ViewerEngine } from '../viewer/ViewerEngine';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useProjectDbStore } from '../state/projectDbStore';
import { useSelectionStore } from '../state/selectionStore';
import { useSequenceTimelineStore } from '../state/sequenceTimelineStore';
import { restoreStatus } from '../state/restoreStatus';
import { SCENE_VIEW_KEY, applySceneShared, applySceneView, captureSceneView, readSceneView, type SceneViewState } from '../viewer/sceneViewState';

const cameraControls = (engine: ViewerEngine) => engine.world.camera.controls;

/** Keeps the 3D view's own state in the scene (see viewer/sceneViewState.ts): saved a moment after it changes, put back once the scene's models are loaded
    (and the split's second view, when it opens). Nothing is saved before that, so a scene is never overwritten by the empty view of a page that is still loading. */
export function SceneViewSync() {
  const engine = useViewerEngine();
  const root = useProjectDbStore((s) => s.db?.root ?? null);
  const models = useModelsStore((s) => s.models);
  const ready = useRef(false);
  const modelCount = useRef(models.length);
  modelCount.current = models.length;

  // Saving.
  useEffect(() => {
    let timer: number | undefined;
    let last = localStorage.getItem(SCENE_VIEW_KEY);
    const save = () => {
      window.clearTimeout(timer);
      if (!ready.current) return;
      try {
        const text = JSON.stringify(captureSceneView(engine));
        if (text === last) return;
        last = text;
        localStorage.setItem(SCENE_VIEW_KEY, text);
      } catch {
        // storage full or the view not ready: try at the next change
      }
    };
    const later = () => { window.clearTimeout(timer); timer = window.setTimeout(save, 800); };
    // The camera is there once the engine has started (it starts after the first render).
    let controls: ReturnType<typeof cameraControls> | undefined;
    let secondControls = engine.secondary?.overlayWorld.camera.controls;
    secondControls?.addEventListener('sleep', later);
    let gone = false;
    void engine.ready.then(() => {
      if (gone) return;
      controls = cameraControls(engine);
      controls.addEventListener('sleep', later);
    });
    const onSecond = () => {
      secondControls?.removeEventListener('sleep', later);
      secondControls = engine.secondary?.overlayWorld.camera.controls;
      secondControls?.addEventListener('sleep', later);
      later();
    };
    const events = [engine.onVisibilityChange, engine.onExternalVisibilityChange, engine.onInteractionModeChange, engine.onRevealPinChange, engine.onXrayChange];
    for (const e of events) e.add(later);
    engine.onSecondaryChange.add(onSecond);
    const unsubs = [useSelectionStore.subscribe(later), useSequenceTimelineStore.subscribe(later), useModelsStore.subscribe(later)];
    // A scene switch or a close saves at once (scenes.ts asks before it takes its snapshot, and not while it is switching, so the other scene's view is never overwritten).
    window.addEventListener('ip-scene-flush', save);
    return () => {
      gone = true;
      window.clearTimeout(timer);
      for (const e of events) e.remove(later);
      engine.onSecondaryChange.remove(onSecond);
      controls?.removeEventListener('sleep', later);
      secondControls?.removeEventListener('sleep', later);
      for (const u of unsubs) u();
      window.removeEventListener('ip-scene-flush', save);
    };
  }, [engine]);

  // Restoring: once the project's models are back (they load a moment after the page) and no more are arriving.
  useEffect(() => {
    const saved: SceneViewState | null = readSceneView();
    let cancelled = false;
    let settle: number | undefined;
    let appliedSecond = false;
    const applySecond = () => {
      if (!saved || appliedSecond || !engine.secondary) return;
      appliedSecond = true;
      void applySceneView(engine, saved, 'second').catch(() => undefined);
    };
    const run = async () => {
      if (cancelled || ready.current) return;
      try {
        if (saved && modelCount.current > 0) {
          await applySceneShared(engine, saved);
          await applySceneView(engine, saved, 'main');
          applySecond();
        }
      } catch (e) {
        console.warn('Restoring the scene’s 3D view failed', e);
      } finally {
        ready.current = true;
      }
    };
    // Waits for the model count to hold still for a moment.
    let seen = -1;
    const poll = () => {
      window.clearTimeout(settle);
      if (cancelled) return;
      const ok = !root || restoreStatus.done(root);
      if (ok && modelCount.current === seen) { void run(); return; }
      seen = ok ? modelCount.current : -1;
      settle = window.setTimeout(poll, 1200);
    };
    // Without a project there is nothing to restore the models from: nothing to put back either, saving starts at once.
    if (!root) ready.current = true;
    else poll();
    engine.onSecondaryChange.add(applySecond);
    return () => { cancelled = true; window.clearTimeout(settle); engine.onSecondaryChange.remove(applySecond); };
  }, [engine, root]);

  return null;
}
