import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Bucket, BucketFigures } from '../../schedule/resourceLoading';

/** Categorical slots in fixed order (dataviz reference palette, validated for
    adjacent pairs on white); a trade keeps its slot whatever is filtered. */
export const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
export const OTHER_COLOR = '#898781';
export const CRITICAL = 'var(--bar-critical, #d03b3b)';

export const PAD = { left: 48, right: 64, top: 18, bottom: 26 };

export const fmtNum = (v: number, digits = 0) =>
  v.toLocaleString(undefined, { maximumFractionDigits: v !== 0 && Math.abs(v) < 10 ? Math.max(digits, 1) : digits });

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  // Fine steps, so the top of the axis sits just above the largest value.
  return ([1, 1.2, 1.5, 2, 2.4, 3, 4, 5, 6, 8, 10].find((step) => n <= step + 1e-9) ?? 10) * p;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 40;

/** Every zoomable scroller on screen (the timeline and each chart) keeps the
    same horizontal position, so they pan together like one wide chart. */
const scrollGroup = new Set<HTMLDivElement>();
/** The date under the pointer when a zoom starts: kept under it afterwards. */
let zoomAnchor: { frac: number; x: number } | null = null;

/** Changes the shared zoom keeping the point under `clientX` (default: the
    middle of the view) where it is. */
export function changeZoom(next: number, set: (z: number) => void, clientX?: number) {
  const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next * 100) / 100));
  const el = [...scrollGroup][0];
  if (el) {
    const x = clientX === undefined ? el.clientWidth / 2 : clientX - el.getBoundingClientRect().left;
    zoomAnchor = { frac: (el.scrollLeft + x) / Math.max(1, el.scrollWidth), x };
  }
  set(z);
}

interface ZoomScrollerProps {
  zoom: number;
  onZoom: (z: number) => void;
  /** Draws the scrollbar (the timeline); the charts leave theirs hidden. */
  bar?: boolean;
  className?: string;
  /** Receives the full (zoomed) content width. */
  children: (width: number) => ReactNode;
}

/** Horizontal scroller whose content is `zoom` × as wide as its box; ctrl +
    wheel zooms around the pointer. */
export function ZoomScroller({ zoom, onZoom, bar, className, children }: ZoomScrollerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(600);
  const zoomRef = useRef({ zoom, onZoom });
  zoomRef.current = { zoom, onZoom };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    scrollGroup.add(el);
    const peer = [...scrollGroup].find((o) => o !== el);
    if (peer) el.scrollLeft = peer.scrollLeft;
    const onScroll = () => {
      for (const o of scrollGroup) if (o !== el && Math.abs(o.scrollLeft - el.scrollLeft) >= 1) o.scrollLeft = el.scrollLeft;
    };
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      changeZoom(zoomRef.current.zoom * (e.deltaY < 0 ? 1.25 : 0.8), zoomRef.current.onZoom, e.clientX);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      scrollGroup.delete(el);
      el.removeEventListener('scroll', onScroll);
      el.removeEventListener('wheel', onWheel);
    };
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    const a = zoomAnchor;
    if (!el || !a) return;
    el.scrollLeft = Math.max(0, a.frac * el.scrollWidth - a.x);
    queueMicrotask(() => {
      if (zoomAnchor === a) zoomAnchor = null;
    });
  }, [zoom]);

  return (
    <div ref={ref} className={`rv-zs${bar ? ' rv-zs--bar' : ''}${className ? ` ${className}` : ''}`}>
      {children(Math.round(box * zoom))}
    </div>
  );
}

/** Value labels that stay at the left edge while a zoomed chart scrolls. */
function YAxis({ height, ticks }: { height: number; ticks: { y: number; label: string }[] }) {
  return (
    <div className="rv-yaxis" style={{ width: PAD.left, height }}>
      <svg width={PAD.left} height={height} aria-hidden="true">
        {ticks.map((t) => (
          <text key={t.label + t.y} x={PAD.left - 6} y={t.y + 3} className="rv-tick" textAnchor="end">{t.label}</text>
        ))}
      </svg>
    </div>
  );
}

/** Bar with 4px rounded top corners, anchored on the baseline. */
function topRounded(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className="rv-tip" style={{ left: Math.min(tip.x, window.innerWidth - 250), top: tip.y }}>
      {tip.content}
    </div>
  );
}

export interface StackSeries {
  name: string;
  color: string;
}

interface StackedChartProps {
  buckets: Bucket[];
  figures: BucketFigures[];
  series: StackSeries[];
  unit: string;
  /** Constant capacity line (people), or null. */
  capacity: number | null;
  /** Total per bucket before levelling, drawn as a line, or null. */
  before: number[] | null;
  selected: number | null;
  onSelect: (index: number | null) => void;
  height: number;
  /** Aria label naming the chart. */
  title: string;
  /** Whole-number axis (counts). */
  integer?: boolean;
  /** Writes each column's total above it when there is room. */
  valueLabels?: boolean;
  /** Extra tooltip rows for a period. */
  extra?: (index: number) => ReactNode;
  /** A line on its own right-hand axis (e.g. the running total). */
  overlay?: { name: string; values: number[] } | null;
  zoom: number;
  onZoom: (z: number) => void;
}

/** Stacked columns per period (one segment per trade), a dashed capacity
    line, overload markers (▲, status red) and, after levelling, the total
    before levelling as a grey line — all on one axis. */
export function StackedChart(props: StackedChartProps) {
  return <ZoomScroller zoom={props.zoom} onZoom={props.onZoom}>{(width) => <StackedBody {...props} width={width} />}</ZoomScroller>;
}

function StackedBody({ buckets, figures, series, unit, capacity, before, selected, onSelect, height, title, integer, valueLabels, extra, overlay, width }: StackedChartProps & { width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const n = buckets.length;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const step = n ? plotW / n : plotW;
  const gap = step > 6 ? 2 : step > 3 ? 1 : 0;
  // Scaled to the bars and capacity; a much higher "before levelling" line
  // is clipped rather than squashing the bars (its peak is noted instead).
  const barMax = Math.max(1, ...figures.map((f) => f.total), capacity ?? 0);
  const beforeMax = before ? Math.max(0, ...before) : 0;
  const rawMax = niceMax(Math.max(barMax, beforeMax <= barMax * 1.5 ? beforeMax : 0) * 1.02);
  const maxVal = integer ? Math.max(4, Math.ceil(rawMax / 4) * 4) : rawMax;
  const beforeOffScale = beforeMax > maxVal;
  const overMax = overlay ? niceMax(Math.max(1, ...overlay.values) * 1.02) : 1;
  const yOver = (v: number) => PAD.top + plotH - (v / overMax) * plotH;
  const y = (v: number) => PAD.top + plotH - (v / maxVal) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * maxVal);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 56))));
  const clipId = `rv-clip-${title.replace(/\W+/g, '')}`;

  const indexAt = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const i = Math.floor((clientX - rect.left - PAD.left) / step);
    return i >= 0 && i < n ? i : null;
  };
  const showTip = (i: number, clientX: number, clientY: number) => {
    const f = figures[i];
    const rows = series.filter((s) => (f.values.get(s.name) ?? 0) > 0);
    setTip({
      x: clientX + 12,
      y: Math.max(0, clientY - 10),
      content: (
        <>
          <div className="rv-tip__title">{buckets[i].long}</div>
          {rows.map((s) => (
            <div key={s.name} className="rv-tip__row">
              <span className="rv-swatch" style={{ background: s.color }} />
              <span className="rv-tip__name">{s.name}</span>
              <span className="rv-tip__val">{fmtNum(f.values.get(s.name) ?? 0)}</span>
            </div>
          ))}
          <div className="rv-tip__row rv-tip__total">
            <span className="rv-tip__name">Total {unit}</span>
            <span className="rv-tip__val">{fmtNum(f.total)}</span>
          </div>
          {capacity !== null && (
            <div className="rv-tip__row">
              <span className="rv-tip__name">Capacity</span>
              <span className="rv-tip__val">{fmtNum(capacity)}</span>
            </div>
          )}
          {before && (
            <div className="rv-tip__row">
              <span className="rv-tip__name">Before levelling</span>
              <span className="rv-tip__val">{fmtNum(before[i])}</span>
            </div>
          )}
          {f.overloaded.length > 0 && (
            <div className="rv-tip__over">
              ▲ Over capacity on {f.overDays} day{f.overDays === 1 ? '' : 's'}: {f.overloaded.join(', ')}
            </div>
          )}
          {overlay && (
            <div className="rv-tip__row">
              <span className="rv-tip__name">{overlay.name}</span>
              <span className="rv-tip__val">{fmtNum(overlay.values[i])}</span>
            </div>
          )}
          {extra?.(i)}
          <div className="rv-tip__hint">Click to list the activities</div>
        </>
      ),
    });
  };

  return (
    <div
      ref={ref}
      className="rv-chart"
      style={{ width }}
      onMouseMove={(e) => {
        const i = indexAt(e.clientX);
        setHover(i);
        if (i === null) setTip(null);
        else showTip(i, e.clientX, e.clientY);
      }}
      onMouseLeave={() => {
        setHover(null);
        setTip(null);
      }}
      onClick={(e) => {
        const i = indexAt(e.clientX);
        onSelect(i === selected ? null : i);
      }}
    >
      <YAxis height={height} ticks={ticks.map((t) => ({ y: y(t), label: fmtNum(t) }))} />
      <svg className="rv-plot" width={width} height={height} role="img" aria-label={title}>
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
          </clipPath>
        </defs>
        {ticks.map((t) => (
          <line key={t} x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'rv-axis' : 'rv-grid'} />
        ))}
        {(hover !== null || selected !== null) &&
          [hover, selected].filter((i): i is number => i !== null).map((i) => (
            <rect key={`band${i}`} x={PAD.left + i * step} y={PAD.top} width={step} height={plotH} className={i === selected ? 'rv-band rv-band--selected' : 'rv-band'} />
          ))}
        {figures.map((f, i) => {
          const x = PAD.left + i * step + gap / 2;
          const w = Math.max(step - gap, 0.5);
          let acc = 0;
          const segs = series.filter((s) => (f.values.get(s.name) ?? 0) > 0);
          return (
            <g key={i}>
              {segs.map((s, k) => {
                const v = f.values.get(s.name) ?? 0;
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                const h = Math.max(y0 - y1 - (k > 0 && gap ? 1 : 0), 0.5);
                return k === segs.length - 1 ? (
                  <path key={s.name} d={topRounded(x, y1, w, h)} fill={s.color} />
                ) : (
                  <rect key={s.name} x={x} y={y1 + (gap ? 1 : 0)} width={w} height={Math.max(h - (gap ? 1 : 0), 0.5)} fill={s.color} />
                );
              })}
              {f.overloaded.length > 0 && (
                <text x={x + w / 2} y={y(f.total) - 4} className="rv-over" textAnchor="middle">▲</text>
              )}
              {valueLabels && f.total > 0 && w >= 16 && (
                <text x={x + w / 2} y={y(f.total) - 4} className="rv-valuelabel" textAnchor="middle">{fmtNum(f.total)}</text>
              )}
            </g>
          );
        })}
        {before && (
          <polyline
            className="rv-before"
            clipPath={`url(#${clipId})`}
            points={before.map((v, i) => `${PAD.left + (i + 0.5) * step},${y(v)}`).join(' ')}
          />
        )}
        {overlay && n > 0 && (
          <g>
            <polyline className="rv-overlay" points={overlay.values.map((v, i) => `${PAD.left + (i + 0.5) * step},${yOver(v)}`).join(' ')} />
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <text key={t} x={PAD.left + plotW + 6} y={yOver(t * overMax) + 3} className="rv-tick">{fmtNum(t * overMax)}</text>
            ))}
            <text x={PAD.left + plotW} y={PAD.top - 6} className="rv-caplabel" textAnchor="end">{overlay.name} (right axis)</text>
          </g>
        )}
        {beforeOffScale && (
          <text x={PAD.left + plotW} y={PAD.top - 6} className="rv-caplabel" textAnchor="end">Before levelling peaks at {fmtNum(beforeMax)} (off scale)</text>
        )}
        {capacity !== null && capacity > 0 && (
          <g>
            <line x1={PAD.left} x2={PAD.left + plotW} y1={y(capacity)} y2={y(capacity)} className="rv-capacity" />
            <text x={PAD.left + plotW + 4} y={y(capacity) + 3} className="rv-caplabel">Capacity {fmtNum(capacity)}</text>
          </g>
        )}
        {buckets.map((b, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={PAD.left + (i + 0.5) * step} y={height - 8} className="rv-tick" textAnchor="middle">{b.label}</text>
          ) : null,
        )}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

export interface LineSeries {
  name: string;
  color: string;
  values: number[];
  dashed?: boolean;
}

/** Cumulative curves (S-curve) with a crosshair tooltip. */
interface LineChartProps {
  buckets: Bucket[];
  series: LineSeries[];
  unit: string;
  height: number;
  title: string;
  zoom: number;
  onZoom: (z: number) => void;
}

export function LineChart(props: LineChartProps) {
  return <ZoomScroller zoom={props.zoom} onZoom={props.onZoom}>{(width) => <LineBody {...props} width={width} />}</ZoomScroller>;
}

function LineBody({ buckets, series, unit, height, title, width }: LineChartProps & { width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const n = buckets.length;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const step = n ? plotW / n : plotW;
  const maxVal = niceMax(Math.max(1, ...series.flatMap((s) => s.values)) * 1.05);
  const y = (v: number) => PAD.top + plotH - (v / maxVal) * plotH;
  const xAt = (i: number) => PAD.left + (i + 0.5) * step;
  const ticks = [0, 0.5, 1].map((t) => t * maxVal);
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 56))));
  // End labels, pushed apart when curves finish at (nearly) the same value.
  const endY = new Map<string, number>();
  if (n > 0) {
    const order = [...series].sort((a, b) => y(a.values[n - 1]) - y(b.values[n - 1]));
    let last = -Infinity;
    for (const s of order) {
      const at = Math.max(y(s.values[n - 1]) + 3, last + 12);
      endY.set(s.name, at);
      last = at;
    }
  }

  return (
    <div
      ref={ref}
      className="rv-chart"
      style={{ width }}
      onMouseMove={(e) => {
        const rect = ref.current!.getBoundingClientRect();
        const i = Math.floor((e.clientX - rect.left - PAD.left) / step);
        if (i < 0 || i >= n) {
          setHover(null);
          setTip(null);
          return;
        }
        setHover(i);
        setTip({
          x: e.clientX + 12,
          y: Math.max(0, e.clientY - 10),
          content: (
            <>
              <div className="rv-tip__title">{buckets[i].long}</div>
              {series.map((s) => (
                <div key={s.name} className="rv-tip__row">
                  <span className="rv-swatch" style={{ background: s.color }} />
                  <span className="rv-tip__name">{s.name}</span>
                  <span className="rv-tip__val">{fmtNum(s.values[i])} {unit}</span>
                </div>
              ))}
            </>
          ),
        });
      }}
      onMouseLeave={() => {
        setHover(null);
        setTip(null);
      }}
    >
      <YAxis height={height} ticks={ticks.map((t) => ({ y: y(t), label: fmtNum(t) }))} />
      <svg className="rv-plot" width={width} height={height} role="img" aria-label={title}>
        {ticks.map((t) => (
          <line key={t} x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} className={t === 0 ? 'rv-axis' : 'rv-grid'} />
        ))}
        {hover !== null && <line x1={xAt(hover)} x2={xAt(hover)} y1={PAD.top} y2={PAD.top + plotH} className="rv-crosshair" />}
        {series.map((s) => (
          <g key={s.name}>
            <polyline
              points={s.values.map((v, i) => `${xAt(i)},${y(v)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '5 4' : undefined}
              strokeLinejoin="round"
            />
            {hover !== null && <circle cx={xAt(hover)} cy={y(s.values[hover])} r={4} fill={s.color} stroke="#fff" strokeWidth={2} />}
            {n > 0 && (
              <text x={PAD.left + plotW + 4} y={endY.get(s.name)} className="rv-caplabel">{s.name}</text>
            )}
          </g>
        ))}
        {buckets.map((b, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={xAt(i)} y={height - 8} className="rv-tick" textAnchor="middle">{b.label}</text>
          ) : null,
        )}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}
