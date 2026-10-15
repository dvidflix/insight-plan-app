import { recomputeCpm } from './cpm';
import type { ScheduleCalendar } from './calendar';
import type { Activity, ActivityType, RelationType, ScheduleModel, WbsNode } from './types';
import type { ElementSummary } from '../viewer/types';
import { objectFieldValue, type LinkGroup } from './linkGroups';

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

/** Dissolves activities: they are taken out and the logic they carried stays. Each of their predecessors is linked to each of their
    successors (finish to start, the two lags added), unless the two are linked already or the link would close a loop. */
export function dissolveActivities(m: ScheduleModel, ids: Iterable<string>): Result<{ removed: number; bridged: number }> {
  const gone = new Set([...ids].filter((id) => m.activities.some((a) => a.id === id)));
  if (gone.size === 0) return { error: 'No activity to dissolve.' };
  let rels = m.relationships;
  let bridged = 0;
  const leadsTo = (from: string, to: string, list: typeof rels): boolean => {
    const next = new Map<string, string[]>();
    for (const r of list) (next.get(r.predId) ?? next.set(r.predId, []).get(r.predId)!).push(r.succId);
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(next.get(id) ?? []));
    }
    return false;
  };
  // One at a time, so dissolving B and C in A → B → C → D leaves A → D.
  for (const id of gone) {
    const ins = rels.filter((r) => r.succId === id);
    const outs = rels.filter((r) => r.predId === id);
    rels = rels.filter((r) => r.succId !== id && r.predId !== id);
    for (const i of ins) {
      for (const o of outs) {
        if (i.predId === o.succId || rels.some((r) => r.predId === i.predId && r.succId === o.succId) || leadsTo(o.succId, i.predId, rels)) continue;
        rels = [...rels, { predId: i.predId, succId: o.succId, type: 'FS', lagHours: i.lagHours + o.lagHours }];
        bridged++;
      }
    }
  }
  const activities = m.activities.filter((a) => !gone.has(a.id));
  return { model: calculated({ ...m, activities, relationships: rels }), removed: gone.size, bridged };
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

export interface TasksFromObjects {
  /** One task for each object (else one task for all of them). */
  perObject: boolean;
  days: number;
  /** Default: the calendar of the activity they go after. */
  calendarId?: string | null;
  /** Chain the new tasks with this relation (null: no links between them). */
  chain: RelationType | null;
  /** Goes after this activity: it takes its WBS node, and the first new task is linked from it. */
  after?: string;
  wbsId?: string | null;
  /** What the work is (Install, Construct, Remove, Temporary...): the word the task name starts with. */
  workType?: string;
  /** A task, or a milestone (default: a task). */
  type?: ActivityType;
}

/** New tasks from objects picked in the 3D model, linked to them the way the programme links tasks to objects: through the Link
    Group, whose matching rules say which task field holds which object property. Each new task gets the object's value in
    the field of every rule of the group (its Name or Activity ID, a user field or an activity code the programme has), so the group
    finds its object by itself. Fields the programme cannot hold are listed in `notes`. */
export function addTasksFromObjects(m: ScheduleModel, objects: ElementSummary[], group: LinkGroup | null, o: TasksFromObjects): Result<{ ids: string[]; notes: string[] }> {
  if (objects.length === 0) return { error: 'Select objects in the 3D model first.' };
  const notes = new Set<string>();
  const groups = o.perObject ? objects.map((el) => [el]) : [objects];
  let model = m;
  const ids: string[] = [];
  for (const parts of groups) {
    const first = parts[0];
    const name = parts.length > 1 ? `${first.name || first.category} (+${parts.length - 1})` : first.name || first.category;
    const added = addActivity(model, { name, after: ids[ids.length - 1] ?? o.after, wbsId: o.wbsId, days: o.days, type: o.type });
    if ('error' in added) return added;
    model = added.model;
    const id = added.id;
    let patch: Partial<Activity> = o.calendarId ? { calendarId: o.calendarId, durationHours: o.days * (model.calendars.find((c) => c.id === o.calendarId)?.hoursPerDay || 8) } : {};
    if (patch.durationHours !== undefined) patch.remainingDurationHours = patch.durationHours;
    for (const rule of group?.matchRules ?? []) {
      const value = [...new Set(parts.map((el) => objectFieldValue(el, rule.objectPropertySet, rule.objectAttribute).trim()).filter(Boolean))].join(rule.taskSeparators?.[0] ?? ', ');
      if (!value) { notes.add(`The object has no ${rule.objectPropertySet}${rule.objectAttribute ? `.${rule.objectAttribute}` : ''} to match.`); continue; }
      const field = rule.taskField;
      const current = model.activities.find((a) => a.id === id)!;
      if (field === '_name') patch = { ...patch, name: value };
      else if (field === '_code') {
        if (model.activities.some((a) => a.code.toLowerCase() === value.toLowerCase())) notes.add(`An activity with the ID “${value}” exists already: the new task keeps ${current.code}.`);
        else patch = { ...patch, code: value };
      } else if ((model.udfTypes ?? []).some((t) => t.label === field)) patch = { ...patch, udf: { ...(patch.udf ?? current.udf), [field]: value } };
      else if ((model.activityCodeCatalog ?? []).some((t) => t.name === field && t.values.some((v) => v.value === value))) patch = { ...patch, activityCodes: { ...(patch.activityCodes ?? current.activityCodes), [field]: value } };
      else notes.add(`The programme has no field “${field}” holding “${value}”: add that user field or activity code value first.`);
    }
    // The work type leads the name ("Install 1HDAB - L1 - Walls"), unless a rule matches on the name: it would stop matching.
    if (o.workType?.trim()) {
      if (group?.matchRules.some((r) => r.taskField === '_name')) notes.add('The group matches on the task name, so the work type is not put in front of it.');
      else patch = { ...patch, name: `${o.workType.trim()} ${patch.name ?? name}` };
    }
    model = { ...model, activities: model.activities.map((a) => (a.id === id ? { ...a, ...patch } : a)) };
    ids.push(id);
  }
  const relationships = [...model.relationships];
  const link = (predId: string, succId: string) => relationships.push({ predId, succId, type: o.chain ?? 'FS', lagHours: 0 });
  if (o.chain) {
    if (o.after) link(o.after, ids[0]);
    for (let i = 1; i < ids.length; i++) link(ids[i - 1], ids[i]);
  }
  return { model: calculated({ ...model, relationships }), ids, notes: [...notes] };
}
