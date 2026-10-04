import { useRef, useState } from 'react';
import type { ScheduleModel } from '../../schedule/types';
import { runMonteCarlo, type CriticalityRow, type MonteCarloResult } from '../../schedule/monteCarlo';
import { fmtDate } from '../../schedule/reports';
import { downloadCsv } from '../../utils/csv';
import { usePersistedState } from '../../utils/persistedState';
import { FilterSelect, PagedTable, Section, Tiles, type Column } from '../reports/ReportParts';

const pad = (n: number) => String(n).padStart(2, '0');
const toInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fromInput = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).getTime() : null;
};
const ITERATIONS = [200, 500, 1000, 2000].map((n) => ({ value: String(n), label: `${n} runs` }));

/** Programmes > Risk (Monte Carlo): how likely the programme is to finish by a date
    when durations are uncertain. Each unfinished activity's duration is drawn from a
    triangular range around its planned one (shortest / planned / longest, as a % of
    planned) and the critical path is recalculated for every run. */
export function MonteCarloView({ model }: { model: ScheduleModel }) {
  const [iterations, setIterations] = usePersistedState<string>('schedule.mcIterations', '500');
  const [minPct, setMinPct] = usePersistedState<number>('schedule.mcMin', 90);
  const [maxPct, setMaxPct] = usePersistedState<number>('schedule.mcMax', 130);
  const [target, setTarget] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const stop = useRef(false);

  const run = async () => {
    setMessage(null);
    stop.current = false;
    setProgress(0);
    const out = await runMonteCarlo(model, { iterations: Number(iterations), minPct, maxPct }, setProgress, () => stop.current);
    setProgress(null);
    if (out) {
      setResult(out);
      if (!target && out.planned) setTarget(toInput(out.planned));
    } else if (!stop.current) {
      setMessage('The programme has no network to simulate (no activities with logic).');
    }
  };

  const targetMs = fromInput(target);
  const f = (ms: number | null) => (ms === null ? '—' : fmtDate(new Date(ms)));
  const chance = result && targetMs !== null ? result.chanceBy(targetMs) : null;
  const chanceColor = chance === null ? undefined : chance >= 80 ? 'var(--bar-done)' : chance >= 50 ? 'var(--warn)' : 'var(--bar-critical)';

  const cols: Column<CriticalityRow>[] = [
    { key: 'ci', label: 'Criticality', align: 'right', render: (r) => `${r.criticality.toFixed(0)}%`, sort: (r) => r.criticality },
    { key: 'id', label: 'Activity ID', render: (r) => r.code, sort: (r) => r.code },
    { key: 'name', label: 'Activity Name', render: (r) => <span className="report-clip" title={r.name}>{r.name}</span>, sort: (r) => r.name },
    { key: 'dur', label: 'Duration (d)', align: 'right', render: (r) => r.durationDays.toFixed(1), sort: (r) => r.durationDays },
  ];

  const exportCsv = () => {
    if (!result) return;
    downloadCsv('monte-carlo-criticality.csv', ['Criticality %', 'Activity ID', 'Activity Name', 'Duration (d)'], result.criticality.map((r) => [r.criticality.toFixed(1), r.code, r.name, r.durationDays.toFixed(1)]));
  };

  // Histogram of finish dates, with the planned finish and the P50 / P80 / P90 marked.
  const W = 640;
  const H = 160;
  const max = result ? Math.max(1, ...result.histogram.map((h) => h.count)) : 1;
  const lo = result?.histogram[0].from ?? 0;
  const hi = result?.histogram[result.histogram.length - 1].to ?? 1;
  const x = (ms: number) => 20 + ((ms - lo) / Math.max(1, hi - lo)) * (W - 40);

  return (
    <div className="page-body" style={{ overflow: 'auto' }}>
      <div className="page-body__main" style={{ padding: 12 }}>
        <div className="report">
          <div className="report-header">
            <div className="report-header__row">
              <h2 className="report-header__title">Schedule risk (Monte Carlo)</h2>
              {result && <button type="button" className="checks-export-btn report-header__export" onClick={exportCsv}>Export (CSV)</button>}
            </div>
            <div className="report-header__desc">Every unfinished activity's duration varies between the shortest and longest below, most likely the planned one · whole working days · {model.project.name}</div>
          </div>

          <Section title="Run">
            <div className="report-filters">
              <FilterSelect label="Runs" value={iterations} onChange={setIterations} options={ITERATIONS} />
              <label className="report-filter">
                <span>Shortest (% of planned)</span>
                <input type="number" min={10} max={100} value={minPct} onChange={(e) => setMinPct(Math.min(100, Math.max(10, Number(e.target.value) || 100)))} />
              </label>
              <label className="report-filter">
                <span>Longest (% of planned)</span>
                <input type="number" min={100} max={500} value={maxPct} onChange={(e) => setMaxPct(Math.min(500, Math.max(100, Number(e.target.value) || 100)))} />
              </label>
              {progress === null ? (
                <button type="button" className="report-toggle active" onClick={() => void run()}>Run simulation</button>
              ) : (
                <>
                  <progress value={progress} max={1} style={{ width: 120 }} />
                  <button type="button" className="report-toggle" onClick={() => { stop.current = true; }}>Stop</button>
                </>
              )}
            </div>
            {message && <div className="report-empty">{message}</div>}
          </Section>

          {result && (
            <>
              <Section title="Finish date confidence">
                <div className="report-filters">
                  <label className="report-filter">
                    <span>Target finish</span>
                    <input type="date" value={target} onChange={(e) => setTarget(e.target.value)} />
                  </label>
                </div>
                <Tiles tiles={[
                  { value: chance === null ? '—' : `${chance.toFixed(0)}%`, label: `Chance of finishing by ${target ? f(targetMs) : 'the target'}`, color: chanceColor },
                  { value: f(result.planned), label: 'Planned finish' },
                  { value: f(result.percentile(50)), label: 'P50 (even odds)' },
                  { value: f(result.percentile(80)), label: 'P80' },
                  { value: f(result.percentile(90)), label: 'P90' },
                ]} />
                <div style={{ overflowX: 'auto' }}>
                  <svg width={W} height={H + 40} role="img" aria-label="Distribution of finish dates">
                    {result.histogram.map((h, i) => (
                      <rect key={i} x={x(h.from) + 1} y={10 + H - (h.count / max) * H} width={Math.max(1, x(h.to) - x(h.from) - 2)} height={(h.count / max) * H} fill="var(--bar-normal)" opacity={0.75}>
                        <title>{`${f(h.from)} – ${f(h.to)}: ${h.count} runs`}</title>
                      </rect>
                    ))}
                    {result.planned !== null && result.planned >= lo && result.planned <= hi && (
                      <g>
                        <line x1={x(result.planned)} x2={x(result.planned)} y1={4} y2={H + 12} stroke="var(--text)" strokeDasharray="4 3" />
                        <text x={x(result.planned)} y={H + 26} textAnchor="middle" fontSize={10} fill="var(--text)">planned</text>
                      </g>
                    )}
                    {([50, 80, 90] as const).map((p) => (
                      <g key={p}>
                        <line x1={x(result.percentile(p))} x2={x(result.percentile(p))} y1={4} y2={H + 12} stroke="var(--bar-critical)" />
                        <text x={x(result.percentile(p))} y={H + 38} textAnchor="middle" fontSize={10} fill="var(--bar-critical)">P{p}</text>
                      </g>
                    ))}
                    <text x={20} y={H + 38} fontSize={10} fill="var(--text-dim)">{f(lo)}</text>
                    <text x={W - 20} y={H + 38} textAnchor="end" fontSize={10} fill="var(--text-dim)">{f(hi)}</text>
                  </svg>
                </div>
              </Section>

              <Section title="What drives the finish: criticality">
                <PagedTable columns={cols} rows={result.criticality} rowKey={(r) => r.id} initialSort={{ key: 'ci', dir: 'desc' }} footnote="Criticality: the share of runs in which the activity sat on the critical path." />
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
