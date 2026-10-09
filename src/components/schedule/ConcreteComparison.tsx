import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useVisibleSchedules } from '../../state/scheduleStore';
import { programmeKey } from '../../state/unloadedWbsStore';
import { usePersistedState } from '../../utils/persistedState';
import { downloadCsv } from '../../utils/csv';
import { MATERIAL_LABEL, MATERIAL_UNIT, PERIOD_LABEL, buildSeries, concreteResources, mondayOnOrBefore, periodStart, pours, type Align, type ConcreteSeries, type Material, type Period } from '../../schedule/concreteDistribution';
import { SERIES_COLORS, fmtNum } from './ResourceCharts';
import { FiltersPanel } from './FiltersPanel';
import { applyFieldFilters, buildFilterFields, countActiveFilters, emptyFilterState, hasActiveFilters, type FieldFilterState, type FilterFieldDef } from '../../schedule/filterFields';
import { deserializeFilters, serializeFilters, type SerializedFilters } from '../../state/scheduleLayoutsStore';
import type { Activity, ScheduleModel } from '../../schedule/types';

const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((step) => n <= step + 1e-9) ?? 10) * p;
}

/** A period by its name ("2027", "Q3 2027", "Mar 2027", "from 2 Mar 2027"), counted from the first series that has a start date. */
function periodName(series: ConcreteSeries[], period: Period, index: number): string | null {
  const origin = series.find((s) => s.origin)?.origin;
  if (!origin) return null;
  const d = periodStart(origin, period, index);
  if (period === 'year') return String(d.getFullYear());
  if (period === 'quarter') return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
  if (period === 'month') return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return `from ${fmtDate(d)}`;
}

const startLabel = (series: ConcreteSeries[], period: Period, index: number) => {
  const name = periodName(series, period, index);
  return name ? <span className="scn-dim"> · {name}</span> : null;
};

const TICKS = 5;
const PAD = { left: 56, right: 64, top: 12, bottom: 34 };
const HEIGHT = 440;

/** Weekly volume (bars, left axis) and running total (lines, right axis) of every series, week by week. */
function DistributionChart({ series, bars, lines, pct, period, unit, xTitle }: { series: ConcreteSeries[]; bars: boolean; lines: boolean; pct: boolean; period: Period; unit: string; xTitle: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(480, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const weeks = Math.max(1, ...series.map((s) => s.volume.length));
  const leftMax = niceMax(Math.max(0, ...series.flatMap((s) => s.volume)));
  // The running total in m³, or as a share of each programme's own total (so programmes of very different size compare by shape).
  const rightMax = pct ? 100 : niceMax(Math.max(0, ...series.map((s) => s.total)));
  const cum = (s: ConcreteSeries, v: number) => (pct ? (s.total > 0 ? (v / s.total) * 100 : 0) : v);
  const plotW = width - PAD.left - PAD.right;
  // Grouped by month, a second axis line numbers the project months (M1 = the first month).
  const padBottom = period === 'month' ? PAD.bottom + 14 : PAD.bottom;
  const plotH = HEIGHT - PAD.top - padBottom;
  const step = plotW / weeks;
  const x = (week: number) => PAD.left + week * step; // left edge of week index `week` (0-based)
  const yLeft = (v: number) => PAD.top + plotH - (v / leftMax) * plotH;
  const yRight = (v: number) => PAD.top + plotH - (v / rightMax) * plotH;
  const every = Math.max(1, Math.ceil(weeks / Math.max(4, Math.floor(plotW / (period === 'week' ? 44 : 70)))));
  const barW = Math.max(1, (step * 0.8) / Math.max(1, series.length));

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHover(Math.min(weeks - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * weeks))));
  };

  return (
    <div ref={box} className="cc-chart">
      <svg width={width} height={HEIGHT} role="img" aria-label="Concrete distribution by week">
        {Array.from({ length: TICKS + 1 }, (_, i) => {
          const y = PAD.top + (plotH * i) / TICKS;
          return (
            <g key={i}>
              <line x1={PAD.left} x2={PAD.left + plotW} y1={y} y2={y} className="cc-grid" />
              <text x={PAD.left - 8} y={y + 4} textAnchor="end" className="cc-axis">{fmtNum((leftMax * (TICKS - i)) / TICKS)}</text>
              <text x={PAD.left + plotW + 8} y={y + 4} className="cc-axis">{fmtNum((rightMax * (TICKS - i)) / TICKS)}{pct ? '%' : ''}</text>
            </g>
          );
        })}
        {Array.from({ length: Math.ceil(weeks / every) }, (_, i) => i * every).map((w) => (
          <text key={w} x={x(w) + step / 2} y={PAD.top + plotH + 16} textAnchor="middle" className="cc-axis">
            {period === 'week' ? w + 1 : (periodName(series, period, w) ?? w + 1)}
            {period === 'month' && <tspan x={x(w) + step / 2} dy={13} className="cc-axis-sub">M{w + 1}</tspan>}
          </text>
        ))}
        <text x={PAD.left + plotW / 2} y={HEIGHT - 4} textAnchor="middle" className="cc-axis-title">{xTitle}</text>
        <text transform={`translate(12 ${PAD.top + plotH / 2}) rotate(-90)`} textAnchor="middle" className="cc-axis-title">{PERIOD_LABEL[period]}ly {unit}</text>
        <text transform={`translate(${width - 10} ${PAD.top + plotH / 2}) rotate(90)`} textAnchor="middle" className="cc-axis-title">{pct ? 'Cumulative % of total' : `Cumulative ${unit}`}</text>

        {bars && series.map((s, k) => s.volume.map((v, w) => v > 0 && (
          <rect key={`${s.key}-${w}`} x={x(w) + step * 0.1 + k * barW} y={yLeft(v)} width={Math.max(1, barW - 0.5)} height={PAD.top + plotH - yLeft(v)} fill={s.color} opacity={0.3} />
        )))}
        {lines && series.map((s) => s.cumulative.length > 0 && (
          <polyline
            key={s.key}
            fill="none"
            stroke={s.color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            points={[`${x(0)},${yRight(0)}`, ...s.cumulative.map((v, w) => `${x(w + 1)},${yRight(cum(s, v))}`)].join(' ')}
          />
        ))}
        {hover !== null && <rect x={x(hover)} y={PAD.top} width={step} height={plotH} className="cc-hover" />}
        <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hover !== null && (
        <div className="cc-tip" style={{ left: Math.min(width - 230, Math.max(8, x(hover) + step + 8)), top: PAD.top + 6 }}>
          <b>{period === 'month' ? `Project month ${hover + 1}` : `${PERIOD_LABEL[period]} ${hover + 1}`}</b>{startLabel(series, period, hover)}
          {series.map((s) => (
            <div key={s.key}>
              <span className="cc-dot" style={{ background: s.color }} />
              {s.label}: {fmtNum(s.volume[hover] ?? 0, 1)} {unit} · {pct ? `${fmtNum(cum(s, s.cumulative[Math.min(hover, s.cumulative.length - 1)] ?? 0))}%` : `${fmtNum(s.cumulative[Math.min(hover, s.cumulative.length - 1)] ?? 0)} ${unit}`} total
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Programmes > Concrete Comparison: the loaded programmes' concrete by week laid over each other — a baseline of one
    project against the scenarios of another, from the first pour of each (or from their programme start, or on the
    calendar). Which resources count as concrete, and a scope per programme (a building code, say), are set below. */
export function ConcreteComparison() {
  const schedules = useVisibleSchedules();
  const [align, setAlign] = usePersistedState<Align>('schedule.concrete.align', 'first');
  const [basis, setBasis] = usePersistedState<'current' | 'planned'>('schedule.concrete.basis', 'current');
  const [bars, setBars] = usePersistedState('schedule.concrete.bars', true);
  const [lines, setLines] = usePersistedState('schedule.concrete.lines', true);
  const [pct, setPct] = usePersistedState('schedule.concrete.pct', false);
  const [period, setPeriod] = usePersistedState<Period>('schedule.concrete.period', 'week');
  const [scopes, setScopes] = usePersistedState<Record<string, string>>('schedule.concrete.scopes', {});
  const [off, setOff] = usePersistedState<string[]>('schedule.concrete.off', []);
  const [labels, setLabels] = usePersistedState<Record<string, string>>('schedule.concrete.labels', {});
  const [material, setMaterialRaw] = usePersistedState<Material>('schedule.concrete.material', 'concrete');
  const [chosen, setChosen] = usePersistedState<string[] | null>('schedule.concrete.resources', null);
  // Switching material goes back to the resources that look like it.
  const setMaterial = (m: Material) => { setMaterialRaw(m); setChosen(null); };
  const unit = MATERIAL_UNIT[material];
  // Each programme's own field filters (WBS, activity codes, user fields, resources, dates...): the same filters as the Gantt's.
  const [filterStore, setFilterStore] = usePersistedState<Record<string, SerializedFilters>>('schedule.concrete.filters', {});
  const [openFilters, setOpenFilters] = useState<string | null>(null);
  const filtersOf = (key: string): FieldFilterState => (filterStore[key] ? deserializeFilters(filterStore[key]) : emptyFilterState());
  const setFiltersOf = (key: string, next: FieldFilterState | ((prev: FieldFilterState) => FieldFilterState)) =>
    setFilterStore((all) => {
      const prev = all[key] ? deserializeFilters(all[key]) : emptyFilterState();
      return { ...all, [key]: serializeFilters(typeof next === 'function' ? next(prev) : next) };
    });
  const fieldCache = useRef(new WeakMap<ScheduleModel, FilterFieldDef[]>());
  const acceptOf = (m: ScheduleModel, key: string): ((a: Activity) => boolean) | undefined => {
    const state = filterStore[key] ? deserializeFilters(filterStore[key]) : null;
    if (!state || !hasActiveFilters(state)) return undefined;
    let fields = fieldCache.current.get(m);
    if (!fields) fieldCache.current.set(m, (fields = buildFilterFields(m)));
    const allowed = new Set(applyFieldFilters(m.activities, fields, state).map((a) => a.id));
    return (a) => allowed.has(a.id);
  };

  const candidates = useMemo(() => concreteResources(schedules), [schedules]);
  // Until the user picks, the resources that look like concrete count.
  const resources = useMemo(() => new Set(chosen ?? candidates.filter((c) => (material === 'rebar' ? c.rebar : c.byDefault)).map((c) => c.name)), [chosen, candidates, material]);
  const toggleResource = (name: string) => setChosen([...(resources.has(name) ? [...resources].filter((n) => n !== name) : [...resources, name])]);

  const entries = schedules.map((m, i) => {
    const key = programmeKey(m);
    return { m, key, color: SERIES_COLORS[i % SERIES_COLORS.length], label: labels[key] ?? (m.project.name || m.sourceFileName) };
  });
  const active = entries.filter((e) => !off.includes(e.key));

  const series = useMemo(() => {
    const opts = (scope: string, accept?: (a: Activity) => boolean) => ({ resources, basis, scope, accept });
    let common: Date | null = null;
    if (align === 'calendar') {
      const firsts = active.flatMap((e) => pours(e.m, opts(scopes[e.key] ?? '', acceptOf(e.m, e.key))).map((p) => p.start.getTime()));
      common = firsts.length ? mondayOnOrBefore(new Date(Math.min(...firsts))) : null;
    }
    return active.map((e) => buildSeries(e.m, e.key, e.label, e.color, opts(scopes[e.key] ?? '', acceptOf(e.m, e.key)), align, common, period));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedules, resources, basis, align, scopes, off, labels, filterStore, period]);

  const weeks = Math.max(0, ...series.map((s) => s.volume.length));
  const periods = `${PERIOD_LABEL[period]}s`;
  const xTitle = align === 'calendar' ? `${periods} from ${fmtDate(series.find((s) => s.origin)?.origin ?? null)}` : align === 'start' ? `${periods} from programme start` : `${periods} from the first pour`;

  const exportCsv = () => {
    const headers = [PERIOD_LABEL[period], ...series.flatMap((s) => [`${s.label} ${PERIOD_LABEL[period].toLowerCase()} ${unit}`, `${s.label} cumulative ${unit}`])];
    const rows = Array.from({ length: weeks }, (_, w) => [w + 1, ...series.flatMap((s) => [Math.round((s.volume[w] ?? 0) * 10) / 10, Math.round((s.cumulative[Math.min(w, s.cumulative.length - 1)] ?? 0) * 10) / 10])]);
    downloadCsv(`${material}-distribution.csv`, headers, rows);
  };

  if (schedules.length === 0) {
    return <div className="cc"><div className="scn-dim">Load a programme first (Inputs): every loaded programme becomes a line on the chart.</div></div>;
  }

  return (
    <div className="cc">
      <div className="cc-bar">
        <h3>{MATERIAL_LABEL[material]} distribution</h3>
        <div className="cc-material" role="group" aria-label="What to compare">
          {(['concrete', 'rebar'] as Material[]).map((m) => (
            <button key={m} type="button" className={`btn btn--small${material === m ? ' primary' : ''}`} onClick={() => setMaterial(m)}>{MATERIAL_LABEL[m]}</button>
          ))}
        </div>
        <label>Group by
          <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
            <option value="week">Week</option>
            <option value="month">Month</option>
            <option value="quarter">Quarter</option>
            <option value="year">Year</option>
          </select>
        </label>
        <label>{periods} from
          <select value={align} onChange={(e) => setAlign(e.target.value as Align)}>
            <option value="first">the first pour of each</option>
            <option value="start">each programme's start</option>
            <option value="calendar">the same calendar date</option>
          </select>
        </label>
        <label>Dates
          <select value={basis} onChange={(e) => setBasis(e.target.value as 'current' | 'planned')}>
            <option value="current">Current</option>
            <option value="planned">Baseline</option>
          </select>
        </label>
        <label className="cc-check"><input type="checkbox" checked={bars} onChange={(e) => setBars(e.target.checked)} /> Bars (per {PERIOD_LABEL[period].toLowerCase()})</label>
        <label className="cc-check"><input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} /> Cumulative lines</label>
        <label className="cc-check" title="Draw each running total as a share of that programme's own total, to compare the shape of programmes of different size"><input type="checkbox" checked={pct} onChange={(e) => setPct(e.target.checked)} /> Cumulative as % of total</label>
        <button type="button" className="btn btn--small" onClick={exportCsv} disabled={weeks === 0}>Export CSV</button>
      </div>

      {weeks === 0 ? (
        <div className="scn-dim">No {MATERIAL_LABEL[material].toLowerCase()} found with the resources ticked below. Tick the resource that carries its quantity ({unit}).</div>
      ) : (
        <DistributionChart series={series} bars={bars} lines={lines} pct={pct} period={period} unit={unit} xTitle={xTitle} />
      )}

      <table className="cc-table">
        <thead>
          <tr><th /><th>Programme</th><th title="Quick scope: only activities whose ID, name, WBS or an activity code contains one of these words (comma-separated) count, a building code such as HDAB, say">Scope</th><th title="Filter the programme by any of its fields: WBS, activity codes, user fields, resources, status, dates...">Filters</th><th className="num">Total {unit}</th><th className="num">Pours</th><th>First</th><th>Last</th><th className="num">{periods}</th></tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const s = series.find((x) => x.key === e.key);
            return (
              <Fragment key={e.key}>
              <tr className={off.includes(e.key) ? 'is-off' : ''}>
                <td>
                  <input type="checkbox" checked={!off.includes(e.key)} onChange={() => setOff(off.includes(e.key) ? off.filter((k) => k !== e.key) : [...off, e.key])} title="Show on the chart" />
                  <span className="cc-dot" style={{ background: e.color }} />
                </td>
                <td>
                  <input className="cc-name" value={e.label} onChange={(ev) => setLabels({ ...labels, [e.key]: ev.target.value })} title={e.m.sourceFileName} />
                </td>
                <td><input className="cc-scope" placeholder="whole programme" value={scopes[e.key] ?? ''} onChange={(ev) => setScopes({ ...scopes, [e.key]: ev.target.value })} /></td>
                <td>
                  <button type="button" className={`btn btn--small${openFilters === e.key ? ' primary' : ''}`} onClick={() => setOpenFilters(openFilters === e.key ? null : e.key)}>
                    Filters{countActiveFilters(filtersOf(e.key)) > 0 ? ` (${countActiveFilters(filtersOf(e.key))})` : ''}
                  </button>
                </td>
                <td className="num">{s ? fmtNum(s.total) : '—'}</td>
                <td className="num">{s ? s.pours.toLocaleString() : '—'}</td>
                <td>{fmtDate(s?.first ?? null)}</td>
                <td>{fmtDate(s?.last ?? null)}</td>
                <td className="num">{s ? s.volume.length : '—'}</td>
              </tr>
              {openFilters === e.key && (
                <tr className="cc-filters">
                  <td colSpan={9}>
                    <div className="cc-filters__box">
                      <FiltersPanel model={e.m} baseActivities={e.m.activities} state={filtersOf(e.key)} onChange={(next) => setFiltersOf(e.key, next)} />
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <div className="cc-resources">
        <div className="cc-resources__title">Counts as {MATERIAL_LABEL[material].toLowerCase()} <span className="scn-dim">(the quantity of these resources, in {unit})</span></div>
        {candidates.length === 0 && <div className="scn-dim">None of the loaded programmes has a resource with a quantity.</div>}
        {candidates.slice(0, 60).map((c) => (
          <label key={c.name} className="cc-check">
            <input type="checkbox" checked={resources.has(c.name)} onChange={() => toggleResource(c.name)} /> {c.name} <span className="scn-dim">{fmtNum(c.total)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
