import { useRef } from 'react';
import { dateOfDay, dayIndex, midnight, type Bucket, type Period } from '../../schedule/resourceLoading';
import { PAD, ZoomScroller } from './ResourceCharts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROW_H = 16;

interface Cell {
  from: number;
  to: number;
  label: string;
}

/** Runs of consecutive periods sharing a key, as cells. */
function runs(n: number, keyOf: (i: number) => string, labelOf: (i: number) => string): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const last = out[out.length - 1];
    if (last && keyOf(last.from) === keyOf(i)) last.to = i + 1;
    else out.push({ from: i, to: i + 1, label: labelOf(i) });
  }
  return out;
}

const mondayOf = (d: Date) => {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
};

interface ResourceTimelineProps {
  origin: Date;
  buckets: Bucket[];
  period: Period;
  selected: number | null;
  onSelect: (index: number | null) => void;
  zoom: number;
  onZoom: (z: number) => void;
}

/** The 4D timeline's track for the Resources graphs: years over months (or
    quarters) over weeks (or the periods themselves), the playhead being the
    selected period — click or drag along it to move. It scrolls and zooms with
    the graphs below (ctrl + wheel, or the zoom buttons). Months are drawn
    darker than weeks, as in the Gantt. */
export function ResourceTimeline({ origin, buckets, period, selected, onSelect, zoom, onZoom }: ResourceTimelineProps) {
  const innerRef = useRef<HTMLDivElement>(null);
  const n = buckets.length;
  const dates = buckets.map((b) => dateOfDay(origin, b.from));
  const today = dayIndex(origin, midnight(new Date()));
  const todayIdx = buckets.findIndex((b) => today >= b.from && today <= b.to);

  const years = runs(n, (i) => String(dates[i].getFullYear()), (i) => String(dates[i].getFullYear()));
  const middle =
    period === 'month'
      ? runs(n, (i) => `${dates[i].getFullYear()}Q${Math.floor(dates[i].getMonth() / 3)}`, (i) => `Q${Math.floor(dates[i].getMonth() / 3) + 1}`)
      : runs(n, (i) => `${dates[i].getFullYear()}-${dates[i].getMonth()}`, (i) => MONTHS[dates[i].getMonth()]);
  const lower =
    period === 'month'
      ? buckets.map((_, i): Cell => ({ from: i, to: i + 1, label: MONTHS[dates[i].getMonth()] }))
      : period === 'week'
        ? buckets.map((_, i): Cell => ({ from: i, to: i + 1, label: String(dates[i].getDate()) }))
        : runs(n, (i) => String(mondayOf(dates[i]).getTime()), (i) => String(mondayOf(dates[i]).getDate()));
  // Yearly periods are the years row itself.
  const rows: { cells: Cell[]; kind: 'year' | 'month' | 'week' }[] = period === 'year'
    ? [{ cells: buckets.map((_, i): Cell => ({ from: i, to: i + 1, label: String(dates[i].getFullYear()) })), kind: 'year' }]
    : [
      { cells: years, kind: 'year' },
      { cells: middle, kind: 'month' },
      { cells: lower, kind: 'week' },
    ];

  return (
    <ZoomScroller zoom={zoom} onZoom={onZoom} bar>
      {(width) => {
        const plotW = width - PAD.left - PAD.right;
        const step = n ? plotW / n : plotW;
        const at = (clientX: number) => {
          const rect = innerRef.current!.getBoundingClientRect();
          const i = Math.floor((clientX - rect.left - PAD.left) / step);
          return Math.min(n - 1, Math.max(0, i));
        };
        const scrub = (e: React.PointerEvent) => {
          if (e.buttons !== 1 || !n) return;
          onSelect(at(e.clientX));
        };
        return (
          <div
            ref={innerRef}
            className="rv-tl"
            style={{ width, height: ROW_H * rows.length }}
            onPointerDown={(e) => {
              if (e.button !== 0 || !n) return;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              const i = at(e.clientX);
              onSelect(i === selected ? null : i);
            }}
            onPointerMove={scrub}
            title="Click or drag to pick a period · Ctrl + wheel to zoom"
          >
            {selected !== null && selected < n && <div className="rv-tl__sel" style={{ left: PAD.left + selected * step, width: Math.max(step, 2) }} />}
            {rows.map((row, r) =>
              row.cells.map((c) => {
                const w = (c.to - c.from) * step;
                return (
                  <div
                    key={`${r}:${c.from}`}
                    className={`rv-tl__cell rv-tl__cell--${row.kind}`}
                    style={{ left: PAD.left + c.from * step, width: w, top: r * ROW_H, height: ROW_H }}
                  >
                    {w >= c.label.length * 6.5 + 6 && <span>{c.label}</span>}
                  </div>
                );
              }),
            )}
            {todayIdx >= 0 && <div className="rv-tl__today" style={{ left: PAD.left + (todayIdx + 0.5) * step }} title="Today" />}
          </div>
        );
      }}
    </ZoomScroller>
  );
}
