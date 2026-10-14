import { Fragment, useMemo, useState } from 'react';
import { FileDrop } from '../FileDrop';
import { loadScheduleFile } from '../../schedule/importSchedule';
import { compareSchedules } from '../../schedule/compare';
import { useScheduleStore } from '../../state/scheduleStore';
import { useBaselinesOf } from '../../state/baselines';
import { dbScheduleId, loadProgramme } from '../../state/projectDbStore';
import type { ScheduleModel } from '../../schedule/types';
import type { MilestoneDriver } from '../../schedule/milestoneDrivers';

export function ComparePanel({ current }: { current: ScheduleModel }) {
  const schedules = useScheduleStore((s) => s.schedules);
  const addSchedule = useScheduleStore((s) => s.addSchedule);
  const otherSchedules = schedules.filter((s) => s.id !== current.id);
  // The baselines saved of this programme (see the Baselines menu); one not loaded yet is read from the database when picked.
  const savedBaselines = useBaselinesOf(current);
  const pickSaved = async (id: number) => {
    setError(null);
    try {
      const p = savedBaselines.find((b) => b.id === id);
      if (p && !schedules.some((s) => s.dbProgrammeId === id)) await loadProgramme(p);
      setBaselineId(dbScheduleId(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<'events' | 'drag' | 'milestones'>('events');
  const [error, setError] = useState<string | null>(null);

  const baseline = otherSchedules.find((s) => s.id === baselineId) ?? null;
  const result = useMemo(() => (baseline ? compareSchedules(baseline, current) : null), [baseline, current]);

  const handleFile = async (file: File) => {
    setError(null);
    try {
      // A baseline .xer loads the same P6 projects as the current programme, when it has them.
      const model = await loadScheduleFile(file, current.project.id.split('+').filter(Boolean));
      addSchedule(model);
      setBaselineId(model.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!baseline || !result) {
    return (
      <div className="page">
        <div style={{ padding: 12, color: 'var(--text-dim)' }}>
          Pick a baseline schedule to compare against the current one ({current.project.name}).
        </div>
        {savedBaselines.length > 0 && (
          <div style={{ padding: '0 12px 12px', display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span className="scn-dim">Saved baselines</span>
            {savedBaselines.map((b) => (
              <button key={b.id} className="btn" onClick={() => void pickSaved(b.id)} title={`Saved ${new Date(b.importedAt).toLocaleString()}`}>{b.name}</button>
            ))}
          </div>
        )}
        {otherSchedules.filter((s) => !savedBaselines.some((b) => b.id === s.dbProgrammeId)).length > 0 && (
          <div style={{ padding: '0 12px 12px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {otherSchedules.filter((s) => !savedBaselines.some((b) => b.id === s.dbProgrammeId)).map((s) => (
              <button key={s.id} className="btn" onClick={() => setBaselineId(s.id)}>
                {s.sourceFileName}
              </button>
            ))}
          </div>
        )}
        <FileDrop label="…or drop a new baseline .xer/.xml here" accept=".xer,.xml" onFile={handleFile} />
        {error && <div style={{ color: 'var(--danger)', padding: '0 12px' }}>{error}</div>}
      </div>
    );
  }

  const { summary, events, dragRows, milestones } = result;

  return (
    <div className="page">
      <div className="filterbar">
        <span>
          Baseline: <strong>{baseline.sourceFileName}</strong>
        </span>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setBaselineId(null)}>
          Change baseline
        </button>
      </div>
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-card__label">Baseline finish</div>
          <div className="stat-card__value" style={{ fontSize: 14 }}>{summary.baselineFinish?.toLocaleDateString() ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Current finish</div>
          <div className="stat-card__value" style={{ fontSize: 14 }}>{summary.currentFinish?.toLocaleDateString() ?? '—'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Slip</div>
          <div className="stat-card__value">{summary.slipDays === null ? '—' : `${summary.slipDays > 0 ? '+' : ''}${Math.round(summary.slipDays)}d`}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">CP impact (d)</div>
          <div className="stat-card__value">{Math.round(summary.cpImpactDays * 10) / 10}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__label">Events</div>
          <div className="stat-card__value">{summary.eventCount}</div>
        </div>
      </div>
      <div className="tabs">
        <button className={subTab === 'events' ? 'active' : ''} onClick={() => setSubTab('events')}>
          Delay Events ({events.length})
        </button>
        <button className={subTab === 'drag' ? 'active' : ''} onClick={() => setSubTab('drag')}>
          Critical Path Drag Analysis ({dragRows.length})
        </button>
        <button className={subTab === 'milestones' ? 'active' : ''} onClick={() => setSubTab('milestones')}>
          Milestone drivers ({milestones.length})
        </button>
      </div>
      <div className="page-body__main">
        {subTab === 'events' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>ID</th><th>Type</th><th>Code</th><th>Name</th><th>Base (d)</th><th>Curr (d)</th><th>Delta (d)</th><th>Delay (d)</th><th>On CP</th><th>Description</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className={e.onCriticalPath ? 'critical' : ''}>
                  <td>{e.id}</td>
                  <td>{e.type}</td>
                  <td>{e.code}</td>
                  <td>{e.name}</td>
                  <td>{e.baseDurationDays !== null ? Math.round(e.baseDurationDays * 10) / 10 : ''}</td>
                  <td>{e.currDurationDays !== null ? Math.round(e.currDurationDays * 10) / 10 : ''}</td>
                  <td>{e.deltaDurationDays !== null ? Math.round(e.deltaDurationDays * 10) / 10 : ''}</td>
                  <td>{e.delayDays !== null ? Math.round(e.delayDays) : ''}</td>
                  <td>{e.onCriticalPath === null ? '' : e.onCriticalPath ? 'Yes' : 'No'}</td>
                  <td>{e.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {subTab === 'milestones' && <MilestoneDrivers rows={milestones} />}
        {subTab === 'drag' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Code</th><th>Name</th><th>Base CP</th><th>Curr CP</th><th>Base Drag</th><th>Curr Drag</th><th>Delta</th><th>Classification</th>
              </tr>
            </thead>
            <tbody>
              {dragRows.map((r) => (
                <tr key={r.code} className={r.currOnCP ? 'critical' : ''}>
                  <td>{r.code}</td>
                  <td>{r.name}</td>
                  <td>{r.baseOnCP ? 'Yes' : 'No'}</td>
                  <td>{r.currOnCP ? 'Yes' : 'No'}</td>
                  <td>{Math.round(r.baseDrag * 10) / 10}</td>
                  <td>{Math.round(r.currDrag * 10) / 10}</td>
                  <td>{Math.round(r.deltaDrag * 10) / 10}</td>
                  <td>{r.classification}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  duration: 'Duration', lag: 'Lag', logic: 'Logic', constraint: 'Constraint', progress: 'Progress',
  datadate: 'Data date', calendar: 'Calendar', new: 'New activity', unknown: 'Not found',
};
const fmtDays = (n: number) => `${n > 0 ? '+' : ''}${n} d`;

/** Why each milestone that moved, moved: the activity on its driving chain where the shift came in, and what changed there. */
function MilestoneDrivers({ rows }: { rows: MilestoneDriver[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length === 0) return <div style={{ padding: 12, color: 'var(--text-dim)' }}>No milestone moved between the two programmes.</div>;
  return (
    <table className="data-table">
      <thead>
        <tr><th /><th>Milestone</th><th>Baseline</th><th>Current</th><th>Moved</th><th>Main driver</th><th>Reason</th></tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Fragment key={r.code}>
            <tr className={r.slipDays > 0 ? 'critical' : ''} onClick={() => setOpen(open === r.code ? null : r.code)} style={{ cursor: 'pointer' }}>
              <td>{open === r.code ? '▾' : '▸'}</td>
              <td title={r.name}>{r.code}<div style={{ color: 'var(--text-dim)', fontSize: 11 }}>{r.name}</div></td>
              <td>{r.baseDate.toLocaleDateString()}</td>
              <td>{r.currDate.toLocaleDateString()}</td>
              <td>{fmtDays(r.slipDays)}</td>
              <td>{r.primary ? <>{r.primary.code}{r.primary.days !== null && <> ({fmtDays(r.primary.days)})</>}</> : '—'}</td>
              <td>
                {r.primary ? <><strong>{KIND_LABEL[r.primary.kind]}:</strong> {r.primary.reason}</> : 'No driving chain found.'}
                {r.pathChanged && <div style={{ color: 'var(--text-dim)', fontSize: 11 }}>The driving path is not the one the baseline had.</div>}
              </td>
            </tr>
            {open === r.code && (
              <tr>
                <td />
                <td colSpan={6}>
                  <div style={{ fontSize: 12, marginBottom: 4 }}><strong>What moved it</strong> (in chain order, earliest first)</div>
                  {r.steps.length === 0 && <div style={{ color: 'var(--text-dim)' }}>No single change on the chain explains it.</div>}
                  {r.steps.map((s, i) => (
                    <div key={`${s.code}:${i}`} style={{ fontSize: 12, padding: '2px 0' }}>
                      <strong>{s.code}</strong> {s.name} — {s.days !== null ? fmtDays(s.days) : 'not measurable'} · {KIND_LABEL[s.kind]}: {s.reason}
                    </div>
                  ))}
                  {Math.abs(r.unexplainedDays) > 0.5 && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Not accounted for: {fmtDays(r.unexplainedDays)} (new activities on the path).</div>}
                  <div style={{ fontSize: 12, margin: '8px 0 2px' }}><strong>Driving chain</strong> (movement of the date each activity passes on)</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                    {r.chain.map((l, i) => <span key={`${l.code}:${i}`}>{i > 0 && ' → '}{l.code}{l.shiftDays !== null ? ` (${fmtDays(l.shiftDays)})` : ' (new)'}</span>)}
                  </div>
                </td>
              </tr>
            )}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}
