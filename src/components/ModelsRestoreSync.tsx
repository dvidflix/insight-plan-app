import { useEffect, useRef, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useModelStoreState } from '../state/modelStoreState';
import { useProjectDbStore } from '../state/projectDbStore';
import { fetchSettings, saveSetting } from '../db/api';
import { loadStoredModel } from '../viewer/modelStore';
import { restoreStatus } from '../state/restoreStatus';
import { setActiveLinked } from '../state/sceneModels';

const KEY = 'loadedModels';
/** The scene's own copy of the list (a browser key, so each scene saves and brings back its own models); the project database's list is the
    fallback for a scene that has none yet. */
const SCENE_KEY = 'models.loaded';
const sceneList = (): string[] | null => {
  try {
    const v = JSON.parse(localStorage.getItem(SCENE_KEY) ?? 'null');
    return Array.isArray(v) ? (v as string[]) : null;
  } catch { return null; }
};

/** Browser edition: opens the models that were loaded when the project was last used (from the model store, so from their
    converted copies), and keeps that list in the project database as models are loaded and removed. */
export function ModelsRestoreSync({ enabled = true }: { /** False: not yet (a second window waits until it shows a page with the 3D view). */ enabled?: boolean }) {
  const engine = useViewerEngine();
  const root = useProjectDbStore((s) => s.db?.root ?? null);
  const models = useModelsStore((s) => s.models);
  const stored = useModelStoreState((s) => s.models);
  const started = useRef<string | null>(null);
  const failed = useRef<string[]>([]);
  const [restoredFor, setRestoredFor] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !root || started.current === root) return;
    started.current = root;
    void (async () => {
      try {
        const names = sceneList() ?? (await fetchSettings(root))[KEY];
        await useModelStoreState.getState().refresh(root);
        for (const name of Array.isArray(names) ? (names as string[]) : []) {
          try {
            const m = useModelStoreState.getState().models.find((x) => x.name === name);
            if (!m || useModelsStore.getState().models.some((x) => x.name === name)) continue;
            const { info } = await loadStoredModel(engine, root, m.name, m.ifcHash);
            useModelsStore.getState().addModel(info);
          } catch (e) {
            // One that fails keeps its place in the saved list (it is tried again next time) and the others still load.
            failed.current.push(name);
            console.warn(`Restoring ${name} failed`, e);
          }
        }
      } catch {
        // The Inputs page still lists the stored models to open by hand.
      } finally {
        restoreStatus.mark(root);
        setRestoredFor(root);
      }
    })();
  }, [root, engine, enabled]);

  // The scene's list is the one ticked in the Files panel (state/sceneModels.ts): what happens to be loaded no longer rewrites it.
  // A scene that has no list yet (made before) takes what was restored for it, once, so it has an explicit list from then on.
  const names = JSON.stringify(models.map((m) => m.name).filter((n) => stored.some((s) => s.name === n)).sort());
  useEffect(() => {
    if (!root || restoredFor !== root) return;
    const list = [...new Set([...(JSON.parse(names) as string[]), ...failed.current])];
    if (sceneList() === null) setActiveLinked(list);
    // The project database keeps the last list only as the start for a scene without one.
    const t = setTimeout(() => void saveSetting(root, KEY, list).catch(() => undefined), 100);
    return () => clearTimeout(t);
  }, [root, restoredFor, names]);

  return null;
}
