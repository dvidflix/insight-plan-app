import { useMemo, useState } from 'react';
import type { Activity, ScheduleModel } from '../../schedule/types';
import { STATUS_LABEL, TYPE_LABEL } from '../../schedule/filterFields';
import { FLOAT_BUCKETS, daysOf, fmtDate, fmtNum, floatCategory, isMilestone, type FloatCategory } from '../../schedule/reports';
import { downloadCsv } from '../../utils/csv';
import { BarList, FilterRow, FilterSelect, FilterText, PagedTable, ReportHeader, Section, Tiles, type Column } from './ReportParts';
import { queryMatcher } from '../../schedule/search';

interface Row {
  a: Activity;
  floatDays: number;
  category: FloatCategory;
}

const CATEGORY_CLASS: Record<FloatCategory, string> = {
  Critical: 'red', 'Near-critical': 'amber', 'Low float': 'amber', OK: 'green',
};

export function FloatReport({ model, onBack }: { model: ScheduleModel; onBack: () => void }) {
  const [category, setCategory] = useState('all');
  const [wbs, setWbs] = useState('');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [milestonesOnly, setMilestonesOnly] = useState(false);

  const rows = useMemo<Row[]>(
    () => model.activities
      .filter((a) => a.type !== 'wbs-summary' && a.totalFloatHours !== null)
      .map((a) => { const floatDays = daysOf(a.totalFloatHours)!; return { a, floatDays, category: floatCategory(floatDays) }; }),
    [model],
  );

  const clear = () => { setCategory('all'); setWbs(''); setStatus('all'); setType('all'); setMilestonesOnly(false); };
  const filtered = useMemo(() => {
    const q = wbs.trim().toLowerCase();
    const hit = queryMatcher(wbs);
    return rows.filter((r) =>
      (category === 'all' || r.category === category) &&
      (status === 'all' || r.a.status === status) &&
      (type === 'all' || r.a.type === type) &&
      (!milestonesOnly || isMilestone(r.a)) &&
      (!q || hit(r.a.wbsPath)));
  }, [rows, category, wbs, status, type, milestonesOnly]);

  const n = (c: FloatCategory) => rows.filter((r) => r.category === c).length;
  const avg = rows.length ? rows.reduce((s, r) => s + r.floatDays, 0) / rows.length : null;

  const cols: Column<Row>[] = [
    { key: 'id', label: 'Activity ID', render: (r) => r.a.code || r.a.id, sort: (r) => r.a.code },
    { key: 'name', label: 'Activity Name', render: (r) => <span className="report-clip" title={r.a.name}>{r.a.name}</span>, sort: (r) => r.a.name },
    { key: 'wbs', label: 'WBS', render: (r) => <span className="report-clip" title={r.a.wbsPath}>{r.a.wbsPath}</span>, sort: (r) => r.a.wbsPath },
    { key: 'start', label: 'Start', render: (r) => fmtDate(r.a.actualStart ?? r.a.earlyStart), sort: (r) => (r.a.actualStart ?? r.a.earlyStart)?.getTime() ?? null },
    { key: 'finish', label: 'Finish', render: (r) => fmtDate(r.a.actualFinish ?? r.a.earlyFinish), sort: (r) => (r.a.actualFinish ?? r.a.earlyFinish)?.getTime() ?? null },
    { key: 'dur', label: 'Duration', align: 'right', render: (r) => fmtNum(daysOf(r.a.durationHours), 0), sort: (r) => r.a.durationHours },
    { key: 'tf', label: 'Total Float', align: 'right', render: (r) => <span style={{ color: r.floatDays < 0 ? 'var(--danger)' : undefined, fontWeight: r.floatDays <= 0 ? 700 : undefined }}>{fmtNum(r.floatDays)}</span>, sort: (r) => r.floatDays },
    { key: 'ff', label: 'Free Float', align: 'right', render: (r) => fmtNum(daysOf(r.a.freeFloatHours)), sort: (r) => daysOf(r.a.freeFloatHours) },
    { key: 'crit', label: 'Criticality', render: (r) => <span className={`check-badge check-badge--${CATEGORY_CLASS[r.category]}`}>{r.category}</span>, sort: (r) => r.floatDays },
    { key: 'st', label: 'Status', render: (r) => STATUS_LABEL[r.a.status], sort: (r) => r.a.status },
  ];

  const exportCsv = () =>
    downloadCsv('float-analysis.csv',
      ['Activity ID', 'Activity Name', 'WBS', 'Start', 'Finish', 'Duration (d)', 'Total Float (d)', 'Free Float (d)', 'Criticality', 'Status'],
      filtered.map((r) => [r.a.code || r.a.id, r.a.name, r.a.wbsPath, fmtDate(r.a.actualStart ?? r.a.earlyStart), fmtDate(r.a.actualFinish ?? r.a.earlyFinish),
        daysOf(r.a.durationHours) ?? '', r.floatDays, daysOf(r.a.freeFloatHours) ?? '', r.category, STATUS_LABEL[r.a.status]]));

  return (
    <div className="report">
      <ReportHeader title="Float Analysis" model={model} onBack={onBack} onExport={exportCsv} description="Schedule flexibility and criticality." />

      <Section title="Executive summary">
        <Tiles tiles={[
          { value: rows.length, label: 'Total Activities' },
          { value: n('Critical'), label: 'Critical (float ≤ 0)', color: '#e8321c' },
          { value: n('Near-critical'), label: 'Near-Critical (1–5d)', color: '#f0701c' },
          { value: n('Low float'), label: 'Low Float (6–10d)', color: '#e0a010' },
          { value: rows.filter((r) => r.floatDays < -0.05).length, label: 'Negative Float', color: '#a51c10' },
          { value: fmtNum(avg), label: 'Avg Total Float (d)' },
        ]} />
      </Section>

      <Section title="Float distribution (working days)">
        <BarList rows={FLOAT_BUCKETS.map((b) => ({ label: b.label, color: b.color, value: rows.filter((r) => b.test(r.floatDays)).length }))} />
      </Section>

      <Section title="Activity analysis">
        <FilterRow onClear={clear} summary={`${filtered.length} of ${rows.length} activities`}>
          <FilterSelect label="Category" value={category} onChange={setCategory} options={[{ value: 'all', label: 'All' }, ...(['Critical', 'Near-critical', 'Low float', 'OK'] as const).map((c) => ({ value: c, label: c }))]} />
          <FilterText label="WBS" value={wbs} onChange={setWbs} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All' }, ...Object.entries(STATUS_LABEL).map(([value, label]) => ({ value, label }))]} />
          <FilterSelect label="Type" value={type} onChange={setType} options={[{ value: 'all', label: 'All' }, ...Object.entries(TYPE_LABEL).filter(([v]) => v !== 'wbs-summary').map(([value, label]) => ({ value, label }))]} />
          <button type="button" className={`report-toggle${milestonesOnly ? ' active' : ''}`} onClick={() => setMilestonesOnly((v) => !v)}>Milestones only</button>
        </FilterRow>
        <PagedTable columns={cols} rows={filtered} rowKey={(r) => r.a.id} initialSort={{ key: 'tf', dir: 'asc' }} />
      </Section>
    </div>
  );
}
