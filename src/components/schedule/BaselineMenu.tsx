import { IconRemove } from '../icons';
import { useState } from 'react';
import { useDismiss } from '../useDismiss';
import type { ScheduleModel } from '../../schedule/types';
import { useBaselineChoiceStore, useBaselinesOf } from '../../state/baselines';
import { removeBaseline, renameBaseline, saveBaselineOf, useProjectDbStore } from '../../state/projectDbStore';
import { programmeKey } from '../../state/unloadedWbsStore';

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
};

/** Programmes toolbar: the baselines saved of the programme (frozen copies of it as it was), save one now, and choose the one the
    programme is shown against (the Gantt's baseline bars, the Saved baseline columns, Compare). */
export function BaselineMenu({ model }: { model: ScheduleModel }) {
  const [open, setOpen] = useState(false);
  const boxRef = useDismiss<HTMLSpanElement>(open, () => setOpen(false));
  const baselines = useBaselinesOf(model);
  const programmes = useProjectDbStore((s) => s.programmes);
  const busy = useProjectDbStore((s) => s.busy);
  const error = useProjectDbStore((s) => s.error);
  const key = programmeKey(model);
  const chosen = useBaselineChoiceStore((s) => s.byProgramme[key] ?? null);
  const choose = useBaselineChoiceStore((s) => s.choose);
  const record = programmes.find((p) => p.id === model.dbProgrammeId);
  if (!record || record.baselineOf !== null) return null;

  const save = async () => {
    const name = window.prompt('Name of the baseline:', `Baseline ${baselines.length + 1}`)?.trim();
    if (!name) return;
    await saveBaselineOf(record, name);
    // The one just saved is the one to show against.
    const latest = useProjectDbStore.getState().programmes.filter((p) => p.baselineOf === record.id).sort((a, b) => b.id - a.id)[0];
    if (latest) choose(key, latest.id);
  };

  return (
    <span className="schedule-toolbar__edit-wbs baseline-menu" ref={boxRef}>
      <button type="button" className={`btn btn--small${chosen !== null ? ' primary' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)} title="Save the programme as a baseline, and choose the baseline it is shown against">
        Baselines ▾
      </button>
      {open && (
        <div className="schedule-toolbar__edit-panel" role="group" aria-label="Baselines" style={{ minWidth: 320 }}>
          <button type="button" className="btn btn--small primary" disabled={!!busy} onClick={() => void save()} title="Keep the programme as it is now: its activities, dates, links and calendars">Save baseline…</button>
          {baselines.length === 0 && <div className="scn-dim" style={{ fontSize: 12 }}>No baseline saved yet. Save one before the programme changes, then see what moved.</div>}
          {baselines.length > 0 && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
              <input type="radio" name="baseline" checked={chosen === null} onChange={() => choose(key, null)} /> Show none
            </label>
          )}
          {baselines.map((b) => (
            <div key={b.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', flex: 1, minWidth: 0 }} title={`Saved ${when(b.importedAt)}`}>
                <input type="radio" name="baseline" checked={chosen === b.id} onChange={() => choose(key, b.id)} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.name}</span>
                <span className="scn-dim" style={{ whiteSpace: 'nowrap' }}>{when(b.importedAt)}</span>
              </label>
              <button type="button" className="btn btn--small" onClick={() => { const name = window.prompt('New name:', b.name)?.trim(); if (name && name !== b.name) void renameBaseline(b, name); }}>Rename</button>
              <button type="button" className="cols__icon cols__icon--remove" aria-label={`Delete ${b.name}`} title="Delete this baseline" onClick={() => { if (window.confirm(`Delete the baseline “${b.name}”?`)) { if (chosen === b.id) choose(key, null); void removeBaseline(b); } }}><IconRemove /></button>
            </div>
          ))}
          {chosen !== null && <div className="scn-dim" style={{ fontSize: 11 }}>Shown on the Gantt as the thin bars, and in the columns “Saved baseline start / finish / duration” and “Start / finish variance to baseline”.</div>}
          {error && <div role="alert" style={{ color: 'var(--danger, #b91c1c)', fontSize: 12 }}>{error}</div>}
        </div>
      )}
    </span>
  );
}
