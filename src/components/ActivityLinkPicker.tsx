import { useMemo, useState } from 'react';
import { useSequenceSchedule } from '../state/scheduleStore';
import { activityFinishMs, activityStartMs } from '../schedule/linking';
import { activityFor } from '../topics/topicDates';
import type { ActRef } from '../state/topicsStore';

const fmt = (ms: number | null) => (ms === null ? '?' : new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));

/** Pick an activity of the loaded programmes (search by code or name). */
export function ActivityLinkPicker({ value, onChange, placeholder = 'Pick an activity' }: { value: ActRef | undefined; onChange: (act: ActRef | undefined) => void; placeholder?: string }) {
  const schedule = useSequenceSchedule();
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const linked = activityFor(value, schedule);

  const results = useMemo(() => {
    if (!schedule) return [];
    const q = query.trim().toLowerCase();
    return (q ? schedule.activities.filter((a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)) : schedule.activities).slice(0, 40);
  }, [schedule, query]);

  return (
    <div className="mkt__act">
      <div className="mkt__act-head">
        {value ? (
          <span className="mkt__act-cur" title={linked ? `${fmt(activityStartMs(linked, 'planned'))} – ${fmt(activityFinishMs(linked, 'planned'))}` : undefined}>
            <b>{value.code}</b> {value.name || linked?.name}
            {!linked && <em> (not loaded)</em>}
          </span>
        ) : <span className="mkt__act-none">{placeholder}</span>}
        <span className="mkt__spacer" />
        <button type="button" className="btn btn--small" onClick={() => setPicking((v) => !v)} disabled={!schedule}>{picking ? 'Close' : value ? 'Change' : 'Pick'}</button>
        {value && <button type="button" className="btn btn--small" onClick={() => onChange(undefined)}>Clear</button>}
      </div>
      {!schedule && <div className="flt__hint">Load a programme (Inputs) to pick an activity.</div>}
      {picking && schedule && (
        <div className="mkt__pick">
          <input autoFocus placeholder="Search activity code or name…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="mkt__pick-list">
            {results.map((a) => (
              <button key={a.id} type="button" className="mkt__pick-row" onClick={() => { onChange({ id: a.id, code: a.code, name: a.name }); setPicking(false); setQuery(''); }}>
                <b>{a.code}</b> <span>{a.name}</span>
              </button>
            ))}
            {results.length === 0 && <div className="flt__hint">No activity matches.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
