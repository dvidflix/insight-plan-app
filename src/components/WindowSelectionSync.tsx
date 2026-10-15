import { useEffect } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useSelectionStore } from '../state/selectionStore';
import { useActivitySelectionStore } from '../state/activitySelectionStore';
import { hasLinkedWindows, onWindowMessage, sendToWindows } from '../state/windowSync';

/** What is picked is the same in every window of a group ("Open in a new window"): the activities picked in the Gantt or the
    Table, and the objects picked in the 3D model. Each window then does what it does with them (the Programmes page picks the
    objects of an activity, the 4D page the activities of an object), so a pick on one screen shows on the other.
    The objects are sent by model name, as each window gives its own ids to the models it loads. */

const keyOf = (by: Record<string, unknown[]>) => Object.keys(by).sort().map((k) => `${k}=${[...(by[k] as number[])].sort((a, b) => a - b).join(',')}`).join(';');

export function WindowSelectionSync() {
  const engine = useViewerEngine();

  // ---- Activities picked ----
  useEffect(() => {
    let last = '';
    const keyOfPicks = (ids: Set<string>, anchor: string | null) => `${[...ids].sort().join('|')}#${anchor ?? ''}`;
    const unsub = useActivitySelectionStore.subscribe((s) => {
      const key = keyOfPicks(s.ids, s.anchor);
      if (key === last) return;
      last = key;
      if (hasLinkedWindows()) sendToWindows('picks', { ids: [...s.ids], anchor: s.anchor });
    });
    const off = onWindowMessage<{ ids: string[]; anchor: string | null }>('picks', (m) => {
      const key = keyOfPicks(new Set(m.ids), m.anchor);
      if (key === last) return;
      last = key;
      useActivitySelectionStore.setState({ ids: new Set(m.ids), anchor: m.anchor });
    });
    return () => { unsub(); off(); };
  }, []);

  // ---- Objects picked in the 3D model ----
  useEffect(() => {
    let last = '';
    const nameOf = (modelId: string) => useModelsStore.getState().models.find((m) => m.modelId === modelId)?.name;
    const idOf = (name: string) => useModelsStore.getState().models.find((m) => m.name === name)?.modelId;
    const unsub = useSelectionStore.subscribe((s) => {
      const key = keyOf(s.byModel);
      if (key === last) return;
      last = key;
      if (!hasLinkedWindows()) return;
      const byName: Record<string, number[]> = {};
      for (const [modelId, ids] of Object.entries(s.byModel)) {
        const name = nameOf(modelId);
        if (name && ids.length) byName[name] = ids;
      }
      sendToWindows('objects', byName);
    });
    const off = onWindowMessage<Record<string, number[]>>('objects', (byName) => {
      const mine: Record<string, number[]> = {};
      for (const [name, ids] of Object.entries(byName)) {
        const modelId = idOf(name);
        if (modelId && ids.length) mine[modelId] = ids;
      }
      const key = keyOf(mine);
      if (key === keyOf(useSelectionStore.getState().byModel)) { last = key; return; }
      last = key; // the viewer's answer to this is not a new pick
      void engine.selectElements(mine, false);
    });
    return () => { unsub(); off(); };
  }, [engine]);

  return null;
}
