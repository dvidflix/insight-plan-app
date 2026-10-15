import { useEffect, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useSatelliteModelsStore } from '../state/satelliteModels';
import { IS_SATELLITE, SATELLITE_GROUP } from '../state/satellite';
import { ownsGroup } from '../state/windowSync';

/** The 3D models in a second window ("Open in a new window"): the window that opened it sends the models it has loaded as .frag
    bytes (already converted, as Duplicate tab does), so nothing is converted from IFC again and the 4D, the counts and the views
    work there. The programmes already come over with the edits (state/windowSync.ts). The second window asks as it opens (and
    again, a few times, until the answer starts), and when "Load the models here" is pressed. */

const CHANNEL = 'insight-plan.satellite-models';

type Message =
  | { type: 'request'; group: string; token: string }
  | { type: 'model'; token: string; index: number; total: number; name: string; buffer: ArrayBuffer; layers: [string, number[]][]; hidden: boolean };

export function SatelliteModelsSync() {
  const engine = useViewerEngine();
  const wanted = useSatelliteModelsStore((s) => s.wanted);
  const [status, setStatus] = useState<string | null>(null);

  // The window that opened the others answers.
  useEffect(() => {
    if (IS_SATELLITE) return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = async (e: MessageEvent<Message>) => {
      const msg = e.data;
      if (msg.type !== 'request' || !ownsGroup(msg.group)) return;
      const { models, hiddenModelIds } = useModelsStore.getState();
      // Several at once would hold every model's bytes in memory together: one after the other.
      for (const [index, m] of models.entries()) {
        try {
          const out = await engine.exportModel(m.modelId);
          if (out) channel.postMessage({ type: 'model', token: msg.token, index, total: models.length, name: m.name, buffer: out.buffer, layers: out.layers, hidden: hiddenModelIds.has(m.modelId) } satisfies Message);
        } catch {
          // that model is left out
        }
      }
    };
    return () => channel.close();
  }, [engine]);

  // A second window asks.
  useEffect(() => {
    if (!IS_SATELLITE || !SATELLITE_GROUP) return;
    const token = crypto.randomUUID();
    const channel = new BroadcastChannel(CHANNEL);
    let started = false;
    let alive = true;
    let chain: Promise<void> = Promise.resolve();
    channel.onmessage = (e: MessageEvent<Message>) => {
      const msg = e.data;
      if (msg.type !== 'model' || msg.token !== token) return;
      started = true;
      chain = chain.then(async () => {
        if (!alive || useModelsStore.getState().models.some((m) => m.name === msg.name)) return;
        setStatus(`Loading model ${msg.index + 1} of ${msg.total}: ${msg.name}…`);
        try {
          const info = await engine.loadFrag(msg.buffer, msg.name);
          const store = useModelsStore.getState();
          store.addModel(info);
          engine.setLayers(info.modelId, msg.layers);
          if (msg.hidden && !useModelsStore.getState().hiddenModelIds.has(info.modelId)) store.toggleModelHidden(info.modelId);
        } catch (err) {
          setStatus(`Could not load ${msg.name}: ${err instanceof Error ? err.message : String(err)}`);
          return;
        }
        if (msg.index + 1 >= msg.total) setStatus(null);
      });
    };
    // The opening window may not be listening yet, or may be busy: ask again until it starts to answer.
    let tries = 0;
    const ask = () => {
      if (!alive || started || tries++ > 8) {
        if (!started && alive && tries > 8) setStatus(null);
        return;
      }
      channel.postMessage({ type: 'request', group: SATELLITE_GROUP as string, token } satisfies Message);
      window.setTimeout(ask, 2500);
    };
    setStatus('Asking the main window for the models…');
    window.setTimeout(ask, 500);
    return () => {
      alive = false;
      channel.close();
    };
    // `wanted` asks again (the button: Load the models here).
  }, [engine, wanted]);

  if (!status) return null;
  return (
    <div className="duplicate-tab__status" role="status">
      <span>{status}</span>
      <button type="button" className="btn" onClick={() => setStatus(null)}>Close</button>
    </div>
  );
}
