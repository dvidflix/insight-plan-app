import { useSequenceTimelineStore, type SkipMode } from '../../state/sequenceTimelineStore';
import { InfoTip } from '../InfoTip';

/** Monday first; the number is JS's getDay (0 = Sunday). */
const WEEK: { day: number; letter: string; name: string }[] = [
  { day: 1, letter: 'M', name: 'Monday' },
  { day: 2, letter: 'T', name: 'Tuesday' },
  { day: 3, letter: 'W', name: 'Wednesday' },
  { day: 4, letter: 'T', name: 'Thursday' },
  { day: 5, letter: 'F', name: 'Friday' },
  { day: 6, letter: 'S', name: 'Saturday' },
  { day: 0, letter: 'S', name: 'Sunday' },
];

/** 4D > Options > Skip days: the days playback and the step buttons go over (Daily and hourly steps). */
export function SkipDays() {
  const skip = useSequenceTimelineStore((s) => s.skip);
  const setSkip = useSequenceTimelineStore((s) => s.setSkip);
  const toggle = (day: number) => setSkip({ ...skip, days: skip.days.includes(day) ? skip.days.filter((d) => d !== day) : [...skip.days, day] });
  return (
    <>
      <label className="disp__row">
        <span>
          Skip days{' '}
          <InfoTip>Playback and the step buttons go over these days with Daily and hourly steps. Non-working days follow the programme's calendar (the one most activities use); Custom lets you pick the weekdays.</InfoTip>
        </span>
        <select value={skip.mode} onChange={(e) => setSkip({ ...skip, mode: e.target.value as SkipMode })} title="Days to skip">
          <option value="none">None</option>
          <option value="nonworking">Non-working days</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      {skip.mode === 'custom' && (
        <div className="disp__row" role="group" aria-label="Weekdays to skip">
          <span />
          <span style={{ display: 'inline-flex', gap: 4 }}>
            {WEEK.map((w) => (
              <button key={w.day} type="button" className={`tags__chip${skip.days.includes(w.day) ? ' active' : ''}`} aria-pressed={skip.days.includes(w.day)} title={`${skip.days.includes(w.day) ? 'Skipped' : 'Not skipped'}: ${w.name}`} onClick={() => toggle(w.day)} style={{ minWidth: 26, justifyContent: 'center' }}>{w.letter}</button>
            ))}
          </span>
        </div>
      )}
    </>
  );
}
