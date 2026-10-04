import type { CalendarException } from '../../schedule/calendar';
import type { ScheduleModel } from '../../schedule/types';

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function CalendarsPanel({ model }: { model: ScheduleModel }) {
  if (model.calendars.length === 0) {
    return <div style={{ padding: 12, color: 'var(--text-dim)' }}>No calendars found in this file.</div>;
  }
  return (
    <div style={{ overflow: 'auto', height: '100%', padding: 12 }}>
      {model.calendars.map((cal) => {
        const hasPattern = Object.keys(cal.days).length > 0;
        return (
          <div className="check-item" key={cal.id}>
            <div className="check-item__title">
              <span>{cal.name || cal.id}</span>
              <span style={{ color: 'var(--text-dim)' }}>{cal.hoursPerDay ?? 8}h/day</span>
            </div>
            {!hasPattern && (
              <div style={{ color: 'var(--text-dim)', marginTop: 6 }}>
                No decodable weekly pattern in this source file — CPM math assumes a standard Mon-Fri work week.
              </div>
            )}
            {hasPattern && (
              <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
                {DOW.map((day) => {
                  const d = cal.days[day];
                  const working = d ? d.working : day !== 'Sunday' && day !== 'Saturday';
                  return (
                    <div key={day} style={{ textAlign: 'center' }}>
                      <div style={{ color: working ? 'var(--ok)' : 'var(--text-dim)', fontWeight: 600 }}>{day.slice(0, 3)}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{working ? d?.range || 'working' : 'off'}</div>
                    </div>
                  );
                })}
              </div>
            )}
            <Exceptions exceptions={cal.exceptions ?? []} />
          </div>
        );
      })}
    </div>
  );
}

/** The calendar's holidays and extra working days, by year. */
function Exceptions({ exceptions }: { exceptions: CalendarException[] }) {
  if (exceptions.length === 0) {
    return <div style={{ color: 'var(--text-dim)', marginTop: 6, fontSize: 12 }}>No holidays or exceptions.</div>;
  }
  const off = exceptions.filter((e) => !e.working).length;
  const byYear = new Map<string, CalendarException[]>();
  for (const e of exceptions) {
    const year = e.date.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), e]);
  }
  return (
    <details style={{ marginTop: 8, fontSize: 12 }}>
      <summary style={{ cursor: 'pointer', color: 'var(--text-dim)' }}>
        {off} non-working {off === 1 ? 'day' : 'days'}
        {exceptions.length > off && `, ${exceptions.length - off} with changed hours`}
      </summary>
      {[...byYear].map(([year, list]) => (
        <div key={year} style={{ marginTop: 6 }}>
          <b>{year}</b>{' '}
          {list.map((e, i) => (
            <span key={i}title={e.working ? `Working ${e.range}` : 'Non-working'} style={{ marginRight: 8, color: e.working ? 'var(--ok)' : undefined, whiteSpace: 'nowrap' }}>
              {new Date(`${e.date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </span>
          ))}
        </div>
      ))}
    </details>
  );
}
