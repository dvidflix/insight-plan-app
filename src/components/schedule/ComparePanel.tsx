import { useMemo, useState } from 'react';
import { FileDrop } from '../FileDrop';
import { loadScheduleFile } from '../../schedule/importSchedule';
import { compareSchedules } from '../../schedule/compare';
import { useScheduleStore } from '../../state/scheduleStore';
import type { ScheduleModel } from '../../schedule/types';

export function ComparePanel({ current }: { current: ScheduleModel }) {
  const schedules = useScheduleStore((s) => s.schedules);
  const addSchedule = useScheduleStore((s) => s.addSchedule);
  const otherSchedules = schedules.filter((s) => s.id !== current.id);

  const [baselineId, setBaselineId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<'events' | 'drag'>('events');
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
        {otherSchedules.length > 0 && (
          <div style={{ padding: '0 12px 12px', display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {otherSchedules.map((s) => (
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

  const { summary, events, dragRows } = result;

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
