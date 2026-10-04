import { useMemo, useState } from 'react';
import type { Activity } from '../../schedule/types';
import { HEAT_MODES, activityOnDay, dayIndex, dayToDate, heatCounts, type HeatMode } from '../../schedule/heatmap';
import type { ColumnCtx, ColumnDef } from '../../schedule/columns';
import { queryMatcher } from '../../schedule/search';
import { STATUS_LABEL } from '../../schedule/filterFields';
import { fmtDate } from '../../schedule/reports';

export interface DayFilter {
  day: number;
  mode: HeatMode;
}

interface CalendarHeatmapProps {
  /** Activities to count — should not already be narrowed by the day filter. */
  activities: Activity[];
  dayFilter: DayFilter | null;
  onDayFilter: (filter: DayFilter | null) => void;
  /** The column catalog, to filter by a field's values (Activity Type, a code, a user field…). */
  catalog?: ColumnDef[];
  columnCtx?: ColumnCtx;
  /** Opens an activity (the day's list links to them). */
  onSelectActivity?: (activity: Activity) => void;
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MAX_VALUES = 60;

const heatColor = (count: number, max: number) => `rgba(224, 72, 52, ${(0.1 + 0.7 * (count / max)).toFixed(3)})`;
const startTime = (a: Activity) => (a.actualStart ?? a.earlyStart ?? a.targetStart)?.getTime() ?? 0;

/** Programmes > Calendar Heatmap: activities per day. Filter inside it by name / code
    terms (e.g. "rebar" or "rebar, concrete") and by the values of any field; click a
    day to list the activities on it in a pane (with a button to filter the Table and
    Gantt to that day). */
export function CalendarHeatmap({ activities: all, dayFilter, onDayFilter, catalog = [], columnCtx, onSelectActivity }: CalendarHeatmapProps) {
  const [mode, setMode] = useState<HeatMode>('active');
  const [year, setYear] = useState('all');
  const [search, setSearch] = useState('');
  const [fieldId, setFieldId] = useState('');
  const [values, setValues] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<number | null>(null);

  const field = useMemo(() => catalog.find((c) => c.id === fieldId) ?? null, [catalog, fieldId]);
  const fieldValues = useMemo(() => {
    if (!field || !columnCtx) return [] as { value: string; count: number }[];
    const tally = new Map<string, number>();
    for (const a of all) {
      if (a.type === 'wbs-summary') continue;
      const v = field.text(a, columnCtx);
      if (v) tally.set(v, (tally.get(v) ?? 0) + 1);
    }
    return [...tally].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count).slice(0, MAX_VALUES);
  }, [all, field, columnCtx]);

  const activities = useMemo(() => {
    const hit = queryMatcher(search);
    return all.filter((a) => {
      if (search.trim() && !hit(`${a.code} ${a.name}`)) return false;
      if (values.size > 0 && !(field && columnCtx && values.has(field.text(a, columnCtx)))) return false;
      return true;
    });
  }, [all, search, values, field, columnCtx]);

  const counts = useMemo(() => heatCounts(activities, mode), [activities, mode]);
  const dayList = useMemo(
    () => (picked === null ? [] : activities.filter((a) => activityOnDay(a, mode, picked)).sort((a, b) => startTime(a) - startTime(b) || a.code.localeCompare(b.code))),
    [activities, mode, picked],
  );
  const toggleValue = (v: string) =>
    setValues((cur) => {
      const next = new Set(cur);
      if (!next.delete(v)) next.add(v);
      return next;
    });

  const { months, years, max } = useMemo(() => {
    if (counts.size === 0) return { months: [] as { y: number; m: number }[], years: [] as number[], max: 0 };
    let lo = Infinity;
    let hi = -Infinity;
    let peak = 0;
    for (const [d, n] of counts) {
      if (d < lo) lo = d;
      if (d > hi) hi = d;
      if (n > peak) peak = n;
    }
    const first = dayToDate(lo);
    const last = dayToDate(hi);
    const list: { y: number; m: number }[] = [];
    for (let y = first.getFullYear(), m = first.getMonth(); y < last.getFullYear() || (y === last.getFullYear() && m <= last.getMonth()); ) {
      list.push({ y, m });
      if (++m > 11) { m = 0; y++; }
    }
    return { months: list, years: [...new Set(list.map((x) => x.y))], max: peak };
  }, [counts]);

  const shown = year === 'all' ? months : months.filter((x) => x.y === Number(year));
  const modeInfo = HEAT_MODES.find((m) => m.id === mode)!;
  const dayIsFiltered = picked !== null && dayFilter?.day === picked && dayFilter.mode === mode;

  return (
    <div className="heat-wrap">
      <div className="heat">
        <div className="heat__controls">
          <div className="heat__tabs" role="tablist">
            {HEAT_MODES.map((m) => (
              <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} className={mode === m.id ? 'active' : ''} onClick={() => setMode(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <select className="filter-select heat__year" value={year} onChange={(e) => setYear(e.target.value)} aria-label="Year">
            <option value="all">All Years</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div className="heat__filters">
          <input type="search" value={search} placeholder="Filter by name / code: rebar, concrete…" onChange={(e) => { setSearch(e.target.value); setPicked(null); }} />
          {catalog.length > 0 && (
            <select value={fieldId} onChange={(e) => { setFieldId(e.target.value); setValues(new Set()); }} aria-label="Filter by field">
              <option value="">Filter by field…</option>
              {catalog.filter((c) => c.group !== 'Resource Units' && c.group !== 'Dates').map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          )}
          {(search || values.size > 0) && (
            <button type="button" className="btn btn--small" onClick={() => { setSearch(''); setValues(new Set()); }}>Clear filters</button>
          )}
          <span className="heat__hint">{activities.length} of {all.length} activities</span>
        </div>
        {field && fieldValues.length > 0 && (
          <div className="heat__values">
            {fieldValues.map((v) => (
              <button key={v.value} type="button" className={`heat__chip${values.has(v.value) ? ' active' : ''}`} onClick={() => toggleValue(v.value)} title={`${v.count} activities`}>
                {v.value} <span>{v.count}</span>
              </button>
            ))}
          </div>
        )}

        <div className="heat__legend">
          Heatmap shows: <strong>{modeInfo.shows}</strong> per day
          <span className="heat__scale">
            0
            <i style={{ background: `linear-gradient(90deg, ${heatColor(0, 1)}, ${heatColor(1, 1)})` }} />
            {max}
          </span>
          <span className="heat__hint">Hover a day for details · Click a day to list its activities</span>
        </div>

        {shown.length === 0 ? (
          <div className="heat__empty">No dated activities to show.</div>
        ) : (
          <div className="heat__months">
            {shown.map(({ y, m }) => {
              const lead = new Date(y, m, 1).getDay();
              const days = new Date(y, m + 1, 0).getDate();
              const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
              return (
                <div className="heat-month" key={`${y}-${m}`}>
                  <div className="heat-month__title">{MONTHS[m].toUpperCase()} {y}</div>
                  <div className="heat-month__grid">
                    {DOW.map((d) => <div className="heat-month__dow" key={d}>{d}</div>)}
                    {cells.map((d, i) => {
                      if (d === null) return <div className="heat-day heat-day--blank" key={`b${i}`} />;
                      const idx = dayIndex(new Date(y, m, d));
                      const n = counts.get(idx) ?? 0;
                      const selected = picked === idx;
                      return (
                        <button
                          key={d}
                          type="button"
                          className={`heat-day${selected ? ' heat-day--selected' : ''}`}
                          style={n > 0 ? { background: heatColor(n, max) } : undefined}
                          title={`${d} ${MONTHS[m]} ${y}: ${n} ${n === 1 ? 'activity' : 'activities'}`}
                          onClick={() => setPicked(selected ? null : idx)}
                        >
                          <span className="heat-day__num">{d}</span>
                          {n > 0 && <span className="heat-day__count">{n}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {picked !== null && (
        <aside className="heat-pane" aria-label="Activities on the selected day">
          <div className="heat-pane__head">
            <div>
              <b>{dayToDate(picked).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</b>
              <div className="scn-dim">{dayList.length} {dayList.length === 1 ? 'activity' : 'activities'} · {modeInfo.label}</div>
            </div>
            <button type="button" className="btn btn--small" aria-label="Close" onClick={() => setPicked(null)}>✕</button>
          </div>
          <button
            type="button"
            className={`btn btn--small${dayIsFiltered ? ' primary' : ''}`}
            onClick={() => onDayFilter(dayIsFiltered ? null : { day: picked, mode })}
            title="Show only this day's activities in the Table and Gantt"
          >
            {dayIsFiltered ? 'Clear the Table / Gantt filter' : 'Filter the Table and Gantt to this day'}
          </button>
          <div className="heat-pane__list">
            {dayList.map((a) => (
              <div className="heat-pane__item" key={a.id}>
                {onSelectActivity ? <button type="button" className="link-btn" onClick={() => onSelectActivity(a)}>{a.code || a.id}</button> : <b>{a.code || a.id}</b>}
                <span className="heat-pane__name" title={a.name}>{a.name}</span>
                <span className="scn-dim">
                  {fmtDate(a.actualStart ?? a.earlyStart ?? a.targetStart)} to {fmtDate(a.actualFinish ?? a.earlyFinish ?? a.targetFinish)} · {STATUS_LABEL[a.status]}
                </span>
              </div>
            ))}
            {dayList.length === 0 && <div className="scn-dim">Nothing on this day for the filters above.</div>}
          </div>
        </aside>
      )}
    </div>
  );
}
