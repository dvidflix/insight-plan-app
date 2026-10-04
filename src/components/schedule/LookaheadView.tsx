import { useMemo, useState } from 'react';
import type { Activity, ScheduleModel } from '../../schedule/types';
import { WHY_LABEL, lookahead, type LookaheadRow, type LookaheadWhy } from '../../schedule/lookahead';
import { STATUS_LABEL } from '../../schedule/filterFields';
import { daysOf, fmtDate } from '../../schedule/reports';
import { downloadCsv } from '../../utils/csv';
import { useSequenceTimelineStore } from '../../state/sequenceTimelineStore';
import { usePersistedState } from '../../utils/persistedState';
import { FilterRow, FilterSelect, PagedTable, Section, Tiles, type Column } from '../reports/ReportParts';

const pad = (n: number) => String(n).padStart(2, '0');
const toInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromInput = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
};

const WEEK_OPTIONS = [1, 2, 3, 4, 6, 8, 12].map((n) => ({ value: String(n), label: `${n} week${n === 1 ? '' : 's'}` }));
const WHY_COLOR: Record<LookaheadWhy, string> = { late: 'var(--bar-critical)', starts: 'var(--bar-normal)', finishes: 'var(--bar-done)', runs: 'var(--text-dim)' };

/** Programmes > Lookahead: the work a short window of the programme asks for.
    Pick the first day and how many weeks; the table lists what starts, finishes
    or runs through it, and what is already late. */
export function LookaheadView({ model, onSelect }: { model: ScheduleModel; onSelect: (activity: Activity) => void }) {
  const dataDate = model.project.dataDate ?? new Date();
  const [from, setFrom] = usePersistedState<string>('schedule.lookaheadFrom', '');
  const [weeks, setWeeks] = usePersistedState<string>('schedule.lookaheadWeeks', '3');
  const [why, setWhy] = useState('all');
  const start = (from && fromInput(from)) || dataDate;
  const n = Number(weeks) || 3;

  const rows = useMemo(() => lookahead(model.activities, start, n), [model, start, n]);
  const count = (w: LookaheadWhy) => rows.filter((r) => r.why.includes(w)).length;
  const shown = why === 'all' ? rows : rows.filter((r) => r.why.includes(why as LookaheadWhy));
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + n * 7 - 1);

  const cols: Column<LookaheadRow>[] = [
    {
      key: 'why', label: 'Why',
      render: (r) => r.why.map((w) => <span key={w} className="report-chip" style={{ marginRight: 4 }}><i style={{ background: WHY_COLOR[w] }} />{WHY_LABEL[w]}</span>),
      sort: (r) => r.why[0],
    },
    { key: 'id', label: 'Activity ID', render: (r) => <button type="button" className="link-btn" onClick={() => onSelect(r.activity)}>{r.activity.code || r.activity.id}</button>, sort: (r) => r.activity.code },
    { key: 'name', label: 'Activity Name', render: (r) => <span className="report-clip" title={r.activity.name}>{r.activity.name}</span>, sort: (r) => r.activity.name },
    { key: 'wbs', label: 'WBS', render: (r) => <span className="report-clip" title={r.activity.wbsPath}>{r.activity.wbsPath}</span>, sort: (r) => r.activity.wbsPath },
    { key: 'start', label: 'Start', render: (r) => fmtDate(r.start), sort: (r) => r.start?.getTime() ?? null },
    { key: 'finish', label: 'Finish', render: (r) => fmtDate(r.finish), sort: (r) => r.finish?.getTime() ?? null },
    { key: 'float', label: 'Float (d)', align: 'right', render: (r) => daysOf(r.activity.totalFloatHours) ?? '—', sort: (r) => daysOf(r.activity.totalFloatHours) },
    { key: 'pct', label: '%', align: 'right', render: (r) => `${r.activity.percentComplete}%`, sort: (r) => r.activity.percentComplete },
    { key: 'status', label: 'Status', render: (r) => STATUS_LABEL[r.activity.status], sort: (r) => r.activity.status },
  ];

  const exportCsv = () =>
    downloadCsv(`lookahead-${toInput(start)}.csv`, ['Why', 'Activity ID', 'Activity Name', 'WBS', 'Start', 'Finish', 'Float (d)', '% Complete', 'Status'],
      shown.map((r) => [r.why.map((w) => WHY_LABEL[w]).join(' + '), r.activity.code || r.activity.id, r.activity.name, r.activity.wbsPath, fmtDate(r.start), fmtDate(r.finish), daysOf(r.activity.totalFloatHours) ?? '', r.activity.percentComplete, STATUS_LABEL[r.activity.status]]));

  const showIn4d = () => {
    const t = useSequenceTimelineStore.getState();
    t.setPlaying(false);
    t.setDate(start.getTime());
  };

  return (
    <div className="page-body" style={{ overflow: 'auto' }}>
      <div className="page-body__main" style={{ padding: 12 }}>
        <div className="report">
          <div className="report-header">
            <div className="report-header__row">
              <h2 className="report-header__title">Lookahead</h2>
              <button type="button" className="checks-export-btn report-header__export" onClick={showIn4d} title="Move the 4D timeline to the first day of the window">Set 4D date</button>
              <button type="button" className="checks-export-btn report-header__export" onClick={exportCsv}>Export (CSV)</button>
            </div>
            <div className="report-header__desc">{fmtDate(start)} to {fmtDate(end)} · {model.project.name}</div>
          </div>

          <Section title="Window">
            <FilterRow onClear={() => { setFrom(''); setWeeks('3'); setWhy('all'); }} summary={`${shown.length} of ${rows.length} activities`}>
              <label className="report-filter">
                <span>From</span>
                <input type="date" value={toInput(start)} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <FilterSelect label="Length" value={weeks} onChange={setWeeks} options={WEEK_OPTIONS} />
              <FilterSelect label="Show" value={why} onChange={setWhy} options={[{ value: 'all', label: 'All' }, ...(Object.keys(WHY_LABEL) as LookaheadWhy[]).map((w) => ({ value: w, label: WHY_LABEL[w] }))]} />
            </FilterRow>
            <Tiles tiles={[
              { value: rows.length, label: 'In the window' },
              { value: count('starts'), label: 'Start' },
              { value: count('finishes'), label: 'Finish' },
              { value: count('runs'), label: 'Run through' },
              { value: count('late'), label: 'Late', color: 'var(--bar-critical)' },
            ]} />
          </Section>

          <Section title="Activities">
            <PagedTable columns={cols} rows={shown} rowKey={(r) => r.activity.id} initialSort={{ key: 'start', dir: 'asc' }} />
          </Section>
        </div>
      </div>
    </div>
  );
}
