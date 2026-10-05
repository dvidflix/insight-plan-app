import { useMemo, useState } from 'react';
import { useSequenceSchedule } from '../state/scheduleStore';
import { activityFinishMs, activityStartMs } from '../schedule/linking';
import { activityOfMarker } from '../viewer/markerActivity';
import type { Marker } from '../state/markersStore';

const fmt = (ms: number | null) => (ms === null ? '?' : new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));

/** Links a marker to an activity of the loaded programmes: search by code or name, pick one. In 4D Sequencing the
    marker then shows only from that activity's start to its finish. */
export function MarkerActivityPicker({ marker, onChange }: { marker: Marker; onChange: (patch: Pick<Marker, 'activityId' | 'activityCode' | 'activityName'>) => void }) {
  const schedule = useSequenceSchedule();
  const [query, setQuery] = useState('');
  const [picking, setPicking] = useState(false);
  const linked = activityOfMarker(marker, schedule);

  const results = useMemo(() => {
    if (!schedule) return [];
    const q = query.trim().toLowerCase();
    const all = schedule.activities;
    return (q ? all.filter((a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)) : all).slice(0, 40);
  }, [schedule, query]);

  const unlink = () => onChange({ activityId: undefined, activityCode: undefined, activityName: undefined });

  return (
    <div className="mkt__act">
      <div className="mkt__act-head">
        <span className="mkt__lbl">Activity</span>
        {marker.activityId ? (
          <span className="mkt__act-cur">
            <b>{marker.activityCode}</b> {marker.activityName}
            {!linked && <em> (not loaded)</em>}
          </span>
        ) : <span className="mkt__act-none">None: always shown</span>}
        <span className="mkt__spacer" />
        <button type="button" className="btn btn--small" onClick={() => setPicking((v) => !v)} disabled={!schedule}>{picking ? 'Close' : marker.activityId ? 'Change' : 'Link'}</button>
        {marker.activityId && <button type="button" className="btn btn--small" onClick={unlink}>Unlink</button>}
      </div>
      {!schedule && <div className="flt__hint">Load a programme (Inputs) to link an activity.</div>}
      {linked && <div className="flt__hint">Shown in 4D Sequencing from {fmt(activityStartMs(linked, 'planned'))} to {fmt(activityFinishMs(linked, 'planned'))} (planned dates; the basis in use applies).</div>}
      {picking && schedule && (
        <div className="mkt__pick">
          <input autoFocus placeholder="Search activity code or name…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="mkt__pick-list">
            {results.map((a) => (
              <button key={a.id} type="button" className="mkt__pick-row" onClick={() => { onChange({ activityId: a.id, activityCode: a.code, activityName: a.name }); setPicking(false); setQuery(''); }}>
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
