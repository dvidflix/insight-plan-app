import { useMemo, useState } from 'react';
import type { RelationType, ScheduleModel } from '../../schedule/types';
import { LAG_BUCKETS, REL_TYPE_LABEL, fmtNum, relationshipRows, type RelRow } from '../../schedule/reports';
import { downloadCsv } from '../../utils/csv';
import { BarList, Chips, FilterRow, FilterSelect, FilterText, PagedTable, ReportHeader, Section, Tiles, type Column } from './ReportParts';
import { queryMatcher } from '../../schedule/search';

const TYPES: RelationType[] = ['FS', 'SS', 'FF', 'SF'];
const TYPE_COLOR = '#8cbcf0';
const LEAD_COLOR = '#7a3cdc';
const LAG_COLOR = '#f0961c';

const lagCell = (r: RelRow) => (
  <span style={{ color: r.lagDays > 0 ? LAG_COLOR : r.lagDays < 0 ? LEAD_COLOR : undefined, fontWeight: r.lagDays ? 700 : undefined }}>{fmtNum(r.lagDays)}</span>
);
const floatCell = (v: number | null) => (
  <span style={{ color: v !== null && v <= 0 ? 'var(--danger)' : undefined, fontWeight: v !== null && v <= 0 ? 700 : undefined }}>{fmtNum(v)}</span>
);

interface WbsStat { wbs: string; total: number; fs: number; ss: number; ff: number; sf: number; lagged: number; lead: number; lagSum: number; lagMax: number }

export function RelationshipReport({ model, onBack }: { model: ScheduleModel; onBack: () => void }) {
  const rows = useMemo(() => relationshipRows(model), [model]);
  const [type, setType] = useState('all');
  const [lagKind, setLagKind] = useState('all');
  const [range, setRange] = useState('all');
  const [wbs, setWbs] = useState('');
  const clear = () => { setType('all'); setLagKind('all'); setRange('all'); setWbs(''); };

  const count = (fn: (r: RelRow) => boolean) => rows.filter(fn).length;
  const stats = useMemo(() => {
    const byWbs = new Map<string, WbsStat>();
    for (const r of rows) {
      const s = byWbs.get(r.succWbs) ?? { wbs: r.succWbs, total: 0, fs: 0, ss: 0, ff: 0, sf: 0, lagged: 0, lead: 0, lagSum: 0, lagMax: 0 };
      s.total++;
      s[r.type.toLowerCase() as 'fs' | 'ss' | 'ff' | 'sf']++;
      if (r.lagDays > 0) { s.lagged++; s.lagSum += r.lagDays; s.lagMax = Math.max(s.lagMax, r.lagDays); }
      if (r.lagDays < 0) s.lead++;
      byWbs.set(r.succWbs, s);
    }
    return [...byWbs.values()];
  }, [rows]);

  const filtered = useMemo(() => {
    const q = wbs.trim().toLowerCase();
    const hit = queryMatcher(wbs);
    return rows.filter((r) => {
      if (type !== 'all' && r.type !== type) return false;
      if (lagKind === 'lag' && !(r.lagDays > 0)) return false;
      if (lagKind === 'lead' && !(r.lagDays < 0)) return false;
      if (lagKind === 'none' && r.lagDays !== 0) return false;
      if (range === '10' && !(r.lagDays > 10)) return false;
      if (range === '30' && !(r.lagDays > 30)) return false;
      if (q && !hit(r.predWbs) && !hit(r.succWbs)) return false;
      return true;
    });
  }, [rows, type, lagKind, range, wbs]);

  const cross = useMemo(() => rows.filter((r) => r.crossWbs), [rows]);
  const lagStats = useMemo(() => stats.filter((s) => s.lagged > 0).sort((a, b) => b.lagged - a.lagged), [stats]);

  const cols: Column<RelRow>[] = [
    { key: 'pc', label: 'Predecessor ID', render: (r) => r.predCode, sort: (r) => r.predCode },
    { key: 'pn', label: 'Predecessor Name', render: (r) => <span className="report-clip" title={r.predName}>{r.predName}</span>, sort: (r) => r.predName },
    { key: 'sc', label: 'Successor ID', render: (r) => r.succCode, sort: (r) => r.succCode },
    { key: 'sn', label: 'Successor Name', render: (r) => <span className="report-clip" title={r.succName}>{r.succName}</span>, sort: (r) => r.succName },
    { key: 'ty', label: 'Relationship Type', render: (r) => REL_TYPE_LABEL[r.type], sort: (r) => r.type },
    { key: 'lg', label: 'Lag / Lead', align: 'right', render: lagCell, sort: (r) => r.lagDays },
    { key: 'pw', label: 'Predecessor WBS', render: (r) => <span className="report-clip" title={r.predWbs}>{r.predWbs}</span>, sort: (r) => r.predWbs },
    { key: 'sw', label: 'Successor WBS', render: (r) => <span className="report-clip" title={r.succWbs}>{r.succWbs}</span>, sort: (r) => r.succWbs },
    { key: 'pf', label: 'Pred. Total Float', align: 'right', render: (r) => floatCell(r.predFloat), sort: (r) => r.predFloat },
    { key: 'sf', label: 'Succ. Total Float', align: 'right', render: (r) => floatCell(r.succFloat), sort: (r) => r.succFloat },
  ];

  const exportCsv = () =>
    downloadCsv('relationships.csv',
      ['Predecessor ID', 'Predecessor Name', 'Successor ID', 'Successor Name', 'Type', 'Lag (d)', 'Predecessor WBS', 'Successor WBS', 'Pred TF (d)', 'Succ TF (d)'],
      filtered.map((r) => [r.predCode, r.predName, r.succCode, r.succName, r.type, r.lagDays, r.predWbs, r.succWbs, r.predFloat ?? '', r.succFloat ?? '']));

  return (
    <div className="report">
      <ReportHeader
        title="Relationship and Lag Analysis" model={model} onBack={onBack} onExport={exportCsv}
        description="Schedule relationships, lags, leads, and network connectivity across the project schedule."
      />

      <Section title="Executive summary">
        <Tiles tiles={[
          { value: rows.length, label: 'Total Relationships' },
          ...TYPES.map((t, i) => ({ value: count((r) => r.type === t), label: `${t} Relationships`, color: ['#2f7fe0', '#1fa0e0', '#7a3cdc', '#d02a78'][i] })),
          { value: count((r) => r.lagDays > 0), label: 'With Lag', color: LAG_COLOR },
          { value: count((r) => r.lagDays < 0), label: 'With Lead', color: LEAD_COLOR },
        ]} />
      </Section>

      <Section title="Relationship type distribution">
        <BarList rows={TYPES.map((t) => {
          const n = count((r) => r.type === t);
          return { label: `${REL_TYPE_LABEL[t]} (${rows.length ? Math.round((n / rows.length) * 100) : 0}%)`, value: n, color: TYPE_COLOR };
        })} />
      </Section>

      <Section title="Lag / lead distribution">
        <BarList rows={LAG_BUCKETS.map((b) => ({
          label: b.label, value: count((r) => b.test(r.lagDays)),
          color: b.label.startsWith('Lead') ? LEAD_COLOR : b.label.startsWith('Lag') ? LAG_COLOR : '#8f9db5',
        }))} />
      </Section>

      <Section title="Large lag / lead — relationships requiring review">
        <Chips items={[
          { text: `${count((r) => r.lagDays > 10)} relationships have a lag greater than 10 days.`, color: LAG_COLOR },
          { text: `${count((r) => r.lagDays > 30)} relationships have a lag greater than 30 days.`, color: '#e8321c' },
          { text: `${count((r) => r.lagDays < 0)} relationships have a negative lag (lead).`, color: LEAD_COLOR },
        ]} />
      </Section>

      <Section title="Relationship + float">
        <Chips items={[{ text: `${count((r) => r.succFloat !== null && r.succFloat <= 0)} relationships feed directly into activities with 0 or negative total float.`, color: '#e8321c' }]} />
      </Section>

      <Section title="Relationship and lag table">
        <FilterRow onClear={clear} summary={`${filtered.length} of ${rows.length} relationships`}>
          <FilterSelect label="Type" value={type} onChange={setType} options={[{ value: 'all', label: 'All' }, ...TYPES.map((t) => ({ value: t, label: t }))]} />
          <FilterSelect label="Lag/Lead" value={lagKind} onChange={setLagKind} options={[{ value: 'all', label: 'All' }, { value: 'lag', label: 'Lag' }, { value: 'lead', label: 'Lead' }, { value: 'none', label: 'None' }]} />
          <FilterSelect label="Lag Range" value={range} onChange={setRange} options={[{ value: 'all', label: 'All' }, { value: '10', label: '> 10 days' }, { value: '30', label: '> 30 days' }]} />
          <FilterText label="WBS" value={wbs} onChange={setWbs} />
        </FilterRow>
        <PagedTable columns={cols} rows={filtered} rowKey={(r) => r.key} initialSort={{ key: 'lg', dir: 'desc' }} />
      </Section>

      <Section title="WBS relationship analysis">
        <PagedTable<WbsStat>
          rows={stats} rowKey={(s) => s.wbs} initialSort={{ key: 'total', dir: 'desc' }}
          columns={[
            { key: 'wbs', label: 'WBS', render: (s) => s.wbs, sort: (s) => s.wbs },
            ...(['total', 'fs', 'ss', 'ff', 'sf'] as const).map((k) => ({ key: k, label: k === 'total' ? 'Total' : k.toUpperCase(), align: 'right' as const, render: (s: WbsStat) => s[k], sort: (s: WbsStat) => s[k] })),
            { key: 'lagged', label: 'Lagged', align: 'right', render: (s) => s.lagged, sort: (s) => s.lagged },
            { key: 'lead', label: 'Lead', align: 'right', render: (s) => s.lead, sort: (s) => s.lead },
          ]}
        />
      </Section>

      <Section title="Cross-WBS relationships">
        <PagedTable<RelRow>
          rows={cross} rowKey={(r) => r.key}
          columns={[
            { key: 'pw', label: 'Predecessor WBS', render: (r) => r.predWbs, sort: (r) => r.predWbs },
            { key: 'sw', label: 'Successor WBS', render: (r) => r.succWbs, sort: (r) => r.succWbs },
            { key: 'p', label: 'Predecessor', render: (r) => <span className="report-clip" title={r.predName}>{r.predCode} — {r.predName}</span> },
            { key: 's', label: 'Successor', render: (r) => <span className="report-clip" title={r.succName}>{r.succCode} — {r.succName}</span> },
            { key: 'ty', label: 'Type', render: (r) => REL_TYPE_LABEL[r.type], sort: (r) => r.type },
            { key: 'lg', label: 'Lag/Lead', align: 'right', render: lagCell, sort: (r) => r.lagDays },
          ]}
        />
      </Section>

      <Section title="Lag analysis by WBS">
        <PagedTable<WbsStat>
          rows={lagStats} rowKey={(s) => s.wbs} initialSort={{ key: 'lagged', dir: 'desc' }}
          columns={[
            { key: 'wbs', label: 'WBS', render: (s) => s.wbs, sort: (s) => s.wbs },
            { key: 'total', label: 'Total Relationships', align: 'right', render: (s) => s.total, sort: (s) => s.total },
            { key: 'lagged', label: 'With Lag', align: 'right', render: (s) => s.lagged, sort: (s) => s.lagged },
            { key: 'avg', label: 'Average Lag', align: 'right', render: (s) => fmtNum(s.lagSum / s.lagged), sort: (s) => s.lagSum / s.lagged },
            { key: 'max', label: 'Maximum Lag', align: 'right', render: (s) => <strong>{fmtNum(s.lagMax)}</strong>, sort: (s) => s.lagMax },
          ]}
        />
      </Section>
    </div>
  );
}
