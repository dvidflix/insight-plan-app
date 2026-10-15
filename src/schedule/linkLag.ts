import type { ScheduleModel } from './types';
import { getCalendar } from './calendar';
import { commit } from '../state/programmeHistory';
import { setLinkOp } from '../state/programmeEdits';
import { programmeKey } from '../state/unloadedWbsStore';

/** Moves the lag of a link by whole working days (dragging its end on the Gantt). The lag is counted in the days of the later activity's
    calendar. `own` is the one programme the link is in; the ids are the programme's own. Returns what to tell the user. */
export function nudgeLag(own: ScheduleModel, predId: string, succId: string, deltaDays: number): string {
  const rel = own.relationships.find((r) => r.predId === predId && r.succId === succId);
  const pred = own.activities.find((a) => a.id === predId);
  const succ = own.activities.find((a) => a.id === succId);
  if (!rel || !pred || !succ) return 'That link is not in the programme.';
  if (deltaDays === 0) return '';
  const perDay = getCalendar(succ.calendarId, new Map(own.calendars.map((c) => [c.id, c]))).hoursPerDay || 8;
  const lagHours = Math.round((rel.lagHours + deltaDays * perDay) * 4) / 4;
  commit('Edit link', () => setLinkOp(programmeKey(own), { op: 'set', pred: pred.code, succ: succ.code, lagHours }), { merge: `link:${predId}>${succId}` });
  const days = Math.round((lagHours / perDay) * 10) / 10;
  return `${pred.code} → ${succ.code}: lag ${days > 0 ? '+' : ''}${days} d. Press F9 to schedule.`;
}
