import { useEffect, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useScheduleStore } from '../state/scheduleStore';
import type { ScheduleModel } from '../schedule/types';
import { IconLaunch } from './icons';

/** Duplicate tab: the same app, with the same models and programmes, in a
    new browser tab (e.g. one per screen). Settings, link groups and the like
    live in localStorage and are shared by every tab already; the models and
    programmes only live in this tab's memory, so the new tab asks for them
    over a BroadcastChannel — the models as .frag bytes, so nothing is
    converted from IFC again. Afterwards the two tabs are independent. */

const CHANNEL = 'insight-plan.duplicate-tab';
const PARAM = 'duplicate';

interface CopiedModel {
  name: string;
  buffer: ArrayBuffer;
  layers: [string, number[]][];
  hidden: boolean;
}

type Message =
  | { type: 'request'; token: string }
  | { type: 'data'; token: string; models: CopiedModel[]; schedules: ScheduleModel[]; hiddenScheduleIds: string[]; selectedScheduleId: string | null }
  | { type: 'error'; token: string; message: string };

/** Tokens this tab handed to the tabs it opened (only those get an answer,
    for a minute — an effect run twice asks twice). */
const issued = new Set<string>();

/** This tab's own token, if Duplicate opened it — read once, and taken off
    the address so a reload doesn't ask again. */
const startToken = (() => {
  const url = new URL(window.location.href);
  const token = url.searchParams.get(PARAM);
  if (token) {
    url.searchParams.delete(PARAM);
    window.history.replaceState(null, '', url.toString());
  }
  return token;
})();

export function DuplicateTabButton() {
  const duplicate = () => {
    const token = crypto.randomUUID();
    issued.add(token);
    window.setTimeout(() => issued.delete(token), 60000);
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, token);
    window.open(url.toString(), '_blank');
  };
  return (
    <button type="button" className="app-topbar__icon-btn" data-own-gesture onClick={duplicate} title="Duplicate in a new tab: the same models and programmes, e.g. for a second screen" aria-label="Duplicate in a new tab">
      <IconLaunch />
    </button>
  );
}

/** Answers the tabs this one opened, and — in a tab opened by Duplicate —
    loads what the other tab sends. */
export function DuplicateTabSync() {
  const engine = useViewerEngine();
  const [status, setStatus] = useState<string | null>(null);

  // Sender: every tab listens for its own tokens.
  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = async (e: MessageEvent<Message>) => {
      const msg = e.data;
      if (msg.type !== 'request' || !issued.has(msg.token)) return;
      try {
        const { models, hiddenModelIds } = useModelsStore.getState();
        const copied: CopiedModel[] = [];
        for (const m of models) {
          const out = await engine.exportModel(m.modelId);
          if (out) copied.push({ name: m.name, buffer: out.buffer, layers: out.layers, hidden: hiddenModelIds.has(m.modelId) });
        }
        const s = useScheduleStore.getState();
        channel.postMessage({ type: 'data', token: msg.token, models: copied, schedules: s.schedules, hiddenScheduleIds: [...s.hiddenScheduleIds], selectedScheduleId: s.selectedId } satisfies Message);
      } catch (err) {
        channel.postMessage({ type: 'error', token: msg.token, message: err instanceof Error ? err.message : String(err) } satisfies Message);
      }
    };
    return () => channel.close();
  }, [engine]);

  // Receiver: only in a tab opened with ?duplicate=<token>.
  useEffect(() => {
    const token = startToken;
    if (!token) return;
    const channel = new BroadcastChannel(CHANNEL);
    let done = false;
    const timeout = window.setTimeout(() => {
      if (done) return;
      done = true;
      channel.close();
      setStatus('The original tab did not answer (closed or reloaded?). Load the files from Inputs.');
    }, 30000);
    setStatus('Copying models and programmes from the other tab…');
    channel.onmessage = async (e: MessageEvent<Message>) => {
      const msg = e.data;
      if (msg.token !== token || msg.type === 'request' || done) return;
      done = true;
      window.clearTimeout(timeout);
      channel.close();
      if (msg.type === 'error') {
        setStatus(`Could not copy from the other tab: ${msg.message}`);
        return;
      }
      try {
        const schedules = useScheduleStore.getState();
        schedules.replaceAll(msg.schedules, msg.hiddenScheduleIds);
        if (msg.selectedScheduleId) schedules.select(msg.selectedScheduleId);
        for (const [i, m] of msg.models.entries()) {
          setStatus(`Loading model ${i + 1} of ${msg.models.length}: ${m.name}…`);
          const info = await engine.loadFrag(m.buffer, m.name);
          const store = useModelsStore.getState();
          store.addModel(info);
          engine.setLayers(info.modelId, m.layers);
          if (m.hidden && !useModelsStore.getState().hiddenModelIds.has(info.modelId)) store.toggleModelHidden(info.modelId);
        }
        setStatus(null);
      } catch (err) {
        setStatus(`Could not copy from the other tab: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    channel.postMessage({ type: 'request', token } satisfies Message);
    return () => {
      done = true;
      window.clearTimeout(timeout);
      channel.close();
    };
  }, [engine]);

  if (!status) return null;
  return (
    <div className="duplicate-tab__status" role="status">
      <span>{status}</span>
      <button type="button" className="btn" onClick={() => setStatus(null)}>Close</button>
    </div>
  );
}
