import { useEffect, useRef, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useModelStoreState } from '../state/modelStoreState';
import { useProjectDbStore } from '../state/projectDbStore';
import { fetchSettings, saveSetting } from '../db/api';
import { loadStoredModel } from '../viewer/modelStore';

const KEY = 'loadedModels';

/** Browser edition: opens the models that were loaded when the project was last used (from the model store, so from their
    converted copies), and keeps that list in the project database as models are loaded and removed. */
export function ModelsRestoreSync({ enabled = true }: { /** False: not yet (a second window waits until it shows a page with the 3D view). */ enabled?: boolean }) {
  const engine = useViewerEngine();
  const root = useProjectDbStore((s) => s.db?.root ?? null);
  const models = useModelsStore((s) => s.models);
  const stored = useModelStoreState((s) => s.models);
  const started = useRef<string | null>(null);
  const [restoredFor, setRestoredFor] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !root || started.current === root) return;
    started.current = root;
    void (async () => {
      try {
        const names = (await fetchSettings(root))[KEY];
        await useModelStoreState.getState().refresh(root);
        for (const name of Array.isArray(names) ? (names as string[]) : []) {
          const m = useModelStoreState.getState().models.find((x) => x.name === name);
          if (!m || useModelsStore.getState().models.some((x) => x.name === name)) continue;
          const { info } = await loadStoredModel(engine, root, m.name, m.ifcHash);
          useModelsStore.getState().addModel(info);
        }
      } catch {
        // The Inputs page still lists the stored models to open by hand.
      } finally {
        setRestoredFor(root);
      }
    })();
  }, [root, engine, enabled]);

  // Only after the restore, so the empty page at start does not overwrite the saved list.
  const names = JSON.stringify(models.map((m) => m.name).filter((n) => stored.some((s) => s.name === n)).sort());
  useEffect(() => {
    if (!root || restoredFor !== root) return;
    const t = setTimeout(() => void saveSetting(root, KEY, JSON.parse(names)).catch(() => undefined), 500);
    return () => clearTimeout(t);
  }, [root, restoredFor, names]);

  return null;
}
