import { useMemo, useState } from 'react';
import type { Activity, ScheduleModel } from '../../schedule/types';
import { REASONS, ppcWeeks, type PpcWeek } from '../../schedule/ppc';
import { fmtDate } from '../../schedule/reports';
import { downloadCsv } from '../../utils/csv';
import { usePersistedState } from '../../utils/persistedState';
import { ppcReasonKey, usePpcReasonsStore } from '../../state/ppcReasonsStore';
import { BarList, FilterRow, FilterSelect, PagedTable, Section, Tiles, type Column } from '../reports/ReportParts';

const SPAN_OPTIONS = [
  { value: '8', label: 'Last 8 weeks' },
  { value: '12', label: 'Last 12 weeks' },
  { value: '26', label: 'Last 26 weeks' },
  { value: '0', label: 'Whole programme' },
];

const ppcColor = (v: number) => (v >= 80 ? 'var(--bar-done)' : v >= 60 ? 'var(--warn)' : 'var(--bar-critical)');

/** Programmes > PPC: Percent Plan Complete by week. A week's PPC is the share of
    the activities planned to finish in it (baseline finish) that finished by its
    end. Pick a week to see what was missed and give each miss a reason; the
    reasons add up to a Pareto of what holds the plan back. */
export function PpcView({ model, onSelect }: { model: ScheduleModel; onSelect: (activity: Activity) => void }) {
  const asOf = model.project.dataDate ?? new Date();
  const [span, setSpan] = usePersistedState<string>('schedule.ppcSpan', '12');
  const [picked, setPicked] = useState<number | null>(null);
  const reasons = usePpcReasonsStore((s) => s.reasons);
  const setReason = usePpcReasonsStore((s) => s.setReason);

  const all = useMemo(() => ppcWeeks(model.activities, asOf), [model, asOf]);
  const n = Number(span);
  const weeks = n > 0 ? all.slice(-n) : all;
  const closed = weeks.filter((w) => !w.open && w.ppc !== null);
  const planned = closed.reduce((t, w) => t + w.planned.length, 0);
  const done = closed.reduce((t, w) => t + w.done.length, 0);
  const overall = planned ? Math.round((done / planned) * 100) : null;
  const recent = closed.slice(-4);
  const recentPlanned = recent.reduce((t, w) => t + w.planned.length, 0);
  const recentPpc = recentPlanned ? Math.round((recent.reduce((t, w) => t + w.done.length, 0) / recentPlanned) * 100) : null;

  const week = weeks.find((w) => w.start.getTime() === picked) ?? [...closed].reverse().find((w) => w.missed.length) ?? null;

  const pareto = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of weeks) {
      for (const a of w.missed) {
        const r = reasons[ppcReasonKey(a, w.start)];
        if (r) counts.set(r, (counts.get(r) ?? 0) + 1);
      }
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([label, value]) => ({ label, value }));
  }, [weeks, reasons]);

  const cols: Column<PpcWeek>[] = [
    { key: 'week', label: 'Week of', render: (w) => <button type="button" className="link-btn" onClick={() => setPicked(w.start.getTime())}>{fmtDate(w.start)}</button>, sort: (w) => w.start.getTime() },
    { key: 'planned', label: 'Planned', align: 'right', render: (w) => w.planned.length, sort: (w) => w.planned.length },
    { key: 'done', label: 'Finished', align: 'right', render: (w) => (w.open ? '—' : w.done.length), sort: (w) => w.done.length },
    { key: 'missed', label: 'Missed', align: 'right', render: (w) => (w.open ? '—' : w.missed.length), sort: (w) => w.missed.length },
    { key: 'ppc', label: 'PPC', align: 'right', render: (w) => (w.ppc === null || w.open ? (w.open ? 'in progress' : '—') : <b style={{ color: ppcColor(w.ppc) }}>{w.ppc}%</b>), sort: (w) => w.ppc },
  ];

  const missedCols: Column<Activity>[] = [
    { key: 'id', label: 'Activity ID', render: (a) => <button type="button" className="link-btn" onClick={() => onSelect(a)}>{a.code || a.id}</button>, sort: (a) => a.code },
    { key: 'name', label: 'Activity Name', render: (a) => <span className="report-clip" title={a.name}>{a.name}</span>, sort: (a) => a.name },
    { key: 'fin', label: 'Planned finish', render: (a) => fmtDate(a.targetFinish ?? a.earlyFinish), sort: (a) => (a.targetFinish ?? a.earlyFinish)?.getTime() ?? null },
    { key: 'act', label: 'Finished', render: (a) => (a.actualFinish ? fmtDate(a.actualFinish) : 'not yet'), sort: (a) => a.actualFinish?.getTime() ?? null },
    {
      key: 'reason', label: 'Reason',
      render: (a) => {
        const key = ppcReasonKey(a, week!.start);
        return (
          <select value={reasons[key] ?? ''} onChange={(e) => setReason(key, e.target.value)}>
            <option value="">—</option>
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        );
      },
    },
  ];

  const exportCsv = () =>
    downloadCsv('ppc.csv', ['Week of', 'Planned', 'Finished', 'Missed', 'PPC %'],
      weeks.map((w) => [fmtDate(w.start), w.planned.length, w.open ? '' : w.done.length, w.open ? '' : w.missed.length, w.open ? '' : w.ppc ?? '']));

  // The chart: planned (grey) and finished (colour) bars per week, with the PPC % above each.
  const max = Math.max(1, ...weeks.map((w) => w.planned.length));
  const BAR = 22;
  const H = 150;

  return (
    <div className="page-body" style={{ overflow: 'auto' }}>
      <div className="page-body__main" style={{ padding: 12 }}>
        <div className="report">
          <div className="report-header">
            <div className="report-header__row">
              <h2 className="report-header__title">Percent Plan Complete (PPC)</h2>
              <button type="button" className="checks-export-btn report-header__export" onClick={exportCsv}>Export (CSV)</button>
            </div>
            <div className="report-header__desc">Planned = baseline finish in the week · finished = actual finish by the week's end · {model.project.name} · Data Date {fmtDate(model.project.dataDate)}</div>
          </div>

          {all.length === 0 ? (
            <div className="report-empty">No activities with planned finish dates.</div>
          ) : (
            <>
              <Section title="Summary">
                <FilterRow onClear={() => setSpan('12')} summary={`${weeks.length} weeks`}>
                  <FilterSelect label="Show" value={span} onChange={setSpan} options={SPAN_OPTIONS} />
                </FilterRow>
                <Tiles tiles={[
                  { value: overall === null ? '—' : `${overall}%`, label: 'PPC over the weeks shown', color: overall === null ? undefined : ppcColor(overall) },
                  { value: recentPpc === null ? '—' : `${recentPpc}%`, label: 'Last 4 closed weeks', color: recentPpc === null ? undefined : ppcColor(recentPpc) },
                  { value: planned, label: 'Planned' },
                  { value: done, label: 'Finished on time' },
                  { value: planned - done, label: 'Missed', color: planned - done ? 'var(--bar-critical)' : undefined },
                ]} />
              </Section>

              <Section title="By week">
                <div style={{ overflowX: 'auto' }}>
                  <svg width={Math.max(320, weeks.length * (BAR * 2 + 14) + 20)} height={H + 44} role="img" aria-label="PPC by week">
                    {weeks.map((w, i) => {
                      const x = 10 + i * (BAR * 2 + 14);
                      const ph = (w.planned.length / max) * H;
                      const dh = (w.done.length / max) * H;
                      const sel = week?.start.getTime() === w.start.getTime();
                      return (
                        <g key={w.start.getTime()} style={{ cursor: 'pointer' }} onClick={() => setPicked(w.start.getTime())}>
                          <title>{`Week of ${fmtDate(w.start)}: ${w.planned.length} planned, ${w.open ? 'in progress' : `${w.done.length} finished${w.ppc === null ? '' : ` (${w.ppc}%)`}`}`}</title>
                          {sel && <rect x={x - 4} y={4} width={BAR * 2 + 8} height={H + 36} fill="var(--accent-dim)" rx={4} />}
                          <rect x={x} y={20 + H - ph} width={BAR} height={ph} fill="var(--border)" />
                          <rect x={x + BAR} y={20 + H - dh} width={BAR} height={w.open ? 0 : dh} fill="var(--bar-normal)" />
                          <text x={x + BAR} y={14} textAnchor="middle" fontSize={10} fill={w.ppc === null || w.open ? 'var(--text-dim)' : ppcColor(w.ppc)}>
                            {w.open ? '…' : w.ppc === null ? '' : `${w.ppc}%`}
                          </text>
                          <text x={x + BAR} y={H + 36} textAnchor="middle" fontSize={9} fill="var(--text-dim)">{w.start.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
                <div className="report-chips">
                  <span className="report-chip"><i style={{ background: 'var(--border)' }} />Planned</span>
                  <span className="report-chip"><i style={{ background: 'var(--bar-normal)' }} />Finished by the week's end</span>
                </div>
                <PagedTable columns={cols} rows={[...weeks].reverse()} rowKey={(w) => String(w.start.getTime())} />
              </Section>

              {week && !week.open && (
                <Section title={`Missed in the week of ${fmtDate(week.start)} (${week.missed.length})`}>
                  {week.missed.length === 0 ? <div className="report-empty">Everything planned was finished.</div> : <PagedTable columns={missedCols} rows={week.missed} rowKey={(a) => a.id} />}
                </Section>
              )}

              <Section title="Why plans were missed">
                <BarList rows={pareto} emptyText="Give the missed activities a reason above and they add up here." />
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
