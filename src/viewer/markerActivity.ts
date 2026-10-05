import type { Activity, ScheduleModel } from '../schedule/types';
import { activityFinishMs, activityStartMs } from '../schedule/linking';
import type { Marker } from '../state/markersStore';

/** A merged schedule prefixes its activity ids with the programme's position ("1:A100"); the position changes
    with which programmes are shown, so a link is matched on the id without it, then on the activity's code. */
const bareId = (id: string) => id.replace(/^\d+:/, '');

/** The activity a marker is linked to in this schedule, or null (not linked, or not in a loaded programme). */
export function activityOfMarker(m: Pick<Marker, 'activityId' | 'activityCode'>, schedule: ScheduleModel | null): Activity | null {
  if (!m.activityId || !schedule) return null;
  const id = bareId(m.activityId);
  return schedule.activities.find((a) => bareId(a.id) === id && (!m.activityCode || a.code === m.activityCode))
    ?? (m.activityCode ? schedule.activities.find((a) => a.code === m.activityCode) : undefined)
    ?? null;
}

/** Whether a marker is shown at a 4D date: unlinked markers always; a linked one from its activity's start to its
    finish. A linked marker whose activity is not in the loaded programmes, or has no dates, stays shown. */
export function markerShownAt(m: Marker, schedule: ScheduleModel | null, date: number | null, basis: 'planned' | 'actual'): boolean {
  if (!m.activityId || date === null) return true;
  const a = activityOfMarker(m, schedule);
  if (!a) return true;
  const start = activityStartMs(a, basis);
  const finish = activityFinishMs(a, basis);
  if (start === null) return true;
  return date >= start && (finish === null || date <= finish);
}
