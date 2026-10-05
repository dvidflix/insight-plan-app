import { DRIVING_FLOAT_HOURS, DRIVING_GAP_DAYS, DRIVING_TOLERANCE_HOURS } from './drivingPath';
import type { Activity, Relationship, ScheduleModel } from './types';

/** Why a milestone moved between two versions of a programme.
    The milestone's driving chain (the single predecessor that sets its date, then
    that activity's own driver, back to the start) is walked in the current
    version. Each activity on it passes on the shift of the date its successor
    uses, and adds its own: what an activity adds is the part of the milestone's
    movement that entered at that point, and it is explained from what changed
    there (duration, lag, relationship, driver, constraint, progress, data date).
    The contributions add up to the milestone's movement. */

const HOUR = 3_600_000;
const DAY = 86_400_000;
const HOURS_PER_DAY = 8;
/** A move, a contribution or a lag smaller than this is not reported. */
const EPS_DAYS = 0.5;

const ms = (d: Date | null | undefined) => (d ? d.getTime() : null);
/** Actual dates when there are any (completed work), else the programme's own early / target dates. */
const startOf = (a: Activity) => ms(a.actualStart ?? a.earlyStart ?? a.targetStart);
const finishOf = (a: Activity) => ms(a.actualFinish ?? a.earlyFinish ?? a.targetFinish);

export type DriverKind = 'duration' | 'lag' | 'logic' | 'constraint' | 'progress' | 'datadate' | 'calendar' | 'new' | 'unknown';

export interface DriverStep {
  code: string;
  name: string;
  /** Days this activity added to the milestone's movement (+ later, − earlier); null when it cannot be measured (new activity). */
  days: number | null;
  kind: DriverKind;
  reason: string;
}

export interface ChainLink {
  code: string;
  name: string;
  /** Movement (days) of the date the next link uses, current minus baseline; null for a new activity. */
  shiftDays: number | null;
}

export interface MilestoneDriver {
  code: string;
  name: string;
  baseDate: Date;
  currDate: Date;
  /** Current minus baseline, in days. */
  slipDays: number;
  /** The step that moved it most, in the direction it moved. */
  primary: DriverStep | null;
  /** Every step that added to the movement, in chain order (earliest first). */
  steps: DriverStep[];
  /** Movement the steps do not account for (new activities on the path). */
  unexplainedDays: number;
  /** True when the driving chain is not the one the baseline had. */
  pathChanged: boolean;
  chain: ChainLink[];
}

interface Ctx {
  model: ScheduleModel;
  byId: Map<string, Activity>;
  byCode: Map<string, Activity>;
  predsOf: Map<string, Relationship[]>;
}

function ctxOf(model: ScheduleModel): Ctx {
  const predsOf = new Map<string, Relationship[]>();
  for (const r of model.relationships) (predsOf.get(r.succId) ?? predsOf.set(r.succId, []).get(r.succId)!).push(r);
  return {
    model,
    byId: new Map(model.activities.map((a) => [a.id, a])),
    byCode: new Map(model.activities.map((a) => [a.code, a])),
    predsOf,
  };
}

const relPredDate = (rel: Relationship, pred: Activity) => (rel.type === 'FS' || rel.type === 'FF' ? finishOf(pred) : startOf(pred));
const relSuccDate = (rel: Relationship, succ: Activity) => (rel.type === 'FS' || rel.type === 'SS' ? startOf(succ) : finishOf(succ));

/** The date the relationship asks of its successor. */
function implied(rel: Relationship, pred: Activity): number | null {
  const d = relPredDate(rel, pred);
  return d === null ? null : d + rel.lagHours * HOUR;
}

/** Whether `rel` sets its successor's date: what it asks is what the successor has. */
function drivesDate(rel: Relationship, pred: Activity, succ: Activity): boolean {
  const want = implied(rel, pred);
  const have = relSuccDate(rel, succ);
  if (want === null || have === null) return false;
  if (pred.freeFloatHours !== null && pred.freeFloatHours > DRIVING_FLOAT_HOURS) return false;
  const tol = DRIVING_TOLERANCE_HOURS * HOUR;
  const gap = have - want;
  return gap >= -tol && gap <= tol + DRIVING_GAP_DAYS * DAY;
}

interface Link {
  act: Activity;
  /** The relationship from the previous link into this one; null for the first. */
  via: Relationship | null;
}

/** The driving chain of an activity, first activity first. At each step the predecessor asking for the latest date wins. */
function drivingChain(ctx: Ctx, target: Activity): Link[] {
  const rev: Link[] = [];
  const seen = new Set<string>();
  let cur: Activity | undefined = target;
  let into: Relationship | null = null;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    rev.push({ act: cur, via: into });
    let best: { rel: Relationship; at: number } | null = null;
    for (const r of ctx.predsOf.get(cur.id) ?? []) {
      const pred = ctx.byId.get(r.predId);
      if (!pred || pred.type === 'loe' || pred.type === 'wbs-summary' || !drivesDate(r, pred, cur)) continue;
      const at = implied(r, pred)!;
      if (!best || at > best.at) best = { rel: r, at };
    }
    into = best?.rel ?? null;
    cur = best ? ctx.byId.get(best.rel.predId) : undefined;
  }
  // rev[k + 1].via is the relationship from rev[k + 1] to rev[k]; flip so `via` points into each link.
  const chain: Link[] = [];
  for (let k = rev.length - 1; k >= 0; k--) chain.push({ act: rev[k].act, via: k === rev.length - 1 ? null : rev[k + 1].via });
  return chain;
}

const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const round1 = (n: number) => Math.round(n * 10) / 10;
const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Why the milestones that moved between `baseline` and `current` moved. */
export function milestoneDrivers(baseline: ScheduleModel, current: ScheduleModel): MilestoneDriver[] {
  const base = ctxOf(baseline);
  const curr = ctxOf(current);
  const dataDateMoved = !sameTime(baseline.project.dataDate, current.project.dataDate);
  const out: MilestoneDriver[] = [];

  for (const m of current.activities) {
    if (m.type !== 'milestone-start' && m.type !== 'milestone-finish') continue;
    const bm = base.byCode.get(m.code);
    if (!bm) continue;
    const mStart = m.type === 'milestone-start';
    const mNow = mStart ? startOf(m) : finishOf(m);
    const mThen = mStart ? startOf(bm) : finishOf(bm);
    if (mNow === null || mThen === null) continue;
    const slip = (mNow - mThen) / DAY;
    if (Math.abs(slip) <= EPS_DAYS) continue;

    const chain = drivingChain(curr, m);
    const baseChain = drivingChain(base, bm);
    const baseDriverOf = new Map<string, string | null>(); // code -> code of the activity driving it in the baseline
    baseChain.forEach((l, i) => baseDriverOf.set(l.act.code, i === 0 ? null : baseChain[i - 1].act.code));
    const inBaseChain = new Set(baseChain.map((l) => l.act.code));

    const steps: DriverStep[] = [];
    const links: ChainLink[] = [];
    let arriving = 0; // shift (days) handed on by the previous link
    let explained = 0;

    chain.forEach((link, i) => {
      const a = link.act;
      const b = base.byCode.get(a.code);
      const last = i === chain.length - 1;
      const next = chain[i + 1];
      const usesStart = last ? mStart : next.via!.type === 'SS' || next.via!.type === 'SF';
      const drivenStart = i === 0 ? true : link.via!.type === 'FS' || link.via!.type === 'SS';

      if (!b) {
        // A new activity on the path: no baseline dates to measure against.
        links.push({ code: a.code, name: a.name, shiftDays: null });
        steps.push({ code: a.code, name: a.name, days: null, kind: 'new', reason: 'New activity on the driving path (not in the baseline).' });
        return;
      }
      const sNow = startOf(a), sThen = startOf(b), fNow = finishOf(a), fThen = finishOf(b);
      const dS = sNow !== null && sThen !== null ? (sNow - sThen) / DAY : null;
      const dF = fNow !== null && fThen !== null ? (fNow - fThen) / DAY : null;
      const outShift = usesStart ? dS : dF;
      if (outShift === null || dS === null || dF === null) {
        links.push({ code: a.code, name: a.name, shiftDays: null });
        return;
      }
      links.push({ code: a.code, name: a.name, shiftDays: round1(outShift) });
      const own = outShift - arriving;

      // Part of the shift that comes from the activity's own length, when the date handed on is not the one it is driven at.
      const durPart = drivenStart && !usesStart ? dF - dS : !drivenStart && usesStart ? -(dF - dS) : 0;
      const logicPart = own - durPart;

      if (Math.abs(durPart) > EPS_DAYS) {
        const dh = a.durationHours - b.durationHours;
        const rh = a.remainingDurationHours - b.remainingDurationHours;
        const reason = Math.abs(dh) > 0.01
          ? `Duration ${round1(b.durationHours / HOURS_PER_DAY)} d → ${round1(a.durationHours / HOURS_PER_DAY)} d`
          : Math.abs(rh) > 0.01
            ? `Remaining duration ${round1(b.remainingDurationHours / HOURS_PER_DAY)} d → ${round1(a.remainingDurationHours / HOURS_PER_DAY)} d`
            : 'Longer / shorter in working time with the same duration (calendar or progress effect).';
        steps.push({ code: a.code, name: a.name, days: round1(durPart), kind: Math.abs(dh) > 0.01 || Math.abs(rh) > 0.01 ? 'duration' : 'calendar', reason });
        explained += durPart;
      }
      if (Math.abs(logicPart) > EPS_DAYS) {
        let kind: DriverKind = 'unknown';
        let reason = 'Date moved with no change to its logic, duration or constraint found (calendar, working time or rounding).';
        if (i === 0) {
          if (a.actualStart && !sameTime(a.actualStart, b.actualStart)) {
            kind = 'progress';
            reason = `Started ${fmtDate(a.actualStart)}${b.actualStart ? ` (was ${fmtDate(b.actualStart)})` : ` (planned ${fmtDate(b.earlyStart ?? b.targetStart)})`}.`;
          } else if (a.constraintType !== b.constraintType || !sameTime(a.constraintDate, b.constraintDate)) {
            kind = 'constraint';
            reason = `Constraint ${b.constraintType ?? 'none'}${b.constraintDate ? ` ${fmtDate(b.constraintDate)}` : ''} → ${a.constraintType ?? 'none'}${a.constraintDate ? ` ${fmtDate(a.constraintDate)}` : ''}.`;
          } else if (a.constraintType && a.constraintDate && !a.actualStart) {
            kind = 'constraint';
            reason = `Held by its constraint (${a.constraintType} ${fmtDate(a.constraintDate)}); the baseline date was ${fmtDate(b.earlyStart ?? b.targetStart)}.`;
          } else if (dataDateMoved && !a.actualStart) {
            kind = 'datadate';
            reason = `Data date moved ${fmtDate(baseline.project.dataDate)} → ${fmtDate(current.project.dataDate)}; unstarted work cannot start before it.`;
          } else if (a.calendarId !== b.calendarId) {
            kind = 'calendar';
            reason = 'Its calendar changed.';
          }
        } else {
          const via = link.via!;
          const predCode = chain[i - 1].act.code;
          const baseRel = baseline.relationships.find((r) => base.byId.get(r.predId)?.code === predCode && base.byId.get(r.succId)?.code === a.code);
          const wasDrivenBy = baseDriverOf.get(a.code);
          if (!baseRel) {
            kind = 'logic';
            reason = `New driving link from ${predCode} (${via.type}${via.lagHours ? ` ${via.lagHours} h` : ''}); it is not in the baseline.`;
          } else if (inBaseChain.has(a.code) && wasDrivenBy !== undefined && wasDrivenBy !== predCode) {
            kind = 'logic';
            reason = `Driving predecessor changed: was ${wasDrivenBy ?? 'none'}, now ${predCode}.`;
          } else if (!inBaseChain.has(a.code)) {
            kind = 'logic';
            reason = `Now on the driving path (it did not drive the milestone in the baseline), through ${predCode}.`;
          } else if (baseRel.type !== via.type) {
            kind = 'logic';
            reason = `Relationship ${predCode} → ${a.code} changed from ${baseRel.type} to ${via.type}.`;
          } else if (Math.abs(baseRel.lagHours - via.lagHours) > 0.01) {
            kind = 'lag';
            reason = `Lag on ${predCode} → ${a.code} changed from ${baseRel.lagHours} h to ${via.lagHours} h.`;
          } else if (a.constraintType !== b.constraintType || !sameTime(a.constraintDate, b.constraintDate)) {
            kind = 'constraint';
            reason = `Constraint ${b.constraintType ?? 'none'} → ${a.constraintType ?? 'none'}${a.constraintDate ? ` ${fmtDate(a.constraintDate)}` : ''}.`;
          } else if ((a.actualStart && !sameTime(a.actualStart, b.actualStart)) || (a.actualFinish && !sameTime(a.actualFinish, b.actualFinish))) {
            kind = 'progress';
            reason = `Progressed: ${a.actualStart ? `started ${fmtDate(a.actualStart)}` : ''}${a.actualFinish ? ` finished ${fmtDate(a.actualFinish)}` : ''}.`;
          } else if (a.calendarId !== b.calendarId) {
            kind = 'calendar';
            reason = 'Its calendar changed.';
          }
        }
        steps.push({ code: a.code, name: a.name, days: round1(logicPart), kind, reason });
        explained += logicPart;
      }
      arriving = outShift;
    });

    const significant = steps.filter((s) => s.days === null || Math.abs(s.days) > EPS_DAYS);
    const sameDirection = significant.filter((s) => s.days !== null && Math.sign(s.days) === Math.sign(slip));
    const primary = sameDirection.length ? sameDirection.reduce((x, y) => (Math.abs(y.days!) > Math.abs(x.days!) ? y : x)) : significant.find((s) => s.days === null) ?? null;
    out.push({
      code: m.code,
      name: m.name,
      baseDate: new Date(mThen),
      currDate: new Date(mNow),
      slipDays: round1(slip),
      primary,
      steps: significant,
      unexplainedDays: round1(slip - explained),
      pathChanged: chain.some((l) => !inBaseChain.has(l.act.code)) || baseChain.some((l) => !curr.byCode.has(l.act.code)),
      chain: links,
    });
  }
  return out.sort((a, b) => Math.abs(b.slipDays) - Math.abs(a.slipDays));
}
