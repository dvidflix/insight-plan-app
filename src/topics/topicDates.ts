import type { Activity, ScheduleModel } from '../schedule/types';
import { activityFinishMs, activityStartMs } from '../schedule/linking';
import { activityOfMarker } from '../viewer/markerActivity';
import type { ActRef, Topic } from '../state/topicsStore';

const DAY = 86_400_000;

/** yyyy-mm-dd (local) -> ms at local midnight, or null. */
export function parseDay(s: string | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : null;
}

export const dayString = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const activityFor = (ref: ActRef | undefined, schedule: ScheduleModel | null): Activity | null => {
  if (!ref || !schedule) return null;
  // A topic read from a BCF file knows its task by code only.
  if (!ref.id) return schedule.activities.find((a) => a.code === ref.code) ?? null;
  return activityOfMarker({ activityId: ref.id, activityCode: ref.code }, schedule);
};

export interface TopicWindow {
  start: number | null;
  finish: number | null;
  /** The start or finish follows an activity that is not in the loaded programmes (the dates are unknown). */
  missing: boolean;
}

/** The topic's start and finish as dates. Start: typed or an activity's start. Finish: typed, the finish of the
    activity it starts with, another activity's finish, or the start plus a number of days. */
export function topicWindow(t: Pick<Topic, 'start' | 'finish'>, schedule: ScheduleModel | null, basis: 'planned' | 'actual'): TopicWindow {
  let missing = false;
  const startActivity = t.start.kind === 'activity' ? activityFor(t.start.act, schedule) : null;
  if (t.start.kind === 'activity' && !startActivity) missing = true;

  let start: number | null = null;
  if (t.start.kind === 'date') start = parseDay(t.start.date);
  else if (startActivity) start = activityStartMs(startActivity, basis);

  let finish: number | null = null;
  const f = t.finish;
  if (f.kind === 'date') finish = parseDay(f.date);
  else if (f.kind === 'same') finish = startActivity ? activityFinishMs(startActivity, basis) : null;
  else if (f.kind === 'activity') {
    const a = activityFor(f.act, schedule);
    if (!a) missing = true;
    else finish = activityFinishMs(a, basis);
  } else if (f.kind === 'duration' && start !== null && f.days && f.days > 0) finish = start + f.days * DAY;

  return { start, finish, missing };
}

/** Whether the topic is on at a 4D date: from its start to its finish (open-ended on a side with no date).
    A topic with no dates, or whose activity is not loaded, is always on. */
export function topicActiveAt(w: TopicWindow, date: number | null): boolean {
  if (date === null || w.missing || (w.start === null && w.finish === null)) return true;
  // The finish day counts to its end.
  return (w.start === null || date >= w.start) && (w.finish === null || date <= w.finish + DAY - 1);
}
