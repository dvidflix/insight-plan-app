import { setTradeCapacities, useTradeCapacityStore } from '../../state/tradeCapacityStore';
import { useMemo, useState } from 'react';
import type { Activity, ScheduleModel } from '../../schedule/types';
import {
  aggregate,
  buildLoading,
  bucketsOf,
  dateOfDay,
  kpisOf,
  pourCounts,
  type Metric,
  type Period,
  type ResourceLoading,
} from '../../schedule/resourceLoading';
import { applyLevelling, levelSchedule, type LevelMode, type LevelResult } from '../../schedule/levelling';
import { useScheduleStore } from '../../state/scheduleStore';
import { usePersistedState } from '../../utils/persistedState';
import { downloadCsv } from '../../utils/csv';
import { CRITICAL, LineChart, MAX_ZOOM, MIN_ZOOM, OTHER_COLOR, SERIES_COLORS, StackedChart, changeZoom, fmtNum, type LineSeries, type StackSeries } from './ResourceCharts';
import { PourFilter } from './PourFilter';
import { ResourceTimeline } from './ResourceTimeline';
import { applyVirtualResources, virtualCatalog } from '../../schedule/virtualResources';

interface ResourcesViewProps {
  /** The programme(s) shown — levelling runs on all of it. */
  model: ScheduleModel;
  /** The activities left by the page's filters — what the graphs count. */
  activities: Activity[];
  onSelect: (activity: Activity) => void;
}

const METRICS: { id: Metric; label: string; unit: string }[] = [
  { id: 'peak', label: 'People (peak day)', unit: 'people' },
  { id: 'avg', label: 'People (average weekday)', unit: 'people' },
  { id: 'hours', label: 'Man-hours', unit: 'man-hours' },
];
const PERIODS: { id: Period; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];
const MAX_ROWS = 300;
const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
/** "Rebar (t)" → "t"; no unit → "". */
const unitOf = (name: string) => /\(([^)]+)\)\s*$/.exec(name)?.[1] ?? '';

interface Levelled {
  result: LevelResult;
  activities: Activity[];
  mode: LevelMode;
  trades: string[];
}

/** The last levelling of each programme, kept outside the view: switching
    tab and back still shows it (a new or reloaded programme starts clean). */
const keptLevelling = new WeakMap<ScheduleModel, Levelled>();

/** Programmes > Resources: labour demand against capacity per trade — the
    Labour_Resource_Assignment_and_Levelling.xlsx dashboard, live on the
    programme. Stacked histogram by trade with the capacity line and overload
    markers, KPIs, a cumulative man-hours S-curve, the activities behind any
    period, capacities to edit, and a levelling pass whose result can be
    added as a new programme. Materials (concrete m³, rebar t) get their own
    graphs. */
export function ResourcesView({ model, activities, onSelect }: ResourcesViewProps) {
  const addSchedule = useScheduleStore((s) => s.addSchedule);
  const [view, setView] = usePersistedState<'labour' | 'plant' | 'materials'>('resources.view', 'labour');
  const [zoom, setZoom] = usePersistedState<number>('resources.zoom', 1);
  const [period, setPeriod] = usePersistedState<Period>('resources.period', 'week');
  const [metric, setMetric] = usePersistedState<Metric>('resources.metric', 'peak');
  const [hidden, setHidden] = usePersistedState<string[]>('resources.hiddenTrades', []);
  const capOverrides = useTradeCapacityStore((s) => s.capacities);
  const setCapOverrides = setTradeCapacities;
  const [levelMode, setLevelMode] = usePersistedState<LevelMode>('resources.levelMode', 'float');
  const [showTable, setShowTable] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [levelledState, setLevelledState] = useState<{ model: ScheduleModel; value: Levelled | null } | null>(null);
  const levelled = levelledState?.model === model ? levelledState.value : keptLevelling.get(model) ?? null;
  const setLevelled = (value: Levelled | null) => {
    if (value) keptLevelling.set(model, value);
    else keptLevelling.delete(model);
    setLevelledState({ model, value });
  };
  const [busy, setBusy] = useState(false);
  // The programme's resources plus the app-only ones (never exported).
  const catalog = useMemo(() => [...(model.resourceCatalog ?? []), ...virtualCatalog], [model.resourceCatalog]);
  const withVirtual = useMemo(() => applyVirtualResources(activities), [activities]);

  // Before: the programme as it is. After levelling: the levelled dates,
  // counted from the same day 0 so periods line up.
  const before = useMemo(() => buildLoading(withVirtual, catalog, model.calendars, 'current'), [withVirtual, catalog, model.calendars]);
  const after = useMemo(() => {
    if (!levelled) return null;
    const ids = new Set(activities.map((a) => a.id));
    return buildLoading(applyVirtualResources(levelled.activities.filter((a) => ids.has(a.id))), catalog, model.calendars, 'current', before.origin);
  }, [levelled, activities, catalog, model.calendars, before.origin]);
  const shown: ResourceLoading = after ?? before;

  const labour = shown.resources.filter((r) => r.type === 'labor');
  // Equipment, cranes and counted materials (a scenario's pools: the programme gives their count as max units) are charted against it.
  const plant = shown.resources.filter((r) => r.type !== 'labor' && !r.virtual && r.fileCapacity !== null);
  const materials = shown.resources.filter((r) => r.type !== 'labor' && !plant.includes(r));
  const plantStats = useMemo(() => {
    const out = new Map<string, { peak: number; over: number }>();
    for (const r of plant) {
      const s = shown.demand.get(r.name);
      let peak = 0;
      let over = 0;
      for (let d = 0; s && d < s.length; d++) {
        peak = Math.max(peak, s[d]);
        if (r.fileCapacity && s[d] > r.fileCapacity + 1e-9) over++;
      }
      out.set(r.name, { peak, over });
    }
    return out;
  }, [plant, shown.demand]);
  const plantOver = plant.filter((r) => (plantStats.get(r.name)?.over ?? 0) > 0);
  const colorOf = useMemo(() => {
    const all = (catalog.length ? catalog : shown.resources).filter((r) => r.type === 'labor').map((r) => r.name);
    return (name: string) => {
      const i = all.indexOf(name);
      return i >= 0 && i < SERIES_COLORS.length ? SERIES_COLORS[i] : OTHER_COLOR;
    };
  }, [catalog, shown.resources]);

  const capacity = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of labour) {
      const v = capOverrides[r.name] ?? r.fileCapacity;
      if (v && v > 0) m.set(r.name, v);
    }
    return m;
  }, [labour, capOverrides]);

  const trades = labour.map((r) => r.name).filter((n) => !hidden.includes(n));
  const series: StackSeries[] = trades.map((name) => ({ name, color: colorOf(name) }));
  const dayCount = Math.max(before.dayCount, after?.dayCount ?? 0);
  const buckets = useMemo(() => bucketsOf(shown.origin, dayCount, period), [shown.origin, dayCount, period]);
  const figures = useMemo(() => aggregate(shown, trades, capacity, buckets, metric), [shown, trades, capacity, buckets, metric]);
  const beforeFigures = useMemo(() => (after ? aggregate({ ...before, dayCount }, trades, capacity, buckets, metric) : null), [after, before, dayCount, trades, capacity, buckets, metric]);
  const kpis = useMemo(() => kpisOf(shown, trades, capacity), [shown, trades, capacity]);
  const kpisBefore = useMemo(() => (after ? kpisOf(before, trades, capacity) : null), [after, before, trades, capacity]);
  const totalCapacity = trades.reduce((s, n) => s + (capacity.get(n) ?? 0), 0);
  const unit = METRICS.find((m) => m.id === metric)!.unit;
  const peopleMetric = metric !== 'hours';
  const zoomProps = { zoom, onZoom: setZoom };
  const [pourMode, setPourMode] = usePersistedState<'count' | 'volume'>('resources.pourMode', 'count');

  // Concrete pours: one per activity carrying concrete, in the period it starts.
  const concreteNames = useMemo(() => materials.filter((r) => !r.virtual && /concrete/i.test(r.name)).map((r) => r.name), [materials]);
  // Excel-style filter of the chart: series switched off, WBS values left out.
  const [pourHidden, setPourHidden] = usePersistedState<string[]>('resources.pourHidden', []);
  const [pourDepth, setPourDepth] = usePersistedState<number>('resources.pourDepth', 2);
  const [pourExcluded, setPourExcluded] = usePersistedState<string[]>('resources.pourExcluded', []);
  const [pourCumulative, setPourCumulative] = usePersistedState<boolean>('resources.pourCumulative', true);
  const virtualMaterials = useMemo(() => materials.filter((r) => r.virtual), [materials]);
  const wbsAt = (span: { activity: Activity }) => span.activity.wbsPath.split(' / ').filter(Boolean).slice(0, pourDepth).join(' / ') || '(no WBS)';
  const pourWbsValues = useMemo(() => {
    const names = new Set([...concreteNames, ...virtualMaterials.map((r) => r.name)]);
    const counts = new Map<string, number>();
    for (const span of shown.spans) if ([...span.perDay.keys()].some((n) => names.has(n))) counts.set(wbsAt(span), (counts.get(wbsAt(span)) ?? 0) + 1);
    return [...counts].map(([value, count]) => ({ value, count })).sort((x, y) => x.value.localeCompare(y.value, undefined, { numeric: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown.spans, concreteNames, virtualMaterials, pourDepth]);
  const pourLoading = useMemo(() => {
    const out = new Set(pourExcluded);
    return { ...shown, dayCount, spans: out.size ? shown.spans.filter((sp) => !out.has(wbsAt(sp))) : shown.spans };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, dayCount, pourExcluded, pourDepth]);
  const pours = useMemo(() => pourCounts(pourLoading, concreteNames, buckets), [pourLoading, concreteNames, buckets]);
  // The app-only Precast (m3) stacks with the in-situ concrete, in nr or m³.
  const pourSeriesAll = useMemo(() => {
    const short = (n: string) => n.replace(/\s*\([^)]*\)\s*$/, '');
    const concrete = { name: 'Concrete', color: SERIES_COLORS[0], values: pours.map((p) => (pourMode === 'count' ? p.count : p.volume)) };
    const extra = virtualMaterials.map((r, k) => ({
      name: short(r.name),
      color: SERIES_COLORS[(k + 1) % SERIES_COLORS.length],
      values: pourCounts(pourLoading, [r.name], buckets).map((p) => (pourMode === 'count' ? p.count : p.volume)),
    }));
    return [concrete, ...extra];
  }, [pours, pourMode, virtualMaterials, pourLoading, buckets]);
  const pourSeries = useMemo(() => pourSeriesAll.filter((x) => !pourHidden.includes(x.name)), [pourSeriesAll, pourHidden]);
  const pourFigures = useMemo(
    () =>
      buckets.map((b, i) => {
        const values = new Map(pourSeries.map((x) => [x.name, x.values[i]] as const));
        return { values, total: [...values.values()].reduce((n, v) => n + v, 0), peakDay: b.from, overloaded: [], overDays: 0 };
      }),
    [buckets, pourSeries],
  );
  const pourTotalCurve = useMemo(() => {
    let acc = 0;
    return pourFigures.map((f) => (acc += f.total));
  }, [pourFigures]);
  const pourStats = useMemo(() => {
    const total = pours.reduce((n, p) => n + p.count, 0);
    const volume = pours.reduce((n, p) => n + p.volume, 0);
    let busiest = -1;
    pours.forEach((p, i) => {
      if (busiest < 0 || p.count > pours[busiest].count) busiest = i;
    });
    const active = pours.filter((p) => p.count > 0).length;
    return { total, volume, busiest: busiest >= 0 && pours[busiest].count > 0 ? busiest : null, average: active ? total / active : 0, active };
  }, [pours]);

  // S-curve: cumulative man-hours per period.
  const cumulative = (L: ResourceLoading) => {
    const f = aggregate({ ...L, dayCount }, trades, capacity, buckets, 'hours');
    let acc = 0;
    return f.map((x) => (acc += x.total));
  };
  const curves = useMemo(() => {
    const out: LineSeries[] = [{ name: after ? 'Levelled' : 'Programme', color: SERIES_COLORS[0], values: cumulative(shown) }];
    if (after) out.push({ name: 'Before', color: OTHER_COLOR, values: cumulative(before), dashed: true });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, before, after, trades, buckets, dayCount]);

  // Activities behind the selected period.
  const contributors = useMemo(() => {
    if (selected === null || !buckets[selected]) return [];
    const { from, to } = buckets[selected];
    const byId = levelled?.result.byId;
    return shown.spans
      .filter((s) => s.days.some((d) => d >= from && d <= to) && trades.some((t) => s.perDay.has(t)))
      .map((s) => {
        const crews = trades.filter((t) => s.perDay.has(t)).map((t) => ({ trade: t, crew: s.perDay.get(t)! }));
        return { span: s, crews, people: crews.reduce((n, c) => n + c.crew, 0), delay: byId?.get(s.activity.id)?.delayDays ?? 0 };
      })
      .sort((a, b) => b.people - a.people);
  }, [selected, buckets, shown, trades, levelled]);

  const runLevelling = () => {
    setBusy(true);
    // Let the button repaint before the (synchronous) pass.
    setTimeout(() => {
      try {
        const limited = new Map([...capacity].filter(([n]) => trades.includes(n)));
        const result = levelSchedule(model, limited, levelMode);
        const levelledActivities = model.activities.map((a) => {
          const l = result.byId.get(a.id);
          return l && !a.actualStart ? { ...a, earlyStart: l.start, earlyFinish: l.finish, targetStart: l.start, targetFinish: l.finish } : a;
        });
        setLevelled({ result, activities: levelledActivities, mode: levelMode, trades: [...limited.keys()] });
        setSelected(null);
      } finally {
        setBusy(false);
      }
    }, 20);
  };

  const exportCsv = () => {
    downloadCsv(
      `resources-${period}.csv`,
      ['Period', ...trades, `Total (${unit})`, 'Capacity', 'Days over capacity', 'Over capacity'],
      buckets.map((b, i) => [
        b.long,
        ...trades.map((t) => +(figures[i].values.get(t) ?? 0).toFixed(2)),
        +figures[i].total.toFixed(2),
        totalCapacity || '',
        figures[i].overDays,
        figures[i].overloaded.join('; '),
      ]),
    );
  };

  if (!shown.resources.length) {
    return (
      <div className="rv-empty">
        <div className="rv-empty__title">No resources in this programme</div>
        <p>
          The graphs need resource assignments on the activities. Programmes generated in Scenarios carry labour crews, rebar (t) and concrete (m³); a P6 export shows the
          resources assigned in P6. Check the page filters too — they limit what is counted.
        </p>
      </div>
    );
  }

  const delta = (now: number, was: number | undefined, fmt: (v: number) => string) =>
    was === undefined || Math.abs(now - was) < 1e-9 ? null : <span className="rv-kpi__was">was {fmt(was)}</span>;

  return (
    <div className="rv">
      <div className="rv-main">
        <div className="rv-sticky">
        <div className="rv-toolbar">
          <div className="rv-seg" role="tablist" aria-label="Resource kind">
            <button type="button" role="tab" aria-selected={view === 'labour'} className={view === 'labour' ? 'active' : ''} onClick={() => setView('labour')} disabled={!labour.length}>Labour</button>
            <button type="button" role="tab" aria-selected={view === 'plant'} className={view === 'plant' ? 'active' : ''} onClick={() => setView('plant')} disabled={!plant.length} title="Equipment, cranes and counted materials against the pool of the scenario">Equipment</button>
            <button type="button" role="tab" aria-selected={view === 'materials'} className={view === 'materials' ? 'active' : ''} onClick={() => setView('materials')} disabled={!materials.length}>Materials</button>
          </div>
          {view === 'labour' && (
            <label className="rv-field">
              <span>Show</span>
              <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
                {METRICS.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </label>
          )}
          <div className="rv-seg" role="tablist" aria-label="Period">
            {PERIODS.map((p) => (
              <button key={p.id} type="button" role="tab" aria-selected={period === p.id} className={period === p.id ? 'active' : ''} onClick={() => { setPeriod(p.id); setSelected(null); }}>{p.label}</button>
            ))}
          </div>
            <div className="rv-seg rv-zoom" role="group" aria-label="Zoom">
              <button type="button" onClick={() => changeZoom(zoom / 1.5, setZoom)} disabled={zoom <= MIN_ZOOM} title="Zoom out" aria-label="Zoom out">−</button>
              <button type="button" onClick={() => changeZoom(zoom * 1.5, setZoom)} disabled={zoom >= MAX_ZOOM} title="Zoom in (Ctrl + wheel over a graph)" aria-label="Zoom in">+</button>
              <button type="button" onClick={() => changeZoom(1, setZoom)} disabled={zoom === 1} title="Fit the whole programme">Fit</button>
            </div>
          <span className="rv-toolbar__spacer" />
          {view === 'labour' && <button type="button" className="btn" onClick={() => setShowTable((v) => !v)}>{showTable ? 'Hide table' : 'Show table'}</button>}
          {view === 'labour' && <button type="button" className="btn" onClick={exportCsv}>Export CSV</button>}
        </div>
          <ResourceTimeline origin={shown.origin} buckets={buckets} period={period} selected={selected} onSelect={setSelected} {...zoomProps} />
        </div>

        {view === 'labour' && labour.length === 0 && <div className="rv-note">No labour resources in the filtered activities.</div>}

        {view === 'labour' && labour.length > 0 && (
          <>
            <div className="rv-legend" aria-label="Trades">
              {labour.map((r) => {
                const off = hidden.includes(r.name);
                return (
                  <button
                    key={r.name}
                    type="button"
                    className={`rv-chip${off ? ' rv-chip--off' : ''}`}
                    aria-pressed={!off}
                    title={off ? 'Show this trade' : 'Hide this trade'}
                    onClick={() => setHidden(off ? hidden.filter((n) => n !== r.name) : [...hidden, r.name])}
                  >
                    <span className="rv-swatch" style={{ background: off ? 'transparent' : colorOf(r.name), borderColor: colorOf(r.name) }} />
                    {r.name}
                  </button>
                );
              })}
              <span className="rv-legend__key"><span className="rv-key-cap" /> Capacity</span>
              <span className="rv-legend__key"><span style={{ color: CRITICAL }}>▲</span> Over capacity</span>
              {after && <span className="rv-legend__key"><span className="rv-key-before" /> Before levelling</span>}
            </div>

            <div className="rv-kpis">
              <div className="rv-kpi">
                <div className="rv-kpi__label">Peak demand</div>
                <div className="rv-kpi__value">{fmtNum(kpis.peak)} <small>people</small></div>
                <div className="rv-kpi__sub">{fmtDate(kpis.peakDate)} {delta(kpis.peak, kpisBefore?.peak, (v) => fmtNum(v))}</div>
              </div>
              <div className="rv-kpi">
                <div className="rv-kpi__label">Capacity</div>
                <div className="rv-kpi__value">{totalCapacity ? fmtNum(totalCapacity) : '—'} <small>people / day</small></div>
                <div className="rv-kpi__sub">{capacity.size < trades.length ? `${trades.length - capacity.size} trade${trades.length - capacity.size === 1 ? '' : 's'} without capacity` : 'All shown trades'}</div>
              </div>
              <div className={`rv-kpi${kpis.overDays ? ' rv-kpi--bad' : ' rv-kpi--good'}`}>
                <div className="rv-kpi__label">Days over capacity</div>
                <div className="rv-kpi__value">
                  <span className="rv-status" aria-hidden="true">{kpis.overDays ? '▲' : '✓'}</span> {fmtNum(kpis.overDays)}
                </div>
                <div className="rv-kpi__sub">{kpis.overDays ? 'Some trade over its capacity' : 'Every day within capacity'} {delta(kpis.overDays, kpisBefore?.overDays, (v) => fmtNum(v))}</div>
              </div>
              <div className="rv-kpi">
                <div className="rv-kpi__label">Peak overload</div>
                <div className="rv-kpi__value">{fmtNum(kpis.peakOverload)} <small>people</small></div>
                <div className="rv-kpi__sub">Peak utilisation {fmtNum(kpis.peakUtilisation * 100)}% {delta(kpis.peakOverload, kpisBefore?.peakOverload, (v) => fmtNum(v))}</div>
              </div>
              <div className="rv-kpi">
                <div className="rv-kpi__label">Total effort</div>
                <div className="rv-kpi__value">{fmtNum(kpis.manHours)} <small>man-hours</small></div>
                <div className="rv-kpi__sub">{fmtNum(kpis.manDays)} man-days</div>
              </div>
            </div>

            <section className="rv-card">
              <h4 className="rv-card__title">
                Labour demand by trade — {METRICS.find((m) => m.id === metric)!.label.toLowerCase()} per {period}
                {after && <span className="rv-card__tag">Levelled</span>}
              </h4>
              <StackedChart
                title={`Labour demand by trade, ${unit} per ${period}`}
                buckets={buckets}
                figures={figures}
                series={series}
                unit={unit}
                capacity={peopleMetric && totalCapacity ? totalCapacity : null}
                before={beforeFigures ? beforeFigures.map((f) => f.total) : null}
                selected={selected}
                onSelect={setSelected}
                height={300}
                {...zoomProps}
              />
            </section>

            <section className="rv-card">
              <h4 className="rv-card__title">Cumulative effort (S-curve) — man-hours</h4>
              <LineChart title="Cumulative man-hours" buckets={buckets} series={curves} unit="man-hours" height={170} {...zoomProps} />
            </section>

            {showTable && (
              <section className="rv-card">
                <h4 className="rv-card__title">Table — {unit} per {period}</h4>
                <div className="rv-tablewrap">
                  <table className="rv-table">
                    <thead>
                      <tr>
                        <th>Period</th>
                        {trades.map((t) => <th key={t} className="rv-num">{t}</th>)}
                        <th className="rv-num">Total</th>
                        <th className="rv-num">Capacity</th>
                        <th>Over capacity</th>
                      </tr>
                    </thead>
                    <tbody>
                      {buckets.map((b, i) => (
                        <tr key={b.from} className={i === selected ? 'rv-row--selected' : undefined} onClick={() => setSelected(i)}>
                          <td>{b.long}</td>
                          {trades.map((t) => <td key={t} className="rv-num">{fmtNum(figures[i].values.get(t) ?? 0)}</td>)}
                          <td className="rv-num"><b>{fmtNum(figures[i].total)}</b></td>
                          <td className="rv-num">{peopleMetric && totalCapacity ? fmtNum(totalCapacity) : ''}</td>
                          <td className={figures[i].overloaded.length ? 'rv-bad' : undefined}>{figures[i].overloaded.length ? `▲ ${figures[i].overloaded.join(', ')}` : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {selected !== null && buckets[selected] && (
              <section className="rv-card">
                <h4 className="rv-card__title">
                  {buckets[selected].long}: {contributors.length} activit{contributors.length === 1 ? 'y' : 'ies'} using the shown trades
                  <button type="button" className="mini-btn" onClick={() => setSelected(null)}>Close</button>
                </h4>
                <div className="rv-tablewrap">
                  <table className="rv-table">
                    <thead>
                      <tr>
                        <th>Activity</th>
                        <th>Crew</th>
                        <th>Start</th>
                        <th>Finish</th>
                        <th className="rv-num" title="Total float, working days">Float (d)</th>
                        {levelled && <th className="rv-num" title="Working days moved by levelling">Moved (d)</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {contributors.slice(0, MAX_ROWS).map(({ span, crews, delay }) => {
                        const a = span.activity;
                        return (
                          <tr key={a.id} onClick={() => onSelect(a)} title="Select this activity">
                            <td className="rv-act">
                              <span className="rv-act__code">{a.code}</span> {a.name}
                            </td>
                            <td>
                              {crews.map((c) => (
                                <span key={c.trade} className="rv-crew">
                                  <span className="rv-swatch" style={{ background: colorOf(c.trade) }} />
                                  {fmtNum(c.crew)} {c.trade}
                                </span>
                              ))}
                            </td>
                            <td>{fmtDate(dateOfDay(shown.origin, span.days[0]))}</td>
                            <td>{fmtDate(dateOfDay(shown.origin, span.days[span.days.length - 1]))}</td>
                            <td className="rv-num">{a.totalFloatHours === null ? '—' : fmtNum(a.totalFloatHours / 8)}</td>
                            {levelled && <td className="rv-num">{delay ? fmtNum(delay) : ''}</td>}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {contributors.length > MAX_ROWS && <div className="rv-note">Showing the {MAX_ROWS} biggest crews of {contributors.length}.</div>}
              </section>
            )}
          </>
        )}

        {view === 'materials' && concreteNames.length > 0 && (
          <>
            <div className="rv-kpis">
              <div className="rv-kpi">
                <div className="rv-kpi__label">Concrete pours</div>
                <div className="rv-kpi__value">{fmtNum(pourStats.total)}</div>
                <div className="rv-kpi__sub">{fmtNum(pourStats.volume)} {unitOf(concreteNames[0]) || 'units'} in total</div>
              </div>
              <div className="rv-kpi">
                <div className="rv-kpi__label">Busiest {period}</div>
                <div className="rv-kpi__value">{pourStats.busiest === null ? '—' : fmtNum(pours[pourStats.busiest].count)} <small>pours</small></div>
                <div className="rv-kpi__sub">{pourStats.busiest === null ? '' : buckets[pourStats.busiest].long}</div>
              </div>
              <div className="rv-kpi">
                <div className="rv-kpi__label">Average per {period} with pours</div>
                <div className="rv-kpi__value">{fmtNum(pourStats.average, 1)} <small>pours</small></div>
                <div className="rv-kpi__sub">{fmtNum(pourStats.active)} {period}{pourStats.active === 1 ? '' : 's'} with pours</div>
              </div>
            </div>
            <section className="rv-card">
              <h4 className="rv-card__title">
                Concrete per {period}
                <span className="rv-card__meta">each concrete activity counted in the {period} it starts</span>
                <span className="rv-card__tabs">
                  <label className="rv-field"><input type="checkbox" checked={pourCumulative} onChange={(e) => setPourCumulative(e.target.checked)} /> <span>Cumulative</span></label>
                  <PourFilter
                    series={pourSeriesAll.map((x) => x.name)}
                    hiddenSeries={pourHidden}
                    onHiddenSeries={setPourHidden}
                    depth={pourDepth}
                    onDepth={(d) => { setPourDepth(d); setPourExcluded([]); }}
                    values={pourWbsValues}
                    excluded={pourExcluded}
                    onExcluded={setPourExcluded}
                  />
                  <span className="rv-seg" role="tablist" aria-label="Concrete measure">
                    <button type="button" role="tab" aria-selected={pourMode === 'count'} className={pourMode === 'count' ? 'active' : ''} onClick={() => setPourMode('count')}>Pours (nr)</button>
                    <button type="button" role="tab" aria-selected={pourMode === 'volume'} className={pourMode === 'volume' ? 'active' : ''} onClick={() => setPourMode('volume')}>Volume ({unitOf(concreteNames[0]) || 'units'})</button>
                  </span>
                </span>
              </h4>
              <StackedChart
                title={`Concrete ${pourMode === 'count' ? 'pours' : 'volume'} per ${period}`}
                buckets={buckets}
                figures={pourFigures}
                series={pourSeries.map((x) => ({ name: x.name, color: x.color }))}
                unit={pourMode === 'count' ? 'nr' : unitOf(concreteNames[0])}
                capacity={null}
                before={null}
                selected={selected}
                onSelect={setSelected}
                height={240}
                integer={pourMode === 'count'}
                valueLabels={pourMode === 'count'}
                overlay={pourCumulative ? { name: 'Cumulative', values: pourTotalCurve } : null}
                extra={(i) => (
                  <div className="rv-tip__row">
                    <span className="rv-tip__name">{pourMode === 'count' ? 'Concrete volume' : 'Concrete pours'}</span>
                    <span className="rv-tip__val">{pourMode === 'count' ? `${fmtNum(pours[i].volume)} ${unitOf(concreteNames[0])}` : fmtNum(pours[i].count)}</span>
                  </div>
                )}
                {...zoomProps}
              />
            </section>
          </>
        )}


        {view === 'plant' && plant.length === 0 && <div className="rv-note">No equipment, cranes or counted materials in the filtered activities.</div>}

        {view === 'plant' && plant.length > 0 && (
          <>
            <div className="rv-kpis">
              <div className={`rv-kpi${plantOver.length ? ' rv-kpi--bad' : ' rv-kpi--good'}`}>
                <div className="rv-kpi__label">Over their pool</div>
                <div className="rv-kpi__value"><span className="rv-status" aria-hidden="true">{plantOver.length ? '▲' : '✓'}</span> {plantOver.length}</div>
                <div className="rv-kpi__sub">{plantOver.length ? plantOver.map((p) => p.name).join(', ') : `of ${plant.length} resource${plant.length === 1 ? '' : 's'}: every day within its pool`}</div>
              </div>
            </div>
            {plant.map((r) => {
              const cap = r.fileCapacity!;
              const f = aggregate({ ...shown, dayCount }, [r.name], new Map([[r.name, cap]]), buckets, 'peak');
              const stats = plantStats.get(r.name)!;
              return (
                <section key={r.name} className="rv-card">
                  <h4 className="rv-card__title">
                    {r.name} in use, peak per {period}
                    <span className="rv-card__meta">pool {fmtNum(cap, cap % 1 ? 1 : 0)} · peak {fmtNum(stats.peak, stats.peak % 1 ? 1 : 0)} · {stats.over ? `${stats.over} day${stats.over === 1 ? '' : 's'} over` : 'within the pool'}</span>
                  </h4>
                  <StackedChart
                    title={`${r.name} in use, peak per ${period}`}
                    buckets={buckets}
                    figures={f}
                    series={[{ name: r.name, color: SERIES_COLORS[2] }]}
                    unit={r.type === 'material' ? 'units' : 'in use'}
                    capacity={cap}
                    before={null}
                    selected={selected}
                    onSelect={setSelected}
                    height={180}
                    integer={cap >= 1 && Number.isInteger(cap)}
                    {...zoomProps}
                  />
                </section>
              );
            })}
          </>
        )}

        {view === 'materials' &&
          materials.filter((r) => !concreteNames.includes(r.name) && !r.virtual).map((r) => {
            const f = aggregate({ ...shown, dayCount }, [r.name], new Map(), buckets, 'sum');
            const total = f.reduce((s, x) => s + x.total, 0);
            const u = unitOf(r.name);
            return (
              <section key={r.name} className="rv-card">
                <h4 className="rv-card__title">
                  {r.virtual && <span className="rv-virtual-mark" aria-label="App-only">◇</span>}
                  {r.name} per {period} <span className="rv-card__meta">total {fmtNum(total)} {u}</span>
                  {r.virtual && <span className="rv-card__tag" title="Added by this app; never exported">App only</span>}
                </h4>
                <StackedChart
                  title={`${r.name} per ${period}`}
                  buckets={buckets}
                  figures={f}
                  series={[{ name: r.name, color: SERIES_COLORS[0] }]}
                  unit={u}
                  capacity={null}
                  before={null}
                  selected={selected}
                  onSelect={setSelected}
                  height={200}
                  {...zoomProps}
                />
              </section>
            );
          })}
      </div>

      {view === 'labour' && labour.length > 0 && (
        <aside className="rv-side">
          <section className="rv-card">
            <h4 className="rv-card__title">Capacity (people / day)</h4>
            <table className="rv-table rv-captable">
              <tbody>
                {labour.map((r) => {
                  const own = capOverrides[r.name];
                  return (
                    <tr key={r.name}>
                      <td>
                        <span className="rv-swatch" style={{ background: colorOf(r.name) }} /> {r.name}
                      </td>
                      <td className="rv-num">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          aria-label={`${r.name} capacity`}
                          value={own ?? r.fileCapacity ?? ''}
                          placeholder="—"
                          onChange={(e) => {
                            const v = e.target.value === '' ? null : Math.max(0, Number(e.target.value));
                            const next = { ...capOverrides };
                            if (v === null || v === r.fileCapacity) delete next[r.name];
                            else next[r.name] = v;
                            setCapOverrides(next);
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="rv-note">From the programme ({labour.some((r) => r.fileCapacity) ? 'P6 max units' : 'none set'}); edits are kept in this browser.</div>
            {Object.keys(capOverrides).length > 0 && (
              <button type="button" className="mini-btn" onClick={() => setCapOverrides({})}>Reset to programme values</button>
            )}
          </section>

          <section className="rv-card">
            <h4 className="rv-card__title">Level</h4>
            <p className="rv-note">Delays activities so no shown trade goes over its capacity. Logic is respected; started work stays put; nothing moves earlier.</p>
            <label className="rv-radio">
              <input type="radio" name="level-mode" checked={levelMode === 'float'} onChange={() => setLevelMode('float')} />
              <span><b>Within float</b> — keep the finish date; what can't fit is flagged</span>
            </label>
            <label className="rv-radio">
              <input type="radio" name="level-mode" checked={levelMode === 'extend'} onChange={() => setLevelMode('extend')} />
              <span><b>Allow a later finish</b> — delay as far as needed</span>
            </label>
            <button type="button" className="btn primary" disabled={busy || !capacity.size} onClick={runLevelling}>
              {busy ? 'Levelling…' : levelled ? 'Level again' : 'Level'}
            </button>
            {!capacity.size && <div className="rv-note">Set a capacity for at least one trade first.</div>}
            {levelled && (
              <div className="rv-result">
                <div><b>{fmtNum(levelled.result.moved)}</b> activities moved</div>
                <div className={levelled.result.unresolved ? 'rv-bad' : undefined}>
                  {levelled.result.unresolved ? `▲ ${fmtNum(levelled.result.unresolved)} could not fit ${levelled.mode === 'float' ? 'within their float' : 'within capacity'}` : '✓ Every activity fits'}
                </div>
                <div>
                  Finish {fmtDate(levelled.result.finishBefore)} → <b>{fmtDate(levelled.result.finishAfter)}</b>
                </div>
                <div className="rv-result__actions">
                  <button
                    type="button"
                    className="btn primary"
                    onClick={() => addSchedule(applyLevelling(model, levelled.result, 'levelled'))}
                    title="Adds the levelled programme to the Programmes list, to compare with the original (Schedule Comparison) or play in 4D"
                  >
                    Add as new programme
                  </button>
                  <button type="button" className="btn" onClick={() => setLevelled(null)}>Discard</button>
                </div>
              </div>
            )}
          </section>
        </aside>
      )}
    </div>
  );
}
