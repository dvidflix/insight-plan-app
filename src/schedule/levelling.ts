import { getCalendar, type WorkingCalendar } from './calendar';
import { crewOf, dateOfDay, dayIndex, finishOf, midnight, startOf, workingDaysOf } from './resourceLoading';
import type { Activity, Relationship, ScheduleModel } from './types';

/** Resource levelling, as "How to level" in the levelling workbook does by
    hand — slide activities so crews don't stack past a trade's capacity —
    done as a serial pass (the method P6's leveller uses):
    1. Activities are taken in logic order; among those whose predecessors
       are all placed, the one starting first goes next (then least float).
    2. Each is placed at the first working day, no earlier than its current
       start or than its (already levelled) predecessors allow, where every
       capacity-limited trade it uses stays within capacity on each of its
       days.
    3. 'float' keeps it within its total float (never past its late start);
       if no such day fits it stays at its earliest day and is reported as
       unresolved. 'extend' lets it slip as far as needed (up to MAX_SLIP
       working days), pushing the finish out.
    Levelling only delays: nothing moves earlier than it is now. Activities
    already started keep their dates; durations and crews are unchanged.
    Works in whole working days (time of day kept from the original dates). */

export type LevelMode = 'float' | 'extend';

export interface LevelledActivity {
  start: Date;
  finish: Date;
  /** Working days it moved by. */
  delayDays: number;
  /** Couldn't be placed within capacity (and float, in 'float' mode). */
  unresolved: boolean;
}

export interface LevelResult {
  byId: Map<string, LevelledActivity>;
  moved: number;
  unresolved: number;
  finishBefore: Date | null;
  finishAfter: Date | null;
}

const MAX_SLIP = 2600; // working days (~10 years)
const EPS = 1e-9;

interface Node {
  a: Activity;
  cal: WorkingCalendar;
  /** Working days it lasts (0 = milestone). */
  length: number;
  /** Current start / latest start (day indexes). */
  start0: number;
  late: number;
  fixed: boolean;
  crews: [string, number][];
  preds: Relationship[];
  succs: string[];
  /** Original finish written as 00:00 of the next day (the end of its last
      working day) — kept that way when the activity moves. */
  endsAtMidnight: boolean;
  f0: number;
  /** Placed window. */
  s: number;
  f: number;
}

export function levelSchedule(model: ScheduleModel, capacity: Map<string, number>, mode: LevelMode): LevelResult {
  const calendarsById = new Map(model.calendars.map((c) => [c.id, c]));
  const dated = model.activities.filter((a) => startOf(a, 'current') && finishOf(a, 'current'));
  const empty: LevelResult = { byId: new Map(), moved: 0, unresolved: 0, finishBefore: null, finishAfter: null };
  if (!dated.length) return empty;
  const origin = midnight(new Date(Math.min(...dated.map((a) => startOf(a, 'current')!.getTime()))));
  const isWorking = (cal: WorkingCalendar, day: number) => cal.isWorkingDay(dateOfDay(origin, day));
  const snap = (cal: WorkingCalendar, day: number) => {
    let d = day;
    for (let i = 0; i < 14 && !isWorking(cal, d); i++) d++;
    return d;
  };
  /** Working day `n` working days after `day` (n may be negative). */
  const shift = (cal: WorkingCalendar, day: number, n: number) => {
    let d = day;
    const step = n < 0 ? -1 : 1;
    for (let left = Math.abs(Math.round(n)); left > 0; ) {
      d += step;
      if (isWorking(cal, d)) left--;
    }
    return d;
  };

  const nodes = new Map<string, Node>();
  for (const a of dated) {
    const cal = getCalendar(a.calendarId, calendarsById);
    const isMilestone = a.type === 'milestone-start' || a.type === 'milestone-finish' || (a.durationHours === 0 && a.remainingDurationHours === 0);
    const days = workingDaysOf(origin, startOf(a, 'current')!, finishOf(a, 'current')!, cal);
    const length = isMilestone ? 0 : days.length;
    const start0 = days[0];
    const lastDay = length ? days[days.length - 1] : start0;
    const floatDays = a.totalFloatHours !== null ? Math.max(0, Math.floor(a.totalFloatHours / cal.hoursPerDay)) : 0;
    const late = a.lateStart ? Math.max(start0, dayIndex(origin, a.lateStart)) : shift(cal, start0, floatDays);
    const crews: [string, number][] = [];
    for (const r of a.resources) {
      const cap = capacity.get(r.resourceName);
      if (r.resourceType !== 'labor' || !cap || cap <= 0) continue;
      const crew = crewOf(r, Math.max(length, 1), cal.hoursPerDay);
      if (crew > 0) crews.push([r.resourceName, crew]);
    }
    nodes.set(a.id, {
      a, cal, length, start0, late, crews,
      fixed: !!a.actualStart,
      preds: [], succs: [], s: start0, f: lastDay,
      endsAtMidnight: finishOf(a, 'current')!.getHours() === 0 && finishOf(a, 'current')!.getMinutes() === 0 && dayIndex(origin, finishOf(a, 'current')!) > lastDay,
      f0: lastDay,
    });
  }
  for (const rel of model.relationships) {
    const p = nodes.get(rel.predId);
    const s = nodes.get(rel.succId);
    if (!p || !s || p === s) continue;
    s.preds.push(rel);
    p.succs.push(rel.succId);
  }

  // Capacity use per trade per day.
  const usage = new Map<string, Float64Array>();
  const use = (name: string) => {
    let u = usage.get(name);
    if (!u) usage.set(name, (u = new Float64Array(4096)));
    return u;
  };
  const ensure = (name: string, day: number) => {
    let u = use(name);
    if (day >= u.length) {
      const bigger = new Float64Array(Math.max(u.length * 2, day + 1024));
      bigger.set(u);
      usage.set(name, (u = bigger));
    }
    return u;
  };
  /** The working days of a window starting at `s`. */
  const windowOf = (n: Node, s: number) => {
    const days = [s];
    for (let d = s; days.length < n.length; ) {
      d++;
      if (isWorking(n.cal, d)) days.push(d);
    }
    return days;
  };
  /** -1 if the window fits every trade's capacity, else the first day that doesn't. */
  const clash = (n: Node, days: number[]) => {
    for (const d of days) {
      if (d < 0) continue;
      for (const [name, crew] of n.crews) if (ensure(name, d)[d] + crew > capacity.get(name)! + EPS) return d;
    }
    return -1;
  };
  const book = (n: Node, days: number[]) => {
    for (const [name, crew] of n.crews) for (const d of days) if (d >= 0) ensure(name, d)[d] += crew;
  };

  /** Earliest start the placed predecessors allow. */
  const logicStart = (n: Node) => {
    let s = n.start0;
    for (const rel of n.preds) {
      const p = nodes.get(rel.predId)!;
      const lag = rel.lagHours / n.cal.hoursPerDay;
      let c: number;
      if (rel.type === 'SS') c = shift(n.cal, p.s, lag);
      else if (rel.type === 'FF') c = shift(n.cal, shift(n.cal, p.f, lag), -(Math.max(n.length, 1) - 1));
      else if (rel.type === 'SF') c = shift(n.cal, shift(n.cal, p.s, lag), -(Math.max(n.length, 1) - 1));
      else c = shift(n.cal, p.length ? p.f : p.s - 1, 1 + lag);
      if (c > s) s = c;
    }
    return snap(n.cal, s);
  };

  // Ready queue: all predecessors placed; earliest current start, then least float.
  const pending = new Map<string, number>();
  for (const n of nodes.values()) pending.set(n.a.id, n.preds.length);
  const heap: Node[] = [];
  const before = (x: Node, y: Node) => x.start0 - y.start0 || (x.late - x.start0) - (y.late - y.start0) || (x.a.id < y.a.id ? -1 : 1);
  const push = (n: Node) => {
    heap.push(n);
    for (let i = heap.length - 1; i > 0; ) {
      const parent = (i - 1) >> 1;
      if (before(heap[i], heap[parent]) >= 0) break;
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && before(heap[l], heap[m]) < 0) m = l;
        if (r < heap.length && before(heap[r], heap[m]) < 0) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };

  // Started work is fixed: book it first.
  for (const n of nodes.values()) if (n.fixed && n.length) book(n, windowOf(n, n.s));
  for (const n of nodes.values()) if (!n.preds.length) push(n);

  const byId = new Map<string, LevelledActivity>();
  let placed = 0;
  let moved = 0;
  let unresolved = 0;
  const place = (n: Node) => {
    placed++;
    let flag = false;
    if (!n.fixed) {
      const earliest = logicStart(n);
      let s = earliest;
      // A crew bigger than its trade's whole capacity can never fit.
      const tooBig = n.crews.some(([name, crew]) => crew > capacity.get(name)! + EPS);
      if (n.length && n.crews.length && !tooBig) {
        const limit = mode === 'float' ? Math.max(earliest, n.late) : shift(n.cal, earliest, MAX_SLIP);
        let found = -1;
        for (let t = earliest; t <= limit; ) {
          const bad = clash(n, windowOf(n, t));
          if (bad < 0) {
            found = t;
            break;
          }
          // Any start up to the overloaded day would still cover it: jump past it.
          t = snap(n.cal, bad + 1);
        }
        if (found < 0) flag = true;
        s = found < 0 ? earliest : found;
      } else if (tooBig) flag = true;
      n.s = s;
      const days = n.length ? windowOf(n, s) : [s];
      n.f = days[days.length - 1];
      if (n.length) book(n, days);
    }
    const delayDays = n.s > n.start0 ? countWorking(n.start0, n.s, n.cal) : 0;
    if (delayDays > 0) moved++;
    if (flag) unresolved++;
    // Unmoved activities keep their dates exactly; moved ones start on their
    // new first day and finish on their new last day (at the original times).
    const unmoved = n.fixed || (n.s === n.start0 && n.f === n.f0);
    const endDay = n.length ? n.f : n.s;
    byId.set(n.a.id, {
      start: unmoved ? startOf(n.a, 'current')! : withTime(dateOfDay(origin, n.s), startOf(n.a, 'current')!),
      finish: unmoved ? finishOf(n.a, 'current')! : n.endsAtMidnight ? dateOfDay(origin, endDay + 1) : withTime(dateOfDay(origin, endDay), finishOf(n.a, 'current')!),
      delayDays,
      unresolved: flag,
    });
    for (const id of n.succs) {
      const left = pending.get(id)! - 1;
      pending.set(id, left);
      if (left === 0) push(nodes.get(id)!);
    }
  };
  const countWorking = (from: number, to: number, cal: WorkingCalendar) => {
    let k = 0;
    for (let d = from + 1; d <= to; d++) if (isWorking(cal, d)) k++;
    return k;
  };

  while (heap.length) place(pop());
  // Activities caught in a logic loop never become ready: release one at a
  // time (against its predecessors' current dates) and carry on from there.
  if (placed < nodes.size) {
    for (const n of nodes.values()) {
      if (byId.has(n.a.id) || heap.includes(n)) continue;
      place(n);
      while (heap.length) {
        const next = pop();
        if (!byId.has(next.a.id)) place(next);
      }
    }
  }

  const latest = (ds: Date[]) => (ds.length ? new Date(Math.max(...ds.map((d) => d.getTime()))) : null);
  return {
    byId,
    moved,
    unresolved,
    finishBefore: latest(dated.map((a) => finishOf(a, 'current')!)),
    finishAfter: latest([...byId.values()].map((l) => l.finish)),
  };
}

function withTime(day: Date, time: Date) {
  const d = new Date(day.getTime());
  d.setHours(time.getHours(), time.getMinutes(), time.getSeconds(), 0);
  return d;
}

/** A copy of the model with the levelled dates as its early and planned dates. */
export function applyLevelling(model: ScheduleModel, result: LevelResult, label: string): ScheduleModel {
  const activities = model.activities.map((a) => {
    const l = result.byId.get(a.id);
    if (!l || a.actualStart) return a;
    return { ...a, earlyStart: l.start, earlyFinish: l.finish, targetStart: l.start, targetFinish: l.finish };
  });
  return {
    ...model,
    id: crypto.randomUUID(),
    sourceFileName: `${model.sourceFileName.replace(/\.(xml|xer)$/i, '')} [${label}].${model.sourceFormat}`,
    project: { ...model.project, name: `${model.project.name} (${label})`, planFinish: result.finishAfter ?? model.project.planFinish },
    activities,
  };
}
