import { useMemo } from 'react';
import type { Activity, ScheduleModel } from '../../schedule/types';
import { constraintClass, constraintName, fmtDate } from '../../schedule/reports';
import { downloadCsv } from '../../utils/csv';
import { BarList, PagedTable, ReportHeader, Section, Tiles } from './ReportParts';

interface WbsRow {
  wbs: string;
  total: number;
  hard: number;
  soft: number;
}

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : '0.0%');

export function ConstraintReport({ model, onBack }: { model: ScheduleModel; onBack: () => void }) {
  const acts = useMemo(() => model.activities.filter((a) => a.type !== 'wbs-summary'), [model]);
  const hard = useMemo(() => acts.filter((a) => constraintClass(a) === 'hard'), [acts]);
  const soft = useMemo(() => acts.filter((a) => constraintClass(a) === 'soft'), [acts]);

  const typeCounts = (list: Activity[]) => {
    const m = new Map<string, number>();
    for (const a of list) m.set(a.constraintType!, (m.get(a.constraintType!) ?? 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1]).map(([t, value]) => ({ label: constraintName(t), value }));
  };
  const hardTypes = typeCounts(hard);
  const softTypes = typeCounts(soft);
  const allTypes = typeCounts([...hard, ...soft]);

  const wbsRows = useMemo<WbsRow[]>(() => {
    const m = new Map<string, WbsRow>();
    for (const a of acts) {
      const key = a.wbsPath || '—';
      const r = m.get(key) ?? { wbs: key, total: 0, hard: 0, soft: 0 };
      r.total++;
      const c = constraintClass(a);
      if (c === 'hard') r.hard++;
      else if (c === 'soft') r.soft++;
      m.set(key, r);
    }
    return [...m.values()];
  }, [acts]);

  const none = acts.length - hard.length - soft.length;
  const exportCsv = () =>
    downloadCsv('constraints.csv', ['Activity ID', 'Activity Name', 'WBS', 'Constraint', 'Class', 'Constraint Date'],
      [...hard, ...soft].map((a) => [a.code || a.id, a.name, a.wbsPath, constraintName(a.constraintType!), constraintClass(a), fmtDate(a.constraintDate)]));

  return (
    <div className="report">
      <ReportHeader title="Constraint Analysis" model={model} onBack={onBack} onExport={exportCsv}
        description="Hard and soft constraints, affected activities and constraint types." />

      <Section title="Executive summary">
        <Tiles tiles={[
          { value: acts.length, label: 'Total Activities' },
          { value: hard.length, label: 'Hard Constrained', color: '#2f7fe0' },
          { value: pct(hard.length, acts.length), label: 'Hard Constraint %', color: '#1fa0e0' },
          { value: allTypes.length, label: 'Constraint Types', color: '#7a3cdc' },
          { value: allTypes[0]?.label ?? '—', label: 'Most Used Constraint' },
          { value: soft.length, label: 'Soft Constrained', color: '#7a3cdc' },
        ]} />
      </Section>

      <Section title="Constraint coverage">
        <div className="report-stack" role="img" aria-label={`${hard.length} hard, ${soft.length} soft, ${none} unconstrained`}>
          {hard.length > 0 && <span style={{ flex: hard.length, background: '#2f7fe0' }} />}
          {soft.length > 0 && <span style={{ flex: soft.length, background: '#a48cf0' }} />}
          {none > 0 && <span style={{ flex: none, background: '#d4d7d5' }} />}
        </div>
        <div className="report-legend">
          <span><i style={{ background: '#2f7fe0' }} />Hard — {hard.length} ({pct(hard.length, acts.length)})</span>
          <span><i style={{ background: '#a48cf0' }} />Soft — {soft.length} ({pct(soft.length, acts.length)})</span>
          <span><i style={{ background: '#d4d7d5' }} />Unconstrained — {none} ({pct(none, acts.length)})</span>
        </div>
      </Section>

      <Section title="Hard constraint type distribution">
        <BarList rows={hardTypes.map((r) => ({ ...r, color: '#8cbcf0' }))} emptyText="No hard constraints in this schedule." />
      </Section>

      <Section title="Soft constraint type distribution">
        <BarList rows={softTypes.map((r) => ({ ...r, color: '#a48cf0' }))} emptyText="No soft constraints in this schedule." />
      </Section>

      <Section title="Constraint concentration by WBS">
        <PagedTable<WbsRow>
          rows={wbsRows} rowKey={(r) => r.wbs} initialSort={{ key: 'hard', dir: 'desc' }}
          columns={[
            { key: 'wbs', label: 'WBS', render: (r) => r.wbs, sort: (r) => r.wbs },
            { key: 'total', label: 'Activities', align: 'right', render: (r) => r.total, sort: (r) => r.total },
            { key: 'hard', label: 'Hard Constrained', align: 'right', render: (r) => r.hard, sort: (r) => r.hard },
            { key: 'ph', label: '% Hard', align: 'right', render: (r) => <strong>{pct(r.hard, r.total)}</strong>, sort: (r) => r.hard / r.total },
            { key: 'soft', label: 'Soft Constrained', align: 'right', render: (r) => r.soft, sort: (r) => r.soft },
            { key: 'ps', label: '% Soft', align: 'right', render: (r) => <strong style={{ color: '#7a3cdc' }}>{pct(r.soft, r.total)}</strong>, sort: (r) => r.soft / r.total },
          ]}
        />
      </Section>
    </div>
  );
}
