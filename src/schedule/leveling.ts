import type { Activity, ScheduleModel } from './types';
import type { Result } from './programmeCommands';
import { getCalendar, type WorkingCalendar } from './calendar';
import { recomputeCpm } from './cpm';
import { constraintKind } from './constraints';

/** Resource levelling. A resource that has a capacity (people or machines available at once) is overloaded on a day when the activities
    working that day need more than it has. Levelling delays the start of an activity of the overload until it fits, one overload at a time
    (the activity that has the most float, and starts last, goes first), calculating the programme again after each delay.

    A delay is a Start On or After constraint on the activity. The activity is marked (user field "Levelled") with the constraint it had, so
    "Clear levelling" puts every activity back as it was. Three ways to run it:
    - report: nothing changes; the overloads are listed
    - within float: an activity is only delayed while it stays within its float, so the finish does not move; what cannot is left overloaded
    - as needed: activities are delayed as far as it takes, which may move the finish. */

export const LEVELLED = 'Levelled';

export interface Overload {
  resourceId: string;
  resourceName: string;
  date: Date;
  used: number;
  capacity: number;
  /** The activities working that day on that resource. */
  activityIds: string[];
}

const DAY = 86400000;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** What an assignment needs at once: the units working together. */
const unitsOf = (a: Activity, r: Activity['resources'][number]) => r.unitsPerTime ?? (a.durationHours > 0 ? r.targetQty / a.durationHours : 0);

function calendarsOf(m: ScheduleModel) {
  const byId = new Map(m.calendars.map((c) => [c.id, c]));
  const cache = new Map<string | null, WorkingCalendar>();
  return (id: string | null) => cache.get(id) ?? cache.set(id, getCalendar(id, byId)).get(id)!;
}

/** The working days (as day starts, ms) an activity occupies. */
function daysOf(a: Activity, cal: WorkingCalendar): number[] {
  const s = a.earlyStart;
  const f = a.earlyFinish ?? s;
  if (!s || !f) return [];
  const out: number[] = [];
  const end = dayStart(f);
  // A finish is the end of the last working day (the day it falls on, at its start): the day it falls on is not worked.
  for (let t = dayStart(s), n = 0; t <= end && n < 3000; t += DAY, n++) {
    if (cal.isWorkingDay(new Date(t)) && (t < end || t === dayStart(s))) out.push(t);
  }
  return out;
}

/** Every overload, in date order. */
export function findOverloads(m: ScheduleModel): Overload[] {
  const calOf = calendarsOf(m);
  const capacity = new Map(m.resourceCatalog?.filter((r) => !r.virtual && r.capacity !== null && (r.type === 'labor' || r.type === 'equipment')).map((r) => [r.id, r]) ?? []);
  if (!capacity.size) return [];
  const usage = new Map<string, Map<number, { used: number; ids: string[] }>>();
  for (const a of m.activities) {
    if (a.status === 'completed' || a.type === 'wbs-summary') continue;
    const mine = a.resources.filter((r) => capacity.has(r.resourceId));
    if (!mine.length) continue;
    const days = daysOf(a, calOf(a.calendarId));
    for (const r of mine) {
      const units = unitsOf(a, r);
      if (units <= 0) continue;
      const perDay = usage.get(r.resourceId) ?? usage.set(r.resourceId, new Map()).get(r.resourceId)!;
      for (const t of days) {
        const cell = perDay.get(t) ?? perDay.set(t, { used: 0, ids: [] }).get(t)!;
        cell.used += units;
        cell.ids.push(a.id);
      }
    }
  }
  const out: Overload[] = [];
  for (const [resourceId, perDay] of usage) {
    const res = capacity.get(resourceId)!;
    for (const [t, cell] of perDay) {
      if (cell.used > (res.capacity as number) + 1e-9) out.push({ resourceId, resourceName: res.name, date: new Date(t), used: Math.round(cell.used * 100) / 100, capacity: res.capacity as number, activityIds: cell.ids });
    }
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export const describeOverloads = (m: ScheduleModel): string => {
  const list = findOverloads(m);
  if (!list.length) return 'No resource is over its capacity.';
  const names = new Set(list.map((o) => o.resourceName));
  const first = list[0];
  return `${list.length} overloaded ${list.length === 1 ? 'day' : 'days'} on ${names.size} ${names.size === 1 ? 'resource' : 'resources'}; the first: ${first.resourceName} on ${first.date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' })}, ${first.used} needed of ${first.capacity}.`;
};

const MAX_STEPS = 400;

/** Levels the programme (see the top of the file). */
export function levelResources(m: ScheduleModel, o: { withinFloat: boolean }): Result<{ delayed: number; remaining: number; capped: boolean }> {
  let cur = recomputeCpm(m, { keepOwnStarts: true });
  const delayed = new Set<string>();
  const stuck = new Set<string>();
  let capped = false;
  for (let step = 0; ; step++) {
    if (step >= MAX_STEPS) { capped = true; break; }
    const calOf = calendarsOf(cur);
    const over = findOverloads(cur).find((x) => !stuck.has(`${x.resourceId}:${x.date.getTime()}`));
    if (!over) break;
    const byId = new Map(cur.activities.map((a) => [a.id, a]));
    // Who can wait: not started, and with no constraint that must hold (a mandatory or "on" date, or an earlier levelling is kept).
    const candidates = over.activityIds
      .map((id) => byId.get(id)!)
      .filter((a) => a && !a.actualStart && a.type === 'task' && ![ 'mandatory-start', 'mandatory-finish', 'on-start', 'on-finish' ].includes(constraintKind(a.constraintType) ?? ''))
      .sort((a, b) => (b.totalFloatHours ?? 0) - (a.totalFloatHours ?? 0) || (b.earlyStart?.getTime() ?? 0) - (a.earlyStart?.getTime() ?? 0));
    // It must wait for another activity of the overload to finish: the earliest of those that finish after the overloaded day.
    let chosen: { a: Activity; to: Date } | null = null;
    for (const a of candidates) {
      const others = over.activityIds.filter((id) => id !== a.id).map((id) => byId.get(id)!).filter((x) => x?.earlyFinish && dayStart(x.earlyFinish) > over.date.getTime());
      if (!others.length || !a.earlyStart) continue;
      const free = new Date(Math.min(...others.map((x) => dayStart(x.earlyFinish!))));
      const cal = calOf(a.calendarId);
      let to = free;
      for (let n = 0; n < 14 && !cal.isWorkingDay(to); n++) to = new Date(to.getTime() + DAY);
      const lateDays = a.totalFloatHours !== null && a.totalFloatHours !== undefined ? a.totalFloatHours / (cal.hoursPerDay || 8) : null;
      const delayDays = (to.getTime() - dayStart(a.earlyStart)) / DAY;
      if (to.getTime() <= dayStart(a.earlyStart)) continue;
      if (o.withinFloat && (lateDays === null || delayDays * (cal.workingDaysPerWeek / 7) > lateDays + 1e-9)) continue;
      chosen = { a, to };
      break;
    }
    if (!chosen) { stuck.add(`${over.resourceId}:${over.date.getTime()}`); continue; }
    const { a, to } = chosen;
    const was = String(a.udf[LEVELLED] ?? `${a.constraintType ?? ''}|${a.constraintDate ? a.constraintDate.toISOString() : ''}`);
    const at = new Date(to.getFullYear(), to.getMonth(), to.getDate(), a.earlyStart!.getHours(), a.earlyStart!.getMinutes());
    // An earlier constraint of the same kind that holds it later stays.
    const keep = constraintKind(a.constraintType) === 'snet' && a.constraintDate && a.constraintDate > at ? a.constraintDate : at;
    cur = recomputeCpm({
      ...cur,
      activities: cur.activities.map((x) => (x.id === a.id ? { ...x, constraintType: 'CS_MSOA', constraintDate: keep, udf: { ...x.udf, [LEVELLED]: was } } : x)),
    }, { keepOwnStarts: true });
    delayed.add(a.id);
  }
  return { model: cur, delayed: delayed.size, remaining: findOverloads(cur).length, capped };
}

/** Takes the levelling off: every activity it delayed has the constraint it had before. */
export function clearLevelling(m: ScheduleModel): Result<{ cleared: number }> {
  let cleared = 0;
  const activities = m.activities.map((a) => {
    const was = a.udf[LEVELLED];
    if (was === undefined) return a;
    cleared++;
    const [type, iso] = String(was).split('|');
    const { [LEVELLED]: _gone, ...udf } = a.udf;
    return { ...a, udf, constraintType: type || null, constraintDate: iso ? new Date(iso) : null };
  });
  if (!cleared) return { error: 'No activity is delayed by levelling.' };
  return { model: recomputeCpm({ ...m, activities }, { keepOwnStarts: true }), cleared };
}
