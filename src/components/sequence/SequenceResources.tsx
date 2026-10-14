import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ScheduleModel } from '../../schedule/types';
import { aggregate, bucketsOf, buildLoading, dateOfDay, dayIndex, type Metric, type Period, type ResourceLoading } from '../../schedule/resourceLoading';
import { applyVirtualResources, virtualCatalog } from '../../schedule/virtualResources';
import { useTradeCapacityStore } from '../../state/tradeCapacityStore';
import { useSequenceTimelineStore } from '../../state/sequenceTimelineStore';
import { useTimelineSettingsStore, MAX_TIMELINE_ZOOM } from '../../state/timelineSettingsStore';
import { registerTimelineScroller, syncTimelineScroll, useTimelineSpanStore } from '../../state/timelineSpanStore';
import { usePersistedState } from '../../utils/persistedState';
import { OTHER_COLOR, SERIES_COLORS, fmtNum } from '../schedule/ResourceCharts';

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
/** "Rebar (t)" -> "t"; no unit -> "". */
const unitOf = (name: string) => /\(([^)]+)\)\s*$/.exec(name)?.[1] ?? '';
const HEIGHT = 190;
const PAD = { left: 0, right: 0, top: 10, bottom: 18 };
const AXIS_W = 40; // the value labels at the left edge, which stay put while the chart scrolls
const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Planned and current loading on one day 0, so their periods line up. */
function loadings(model: ScheduleModel) {
  const catalog = [...(model.resourceCatalog ?? []), ...virtualCatalog];
  const acts = applyVirtualResources(model.activities);
  const a = buildLoading(acts, catalog, model.calendars, 'current');
  const b = buildLoading(acts, catalog, model.calendars, 'planned');
  const origin = a.origin.getTime() <= b.origin.getTime() ? a.origin : b.origin;
  const same = (l: ResourceLoading, basis: 'current' | 'planned') => (l.origin.getTime() === origin.getTime() ? l : buildLoading(acts, catalog, model.calendars, basis, origin));
  return { current: same(a, 'current'), planned: same(b, 'planned') };
}

/** 4D > Resources: the labour the programme calls for, week by week, with the planned dates (target) against the
    current ones (early / actual), the site capacity, and the 4D timeline's date as a line across the chart. Click or
    drag on the chart to move the timeline; the table gives that period's figures and the man-hours to date. */
export function SequenceResources({ model }: { model: ScheduleModel }) {
  const date = useSequenceTimelineStore((s) => s.date);
  const [period, setPeriod] = usePersistedState<Period>('sequence.resources.period', 'week');
  const [metric, setMetric] = usePersistedState<Metric>('sequence.resources.metric', 'peak');
  const [kind, setKind] = usePersistedState<'labour' | 'materials'>('sequence.resources.kind', 'labour');
  const [material, setMaterial] = usePersistedState<string>('sequence.resources.material', '');
  const [hiddenTrades, setHiddenTrades] = usePersistedState<string[]>('sequence.resources.hidden', []);
  const capOverrides = useTradeCapacityStore((s) => s.capacities);
  const { current, planned } = useMemo(() => loadings(model), [model]);
  const dayCount = Math.max(current.dayCount, planned.dayCount);
  const lastFinish = useMemo(() => {
    let last: Date | null = null;
    for (const a of model.activities) { const f = a.earlyFinish ?? a.targetFinish; if (f && (!last || f > last)) last = f; }
    return last;
  }, [model]);

  const labour = useMemo(() => {
    const seen = new Map<string, number | null>();
    for (const l of [current, planned]) for (const r of l.resources) if (r.type === 'labor' && !seen.has(r.name)) seen.set(r.name, r.fileCapacity);
    return [...seen].map(([name, fileCapacity]) => ({ name, fileCapacity }));
  }, [current, planned]);
  // Materials (concrete m³, rebar t...): quantities, each in its own unit, so one is charted at a time.
  const materials = useMemo(() => {
    const seen = new Set<string>();
    for (const l of [current, planned]) for (const r of l.resources) if (r.type !== 'labor') seen.add(r.name);
    return [...seen].map((name) => ({ name, fileCapacity: null as number | null }));
  }, [current, planned]);
  const isMat = kind === 'materials' && materials.length > 0;
  const chosen = materials.find((m) => m.name === material)?.name ?? materials[0]?.name ?? '';
  const rows = isMat ? materials : labour;
  const trades = isMat ? (chosen ? [chosen] : []) : labour.map((r) => r.name).filter((n) => !hiddenTrades.includes(n));
  const colorOf = (name: string) => {
    const i = rows.findIndex((r) => r.name === name);
    return i >= 0 && i < SERIES_COLORS.length ? SERIES_COLORS[i] : OTHER_COLOR;
  };
  const capacity = useMemo(() => {
    const m = new Map<string, number>();
    if (isMat) return m;
    for (const r of labour) {
      const v = capOverrides[r.name] ?? r.fileCapacity;
      if (v && v > 0) m.set(r.name, v);
    }
    return m;
  }, [labour, capOverrides, isMat]);

  const buckets = useMemo(() => bucketsOf(current.origin, dayCount, period), [current.origin, dayCount, period]);
  const cur = useMemo(() => aggregate({ ...current, dayCount }, trades, capacity, buckets, isMat ? 'sum' : metric), [current, dayCount, trades, capacity, buckets, metric, isMat]);
  const plan = useMemo(() => aggregate({ ...planned, dayCount }, trades, capacity, buckets, isMat ? 'sum' : metric), [planned, dayCount, trades, capacity, buckets, metric, isMat]);
  const capTotal = trades.reduce((s, n) => s + (capacity.get(n) ?? 0), 0);
  const unit = isMat ? unitOf(chosen) || 'quantity' : METRICS.find((m) => m.id === metric)!.unit;
  const shownMetric: Metric = isMat ? 'sum' : metric;
  // Every material's figures (the table lists them all, whichever one the chart shows).
  const matFigures = useMemo(() => {
    if (!isMat) return null;
    return materials.map((m) => ({
      name: m.name,
      cur: aggregate({ ...current, dayCount }, [m.name], new Map(), buckets, 'sum'),
      plan: aggregate({ ...planned, dayCount }, [m.name], new Map(), buckets, 'sum'),
    }));
  }, [isMat, materials, current, planned, dayCount, buckets]);

  // The chart is the 4D timeline bar's twin: the same dates along its width, the same zoom, scrolled together with it.
  const zoom = useTimelineSettingsStore((st) => st.zoom);
  const spanMin = useTimelineSpanStore((st) => st.min);
  const spanMax = useTimelineSpanStore((st) => st.max);
  const t0 = spanMin ?? current.origin.getTime();
  const t1 = spanMax !== null && spanMax > t0 ? spanMax : dateOfDay(current.origin, dayCount).getTime();
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(480);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(Math.max(240, el.clientWidth)));
    ro.observe(el);
    setViewW(Math.max(240, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  const width = Math.round(viewW * zoom);
  useEffect(() => {
    const el = scroller.current;
    return el ? registerTimelineScroller(el) : undefined;
  }, []);
  useLayoutEffect(() => {
    if (scroller.current) syncTimelineScroll(scroller.current);
  }, [width]);
  // Ctrl + wheel zooms the timeline (and so this chart) around the pointer, as it does on the bar.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const store = useTimelineSettingsStore.getState();
      const next = Math.min(MAX_TIMELINE_ZOOM, Math.max(1, store.zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
      const x = e.clientX - el.getBoundingClientRect().left;
      const frac = (el.scrollLeft + x) / el.scrollWidth;
      store.patch({ zoom: Math.round(next * 100) / 100 });
      requestAnimationFrame(() => { el.scrollLeft = Math.max(0, frac * el.scrollWidth - x); });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const n = buckets.length;
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const max = Math.max(1e-9, ...cur.map((f) => f.total), ...plan.map((f) => f.total), shownMetric === 'hours' || isMat ? 0 : capTotal);
  const yMax = niceMax(max);
  const xOf = (ms: number) => PAD.left + Math.min(1, Math.max(0, (ms - t0) / (t1 - t0))) * plotW;
  const bx = (i: number) => xOf(dateOfDay(current.origin, buckets[i].from).getTime());
  const bEnd = (i: number) => xOf(dateOfDay(current.origin, buckets[i].to + 1).getTime());
  const bw = (i: number) => Math.max(1, bEnd(i) - bx(i) - (n > 120 ? 0 : 1));
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;

  // Where the timeline sits.
  const today = date === null ? -1 : dayIndex(current.origin, new Date(date));
  const at = buckets.findIndex((b) => today >= b.from && today <= b.to);
  const cursorX = date === null ? null : xOf(date);
  const setFromX = (clientX: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect();
    const ms = t0 + Math.min(1, Math.max(0, (clientX - rect.left - PAD.left) / plotW)) * (t1 - t0);
    const picked = dayIndex(current.origin, new Date(ms));
    const b = buckets.find((k) => picked >= k.from && picked <= k.to);
    if (!b) return;
    const day = Math.min(Math.max(b.from, 0), dayCount - 1);
    useSequenceTimelineStore.getState().setPlaying(false);
    useSequenceTimelineStore.getState().setDate(dateOfDay(current.origin, day).getTime());
  };
  const dragging = useRef(false);

  // The table: the period the timeline is in, and the man-hours to its end.
  const row = at >= 0 ? at : null;
  const hoursTo = (l: ResourceLoading, upTo: number) => {
    let sum = 0;
    for (const t of trades) {
      const s = l.demand.get(t);
      if (s) for (let d = 0; d <= Math.min(upTo, s.length - 1); d++) sum += s[d];
    }
    return sum * 8;
  };
  const toDay = row === null ? null : Math.min(buckets[row].to, dayCount - 1);
  const hCur = toDay === null ? null : hoursTo(current, toDay);
  const hPlan = toDay === null ? null : hoursTo(planned, toDay);
  const hTotal = hoursTo(planned, dayCount);

  if (labour.length === 0 && materials.length === 0) return <div className="seqres__empty">This programme has no labour or materials assigned to its activities, so there is nothing to compare. Resources come with the programme (P6 resource assignments).</div>;

  const yTicks = [0, 0.5, 1].map((f) => f * yMax);
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 70))));

  return (
    <div className="seqres">
      <div className="seqres__bar">
        <select value={isMat ? 'materials' : 'labour'} onChange={(e) => setKind(e.target.value as 'labour' | 'materials')} aria-label="Kind of resource">
          <option value="labour" disabled={labour.length === 0}>Labour</option>
          <option value="materials" disabled={materials.length === 0}>Materials</option>
        </select>
        {isMat
          ? <select value={chosen} onChange={(e) => setMaterial(e.target.value)} aria-label="Material">{materials.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}</select>
          : <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} aria-label="Measure">{METRICS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>}
        <select value={period} onChange={(e) => setPeriod(e.target.value as Period)} aria-label="Period">{PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        <span className="seqres__legend"><i className="seqres__key seqres__key--plan" /> Planned (target dates)</span>
        <span className="seqres__legend" title="The programme this chart is built from: its name, its place in the project database and the date its last activity finishes">{model.sourceFileName}{model.dbProgrammeId !== undefined ? ` (#${model.dbProgrammeId})` : ''} · {model.activities.length} activities · ends {lastFinish ? fmtDate(lastFinish) : '—'}</span>
        {capTotal > 0 && shownMetric !== 'hours' && <span className="seqres__legend"><i className="seqres__key seqres__key--cap" /> Capacity</span>}
      </div>
      <div className="seqres__chart" ref={host}>
        <div className="seqres__yaxis" style={{ width: AXIS_W, height: HEIGHT }} aria-hidden="true">
          {yTicks.map((v) => <span key={v} style={{ top: y(v) - 7 }}>{fmtNum(v)}</span>)}
        </div>
        <div className="seqres__scroll" ref={scroller} style={{ overflowX: zoom > 1 ? 'auto' : 'hidden' }}>
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label="Resources by period, current against planned, with the 4D timeline date"
          onPointerDown={(e) => { dragging.current = true; (e.currentTarget as Element).setPointerCapture(e.pointerId); setFromX(e.clientX, e.currentTarget); }}
          onPointerMove={(e) => { if (dragging.current) setFromX(e.clientX, e.currentTarget); }}
          onPointerUp={() => { dragging.current = false; }}
          style={{ touchAction: 'none', cursor: 'ew-resize' }}
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} stroke="var(--border)" strokeWidth={1} />
            </g>
          ))}
          {buckets.map((b, i) => {
            let acc = 0;
            return (
              <g key={b.from}>
                {trades.map((t) => {
                  const v = cur[i].values.get(t) ?? 0;
                  if (v <= 0) return null;
                  const top = y(acc + v);
                  const h = y(acc) - top;
                  acc += v;
                  return <rect key={t} x={bx(i)} y={top} width={bw(i)} height={Math.max(0, h)} fill={colorOf(t)} opacity={at === i ? 1 : 0.82} />;
                })}
                {i % step === 0 && <text x={bx(i) + 2} y={HEIGHT - 4} fontSize={10} fill="var(--text-dim)">{b.label}</text>}
              </g>
            );
          })}
          <polyline fill="none" stroke="#202426" strokeWidth={1.5} strokeDasharray="4 3" points={plan.map((f, i) => `${bx(i) + bw(i) / 2},${y(f.total)}`).join(' ')} />
          {capTotal > 0 && shownMetric !== 'hours' && <line x1={PAD.left} x2={width - PAD.right} y1={y(capTotal)} y2={y(capTotal)} stroke="#d03b3b" strokeWidth={1.2} strokeDasharray="2 3" />}
          {cursorX !== null && <line x1={cursorX} x2={cursorX} y1={PAD.top - 4} y2={PAD.top + plotH} stroke="var(--accent-strong, #1b7f4b)" strokeWidth={2} />}
        </svg>
        </div>
      </div>

      {row !== null ? (
        <div className="seqres__table-wrap">
          {isMat && matFigures ? (
            <>
              <div className="seqres__when">{buckets[row].long} — quantity, current against planned</div>
              <table className="seqres__table">
                <thead><tr><th>Material</th><th>Current</th><th>Planned</th><th>To date</th><th>Programme total</th></tr></thead>
                <tbody>
                  {matFigures.map((m) => {
                    const sum = (f: typeof m.cur, upTo: number) => f.slice(0, upTo + 1).reduce((n, x) => n + x.total, 0);
                    const u = unitOf(m.name);
                    const q = (v: number) => `${fmtNum(v, 1)}${u ? ` ${u}` : ''}`;
                    return (
                      <tr key={m.name}>
                        <td><label className="seqres__trade"><input type="radio" name="seqres-material" checked={m.name === chosen} onChange={() => setMaterial(m.name)} /><i className="seqres__key" style={{ background: colorOf(m.name) }} />{m.name}</label></td>
                        <td>{q(m.cur[row].total)}</td>
                        <td>{q(m.plan[row].total)}</td>
                        <td>{q(sum(m.cur, row))}</td>
                        <td>{q(sum(m.plan, m.plan.length - 1))}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          ) : (
            <>
          <div className="seqres__when">{buckets[row].long} — {unit}, current against planned</div>
          <table className="seqres__table">
            <thead><tr><th>Trade</th><th>Current</th><th>Planned</th><th>Capacity</th><th>Used</th></tr></thead>
            <tbody>
              {labour.map((r) => {
                const off = hiddenTrades.includes(r.name);
                const c = cur[row].values.get(r.name) ?? 0;
                const p = plan[row].values.get(r.name) ?? 0;
                const cap = capacity.get(r.name);
                return (
                  <tr key={r.name} className={off ? 'is-off' : undefined}>
                    <td><label className="seqres__trade"><input type="checkbox" checked={!off} onChange={() => setHiddenTrades(off ? hiddenTrades.filter((x) => x !== r.name) : [...hiddenTrades, r.name])} /><i className="seqres__key" style={{ background: colorOf(r.name) }} />{r.name}</label></td>
                    <td>{off ? '' : fmtNum(c, 1)}</td>
                    <td>{off ? '' : fmtNum(p, 1)}</td>
                    <td>{cap && metric !== 'hours' ? fmtNum(cap) : ''}</td>
                    <td className={cap && c > cap + 1e-9 ? 'seqres__over' : undefined}>{off || !cap || metric === 'hours' ? '' : `${Math.round((c / cap) * 100)}%`}</td>
                  </tr>
                );
              })}
              <tr className="seqres__total"><td>Total</td><td>{fmtNum(cur[row].total, 1)}</td><td>{fmtNum(plan[row].total, 1)}</td><td>{capTotal && metric !== 'hours' ? fmtNum(capTotal) : ''}</td><td>{capTotal && metric !== 'hours' ? `${Math.round((cur[row].total / capTotal) * 100)}%` : ''}</td></tr>
            </tbody>
          </table>
          {hCur !== null && hPlan !== null && (
            <div className="seqres__todate">
              Man-hours to {fmtDate(dateOfDay(current.origin, toDay!))}: <b>{fmtNum(hCur)}</b> current, <b>{fmtNum(hPlan)}</b> planned
              {hPlan > 0 && <> ({hCur - hPlan >= 0 ? '+' : '−'}{fmtNum(Math.abs(hCur - hPlan))}, {Math.round((hCur / hPlan) * 100)}% of plan)</>}
              {hTotal > 0 && <> · {Math.round((hCur / hTotal) * 100)}% of the programme's {fmtNum(hTotal)}</>}
            </div>
          )}
            </>
          )}
        </div>
      ) : (
        <div className="seqres__empty">Move the 4D timeline into the programme's dates (or click the chart) to see that period's figures.</div>
      )}
    </div>
  );
}

/** A round top for the y axis (1, 2, 5 × 10ⁿ). */
function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
