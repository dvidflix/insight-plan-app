import { useMemo, useState } from 'react';
import type { Activity, ScheduleModel } from '../../schedule/types';
import { bucketsOf, buildLoading, dateOfDay, type Period } from '../../schedule/resourceLoading';
import { addsUp, buildDistribution, metricOf, type DistRow, type LabourMeasure } from '../../schedule/resourceDistribution';
import { applyVirtualResources, virtualCatalog } from '../../schedule/virtualResources';
import { usePersistedState } from '../../utils/persistedState';
import { downloadCsv } from '../../utils/csv';
import { fmtNum } from './ResourceCharts';
import { IconExpander } from '../icons';

const PERIODS: { id: Period; label: string }[] = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' },
];
const MEASURES: { id: LabourMeasure; label: string }[] = [
  { id: 'hours', label: 'Man-hours' },
  { id: 'peak', label: 'People (busiest day)' },
  { id: 'avg', label: 'People (average weekday)' },
];
const WBS_LEVELS = [
  { id: 0, label: 'No WBS split' },
  { id: 1, label: 'Split by WBS level 1' },
  { id: 2, label: 'Split by WBS level 2' },
  { id: 3, label: 'Split by WBS level 3' },
  { id: 4, label: 'Split by WBS level 4' },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Line {
  row: DistRow;
  /** The group a row belongs to (to tint its resource figures by their own largest period). */
  open: boolean;
}

/** Programmes > Resource Distribution: the Gantt's time scale with the
    quantity of each resource in each week, month, quarter or year in place of
    bars. A row per resource under Labour, Equipment and Materials, each
    optionally split by WBS level; the figures are shaded by how big they are
    against that row's busiest period, with a total on the right and a CSV
    export. */
export function ResourceDistribution({ model, activities }: { model: ScheduleModel; activities: Activity[] }) {
  const [period, setPeriod] = usePersistedState<Period>('distribution.period', 'month');
  const [measure, setMeasure] = usePersistedState<LabourMeasure>('distribution.labour', 'hours');
  const [wbsDepth, setWbsDepth] = usePersistedState<number>('distribution.wbsDepth', 0);
  const [shade, setShade] = usePersistedState<boolean>('distribution.shade', true);
  const [cumulative, setCumulative] = usePersistedState<boolean>('distribution.cumulative', false);
  const [folded, setFolded] = useState<Set<string>>(new Set());

  /** A row's figures as shown: running totals when Cumulative is on, for the rows that add up (hours, quantities); peaks stay per period. */
  const figures = (row: DistRow) => {
    if (!cumulative || !row.adds) return row.values;
    let run = 0;
    return row.values.map((v) => (run += v));
  };

  const catalog = useMemo(() => [...(model.resourceCatalog ?? []), ...virtualCatalog], [model.resourceCatalog]);
  const withVirtual = useMemo(() => applyVirtualResources(activities), [activities]);
  const loading = useMemo(() => buildLoading(withVirtual, catalog, model.calendars, 'current'), [withVirtual, catalog, model.calendars]);
  const buckets = useMemo(() => bucketsOf(loading.origin, loading.dayCount, period), [loading.origin, loading.dayCount, period]);
  const groups = useMemo(() => buildDistribution(loading, buckets, measure, wbsDepth), [loading, buckets, measure, wbsDepth]);

  const lines = useMemo(() => {
    const out: Line[] = [];
    const walk = (row: DistRow) => {
      const open = !folded.has(row.key);
      out.push({ row, open });
      if (open) row.children.forEach(walk);
    };
    groups.forEach(walk);
    return out;
  }, [groups, folded]);

  // The top row of the header: years over months / quarters, months over weeks.
  const top = useMemo(() => {
    const cells: { label: string; span: number }[] = [];
    if (period === 'year') return cells;
    for (const b of buckets) {
      const d = dateOfDay(loading.origin, b.from);
      const key = period === 'week' ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : String(d.getFullYear());
      const last = cells[cells.length - 1];
      if (last && last.label === key) last.span++;
      else cells.push({ label: key, span: 1 });
    }
    return cells;
  }, [buckets, loading.origin, period]);

  const toggle = (key: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const labourMetric = metricOf('labour', measure);
  const totalHead = addsUp(labourMetric) ? 'Total' : 'Total / peak';

  const exportCsv = () => {
    const all: DistRow[] = [];
    const walk = (r: DistRow) => {
      all.push(r);
      r.children.forEach(walk);
    };
    groups.forEach(walk);
    downloadCsv(
      `resource-distribution-${period}.csv`,
      ['Resource', 'Unit', ...buckets.map((b) => b.long), 'Total'],
      all.map((r) => [`${'  '.repeat(r.depth)}${r.label}`, r.unit, ...(r.values.length ? figures(r).map((v) => +v.toFixed(2)) : buckets.map(() => '')), r.values.length || r.depth ? +r.total.toFixed(2) : '']),
    );
  };

  if (!loading.resources.length) {
    return (
      <div className="rv-empty">
        <div className="rv-empty__title">No resources in this programme</div>
        <p>
          The distribution needs resource assignments on the activities. Programmes generated in Scenarios carry labour crews, rebar (t) and concrete (m³); a P6 export shows the
          resources assigned in P6. Check the page filters too — they limit what is counted.
        </p>
      </div>
    );
  }

  return (
    <div className="rd">
      <div className="rd-bar">
        <div className="rd-seg" role="tablist" aria-label="Period">
          {PERIODS.map((p) => (
            <button key={p.id} type="button" role="tab" aria-selected={period === p.id} className={period === p.id ? 'active' : ''} onClick={() => setPeriod(p.id)}>{p.label}</button>
          ))}
        </div>
        <label className="rd-field">
          <span>Labour as</span>
          <select value={measure} onChange={(e) => setMeasure(e.target.value as LabourMeasure)} aria-label="How labour is counted">
            {MEASURES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label className="rd-field">
          <select value={wbsDepth} onChange={(e) => { setWbsDepth(Number(e.target.value)); setFolded(new Set()); }} aria-label="Split each resource by WBS">
            {WBS_LEVELS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        </label>
        <label className="rd-field">
          <input type="checkbox" checked={shade} onChange={(e) => setShade(e.target.checked)} />
          <span>Shade by size</span>
        </label>
        <label className="rd-field" title="Running total over the periods, for hours and quantities (people and equipment in use are peaks, so they stay per period)">
          <input type="checkbox" checked={cumulative} onChange={(e) => setCumulative(e.target.checked)} />
          <span>Cumulative</span>
        </label>
        <span className="rd-bar__spacer" />
        <span className="rd-bar__note">Equipment: most in use at once · Materials: quantity used · {buckets.length} {period}s</span>
        <button type="button" className="btn" onClick={exportCsv} title="Download this table as a CSV file">Export CSV</button>
      </div>

      <div className="rd-scroll">
        <table className="rd-table">
          <thead>
            {top.length > 0 && (
              <tr>
                <th className="rd-name rd-corner" rowSpan={2}>Resource</th>
                <th className="rd-unit" rowSpan={2}>Unit</th>
                <th className="rd-total" rowSpan={2} title="Hours and quantities add up over the programme; people and equipment show their highest period">{totalHead}</th>
                {top.map((c, i) => <th key={i} colSpan={c.span} className="rd-top">{c.label}</th>)}
              </tr>
            )}
            <tr>
              {top.length === 0 && (
                <>
                  <th className="rd-name rd-corner">Resource</th>
                  <th className="rd-unit">Unit</th>
                  <th className="rd-total" title="Hours and quantities add up over the programme; people and equipment show their highest period">{totalHead}</th>
                </>
              )}
              {buckets.map((b) => <th key={b.from} className="rd-num" title={b.long}>{b.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {lines.map(({ row, open }) => {
              const shown = figures(row);
              const max = shown.reduce((m, v) => Math.max(m, v), 0);
              return (
                <tr key={row.key} className={`rd-row rd-row--${row.depth}`}>
                  <td className="rd-name" style={{ paddingLeft: 8 + row.depth * 16 }}>
                    {row.children.length > 0 ? (
                      <button type="button" className="rd-twisty" aria-expanded={open} aria-label={open ? `Fold ${row.label}` : `Open ${row.label}`} onClick={() => toggle(row.key)}>
                        <IconExpander open={open} />
                      </button>
                    ) : (
                      <span className="rd-twisty" />
                    )}
                    <span title={row.label}>{row.label}</span>
                  </td>
                  <td className="rd-unit">{row.unit}</td>
                  <td className="rd-total">{row.values.length || row.depth ? fmtNum(row.total) : ''}</td>
                  {buckets.map((b, i) => {
                    const v = shown[i] ?? 0;
                    const tint = shade && max > 0 && v > 0 ? `linear-gradient(rgb(var(--accent-rgb) / ${(0.06 + 0.34 * (v / max)).toFixed(3)}), rgb(var(--accent-rgb) / ${(0.06 + 0.34 * (v / max)).toFixed(3)}))` : undefined;
                    return <td key={b.from} className="rd-num" style={tint ? { backgroundImage: tint } : undefined}>{v > 0 ? fmtNum(v) : ''}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
