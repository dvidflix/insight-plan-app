import { useMemo, useState } from 'react';
import type { ScheduleModel } from '../../schedule/types';
import {
  applyDurationChange,
  applyRelationshipChange,
  buildNetwork,
  cloneNetwork,
  computeCPM,
  type RelationshipChange,
  type ScheduleNetwork,
} from '../../schedule/network';

export function WhatIfPanel({ model }: { model: ScheduleModel }) {
  const baseNetwork = useMemo(() => buildNetwork(model), [model]);
  const baseResult = useMemo(() => computeCPM(baseNetwork, model.project.dataDate), [baseNetwork, model]);

  const [scenario, setScenario] = useState<ScheduleNetwork>(() => cloneNetwork(baseNetwork));
  const [log, setLog] = useState<string[]>([]);
  const [durCode, setDurCode] = useState('');
  const [durDays, setDurDays] = useState(1);
  const [predCode, setPredCode] = useState('');
  const [succCode, setSuccCode] = useState('');
  const [relOp, setRelOp] = useState<RelationshipChange['op']>('add');
  const [relType, setRelType] = useState<RelationshipChange['type']>('FS');
  const [relLag, setRelLag] = useState(0);

  const scenarioResult = useMemo(() => computeCPM(scenario, model.project.dataDate), [scenario, model]);

  const applyDuration = () => {
    const next = cloneNetwork(scenario);
    const r = applyDurationChange(next, durCode.trim(), durDays);
    setLog((l) => [r.message, ...l]);
    if (r.ok) setScenario(next);
  };

  const applyRelationship = () => {
    const next = cloneNetwork(scenario);
    const r = applyRelationshipChange(next, { op: relOp, predCode: predCode.trim(), succCode: succCode.trim(), type: relType, lagDays: relLag });
    setLog((l) => [r.message, ...l]);
    if (r.ok) setScenario(next);
  };

  const reset = () => {
    setScenario(cloneNetwork(baseNetwork));
    setLog([]);
  };

  const slipDays = baseResult.projectFinish && scenarioResult.projectFinish
    ? Math.round(((scenarioResult.projectFinish.getTime() - baseResult.projectFinish.getTime()) / 86400000) * 10) / 10
    : null;

  const criticalRows = [...scenario.nodes.values()]
    .map((n) => ({ node: n, result: scenarioResult.perNode.get(n.id) }))
    .filter((r) => r.result?.isCritical)
    .sort((a, b) => a.result!.earlyStart.getTime() - b.result!.earlyStart.getTime());

  return (
    <div className="page-body" style={{ overflow: 'auto' }}>
      <div className="page-body__main" style={{ padding: 12 }}>
        <div className="stat-cards">
          <div className="stat-card">
            <div className="stat-card__label">Baseline finish</div>
            <div className="stat-card__value" style={{ fontSize: 14 }}>{baseResult.projectFinish?.toLocaleDateString() ?? '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card__label">Scenario finish</div>
            <div className="stat-card__value" style={{ fontSize: 14 }}>{scenarioResult.projectFinish?.toLocaleDateString() ?? '—'}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card__label">Slip</div>
            <div className="stat-card__value">{slipDays === null ? '—' : `${slipDays > 0 ? '+' : ''}${slipDays}d`}</div>
          </div>
          <div className="stat-card">
            <div className="stat-card__label">Critical activities</div>
            <div className="stat-card__value">{criticalRows.length}</div>
          </div>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Start</th>
              <th>Finish</th>
              <th>Duration (d)</th>
            </tr>
          </thead>
          <tbody>
            {criticalRows.map(({ node, result }) => (
              <tr key={node.id} className="critical">
                <td>{node.code}</td>
                <td>{node.name}</td>
                <td>{result!.earlyStart.toLocaleDateString()}</td>
                <td>{result!.earlyFinish.toLocaleDateString()}</td>
                <td>{Math.round(node.durationDays * 10) / 10}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel" style={{ width: 320 }}>
        <div className="panel-section">
          <h3>Change duration</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input placeholder="Activity code" value={durCode} onChange={(e) => setDurCode(e.target.value)} />
            <input type="number" placeholder="New duration (days)" value={durDays} onChange={(e) => setDurDays(Number(e.target.value))} />
            <button className="btn primary" onClick={applyDuration}>Apply</button>
          </div>
        </div>
        <div className="panel-section">
          <h3>Add / edit / remove relationship</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <select value={relOp} onChange={(e) => setRelOp(e.target.value as RelationshipChange['op'])}>
              <option value="add">Add</option>
              <option value="edit">Edit</option>
              <option value="remove">Remove</option>
            </select>
            <input placeholder="Predecessor code" value={predCode} onChange={(e) => setPredCode(e.target.value)} />
            <input placeholder="Successor code" value={succCode} onChange={(e) => setSuccCode(e.target.value)} />
            {relOp !== 'remove' && (
              <>
                <select value={relType} onChange={(e) => setRelType(e.target.value as RelationshipChange['type'])}>
                  <option value="FS">Finish-to-Start</option>
                  <option value="SS">Start-to-Start</option>
                  <option value="FF">Finish-to-Finish</option>
                  <option value="SF">Start-to-Finish</option>
                </select>
                <input type="number" placeholder="Lag (days)" value={relLag} onChange={(e) => setRelLag(Number(e.target.value))} />
              </>
            )}
            <button className="btn primary" onClick={applyRelationship}>Apply</button>
          </div>
        </div>
        <div className="panel-section">
          <button className="btn" onClick={reset}>Reset scenario</button>
        </div>
        <div className="panel-section" style={{ flex: 1 }}>
          <h3>Change log</h3>
          {log.length === 0 && <div style={{ color: 'var(--text-dim)' }}>No changes yet.</div>}
          {log.map((m, i) => (
            <div key={i} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>{m}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
