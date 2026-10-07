import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useSequenceSchedule } from '../../state/scheduleStore';
import { useSequenceTimelineStore, STEP_UNIT_LABELS, type StepUnit } from '../../state/sequenceTimelineStore';
import { scheduleRange, type DateRange } from '../../schedule/linking';
import { addUnit, alignDown, nextBoundary, prevBoundary } from '../../schedule/period';
import { useTimelineSettingsStore, MAX_TIMELINE_ZOOM } from '../../state/timelineSettingsStore';
import { IconFirstPage, IconLastPage, IconPauseCircle, IconPlayCircle, IconRewind, IconStopCircle } from '../icons';

/** Widens the schedule range out to whole `unit` boundaries — start down to
    the period's first day, end up to the period's last day (Year =
    1 Jan..31 Dec, Month = 1st..last day, Week = Monday..Sunday). Mirrors
    the Blender add-on's _round_date_range_to_unit so a schedule running
    2017-03-14..2030-11-02 steps as a clean 2017-01-01..2030-12-31 range
    instead of starting/ending mid-period. The end is the last instant of the
    final period so activities finishing late on that day still complete.
    Day is a no-op. */
function roundRangeToUnit(range: DateRange, unit: StepUnit): DateRange {
  if (unit === 'day' || unit.endsWith('h')) return range;
  const min = alignDown(range.min, unit);
  const max = addUnit(alignDown(range.max, unit), unit, 1) - 1;
  return { min, max: Math.max(min, max) };
}

interface YearSegment {
  year: number;
  startPct: number;
  endPct: number;
}

/** One segment per calendar year overlapping the range, clipped to the
    range's own start/end — used to draw the year-banded progress track. */
function yearSegments(range: DateRange): YearSegment[] {
  const startYear = new Date(range.min).getFullYear();
  const endYear = new Date(range.max).getFullYear();
  const span = range.max - range.min;
  const segments: YearSegment[] = [];
  for (let y = startYear; y <= endYear; y++) {
    const yearStart = Math.max(range.min, new Date(y, 0, 1).getTime());
    const yearEnd = Math.min(range.max, new Date(y + 1, 0, 1).getTime());
    if (yearEnd <= yearStart) continue;
    segments.push({ year: y, startPct: ((yearStart - range.min) / span) * 100, endPct: ((yearEnd - range.min) / span) * 100 });
  }
  return segments;
}

interface MonthSegment {
  key: string;
  month: number;
  startPct: number;
  endPct: number;
}

/** One segment per calendar month overlapping the range (clipped to it), for
    the month row of the track while stepping Monthly. */
function monthSegments(range: DateRange): MonthSegment[] {
  const span = range.max - range.min;
  const out: MonthSegment[] = [];
  const first = new Date(range.min);
  for (let y = first.getFullYear(), m = first.getMonth(); new Date(y, m, 1).getTime() <= range.max; m++) {
    if (m > 11) { m = 0; y++; }
    const start = Math.max(range.min, new Date(y, m, 1).getTime());
    const end = Math.min(range.max, new Date(y, m + 1, 1).getTime());
    if (end <= start) continue;
    out.push({ key: `${y}-${m}`, month: m, startPct: ((start - range.min) / span) * 100, endPct: ((end - range.min) / span) * 100 });
  }
  return out;
}

/** One segment per calendar quarter overlapping the range (clipped to it), for
    the quarter row of the track while stepping Quarterly (`month` holds 0-3). */
function quarterSegments(range: DateRange): MonthSegment[] {
  const span = range.max - range.min;
  const out: MonthSegment[] = [];
  const first = new Date(range.min);
  for (let y = first.getFullYear(), q = Math.floor(first.getMonth() / 3); new Date(y, q * 3, 1).getTime() <= range.max; q++) {
    if (q > 3) { q = 0; y++; }
    const start = Math.max(range.min, new Date(y, q * 3, 1).getTime());
    const end = Math.min(range.max, new Date(y, q * 3 + 3, 1).getTime());
    if (end <= start) continue;
    out.push({ key: `${y}-Q${q}`, month: q, startPct: ((start - range.min) / span) * 100, endPct: ((end - range.min) / span) * 100 });
  }
  return out;
}

/** One segment per week (Monday to Sunday) overlapping the range, clipped to it. */
function weekSegments(range: DateRange): { key: number; startPct: number; endPct: number }[] {
  const span = range.max - range.min;
  const out: { key: number; startPct: number; endPct: number }[] = [];
  for (let w = alignDown(range.min, 'week'); w <= range.max; w = addUnit(w, 'week', 1)) {
    const start = Math.max(range.min, w);
    const end = Math.min(range.max, addUnit(w, 'week', 1));
    if (end > start) out.push({ key: w, startPct: ((start - range.min) / span) * 100, endPct: ((end - range.min) / span) * 100 });
  }
  return out;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The 4D scrub/transport controls, in the same visual language as the rest
    of the app — this replaces the ordinary app-wide status bar while the 4D
    Sequencing page is active (see App.tsx), rather than floating a
    separately-styled dark bar over the viewport. The one thing still
    floated over the viewport is the customizable date/week label
    (SequenceLabelOverlay), since a slim status bar has no room for a
    multi-line, user-positioned readout. */
export function SequenceTimelineStatusBar() {
  const model = useSequenceSchedule();
  const basis = useSequenceTimelineStore((s) => s.basis);
  const date = useSequenceTimelineStore((s) => s.date);
  const playing = useSequenceTimelineStore((s) => s.playing);
  const stepUnit = useSequenceTimelineStore((s) => s.stepUnit);
  const setDate = useSequenceTimelineStore((s) => s.setDate);
  const setStepUnit = useSequenceTimelineStore((s) => s.setStepUnit);
  const setPlaying = useSequenceTimelineStore((s) => s.setPlaying);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();
  const tl = useTimelineSettingsStore();

  const range = useMemo(() => {
    const raw = scheduleRange(model, basis);
    return raw ? roundRangeToUnit(raw, stepUnit) : raw;
  }, [model, basis, stepUnit]);

  // Snap the cursor onto the (re-rounded) range when it's first set or when
  // the step unit changes, so it always sits on a period boundary.
  useEffect(() => {
    if (!range) return;
    if (date === null) setDate(range.min);
    else if (date < range.min || date > range.max) setDate(Math.min(range.max, Math.max(range.min, date)));
  }, [range, date, setDate]);

  // Steps to the next calendar boundary of stepUnit on a fixed real-time
  // cadence, rather than advancing continuously — every activity inside the
  // current period lands on the viewer together at the same tick. See
  // nextBoundary's own doc comment for the mid-period-start snap behavior.
  useEffect(() => {
    if (!playing || !range) return;
    intervalRef.current = setInterval(() => {
      setDate((d) => {
        const current = d ?? range.min;
        const aligned = alignDown(current, stepUnit);
        const next = aligned < current ? aligned : nextBoundary(current, stepUnit);
        if (next >= range.max) {
          setPlaying(false);
          return range.max;
        }
        return next;
      });
    }, tl.stepIntervalMs);
    return () => clearInterval(intervalRef.current);
  }, [playing, range, stepUnit, setDate, setPlaying, tl.stepIntervalMs]);

  // Left/Right arrow keys, and Ctrl+. / Ctrl+, , step the cursor forward/back
  // by one stepUnit — same boundary math as the ⏪/⏩ buttons. Ignored while
  // typing in a form field elsewhere on the page so it doesn't hijack normal
  // text editing.
  useEffect(() => {
    if (!range) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Ctrl+Alt+3 plays / pauses, Ctrl+Alt+0 goes to the start, Ctrl+Alt+4 to the end (matched by key
      // position, as Alt changes what the key types).
      if (e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey) {
        if (e.code === 'Digit3') {
          e.preventDefault();
          if (!e.repeat) setPlaying((p) => !p);
          return;
        }
        if (e.code === 'Digit0') {
          e.preventDefault();
          setDate(range.min);
          return;
        }
        if (e.code === 'Digit4') {
          e.preventDefault();
          setDate(range.max);
          return;
        }
        // Ctrl+Alt+5 / 6: a longer / shorter step, along the Step dropdown's list.
        if (e.code === 'Digit5' || e.code === 'Digit6') {
          e.preventDefault();
          const i = STEP_UNIT_LABELS.findIndex((u) => u.value === stepUnit);
          const next = STEP_UNIT_LABELS[Math.min(STEP_UNIT_LABELS.length - 1, Math.max(0, i + (e.code === 'Digit5' ? 1 : -1)))];
          if (next) setStepUnit(next.value);
          return;
        }
      }
      const ctrl = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
      const forward = e.key === 'ArrowRight' || (ctrl && e.code === 'Period');
      const back = e.key === 'ArrowLeft' || (ctrl && e.code === 'Comma');
      if (forward) {
        e.preventDefault();
        setDate((d) => Math.min(range.max, nextBoundary(d ?? range.min, stepUnit)));
      } else if (back) {
        e.preventDefault();
        setDate((d) => Math.max(range.min, prevBoundary(d ?? range.min, stepUnit)));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [range, stepUnit, setDate, setStepUnit, setPlaying]);

  const segments = useMemo(() => (range ? yearSegments(range) : []), [range]);
  // Monthly stepping: the track splits into a month row over a smaller year row.
  const weekly = stepUnit === 'week' || stepUnit === 'day';
  const quarterly = stepUnit === 'quarter';
  // Yearly: the year names centred, with a tick for every month along the bottom.
  const yearly = stepUnit === 'year';
  const monthTicks = useMemo(() => (range && yearly ? monthSegments(range) : []), [range, yearly]);
  const monthly = stepUnit === 'month' || weekly;
  // The upper row of the track: months (Monthly / Weekly) or quarters (Quarterly).
  const months = useMemo(() => (range && monthly ? monthSegments(range) : range && quarterly ? quarterSegments(range) : []), [range, monthly, quarterly]);
  const weeks = useMemo(() => (range && weekly ? weekSegments(range) : []), [range, weekly]);
  const showMonthRow = (monthly || quarterly) && tl.showMonths;
  const showWeekRow = weekly && tl.showWeekTicks;
  // Which rows are drawn, and the share of the bar's height each gets.
  const rowVars = useMemo(() => {
    const rows = [showMonthRow && 'm', tl.showYears && 'y', showWeekRow && 'w'].filter(Boolean) as ('m' | 'y' | 'w')[];
    // Monthly / Quarterly: the period row and the year row split the bar 50/50.
    const weight = weekly ? { m: 1.3, y: 1, w: 1.1 } : { m: 1, y: 1, w: 1.1 };
    const total = rows.reduce((n, r) => n + weight[r], 0) || 1;
    const vars: Record<string, string> = {};
    let top = 0;
    for (const r of rows) {
      const h = (weight[r] / total) * 100;
      vars[`--${r}-top`] = `${top}%`;
      vars[`--${r}-h`] = `${h}%`;
      top += h;
    }
    return vars as CSSProperties;
  }, [showMonthRow, showWeekRow, tl.showYears, weekly]);
  const trackRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const ready = !!model && !!range && date !== null;
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTrackWidth(el.clientWidth));
    ro.observe(el);
    setTrackWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [ready, tl.zoom]);

  // A zoomed bar scrolls sideways: keep the current date in view as it moves.
  const progressFrac = range && date !== null ? (date - range.min) / (range.max - range.min) : 0;
  useEffect(() => {
    const scroller = trackRef.current;
    const inner = innerRef.current;
    if (!scroller || !inner || !tl.followPlayhead || tl.zoom <= 1) return;
    const x = progressFrac * inner.clientWidth;
    const margin = scroller.clientWidth * 0.15;
    if (x < scroller.scrollLeft + margin || x > scroller.scrollLeft + scroller.clientWidth - margin) {
      scroller.scrollTo({ left: Math.max(0, x - scroller.clientWidth * 0.4), behavior: playing ? 'smooth' : 'auto' });
    }
  }, [progressFrac, tl.followPlayhead, tl.zoom, playing]);

  // Ctrl + wheel zooms the bar around the pointer.
  const wheelZoom = tl.wheelZoom;
  useEffect(() => {
    const scroller = trackRef.current;
    if (!scroller || !wheelZoom) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const inner = innerRef.current;
      if (!inner) return;
      const store = useTimelineSettingsStore.getState();
      const next = Math.min(MAX_TIMELINE_ZOOM, Math.max(1, store.zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
      const rect = scroller.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const frac = (scroller.scrollLeft + x) / inner.clientWidth;
      store.patch({ zoom: Math.round(next * 100) / 100 });
      requestAnimationFrame(() => {
        scroller.scrollLeft = Math.max(0, frac * inner.clientWidth - x);
      });
    };
    scroller.addEventListener('wheel', onWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', onWheel);
  }, [wheelZoom, ready]);

  if (!model || !range || date === null) {
    return <footer className="app-statusbar">Load a Programme to start 4D sequencing.</footer>;
  }

  const progressPct = ((date - range.min) / (range.max - range.min)) * 100;
  const clampToRange = (v: number) => Math.min(range.max, Math.max(range.min, v));

  return (
    <footer className="app-statusbar sequence-statusbar">

      <div ref={trackRef} className={`sequence-statusbar__track${showMonthRow ? ' sequence-statusbar__track--months' : ''}${yearly ? ' sequence-statusbar__track--years' : ''}${quarterly ? ' sequence-statusbar__track--quarters' : ''}${tl.zoom > 1 ? ' is-zoomed' : ''}`}>
        <div ref={innerRef} className="sequence-statusbar__inner" style={{ width: `${tl.zoom * 100}%`, ...rowVars }}>
        {showWeekRow && trackWidth > 0 && weeks.length * 3 <= trackWidth && weeks.map((seg) => (
          <div key={seg.key} className={`sequence-statusbar__week-seg${new Date(seg.key).getDate() <= 7 ? ' is-month' : ''}`} style={{ left: `${seg.startPct}%`, width: `${seg.endPct - seg.startPct}%` }} />
        ))}
        {yearly && trackWidth > 0 && monthTicks.length * 3 <= trackWidth && monthTicks.map((seg) => (
          <div key={seg.key} className={`sequence-statusbar__month-tick${seg.month === 0 ? ' is-year' : ''}`} style={{ left: `${seg.startPct}%`, width: `${seg.endPct - seg.startPct}%` }} />
        ))}
        {showMonthRow && months.map((seg) => {
          const px = ((seg.endPct - seg.startPct) / 100) * trackWidth;
          return (
            <div key={seg.key} className="sequence-statusbar__month-seg" style={{ left: `${seg.startPct}%`, width: `${seg.endPct - seg.startPct}%` }}>
              {quarterly ? (px >= 16 ? `Q${seg.month + 1}` : '') : px >= 26 && tl.monthLabels === 'names' ? MONTH_NAMES[seg.month] : px >= 10 ? MONTH_NAMES[seg.month][0] : ''}
            </div>
          );
        })}
        {tl.showYears && segments.map((seg) => (
          <div key={seg.year} className="sequence-statusbar__year-seg" style={{ left: `${seg.startPct}%`, width: `${seg.endPct - seg.startPct}%` }}>
            {((seg.endPct - seg.startPct) / 100) * trackWidth >= (monthly || quarterly ? 30 : 40) && <span>{seg.year}</span>}
          </div>
        ))}
        {tl.showProgress && <div className="sequence-statusbar__progress" style={{ width: `${progressPct}%` }} />}
        {tl.showPlayhead && <div className="sequence-statusbar__playhead" style={{ left: `${progressPct}%` }} />}
        <input
          type="range"
          min={range.min}
          max={range.max}
          value={date}
          onChange={(e) => setDate(Number(e.target.value))}
          className="sequence-statusbar__scrub"
          aria-label="Timeline"
        />
        </div>
      </div>

      <div className="sequence-statusbar__transport">
        <button className="transport-btn" type="button" title="Go to start (Ctrl+Alt+0)" aria-label="Go to start" onClick={() => setDate(range.min)}>
          <IconFirstPage />
        </button>
        <button className="transport-btn" type="button" title={`Back 1 ${stepUnit} (Ctrl+,)`} aria-label={`Back 1 ${stepUnit}`} onClick={() => setDate((d) => clampToRange(prevBoundary(d ?? range.min, stepUnit)))}>
          <IconRewind />
        </button>
        <button className={`transport-btn transport-btn--play${playing ? ' is-playing' : ''}`} type="button" title={playing ? 'Pause (Ctrl+Alt+3)' : 'Play (Ctrl+Alt+3)'} aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)}>
          {playing ? <IconPauseCircle /> : <IconPlayCircle />}
        </button>
        <button
          className="transport-btn"
          type="button"
          title="Stop (back to the start)"
          aria-label="Stop"
          onClick={() => {
            setPlaying(false);
            setDate(range.min);
          }}
        >
          <IconStopCircle />
        </button>
        <button className="transport-btn transport-btn--mirror" type="button" title={`Forward 1 ${stepUnit} (Ctrl+.)`} aria-label={`Forward 1 ${stepUnit}`} onClick={() => setDate((d) => clampToRange(nextBoundary(d ?? range.min, stepUnit)))}>
          <IconRewind />
        </button>
        <button className="transport-btn" type="button" title="Go to end (Ctrl+Alt+4)" aria-label="Go to end" onClick={() => setDate(range.max)}>
          <IconLastPage />
        </button>
      </div>

      <label className="sequence-statusbar__step" title="Playback step (Ctrl+Alt+5 longer, Ctrl+Alt+6 shorter)">
        <span>Step</span>
        <select value={stepUnit} onChange={(e) => setStepUnit(e.target.value as StepUnit)}>
          {STEP_UNIT_LABELS.map((u) => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </select>
      </label>
    </footer>
  );
}
