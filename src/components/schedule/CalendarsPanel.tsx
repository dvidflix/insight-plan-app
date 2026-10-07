import { useMemo, useState } from 'react';
import type { CalendarException, ScheduleCalendar } from '../../schedule/calendar';
import type { Activity, ScheduleModel } from '../../schedule/types';
import { queryMatcher } from '../../schedule/search';
import { usePersistedState } from '../../utils/persistedState';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MAX_LISTED = 200;

type SortKey = 'name' | 'used' | 'hours';
type ExceptionFilter = 'all' | 'off' | 'extra';

const isoText = (e: CalendarException) => {
  const d = new Date(`${e.date}T00:00:00`);
  return `${e.date} ${d.toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} ${MONTHS[d.getMonth()]}`;
};

/** Working days of the weekly pattern (a standard Mon–Fri week when the file carried none). */
const workingDays = (cal: ScheduleCalendar) =>
  DOW.map((day) => {
    const d = cal.days[day];
    return { day, working: d ? d.working : day !== 'Sunday' && day !== 'Saturday', range: d?.range };
  });

/** Project > Calendars: every calendar with what uses it, its weekly pattern and its holidays / extra
    working days. The search at the top matches a calendar's name or ID, an activity using it, or a
    date of its exceptions (e.g. "25 dec", "2028-12", "christmas" if it is named so). */
export function CalendarsPanel({ model, onSelectActivity }: { model: ScheduleModel; onSelectActivity?: (a: Activity) => void }) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = usePersistedState<SortKey>('calendars.sort', 'name');
  const [usedOnly, setUsedOnly] = usePersistedState('calendars.usedOnly', false);
  const [filter, setFilter] = usePersistedState<ExceptionFilter>('calendars.exceptions', 'all');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [listed, setListed] = useState<string | null>(null);

  // Activities by calendar (an unknown or missing one runs on the standard week).
  const usage = useMemo(() => {
    const byCal = new Map<string, Activity[]>();
    const known = new Set(model.calendars.map((c) => c.id));
    let standard = 0;
    for (const a of model.activities) {
      if (a.calendarId && known.has(a.calendarId)) (byCal.get(a.calendarId) ?? byCal.set(a.calendarId, []).get(a.calendarId)!).push(a);
      else standard++;
    }
    return { byCal, standard };
  }, [model]);

  const hit = queryMatcher(query);
  const searching = query.trim() !== '';

  const rows = useMemo(() => {
    const list = model.calendars.map((cal) => {
      const used = usage.byCal.get(cal.id) ?? [];
      const perDay = cal.hoursPerDay ?? 8;
      const days = workingDays(cal).filter((d) => d.working).length;
      const exceptions = cal.exceptions ?? [];
      const byName = hit(`${cal.name} ${cal.id}`);
      const byActivity = !byName && searching ? used.filter((a) => hit(`${a.code} ${a.name}`)) : [];
      const byDate = !byName && searching ? exceptions.filter((e) => hit(isoText(e))) : [];
      const matches = !searching || byName || byActivity.length > 0 || byDate.length > 0;
      return { cal, used, perDay, days, weekHours: perDay * days, exceptions, matches, byActivity, byDate };
    });
    const shown = list.filter((r) => r.matches && (!usedOnly || r.used.length > 0));
    shown.sort((a, b) =>
      sort === 'used' ? b.used.length - a.used.length || (a.cal.name || a.cal.id).localeCompare(b.cal.name || b.cal.id)
      : sort === 'hours' ? b.weekHours - a.weekHours || (a.cal.name || a.cal.id).localeCompare(b.cal.name || b.cal.id)
      : (a.cal.name || a.cal.id).localeCompare(b.cal.name || b.cal.id, undefined, { numeric: true, sensitivity: 'base' }));
    return shown;
    // hit follows the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, usage, query, sort, usedOnly]);

  const toggle = (id: string) => setOpenIds((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  const allOpen = rows.length > 0 && rows.every((r) => openIds.has(r.cal.id));

  if (model.calendars.length === 0) {
    return <div style={{ padding: 12, color: 'var(--text-dim)' }}>No calendars found in this file.</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
        <input
          className="cols__search"
          type="search"
          placeholder="Search calendars, activities using them, or holiday dates…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: '1 1 260px', minWidth: 200 }}
          aria-label="Search calendars"
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Order of the calendars">
          <span className="scn-dim">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <option value="name">Name</option>
            <option value="used">Most used</option>
            <option value="hours">Hours per week</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Holidays and extra working days shown in each calendar">
          <span className="scn-dim">Exceptions</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value as ExceptionFilter)}>
            <option value="all">All</option>
            <option value="off">Non-working only</option>
            <option value="extra">Extra working only</option>
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }} title="Hide calendars no activity uses">
          <input type="checkbox" checked={usedOnly} onChange={(e) => setUsedOnly(e.target.checked)} />
          <span>In use</span>
        </label>
        <button type="button" className="btn btn--small" onClick={() => setOpenIds(allOpen ? new Set() : new Set(rows.map((r) => r.cal.id)))} disabled={rows.length === 0}>
          {allOpen ? 'Collapse all' : 'Expand all'}
        </button>
        <span className="scn-dim" style={{ marginLeft: 'auto' }}>
          {rows.length === model.calendars.length ? `${rows.length} calendars` : `${rows.length} of ${model.calendars.length} calendars`}
          {usage.standard > 0 ? ` · ${usage.standard.toLocaleString()} activities on the standard week` : ''}
        </span>
      </div>

      <div style={{ overflow: 'auto', flex: 1, minHeight: 0, padding: 12 }}>
        {rows.length === 0 && <div style={{ color: 'var(--text-dim)' }}>{searching ? `No calendar matches “${query}”.` : 'No calendars to show.'}</div>}
        {rows.map(({ cal, used, perDay, days, weekHours, exceptions, byActivity, byDate }) => {
          const hasPattern = Object.keys(cal.days).length > 0;
          // Open while searching for something inside it, else as chosen.
          const open = openIds.has(cal.id) || byActivity.length > 0 || byDate.length > 0;
          const off = exceptions.filter((e) => !e.working).length;
          return (
            <div className="check-item" key={cal.id}>
              <div className="check-item__title" style={{ cursor: 'pointer' }} onClick={() => toggle(cal.id)} role="button" aria-expanded={open}>
                <span><span aria-hidden="true">{open ? '▾' : '▸'}</span> {cal.name || cal.id}</span>
                <span style={{ color: 'var(--text-dim)', display: 'flex', gap: 12 }}>
                  <span title="Activities using this calendar">{used.length.toLocaleString()} {used.length === 1 ? 'activity' : 'activities'}</span>
                  <span title="Hours per day">{perDay}h/day</span>
                  <span title="Working days per week">{days} d/wk</span>
                  <span title="Working hours per week">{weekHours}h/wk</span>
                </span>
              </div>

              {/* The week at a glance, even when closed. */}
              <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }} title={hasPattern ? undefined : 'No decodable weekly pattern in this source file — CPM math assumes a standard Mon-Fri work week.'}>
                {workingDays(cal).map(({ day, working, range }) => (
                  <span
                    key={day}
                    title={working ? `${day}: ${range || 'working'}` : `${day}: off`}
                    style={{ minWidth: 38, padding: '2px 6px', borderRadius: 4, textAlign: 'center', fontSize: 12, fontWeight: 600, background: working ? 'color-mix(in srgb, var(--ok) 16%, transparent)' : 'rgba(0,0,0,0.05)', color: working ? 'var(--ok)' : 'var(--text-dim)' }}
                  >
                    {day.slice(0, 3)}
                  </span>
                ))}
                {!hasPattern && <span className="scn-dim" style={{ fontSize: 12, alignSelf: 'center' }}>standard Mon–Fri assumed</span>}
                <span className="scn-dim" style={{ fontSize: 12, alignSelf: 'center', marginLeft: 6 }}>
                  {exceptions.length === 0 ? 'no holidays' : `${off} non-working ${off === 1 ? 'day' : 'days'}${exceptions.length > off ? `, ${exceptions.length - off} extra working` : ''}`}
                </span>
              </div>

              {open && (
                <>
                  {hasPattern && (
                    <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', fontSize: 11, color: 'var(--text-dim)' }}>
                      {workingDays(cal).filter((d) => d.working && d.range).map((d) => <span key={d.day}>{d.day.slice(0, 3)} {d.range}</span>)}
                    </div>
                  )}

                  <Exceptions exceptions={exceptions} filter={filter} marked={byDate} />

                  <div style={{ marginTop: 10, fontSize: 12 }}>
                    <button type="button" className="link-btn" disabled={used.length === 0} onClick={() => setListed(listed === cal.id ? null : cal.id)}>
                      {listed === cal.id ? 'Hide' : 'Show'} the {used.length.toLocaleString()} {used.length === 1 ? 'activity' : 'activities'} using it
                    </button>
                    {byActivity.length > 0 && <span className="scn-dim"> · {byActivity.length.toLocaleString()} match “{query}”</span>}
                  </div>
                  {(listed === cal.id || byActivity.length > 0) && (
                    <ActivityList activities={listed === cal.id ? used : byActivity} onSelect={onSelectActivity} />
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActivityList({ activities, onSelect }: { activities: Activity[]; onSelect?: (a: Activity) => void }) {
  const shown = activities.slice(0, MAX_LISTED);
  return (
    <div style={{ marginTop: 6, maxHeight: 220, overflow: 'auto', fontSize: 12, border: '1px solid var(--border)', borderRadius: 4, background: '#fff' }}>
      {shown.map((a) => (
        <div key={a.id} style={{ display: 'flex', gap: 10, padding: '2px 8px', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
          {onSelect ? <button type="button" className="link-btn" onClick={() => onSelect(a)} title={`Go to ${a.code}`}>{a.code}</button> : <span>{a.code}</span>}
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.name}>{a.name}</span>
        </div>
      ))}
      {activities.length > shown.length && <div className="scn-dim" style={{ padding: '2px 8px' }}>… and {(activities.length - shown.length).toLocaleString()} more</div>}
    </div>
  );
}

/** The calendar's holidays and extra working days, by year then month (the dates a search matched stand out). */
function Exceptions({ exceptions, filter, marked }: { exceptions: CalendarException[]; filter: ExceptionFilter; marked: CalendarException[] }) {
  const list = exceptions.filter((e) => (filter === 'off' ? !e.working : filter === 'extra' ? e.working : true));
  if (exceptions.length === 0) {
    return <div style={{ color: 'var(--text-dim)', marginTop: 8, fontSize: 12 }}>No holidays or exceptions.</div>;
  }
  if (list.length === 0) {
    return <div style={{ color: 'var(--text-dim)', marginTop: 8, fontSize: 12 }}>None of this kind.</div>;
  }
  const hits = new Set(marked.map((e) => e.date));
  const byYear = new Map<string, CalendarException[]>();
  for (const e of list) byYear.set(e.date.slice(0, 4), [...(byYear.get(e.date.slice(0, 4)) ?? []), e]);
  return (
    <div style={{ marginTop: 8, fontSize: 12 }}>
      {[...byYear].map(([year, items]) => {
        const months = new Map<number, CalendarException[]>();
        for (const e of items) {
          const m = Number(e.date.slice(5, 7)) - 1;
          months.set(m, [...(months.get(m) ?? []), e]);
        }
        return (
          <div key={year} style={{ marginTop: 6 }}>
            <b>{year}</b> <span className="scn-dim">{items.length}</span>
            <div style={{ display: 'grid', gridTemplateColumns: '84px 1fr', gap: '1px 8px', marginTop: 2 }}>
              {[...months].sort((a, b) => a[0] - b[0]).map(([m, es]) => (
                <div key={m} style={{ display: 'contents' }}>
                  <span className="scn-dim">{MONTHS[m]}</span>
                  <span>
                    {es.map((e, i) => (
                      <span
                        key={i}
                        title={`${new Date(`${e.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} — ${e.working ? `working ${e.range ?? ''}` : 'non-working'}`}
                        style={{ marginRight: 8, whiteSpace: 'nowrap', color: e.working ? 'var(--ok)' : undefined, background: hits.has(e.date) ? 'rgba(255, 213, 0, 0.45)' : undefined, borderRadius: 2 }}
                      >
                        {Number(e.date.slice(8, 10))}
                      </span>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
