import { useEffect, useMemo, useState } from 'react';
import { useSequenceSchedule } from '../../state/scheduleStore';
import { useSequenceTimelineStore } from '../../state/sequenceTimelineStore';
import { limitRange, scheduleRange } from '../../schedule/linking';
import { useTimelineSettingsStore } from '../../state/timelineSettingsStore';
import { IconInfo } from '../icons';

const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar date for a date input (yyyy-mm-dd). */
const toInput = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fromInput = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d).getTime() : null;
};

/** 4D tab > Jump to date (like Blender's): pick a date, step it back or
    forward by the playback Step with the arrows, then Jump moves the 4D
    timeline there (clamped to the programme's dates). */
export function JumpToDate() {
  const model = useSequenceSchedule();
  const basis = useSequenceTimelineStore((s) => s.basis);
  const date = useSequenceTimelineStore((s) => s.date);
  const setDate = useSequenceTimelineStore((s) => s.setDate);
  const setPlaying = useSequenceTimelineStore((s) => s.setPlaying);
  const limitStart = useTimelineSettingsStore((s) => s.limitStart);
  const limitEnd = useTimelineSettingsStore((s) => s.limitEnd);
  const range = useMemo(() => (model ? limitRange(scheduleRange(model, basis), limitStart, limitEnd) : null), [model, basis, limitStart, limitEnd]);

  const [draft, setDraft] = useState('');
  // The field follows the timeline (playback, scrubber) until edited.
  useEffect(() => {
    if (date !== null) setDraft(toInput(date));
  }, [date]);

  if (!range) {
    return <div className="jump__notice"><IconInfo className="jump__notice-icon" />Load a programme with dates first (Inputs tab).</div>;
  }

  const clamp = (ms: number) => Math.min(range.max, Math.max(range.min, ms));
  const jump = () => {
    const ms = fromInput(draft);
    if (ms === null) return;
    setPlaying(false);
    setDate(clamp(ms));
  };

  return (
    <div className="jump">
      <span className="jump__label">Jump to date</span>
      <input
        type="date"
        className="jump__date"
        value={draft}
        min={toInput(range.min)}
        max={toInput(range.max)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') jump(); }}
      />
      <button type="button" className="btn primary jump__go" disabled={fromInput(draft) === null} onClick={jump} title="Jump: move the 4D timeline to this date" aria-label="Jump to this date">▶</button>
    </div>
  );
}
