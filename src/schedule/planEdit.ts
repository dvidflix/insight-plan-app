import { recomputeCpm } from './cpm';
import type { Activity, RelationType, Relationship, ScheduleModel } from './types';
import type { Result } from './programmeCommands';

/** What typing in a cell of the planner does to the programme: each returns the new model (or an error to show). Dates and float are
    calculated again (the links, the calendars and the constraints decide them) when what was changed can move them. */

/** Fields whose change moves the dates. */
const DRIVES_DATES: (keyof Activity)[] = ['durationHours', 'remainingDurationHours', 'calendarId', 'constraintType', 'constraintDate', 'status', 'actualStart', 'actualFinish', 'type'];

const calculated = (m: ScheduleModel) => recomputeCpm(m, { keepOwnStarts: true });

export const hoursPerDayOfCalendar = (m: ScheduleModel, calendarId: string | null): number => m.calendars.find((c) => c.id === calendarId)?.hoursPerDay || 8;

const round4 = (n: number) => Math.round(n * 4) / 4;

/** The user field that says the duration follows quantity and productivity (see planResources.ts). */
export const DRIVEN_LABEL = 'Duration from productivity';

/** The quantity of the crew resources (labour, equipment) follows the duration: the crew working at once × the hours. */
function resyncAssignments(a: Activity, patch: Partial<Activity>): Partial<Activity> {
  if (patch.resources || (patch.durationHours === undefined && patch.remainingDurationHours === undefined)) return patch;
  if (!a.resources.some((r) => r.unitsPerTime)) return patch;
  const duration = patch.durationHours ?? a.durationHours;
  const remaining = patch.remainingDurationHours ?? a.remainingDurationHours;
  return {
    ...patch,
    resources: a.resources.map((r) => (r.unitsPerTime && !r.virtual ? { ...r, targetQty: round4(r.unitsPerTime * duration), remainQty: round4(r.unitsPerTime * remaining) } : r)),
  };
}

/** Applies field changes to activities (by id). */
export function patchActivities(m: ScheduleModel, patches: Map<string, Partial<Activity>>): Result<{ changed: number }> {
  let changed = 0;
  let drives = false;
  const activities = m.activities.map((a) => {
    const given = patches.get(a.id);
    if (!given) return a;
    const patch = resyncAssignments(a, given);
    const keys = Object.keys(patch) as (keyof Activity)[];
    if (keys.every((k) => a[k] === patch[k])) return a;
    changed++;
    if (keys.some((k) => DRIVES_DATES.includes(k) && a[k] !== patch[k])) drives = true;
    return { ...a, ...patch };
  });
  if (!changed) return { model: m, changed: 0 };
  const next = { ...m, activities };
  return { model: drives ? calculated(next) : next, changed };
}

/** The duration in working days of the activity's calendar. A started activity keeps what it has done: the remaining duration moves with it. */
export function setDurationDays(m: ScheduleModel, id: string, days: number): Result {
  const a = m.activities.find((x) => x.id === id);
  if (!a) return { error: 'That activity is not in the programme.' };
  if (!Number.isFinite(days) || days < 0) return { error: 'The duration is a number of days, 0 or more.' };
  if (a.type !== 'task' && a.type !== 'loe') return { error: 'A milestone has no duration.' };
  const hours = round4(days * hoursPerDayOfCalendar(m, a.calendarId));
  const patch: Partial<Activity> = { durationHours: hours };
  // A duration typed here is the planner's own: it no longer follows quantity and productivity.
  if (a.udf[DRIVEN_LABEL] === 1) { const { [DRIVEN_LABEL]: _off, ...udf } = a.udf; patch.udf = udf; }
  if (a.status === 'not-started') patch.remainingDurationHours = hours;
  else if (a.status === 'in-progress') patch.remainingDurationHours = Math.max(0, round4(hours * (1 - a.percentComplete / 100)));
  return patchActivities(m, new Map([[id, patch]]));
}

/** Where an activity starts or finishes: a constraint that holds it there or later (Start On or After, Finish On or After), since
    the links and the calendar decide the rest. An empty date takes the constraint off. */
export function setDateConstraint(m: ScheduleModel, id: string, field: 'start' | 'finish', date: Date | null): Result {
  const a = m.activities.find((x) => x.id === id);
  if (!a) return { error: 'That activity is not in the programme.' };
  if (date && Number.isNaN(date.getTime())) return { error: 'That is not a date.' };
  const patch: Partial<Activity> = date
    ? { constraintType: field === 'start' ? 'CS_MSOA' : 'CS_MEOA', constraintDate: date }
    : { constraintType: null, constraintDate: null };
  return patchActivities(m, new Map([[id, patch]]));
}

/** The progress as a percent of the duration: 0 is not started, 100 completed, between in progress with what is left. */
export function setPercent(m: ScheduleModel, id: string, percent: number): Result {
  const a = m.activities.find((x) => x.id === id);
  if (!a) return { error: 'That activity is not in the programme.' };
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) return { error: 'The progress is a percent between 0 and 100.' };
  const asOf = m.project.dataDate ?? new Date();
  const total = a.durationHours;
  let patch: Partial<Activity>;
  if (percent === 0) patch = { status: 'not-started', percentComplete: 0, physicalPercentComplete: 0, actualStart: null, actualFinish: null, remainingDurationHours: total };
  else if (percent >= 100) {
    const actualStart = a.actualStart ?? a.earlyStart ?? asOf;
    patch = { status: 'completed', percentComplete: 100, physicalPercentComplete: 100, actualStart, actualFinish: a.actualFinish ?? asOf, remainingDurationHours: 0 };
  } else patch = { status: 'in-progress', percentComplete: percent, physicalPercentComplete: percent, actualStart: a.actualStart ?? a.earlyStart ?? asOf, actualFinish: null, remainingDurationHours: round4(total * (1 - percent / 100)) };
  return patchActivities(m, new Map([[id, patch]]));
}

// ---- Predecessors as text ----

const TYPES: RelationType[] = ['FS', 'SS', 'FF', 'SF'];

export interface PredecessorEntry {
  code: string;
  type: RelationType;
  /** Working days of the later activity's calendar. */
  lagDays: number;
  /** The ID with the type letters left on it, for an Activity ID that itself ends in FS / SS / FF / SF. */
  alt?: string;
}

/** "A1000, A1010SS+2, A1020FF-1d": the links into an activity as they are typed. FS is not written; a lag is in days. */
export function predecessorText(m: ScheduleModel, a: Activity): string {
  const byId = new Map(m.activities.map((x) => [x.id, x]));
  const perDay = hoursPerDayOfCalendar(m, a.calendarId);
  return m.relationships
    .filter((r) => r.succId === a.id)
    .map((r) => {
      const lag = Math.round((r.lagHours / perDay) * 100) / 100;
      return `${byId.get(r.predId)?.code ?? r.predId}${r.type === 'FS' ? '' : r.type}${lag ? `${lag > 0 ? '+' : ''}${lag}` : ''}`;
    })
    .join(', ');
}

/** Reads the typed predecessors. An error names the part it did not understand. */
export function parsePredecessors(text: string): { entries: PredecessorEntry[] } | { error: string } {
  const entries: PredecessorEntry[] = [];
  for (const part of text.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean)) {
    // The ID, then the type (FS SS FF SF), then a lag in days (+2, -1, +1.5d).
    const m = /^(.*?)(?:\s*(FS|SS|FF|SF))?(?:\s*([+-]\s*\d+(?:[.,]\d+)?)\s*d?)?$/i.exec(part);
    if (!m || !m[1].trim()) return { error: `“${part}” is not a predecessor: write its Activity ID, then FS / SS / FF / SF and a lag, like A1000SS+2.` };
    let code = m[1].trim();
    let type = (m[2] ?? 'FS').toUpperCase() as RelationType;
    if (!TYPES.includes(type)) type = 'FS';
    code = code.replace(/\s+/g, ' ');
    entries.push({ code, type, lagDays: m[3] ? Number(m[3].replace(/\s+/g, '').replace(',', '.')) : 0, ...(m[2] ? { alt: `${code}${m[2]}` } : {}) });
  }
  return { entries };
}

/** Makes the links into an activity these: links not listed are taken out, new ones added, changed ones updated. Loops are refused. */
export function setPredecessors(m: ScheduleModel, id: string, entries: PredecessorEntry[]): Result<{ added: number; removed: number }> {
  const succ = m.activities.find((x) => x.id === id);
  if (!succ) return { error: 'That activity is not in the programme.' };
  const byCode = new Map(m.activities.map((a) => [a.code.toLowerCase(), a]));
  const perDay = hoursPerDayOfCalendar(m, succ.calendarId);
  const wanted = new Map<string, Relationship>();
  for (let e of entries) {
    // An ID the programme has, or the ID with the letters the parser took for a type ("A1000SS" read as A1000 + SS when "A1000SS" is an ID).
    const pred = byCode.get(e.code.toLowerCase()) ?? (e.alt ? byCode.get(e.alt.toLowerCase()) : undefined);
    if (pred && !byCode.has(e.code.toLowerCase())) e = { ...e, type: 'FS' };
    if (!pred) return { error: `There is no activity with the ID “${e.code}”.` };
    if (pred.id === id) return { error: 'An activity cannot be its own predecessor.' };
    wanted.set(pred.id, { predId: pred.id, succId: id, type: e.type, lagHours: round4(e.lagDays * perDay) });
  }
  // A new link must not close a loop: the activity must not already lead to the predecessor.
  const successors = new Map<string, string[]>();
  for (const r of m.relationships) if (r.succId !== id) successors.set(r.predId, [...(successors.get(r.predId) ?? []), r.succId]);
  const reaches = (from: string, to: string, seen = new Set<string>()): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (successors.get(from) ?? []).some((n) => reaches(n, to, seen));
  };
  for (const p of wanted.keys()) if (reaches(id, p)) return { error: `${m.activities.find((a) => a.id === p)?.code} → ${succ.code} would make a loop (${succ.code} already leads to it).` };
  const current = m.relationships.filter((r) => r.succId === id);
  const same = (a: Relationship, b: Relationship) => a.type === b.type && a.lagHours === b.lagHours;
  let added = 0;
  let removed = 0;
  const kept: Relationship[] = [];
  for (const r of current) {
    const w = wanted.get(r.predId);
    if (!w) { removed++; continue; }
    kept.push(same(r, w) ? r : w);
    wanted.delete(r.predId);
  }
  for (const w of wanted.values()) { kept.push(w); added++; }
  const unchanged = added === 0 && removed === 0 && kept.every((r) => current.includes(r));
  if (unchanged) return { model: m, added, removed };
  const relationships = [...m.relationships.filter((r) => r.succId !== id), ...kept];
  return { model: calculated({ ...m, relationships }), added, removed };
}

/** The short code of a WBS node. */
export function setWbsCode(m: ScheduleModel, id: string, code: string): Result {
  const node = m.wbs.find((n) => n.id === id);
  if (!node) return { error: 'That WBS node is not in the programme.' };
  const clean = code.trim();
  if ((node.code ?? '') === clean) return { model: m };
  const wbs = m.wbs.map((n) => (n === node ? { ...n, code: clean } : n));
  const names = new Map<string, string>();
  const pathOf = (wbsId: string): string => {
    if (names.has(wbsId)) return names.get(wbsId)!;
    const parts: string[] = [];
    const byId = new Map(wbs.map((n) => [n.id, n]));
    for (let cursor: string | null = wbsId, guard = 0; cursor && guard < 50; guard++) {
      const n = byId.get(cursor);
      if (!n) break;
      parts.unshift(n.code ?? '');
      cursor = n.parentId;
    }
    const path = parts.join(' / ');
    names.set(wbsId, path);
    return path;
  };
  const activities = m.activities.map((a) => {
    if (a.wbsId === null) return a;
    const wbsCodePath = pathOf(a.wbsId);
    return a.wbsCodePath === wbsCodePath ? a : { ...a, wbsCodePath };
  });
  return { model: { ...m, wbs, activities } };
}
