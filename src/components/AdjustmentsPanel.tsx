import { useEffect, useMemo, useState } from 'react';
import { useScheduleStore } from '../state/scheduleStore';
import { useActivitySelectionStore } from '../state/activitySelectionStore';
import { adjustmentsStatus, pullAdjustments, pushRetired, type AdjustmentsStatus } from '../seatable/adjustments';
import { useRetiredTasksStore } from '../state/retiredTasksStore';
import { updateFourD, useScenarioStore } from '../state/scenarioStore';
import { InfoTip } from './InfoTip';

const count = (n: number | null) => (n === null ? 'no table' : n.toLocaleString());

/** Settings › Retired and extra activities (SeaTable): the generated tasks picked in a programme (Ctrl / Shift in the table or
    the Gantt) go to the Retired table, so the generator leaves them out; Pull brings the Retired, Extra activities and
    Baselines tables into the local copy the generator reads. */
export function AdjustmentsPanel() {
  const schedules = useScheduleStore((s) => s.schedules);
  const selectedScheduleId = useScheduleStore((s) => s.selectedId);
  const picked = useActivitySelectionStore((s) => s.ids);
  const [status, setStatus] = useState<AdjustmentsStatus | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = () => void adjustmentsStatus().then(setStatus).catch((e) => setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) }));
  useEffect(refresh, []);

  // The picked activities of the programme on screen (picks of another programme are not in it).
  const tasks = useMemo(() => {
    const model = schedules.find((m) => m.id === selectedScheduleId);
    if (!model) return [];
    return model.activities.filter((a) => picked.has(a.id)).map((a) => ({ taskId: a.code, name: a.name }));
  }, [schedules, selectedScheduleId, picked]);

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await work() });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  /** The programme generated from the scenario on screen is made again, so the links close up around what was retired
      (or the extras come in); without a scenario loaded the links are closed up in the view only. */
  const regenerate = async (): Promise<string> => {
    const sc = useScenarioStore.getState();
    if (!sc.loaded || !sc.scenario) return ' Open the scenario in Scenarios and press Update 4D to generate the programme again.';
    await updateFourD();
    const after = useScenarioStore.getState();
    return after.message?.kind === 'error' ? ` The programme could not be generated again: ${after.message.text}` : ' The programme was generated again.';
  };

  const send = () =>
    run(async () => {
      const r = await pushRetired(tasks.map((t) => ({ ...t, reason: reason.trim() })));
      // Into the local copy the generator reads, and out of the programmes on screen at once.
      await pullAdjustments();
      await useRetiredTasksStore.getState().load();
      useActivitySelectionStore.getState().clear();
      const again = await regenerate();
      return `${r.added} task${r.added === 1 ? '' : 's'} retired${r.skipped ? ` (${r.skipped} already were)` : ''} and taken out of the Gantt and the table.${again}`;
    });
  const pull = () =>
    run(async () => {
      const r = await pullAdjustments();
      await useRetiredTasksStore.getState().load();
      const missing = r.missing.length ? ` Not in the base yet: ${r.missing.join(', ')}.` : '';
      const again = r.retired + r.extras > 0 ? await regenerate() : '';
      return `Pulled ${r.retired} retired, ${r.extras} extra activities, ${r.baselines} baselines.${missing}${again}`;
    });

  return (
    <div className="seatable-panel__body">
      <div className="seatable-panel__status">
        {status
          ? <>Retired <b>{count(status.retired)}</b> · Extra activities <b>{count(status.extras)}</b> · Baselines <b>{count(status.baselines)}</b></>
          : 'Checking SeaTable…'}
        <button type="button" className="cols__link" onClick={refresh}>Check again</button>
      </div>

      <div className="cols__heading">
        <span>
          Retire tasks{' '}
          <InfoTip>
            <p>Pick generated tasks in the Programmes table or the Gantt (click, Ctrl+click to add or remove, Shift+click for a range), then send them to SeaTable’s <b>Retired</b> table, one row per Task ID. The generator leaves those tasks out of the programmes it makes from then on (the Task ID stays the same while the pour’s ID does).</p>
            <p>To bring a task back, delete its row in the Retired table and pull.</p>
          </InfoTip>
        </span>
        <span className="cols__hint">{tasks.length.toLocaleString()} picked</span>
      </div>
      <input className="cols__search" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="seatable-panel__row">
        <button type="button" className="btn primary" disabled={busy || tasks.length === 0} onClick={() => void send()} title={tasks.length ? tasks.slice(0, 8).map((t) => t.taskId).join('\n') + (tasks.length > 8 ? '\n…' : '') : 'Pick tasks in the Programmes table or the Gantt first'}>
          Send {tasks.length ? `${tasks.length.toLocaleString()} ` : ''}to Retired
        </button>
      </div>

      <div className="cols__heading">
        <span>
          Pull for the generator{' '}
          <InfoTip>
            <p>Copies <b>Retired</b>, <b>Extra activities</b> and <b>Baselines</b> into a local file the scenario generator reads, so it works with SeaTable switched off. Pull after changing them in SeaTable, then generate again.</p>
            <p><b>Baselines</b>: Name, Start, Finish, Notes.</p>
            <p><b>Extra activities</b>: Task ID, Task name, Duration (days), Baseline (link to Baselines), Predecessors and Successors (Task IDs, separated by commas), WBS, Notes. They are added to every generated programme, with the baseline’s dates as their target (baseline) dates.</p>
          </InfoTip>
        </span>
        {status?.pulledAt && <span className="cols__hint">{new Date(status.pulledAt).toLocaleString()}</span>}
      </div>
      <div className="seatable-panel__row">
        <button type="button" className="btn" disabled={busy} onClick={() => void pull()}>Pull Retired, Extra activities, Baselines</button>
      </div>

      {message && <div className={message.ok ? 'flt__hint' : 'inputs-panel__error'}>{message.text}</div>}
    </div>
  );
}
