import { recomputeCpm } from './cpm';
import type { ScheduleCalendar } from './calendar';
import type { Activity, ActivityType, ScheduleModel, WbsNode } from './types';

/** Changes to the structure of a programme edited in place: activities added and taken out, WBS nodes added, renamed, moved and taken
    out, activities moved between WBS nodes. Each returns the new model (the old one is not changed), or an `error` to show. Activities
    and nodes it does not touch are the same objects, which is how saving finds what changed (schedule/nativeOps.ts). */

export type Result<T = object> = ({ model: ScheduleModel } & T) | { error: string };

const numeric = (id: string) => (/^\d+$/.test(id) ? Number(id) : 0);
const nextNumber = (ids: Iterable<string>) => 1 + Math.max(0, ...[...ids].map(numeric));

/** The WBS path of a node, names or codes, from the root down (as the programme reader builds it). */
export function wbsPathOf(wbs: readonly WbsNode[], id: string | null, field: 'name' | 'code' = 'name'): string {
  const byId = new Map(wbs.map((n) => [n.id, n]));
  const parts: string[] = [];
  let cursor = id;
  for (let guard = 0; cursor && guard < 50; guard++) {
    const node = byId.get(cursor);
    if (!node) break;
    parts.unshift(field === 'code' ? node.code ?? '' : node.name);
    cursor = node.parentId;
  }
  return parts.join(' / ');
}

/** The activities with their WBS paths made again from the nodes (the same objects where a path did not change). */
function repath(m: ScheduleModel, wbs: WbsNode[]): Activity[] {
  const names = new Map<string, string>();
  const codes = new Map<string, string>();
  return m.activities.map((a) => {
    if (a.wbsId === null) return a;
    if (!names.has(a.wbsId)) {
      names.set(a.wbsId, wbsPathOf(wbs, a.wbsId));
      codes.set(a.wbsId, wbsPathOf(wbs, a.wbsId, 'code'));
    }
    const wbsPath = names.get(a.wbsId)!;
    const wbsCodePath = codes.get(a.wbsId)!;
    return a.wbsPath === wbsPath && a.wbsCodePath === wbsCodePath ? a : { ...a, wbsPath, wbsCodePath };
  });
}

/** Dates and float again from the links, each activity no link drives keeping where it starts. */
const calculated = (m: ScheduleModel) => recomputeCpm(m, { keepOwnStarts: true });

/** The next code in the style of `like` ("A1010" after "A1000": same letters, the number up by 10 over the largest in use). */
export function nextCode(codes: readonly string[], like?: string): string {
  const [, prefix = 'A', digits = '1000'] = /^(.*?)(\d+)$/.exec(like ?? '') ?? [];
  const used = new Set(codes.map((c) => c.toUpperCase()));
  const top = Math.max(0, ...codes.filter((c) => c.startsWith(prefix) && /^\d+$/.test(c.slice(prefix.length))).map((c) => Number(c.slice(prefix.length))));
  let n = (top ? Math.ceil((top + 1) / 10) * 10 : Number(digits) + 10);
  const code = () => `${prefix}${String(n).padStart(digits.length, '0')}`;
  while (used.has(code().toUpperCase())) n += 10;
  return code();
}

export interface NewActivity {
  name?: string;
  /** Goes in this WBS node (default: the one of `after`, else the first node under the project's). */
  wbsId?: string | null;
  /** Takes its WBS node, calendar and code style from this activity. */
  after?: string;
  type?: ActivityType;
  /** Working days (default 5; a milestone has none). */
  days?: number;
}

/** A new activity: five days, not started, starting at the data date until a link says otherwise. */
export function addActivity(m: ScheduleModel, o: NewActivity = {}): Result<{ id: string }> {
  const ref = o.after ? m.activities.find((a) => a.id === o.after) : undefined;
  const wbsId = o.wbsId !== undefined ? o.wbsId : ref?.wbsId ?? m.wbs.find((n) => n.parentId !== null)?.id ?? m.wbs[0]?.id ?? null;
  if (wbsId !== null && !m.wbs.some((n) => n.id === wbsId)) return { error: 'That WBS node is not in the programme.' };
  const type = o.type ?? 'task';
  const calendarId = ref?.calendarId ?? m.calendars[0]?.id ?? null;
  const hoursPerDay = m.calendars.find((c) => c.id === calendarId)?.hoursPerDay || 8;
  const hours = type === 'task' ? Math.max(0, o.days ?? 5) * hoursPerDay : 0;
  const start = m.project.dataDate ?? m.project.planStart ?? new Date();
  const id = String(nextNumber(m.activities.map((a) => a.id)));
  const activity: Activity = {
    id,
    projectId: ref?.projectId ?? m.activities[0]?.projectId ?? m.project.id,
    code: nextCode(m.activities.map((a) => a.code), ref?.code),
    name: o.name ?? (type === 'task' ? 'New activity' : 'New milestone'),
    wbsId,
    wbsPath: wbsPathOf(m.wbs, wbsId),
    wbsCodePath: wbsPathOf(m.wbs, wbsId, 'code'),
    type,
    status: 'not-started',
    targetStart: start, targetFinish: null, actualStart: null, actualFinish: null,
    earlyStart: start, earlyFinish: null, lateStart: null, lateFinish: null,
    durationHours: hours, remainingDurationHours: hours,
    totalFloatHours: null, freeFloatHours: null, isCritical: false, percentComplete: 0,
    constraintType: null, constraintDate: null, activityCodes: {}, resources: [], calendarId, udf: {},
    durationType: 'DT_FixedDUR2', percentCompleteType: 'CP_Drtn',
  };
  const model = calculated({ ...m, activities: [...m.activities, activity] });
  // P6 keeps planned (target) dates on every activity: the new one is planned where it is scheduled when it is made.
  return { model: { ...model, activities: model.activities.map((x) => (x.id === id ? { ...x, targetStart: x.earlyStart, targetFinish: x.earlyFinish } : x)) }, id };
}

/** Takes activities out, with the links to them. */
export function deleteActivities(m: ScheduleModel, ids: Iterable<string>): Result<{ removed: number }> {
  const gone = new Set(ids);
  const activities = m.activities.filter((a) => !gone.has(a.id));
  const removed = m.activities.length - activities.length;
  if (removed === 0) return { error: 'No activity to delete.' };
  const relationships = m.relationships.filter((r) => !gone.has(r.predId) && !gone.has(r.succId));
  return { model: calculated({ ...m, activities, relationships }), removed };
}

/** A new WBS node under `parentId` (null: a top node). */
export function addWbs(m: ScheduleModel, name: string, parentId: string | null): Result<{ id: string }> {
  const clean = name.trim();
  if (!clean) return { error: 'The WBS node needs a name.' };
  if (parentId !== null && !m.wbs.some((n) => n.id === parentId)) return { error: 'That parent is not in the programme.' };
  const id = String(nextNumber(m.wbs.map((n) => n.id)));
  const node: WbsNode = { id, name: clean, code: clean.slice(0, 20), parentId };
  return { model: { ...m, wbs: [...m.wbs, node] }, id };
}

export function renameWbs(m: ScheduleModel, id: string, name: string): Result {
  const clean = name.trim();
  if (!clean) return { error: 'The WBS node needs a name.' };
  const node = m.wbs.find((n) => n.id === id);
  if (!node) return { error: 'That WBS node is not in the programme.' };
  if (node.name === clean) return { model: m };
  const wbs = m.wbs.map((n) => (n === node ? { ...n, name: clean } : n));
  return { model: { ...m, wbs, activities: repath(m, wbs) } };
}

/** Whether `ancestor` is `id` or above it. */
const isAbove = (wbs: readonly WbsNode[], ancestor: string, id: string | null): boolean => {
  const byId = new Map(wbs.map((n) => [n.id, n]));
  for (let cursor = id, guard = 0; cursor && guard < 50; guard++) {
    if (cursor === ancestor) return true;
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
};

/** Moves a WBS node, and what is under it, below another (null: to the top). */
export function moveWbs(m: ScheduleModel, id: string, parentId: string | null): Result {
  const node = m.wbs.find((n) => n.id === id);
  if (!node) return { error: 'That WBS node is not in the programme.' };
  if (parentId !== null && !m.wbs.some((n) => n.id === parentId)) return { error: 'That parent is not in the programme.' };
  if (isAbove(m.wbs, id, parentId)) return { error: 'A WBS node cannot go under itself.' };
  if (node.parentId === parentId) return { model: m };
  const wbs = m.wbs.map((n) => (n === node ? { ...n, parentId } : n));
  return { model: { ...m, wbs, activities: repath(m, wbs) } };
}

/** Takes out a WBS node with nothing in it: no activities, no nodes below. */
export function deleteWbs(m: ScheduleModel, id: string): Result {
  const node = m.wbs.find((n) => n.id === id);
  if (!node) return { error: 'That WBS node is not in the programme.' };
  if (node.parentId === null && m.wbs.filter((n) => n.parentId === null).length === 1) return { error: 'The top WBS node of the programme cannot be deleted.' };
  if (m.wbs.some((n) => n.parentId === id)) return { error: `“${node.name}” has WBS nodes below it: move or delete them first.` };
  const inside = m.activities.filter((a) => a.wbsId === id).length;
  if (inside) return { error: `“${node.name}” has ${inside} ${inside === 1 ? 'activity' : 'activities'}: move ${inside === 1 ? 'it' : 'them'} first.` };
  return { model: { ...m, wbs: m.wbs.filter((n) => n !== node) } };
}

/** Moves activities into a WBS node. */
export function moveActivities(m: ScheduleModel, ids: Iterable<string>, wbsId: string): Result<{ moved: number }> {
  if (!m.wbs.some((n) => n.id === wbsId)) return { error: 'That WBS node is not in the programme.' };
  const picked = new Set(ids);
  const wbsPath = wbsPathOf(m.wbs, wbsId);
  const wbsCodePath = wbsPathOf(m.wbs, wbsId, 'code');
  let moved = 0;
  const activities = m.activities.map((a) => {
    if (!picked.has(a.id) || a.wbsId === wbsId) return a;
    moved++;
    return { ...a, wbsId, wbsPath, wbsCodePath };
  });
  return moved ? { model: { ...m, activities }, moved } : { model: m, moved };
}

/** Moves the data date (the "as of" date of the progress): what is not started cannot start before it, and what is left of a started
    activity runs from it. Dates and float are calculated again. */
export function setDataDate(m: ScheduleModel, date: Date): Result {
  if (Number.isNaN(date.getTime())) return { error: 'That is not a date.' };
  if (m.project.dataDate && m.project.dataDate.getTime() === date.getTime()) return { model: m };
  return { model: calculated({ ...m, project: { ...m.project, dataDate: date } }) };
}

// ---- calendars ----

/** A Monday-Friday calendar of 8-hour days (08:00-16:00). */
export function standardCalendar(id: string, name: string): ScheduleCalendar {
  const working = { working: true, range: '08:00–16:00', spans: [{ start: '08:00', finish: '16:00' }] };
  const off = { working: false, range: '' };
  return {
    id, name, hoursPerDay: 8,
    days: { Sunday: off, Monday: working, Tuesday: working, Wednesday: working, Thursday: working, Friday: working, Saturday: off },
    exceptions: [],
  };
}

/** A new calendar, a copy of another one (its week, its holidays) or a standard Monday-Friday week. */
export function addCalendar(m: ScheduleModel, name: string, copyOf?: string): Result<{ id: string }> {
  const clean = name.trim();
  if (!clean) return { error: 'The calendar needs a name.' };
  if (m.calendars.some((c) => c.name.toLowerCase() === clean.toLowerCase())) return { error: `There is a calendar called “${clean}” already.` };
  const id = String(nextNumber(m.calendars.map((c) => c.id)));
  const from = copyOf ? m.calendars.find((c) => c.id === copyOf) : undefined;
  const calendar: ScheduleCalendar = from ? { ...from, id, name: clean, days: { ...from.days }, exceptions: [...(from.exceptions ?? [])] } : standardCalendar(id, clean);
  return { model: { ...m, calendars: [...m.calendars, calendar] }, id };
}

export type CalendarPatch = Partial<Pick<ScheduleCalendar, 'name' | 'hoursPerDay' | 'days' | 'exceptions'>>;

/** Changes a calendar: its name, the length of its working day, its week, its holidays. Dates and float are calculated again when the
    working time changed. */
export function updateCalendar(m: ScheduleModel, id: string, patch: CalendarPatch): Result {
  const cal = m.calendars.find((c) => c.id === id);
  if (!cal) return { error: 'That calendar is not in the programme.' };
  const name = patch.name?.trim();
  if (patch.name !== undefined && !name) return { error: 'The calendar needs a name.' };
  if (name && m.calendars.some((c) => c.id !== id && c.name.toLowerCase() === name.toLowerCase())) return { error: `There is a calendar called “${name}” already.` };
  if (patch.hoursPerDay !== undefined && !(patch.hoursPerDay !== null && patch.hoursPerDay > 0 && patch.hoursPerDay <= 24)) return { error: 'A working day has between 0 and 24 hours.' };
  const next: ScheduleCalendar = { ...cal, ...patch, ...(name ? { name } : {}) };
  if (patch.exceptions) next.exceptions = [...patch.exceptions].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const workingTimeChanged = patch.hoursPerDay !== undefined || patch.days !== undefined || patch.exceptions !== undefined;
  const model = { ...m, calendars: m.calendars.map((c) => (c === cal ? next : c)) };
  return { model: workingTimeChanged ? calculated(model) : model };
}

/** Takes out a calendar no activity uses (and not the only one). */
export function deleteCalendar(m: ScheduleModel, id: string): Result {
  const cal = m.calendars.find((c) => c.id === id);
  if (!cal) return { error: 'That calendar is not in the programme.' };
  if (m.calendars.length === 1) return { error: 'The programme needs at least one calendar.' };
  const using = m.activities.filter((a) => a.calendarId === id).length;
  if (using) return { error: `“${cal.name}” is used by ${using.toLocaleString()} ${using === 1 ? 'activity' : 'activities'}: give ${using === 1 ? 'it' : 'them'} another calendar first.` };
  return { model: { ...m, calendars: m.calendars.filter((c) => c !== cal) } };
}
