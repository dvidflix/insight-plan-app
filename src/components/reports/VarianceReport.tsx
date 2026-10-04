import { useMemo, useState } from 'react';
import type { ActivityStatus, ScheduleModel } from '../../schedule/types';
import { STATUS_LABEL } from '../../schedule/filterFields';
import { fmtDate, fmtNum, milestoneVarianceRows, wbsVarianceRows, type VarianceRow } from '../../schedule/reports';
import { downloadCsv } from '../../utils/csv';
import { PagedTable, ReportHeader, Section, type Column } from './ReportParts';
import { ExpandCollapseToggle } from '../ExpandCollapseToggle';
import { IconExpander } from '../icons';

const varianceCell = (v: number | null) =>
  v === null ? '—' : <span style={{ color: v > 0 ? 'var(--danger)' : v < 0 ? 'var(--ok)' : undefined, fontWeight: v ? 700 : undefined }}>{v > 0 ? `+${v}` : v}</span>;

const statusLabel = (s: string) => STATUS_LABEL[s as ActivityStatus] ?? s;

const DESCRIPTION = 'Variance is the current finish against the target (baseline) finish, in calendar days; positive is late.';

function exportRows(name: string, rows: VarianceRow[]) {
  downloadCsv(name, ['Activity ID', 'Name', 'WBS', 'BL Start', 'BL Finish', 'Start', 'Finish', 'Status', 'Variance (d)', 'Total Float (d)'],
    rows.map((r) => [r.code, r.name, r.wbs, fmtDate(r.blStart), fmtDate(r.blFinish), fmtDate(r.start), fmtDate(r.finish), statusLabel(r.status), r.variance ?? '', r.floatDays ?? '']));
}

export function WbsVarianceReport({ model, onBack }: { model: ScheduleModel; onBack: () => void }) {
  const rows = useMemo(() => wbsVarianceRows(model), [model]);
  const columns: Column<VarianceRow>[] = [
    { key: 'wbs', label: 'WBS', render: (r) => r.wbs, sort: (r) => r.wbs },
    { key: 'bls', label: 'BL Project Start', align: 'right', render: (r) => fmtDate(r.blStart), sort: (r) => r.blStart?.getTime() ?? null },
    { key: 'blf', label: 'BL Project Finish', align: 'right', render: (r) => fmtDate(r.blFinish), sort: (r) => r.blFinish?.getTime() ?? null },
    { key: 'st', label: 'Start', align: 'right', render: (r) => fmtDate(r.start), sort: (r) => r.start?.getTime() ?? null },
    { key: 'fi', label: 'Finish', align: 'right', render: (r) => fmtDate(r.finish), sort: (r) => r.finish?.getTime() ?? null },
    { key: 'status', label: 'Activity Status', render: (r) => statusLabel(r.status), sort: (r) => r.status },
    { key: 'var', label: 'Variance', align: 'right', render: (r) => varianceCell(r.variance), sort: (r) => r.variance },
    { key: 'tf', label: 'Total Float', align: 'right', render: (r) => fmtNum(r.floatDays), sort: (r) => r.floatDays },
  ];
  return (
    <div className="report">
      <ReportHeader title="WBS Variance" model={model} onBack={onBack} onExport={() => exportRows('wbs-variance.csv', rows)}
        description={`Activities rolled up to WBS rows. ${DESCRIPTION}`} />
      <Section title="WBS roll-up">
        <PagedTable columns={columns} rows={rows} rowKey={(r) => r.key} initialSort={{ key: 'var', dir: 'desc' }} />
      </Section>
    </div>
  );
}

export function MilestoneVarianceReport({ model, onBack }: { model: ScheduleModel; onBack: () => void }) {
  const rows = useMemo(() => milestoneVarianceRows(model), [model]);
  const groups = useMemo(() => {
    const m = new Map<string, VarianceRow[]>();
    for (const r of rows) (m.get(r.wbs) ?? m.set(r.wbs, []).get(r.wbs)!).push(r);
    return [...m.entries()];
  }, [rows]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (wbs: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(wbs)) next.add(wbs);
      return next;
    });

  return (
    <div className="report">
      <ReportHeader title="Milestone Variance" model={model} onBack={onBack} onExport={() => exportRows('milestone-variance.csv', rows)}
        description={`Start and finish milestones grouped by WBS branch; branches with none are dropped. ${DESCRIPTION}`} />
      <Section title={`${rows.length} milestones`}>
        <div className="report-actions">
          <ExpandCollapseToggle
            className="report-link"
            collapsed={groups.length > 0 && groups.every(([w]) => collapsed.has(w))}
            onCollapse={() => setCollapsed(new Set(groups.map(([w]) => w)))}
            onExpand={() => setCollapsed(new Set())}
          />
        </div>
        <div className="report-table">
          <div className="report-table__scroll report-table__scroll--tall">
            <table>
              <thead>
                <tr>
                  <th>Activity ID</th><th>Milestone</th>
                  <th className="right">BL Project Start</th><th className="right">BL Project Finish</th>
                  <th className="right">Start</th><th className="right">Finish</th>
                  <th>Activity Status</th><th className="right">Variance</th><th className="right">Total Float</th>
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 && <tr><td colSpan={9} className="report-empty">No milestones in this schedule.</td></tr>}
                {groups.map(([wbs, list]) => {
                  const closed = collapsed.has(wbs);
                  return [
                    <tr className="report-group" key={`g:${wbs}`} onClick={() => toggle(wbs)}>
                      <td colSpan={9}><IconExpander open={!closed} /> {wbs} <span className="report-group__count">({list.length})</span></td>
                    </tr>,
                    ...(closed ? [] : list.map((r) => (
                      <tr key={r.key}>
                        <td>{r.code}</td><td>{r.name}</td>
                        <td className="right">{fmtDate(r.blStart)}</td><td className="right">{fmtDate(r.blFinish)}</td>
                        <td className="right">{fmtDate(r.start)}</td><td className="right">{fmtDate(r.finish)}</td>
                        <td>{statusLabel(r.status)}</td><td className="right">{varianceCell(r.variance)}</td><td className="right">{fmtNum(r.floatDays)}</td>
                      </tr>
                    ))),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Section>
    </div>
  );
}
