import { IconRemove } from '../icons';
import { useState } from 'react';
import { useEditableGrid } from '../useEditableGrid';
import type { CalendarException, ScheduleCalendar } from '../../schedule/calendar';
import { DAY_NAMES, dayHours, daySpans, standardSpan, weekWithDayLength } from '../../schedule/calendarData';
import { addCalendar, deleteCalendar, updateCalendar, type CalendarPatch } from '../../schedule/programmeCommands';
import type { ScheduleModel } from '../../schedule/types';
import { editStructure } from '../../state/programmeEdits';
import { commit } from '../../state/programmeHistory';
import { programmeKey } from '../../state/unloadedWbsStore';

/** Monday first, as a week is read. */
const WEEK = [...DAY_NAMES.slice(1), DAY_NAMES[0]];

type Days = ScheduleCalendar['days'];
const failed = (r: object): r is { error: string } => 'error' in r;

/** Every day of the week named: a calendar from a file that had no weekly pattern is the Monday-Friday week the schedule takes it for. */
function fullWeek(cal: ScheduleCalendar): Days {
  const hours = cal.hoursPerDay || 8;
  const named = Object.keys(cal.days).length > 0;
  const out: Days = {};
  DAY_NAMES.forEach((name, i) => {
    const day = cal.days[name] ?? (named ? { working: false, range: '' } : i !== 0 && i !== 6 ? { working: true, range: '', spans: [standardSpan(hours)] } : { working: false, range: '' });
    out[name] = day;
  });
  return out;
}

const runText = (spans: { start: string; finish: string }[]) => spans.map((s) => `${s.start}–${s.finish}`).join(', ');

/** Runs one change of the programme's calendars through the history (so it can be undone) and reports a refusal. */
function useCalendarCommand(model: ScheduleModel) {
  const key = programmeKey(model);
  const [note, setNote] = useState<string | null>(null);
  const run = <T extends object>(label: string, command: Parameters<typeof editStructure<T>>[1], merge?: string) => {
    const r = commit(label, () => editStructure(key, command), merge ? { merge } : {});
    if (failed(r)) {
      setNote(r.error);
      return null;
    }
    setNote(null);
    return r;
  };
  return { run, note, setNote };
}

/** The "+ Calendar" button of the Calendars view of a programme edited in place, and what a refusal said. */
export function AddCalendar({ model }: { model: ScheduleModel }) {
  const { run, note } = useCalendarCommand(model);
  return (
    <>
      <button
        type="button"
        className="btn btn--small"
        onClick={() => {
          const name = window.prompt('Name of the new calendar (a Monday-Friday week of 8-hour days; change it below):')?.trim();
          if (name) run('Add calendar', (m) => addCalendar(m, name));
        }}
        title="Add a calendar"
      >
        + Calendar
      </button>
      {note && <span className="scn-dim" role="alert" style={{ color: 'var(--danger, #b91c1c)' }}>{note}</span>}
    </>
  );
}

/** Edits one calendar of a programme edited in place: its name, the length of its working day, the working time of each day of the week
    and its holidays and extra working days. Every change is one undo step, and the programme is calculated again. */
export function CalendarEditor({ model, cal, used }: { model: ScheduleModel; cal: ScheduleCalendar; used: number }) {
  const { run, note } = useCalendarCommand(model);
  const patch = (label: string, p: CalendarPatch, merge?: string) => run(label, (m) => updateCalendar(m, cal.id, p), merge);
  const week = fullWeek(cal);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [kind, setKind] = useState<'off' | 'work'>('off');

  /** The length a day is when every working day has the same: that is the calendar's day. */
  const sharedHours = (days: Days) => {
    const lengths = new Set(DAY_NAMES.filter((n) => days[n]?.working).map((n) => Math.round(dayHours(days[n]) * 100) / 100));
    return lengths.size === 1 ? [...lengths][0] : null;
  };
  /** One day of the week with a change made to it. */
  const dayWith = (from: Days, name: string, change: { working?: boolean; start?: string; finish?: string }) => {
    const current = from[name];
    const spans = daySpans(current);
    const first = spans[0] ?? standardSpan(cal.hoursPerDay || 8);
    const working = change.working ?? current.working;
    const start = change.start ?? first.start;
    const finish = change.finish ?? spans[spans.length - 1]?.finish ?? first.finish;
    const run1 = change.start !== undefined || change.finish !== undefined || (change.working && spans.length === 0);
    return working
      ? (run1 || spans.length === 0 ? { working: true, range: `${start}–${finish}`, spans: [{ start, finish }] } : { ...current, working: true })
      : { working: false, range: '' };
  };
  const hoursPatch = (days: Days) => {
    const hours = sharedHours(days);
    return hours && hours > 0 && hours !== cal.hoursPerDay ? { hoursPerDay: hours } : {};
  };
  const setDay = (name: string, change: { working?: boolean; start?: string; finish?: string }) => {
    const days = { ...week, [name]: dayWith(week, name, change) };
    patch(`Edit ${name} of ${cal.name}`, { days, ...hoursPatch(days) }, `cal:${cal.id}:${name}`);
  };
  // Start and Finish typed as a spreadsheet's: range, fill down (Ctrl+D, the corner square: Monday's hours down to Friday), copy and paste.
  const grid = useEditableGrid({ widthsKey: 'calendar.editor',
    rows: WEEK as string[],
    get: (col, name) => { const spans = daySpans(week[name]); return !week[name].working || spans.length === 0 ? '' : col === 'start' ? spans[0].start : spans[spans.length - 1].finish; },
    write: (col, cells) => {
      let days = { ...week };
      for (const [at, text] of cells) {
        const name = WEEK[at];
        if (!/^\d{2}:\d{2}$/.test(text.trim()) || !days[name].working) continue;
        days = { ...days, [name]: dayWith(days, name, col === 'start' ? { start: text.trim() } : { finish: text.trim() }) };
      }
      patch(`Fill the working week of ${cal.name}`, { days, ...hoursPatch(days) });
    },
  });

  const exceptions = cal.exceptions ?? [];
  const addDates = () => {
    const a = /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : '';
    if (!a) return;
    const b = /^\d{4}-\d{2}-\d{2}$/.test(to) && to >= a ? to : a;
    const dates: string[] = [];
    for (let d = new Date(`${a}T00:00:00Z`); d <= new Date(`${b}T00:00:00Z`) && dates.length < 400; d = new Date(d.getTime() + 86_400_000)) dates.push(d.toISOString().slice(0, 10));
    const span = standardSpan(cal.hoursPerDay || 8);
    const added: CalendarException[] = dates.map((date) => (kind === 'off' ? { date, working: false, range: '' } : { date, working: true, range: `${span.start}–${span.finish}`, spans: [span] }));
    const kept = exceptions.filter((e) => !dates.includes(e.date));
    if (patch(kind === 'off' ? 'Add holidays' : 'Add working days', { exceptions: [...kept, ...added] })) {
      setFrom('');
      setTo('');
    }
  };

  return (
    <div className="cal-edit" style={{ marginTop: 10, padding: 8, border: '1px solid var(--border)', borderRadius: 6, background: '#fff', fontSize: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <label>Name <input defaultValue={cal.name} key={cal.name} onBlur={(e) => { if (e.target.value.trim() !== cal.name) patch('Rename calendar', { name: e.target.value }); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} aria-label="Calendar name" /></label>
        <label title="Hours in a working day: what a duration in days means on this calendar">
          Hours per day <input type="number" min={1} max={24} step="0.5" style={{ width: 64 }} defaultValue={cal.hoursPerDay ?? 8} key={`${cal.hoursPerDay}`} onBlur={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0 && v <= 24 && v !== cal.hoursPerDay) patch('Set hours per day', { hoursPerDay: v, days: weekWithDayLength(week, v) }); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} aria-label="Hours per day" />
        </label>
        <button type="button" className="btn btn--small" onClick={() => { const name = window.prompt('Name of the copy:', `${cal.name} (copy)`)?.trim(); if (name) run('Copy calendar', (m) => addCalendar(m, name, cal.id)); }}>Copy</button>
        <button type="button" className="btn btn--small" disabled={used > 0 || model.calendars.length < 2} onClick={() => { if (window.confirm(`Delete the calendar “${cal.name}”?`)) run('Delete calendar', (m) => deleteCalendar(m, cal.id)); }} title={used > 0 ? `${used.toLocaleString()} activities use it: give them another calendar first` : 'Delete this calendar'}>Delete</button>
        {note && <span role="alert" style={{ color: 'var(--danger, #b91c1c)' }}>{note}</span>}
      </div>

      <table className="xgrid" style={{ marginTop: 8 }} aria-label={`Working week of ${cal.name}`} {...grid.grid}>
        <thead><tr><th>Day</th><th>Start</th><th>Finish</th></tr></thead>
        <tbody>
          {WEEK.map((name, at) => {
            const day = week[name];
            const spans = daySpans(day);
            const split = spans.length > 1;
            return (
              <tr key={name} data-line={at}>
                <td>
                  <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <input type="checkbox" checked={day.working} onChange={(e) => setDay(name, { working: e.target.checked })} /> {name}
                  </label>
                </td>
                {day.working && !split && (
                  <>
                    <td className={`xgrid__cell${grid.sel('start', at)}`} data-col="start" data-row={at}>
                      <input type="time" value={spans[0]?.start ?? ''} onChange={(e) => e.target.value && setDay(name, { start: e.target.value })} aria-label={`${name} starts`} />
                      {grid.handle('start', at)}
                    </td>
                    <td className={`xgrid__cell${grid.sel('finish', at)}`} data-col="finish" data-row={at}>
                      <input type="time" value={spans[0]?.finish ?? ''} onChange={(e) => e.target.value && setDay(name, { finish: e.target.value })} aria-label={`${name} finishes`} />
                      {grid.handle('finish', at)}
                    </td>
                  </>
                )}
                {day.working && split && (
                  <td colSpan={2} className="scn-dim" title="This day has a break. Changing its times makes it one run.">
                    {runText(spans)}{' '}
                    <button type="button" className="link-btn" onClick={() => setDay(name, { start: spans[0].start, finish: spans[spans.length - 1].finish })}>make it one run</button>
                  </td>
                )}
                {!day.working && <td colSpan={2} className="scn-dim">off</td>}
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 10 }}>
        <b>Holidays and extra working days</b>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
          <span>to</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To date (optional)" />
          <select value={kind} onChange={(e) => setKind(e.target.value as 'off' | 'work')} aria-label="Kind of exception">
            <option value="off">Not working</option>
            <option value="work">Working</option>
          </select>
          <button type="button" className="btn btn--small" disabled={!from} onClick={addDates}>Add</button>
          <button type="button" className="btn btn--small" disabled={exceptions.length === 0} onClick={() => { if (window.confirm(`Remove all ${exceptions.length.toLocaleString()} holidays and extra working days of “${cal.name}”?`)) patch('Clear exceptions', { exceptions: [] }); }}>Clear all</button>
        </div>
        {exceptions.length > 0 && (
          <div style={{ maxHeight: 160, overflow: 'auto', marginTop: 6, border: '1px solid var(--border)', borderRadius: 4 }}>
            {exceptions.map((e) => (
              <div key={e.date} style={{ display: 'flex', gap: 8, padding: '1px 6px', alignItems: 'center' }}>
                <span style={{ minWidth: 190 }}>{new Date(`${e.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span>
                <span className="scn-dim" style={{ flex: 1 }}>{e.working ? `working ${e.range ?? ''}` : 'not working'}</span>
                <button type="button" className="cols__icon cols__icon--remove" aria-label={`Remove ${e.date}`} title="Remove this date" onClick={() => patch('Remove exception', { exceptions: exceptions.filter((x) => x.date !== e.date) })}><IconRemove /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
