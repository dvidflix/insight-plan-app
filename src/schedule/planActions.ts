import type { Activity, ScheduleModel } from './types';
import type { Result } from './programmeCommands';
import { nextCode } from './programmeCommands';
import { constraintKind, type ConstraintKind } from './constraints';
import { patchActivities, setPercent } from './planEdit';
import { recomputeCpm } from './cpm';

/** More of what a planner does to a programme edited in place: constraints, progress for several activities at once, splitting an activity. */

// ---- Constraints, typed as P6 and Synchro abbreviate them: SNET 2030-05-31 ----

/** Short code -> the XER constraint type. */
export const CONSTRAINT_CODES: Record<string, { type: string; label: string; needsDate: boolean }> = {
  SNET: { type: 'CS_MSOA', label: 'Start on or after', needsDate: true },
  SNLT: { type: 'CS_MSOB', label: 'Start on or before', needsDate: true },
  SO: { type: 'CS_MSO', label: 'Start on', needsDate: true },
  FNET: { type: 'CS_MEOA', label: 'Finish on or after', needsDate: true },
  FNLT: { type: 'CS_MEOB', label: 'Finish on or before', needsDate: true },
  FO: { type: 'CS_MEO', label: 'Finish on', needsDate: true },
  MSO: { type: 'CS_MANDSTART', label: 'Mandatory start', needsDate: true },
  MFO: { type: 'CS_MANDFIN', label: 'Mandatory finish', needsDate: true },
  ALAP: { type: 'CS_ALAP', label: 'As late as possible', needsDate: false },
};

const SHORT: Record<ConstraintKind, string> = { snet: 'SNET', snlt: 'SNLT', 'on-start': 'SO', fnet: 'FNET', fnlt: 'FNLT', 'on-finish': 'FO', 'mandatory-start': 'MSO', 'mandatory-finish': 'MFO', alap: 'ALAP' };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The constraint of an activity as text: "SNET 2030-05-31", "ALAP", or "" for none. */
export function constraintText(a: Activity): string {
  const kind = constraintKind(a.constraintType);
  if (!kind) return '';
  return kind === 'alap' || !a.constraintDate ? SHORT[kind] : `${SHORT[kind]} ${iso(a.constraintDate)}`;
}

/** Sets or takes off the constraint of an activity from text like "FNLT 2030-06-30" (empty: none). */
export function setConstraintText(m: ScheduleModel, id: string, text: string, parseDate: (s: string) => Date | null): Result<{ changed: number }> {
  const t = text.trim();
  if (!t) return patchActivities(m, new Map([[id, { constraintType: null, constraintDate: null }]]));
  const [code, ...rest] = t.split(/\s+/);
  const def = CONSTRAINT_CODES[code.toUpperCase()];
  if (!def) return { error: `The constraint is one of ${Object.keys(CONSTRAINT_CODES).join(', ')}, then a date: SNET 2030-05-31. Empty takes it off.` };
  if (!def.needsDate) return patchActivities(m, new Map([[id, { constraintType: def.type, constraintDate: null }]]));
  const date = parseDate(rest.join(' '));
  if (!date) return { error: `${code.toUpperCase()} needs a date: ${code.toUpperCase()} 2030-05-31.` };
  return patchActivities(m, new Map([[id, { constraintType: def.type, constraintDate: date }]]));
}

// ---- Progress of several activities ----

export function setPercentMany(m: ScheduleModel, ids: Iterable<string>, percent: number): Result<{ done: number }> {
  let cur = m;
  let done = 0;
  for (const id of ids) {
    const a = cur.activities.find((x) => x.id === id);
    if (!a || a.type === 'wbs-summary') continue;
    const r = setPercent(cur, id, percent);
    if ('error' in r) return r;
    cur = r.model;
    done++;
  }
  return done ? { model: cur, done } : { error: 'Pick the activities to update first.' };
}

// ---- Split ----

const round4 = (n: number) => Math.round(n * 4) / 4;

/** Splits a not-started task into `parts` tasks one after the other (finish to start): each gets an equal share of the duration and of
    the quantities; what followed the task now follows the last part; what preceded it still precedes the first. */
export function splitActivity(m: ScheduleModel, id: string, parts: number): Result<{ ids: string[] }> {
  const a = m.activities.find((x) => x.id === id);
  if (!a) return { error: 'That activity is not in the programme.' };
  if (a.type !== 'task') return { error: 'Only a task with a duration can be split.' };
  if (!Number.isInteger(parts) || parts < 2 || parts > 20) return { error: 'Split into 2 to 20 parts.' };
  if (a.actualStart || a.percentComplete > 0) return { error: 'An activity that has started cannot be split: split it before it starts.' };
  const share = round4(a.durationHours / parts);
  const used = m.activities.map((x) => x.code);
  const usedIds = m.activities.map((x) => Number(x.id)).filter(Number.isFinite);
  let nextId = (usedIds.length ? Math.max(...usedIds) : 0) + 1;
  const scaled = (r: Activity['resources'][number]) => (r.unitsPerTime ? r : { ...r, targetQty: Math.round((r.targetQty / parts) * 1000) / 1000 });
  const made: Activity[] = [];
  for (let n = 2; n <= parts; n++) {
    const code = nextCode(used, a.code);
    used.push(code);
    made.push({ ...a, id: String(nextId++), code, name: `${a.name} (${n}/${parts})`, durationHours: share, remainingDurationHours: share, resources: a.resources.map(scaled), activityCodes: { ...a.activityCodes }, udf: { ...a.udf } });
  }
  const first: Activity = { ...a, name: `${a.name} (1/${parts})`, durationHours: share, remainingDurationHours: share, resources: a.resources.map(scaled) };
  const chain = [first, ...made];
  const last = made[made.length - 1];
  const relationships = [
    ...m.relationships.map((r) => (r.predId === a.id ? { ...r, predId: last.id } : r)),
    ...chain.slice(1).map((p, i) => ({ predId: chain[i].id, succId: p.id, type: 'FS' as const, lagHours: 0 })),
  ];
  const at = m.activities.findIndex((x) => x.id === a.id);
  const activities = [...m.activities.slice(0, at), first, ...made, ...m.activities.slice(at + 1)];
  return { model: recomputeCpm({ ...m, activities, relationships }, { keepOwnStarts: true }), ids: chain.map((x) => x.id) };
}
