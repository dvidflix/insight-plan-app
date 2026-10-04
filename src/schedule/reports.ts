import { isHardConstraint } from './checks';
import type { Activity, RelationType, ScheduleModel } from './types';

const HOURS_PER_DAY = 8;
const DAY_MS = 86400000;

export const daysOf = (hours: number | null): number | null => (hours === null ? null : hours / HOURS_PER_DAY);

export function fmtDate(d: Date | null | undefined): string {
  return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/ /g, '-') : '—';
}

export function fmtNum(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined ? '—' : n.toFixed(digits);
}

/** Whole days from `base` to `d` (positive = later), or null if either is missing. */
export function daysBetween(base: Date | null, d: Date | null): number | null {
  return base && d ? Math.round((d.getTime() - base.getTime()) / DAY_MS) : null;
}

// ---------- Relationships & lag ----------

export interface RelRow {
  key: string;
  predCode: string;
  predName: string;
  succCode: string;
  succName: string;
  type: RelationType;
  lagDays: number;
  predWbs: string;
  succWbs: string;
  predFloat: number | null;
  succFloat: number | null;
  crossWbs: boolean;
}

export const REL_TYPE_LABEL: Record<RelationType, string> = {
  FS: 'Finish to Start',
  SS: 'Start to Start',
  FF: 'Finish to Finish',
  SF: 'Start to Finish',
};

export function relationshipRows(model: ScheduleModel): RelRow[] {
  const byId = new Map(model.activities.map((a) => [a.id, a]));
  const rows: RelRow[] = [];
  model.relationships.forEach((r, i) => {
    const p = byId.get(r.predId);
    const s = byId.get(r.succId);
    if (!p || !s) return;
    rows.push({
      key: `${i}`,
      predCode: p.code || p.id, predName: p.name, succCode: s.code || s.id, succName: s.name,
      type: r.type, lagDays: r.lagHours / HOURS_PER_DAY,
      predWbs: p.wbsPath || '—', succWbs: s.wbsPath || '—',
      predFloat: daysOf(p.totalFloatHours), succFloat: daysOf(s.totalFloatHours),
      crossWbs: p.wbsId !== s.wbsId,
    });
  });
  return rows;
}

export const LAG_BUCKETS: { label: string; test: (lag: number) => boolean }[] = [
  { label: 'Lead 30+', test: (l) => l < -30 },
  { label: 'Lead 11-30', test: (l) => l >= -30 && l < -10 },
  { label: 'Lead 6-10', test: (l) => l >= -10 && l < -5 },
  { label: 'Lead 1-5', test: (l) => l >= -5 && l < 0 },
  { label: 'No Lag', test: (l) => l === 0 },
  { label: 'Lag 1-5', test: (l) => l > 0 && l <= 5 },
  { label: 'Lag 6-10', test: (l) => l > 5 && l <= 10 },
  { label: 'Lag 11-30', test: (l) => l > 10 && l <= 30 },
  { label: 'Lag 31-60', test: (l) => l > 30 && l <= 60 },
  { label: 'Lag 60+', test: (l) => l > 60 },
];

// ---------- Float ----------

export type FloatCategory = 'Critical' | 'Near-critical' | 'Low float' | 'OK';

export function floatCategory(floatDays: number): FloatCategory {
  if (floatDays <= 0.05) return 'Critical';
  if (floatDays <= 5) return 'Near-critical';
  if (floatDays <= 10) return 'Low float';
  return 'OK';
}

export const FLOAT_BUCKETS: { label: string; color: string; test: (f: number) => boolean }[] = [
  { label: 'Negative', color: 'var(--fb-neg, #a51c10)', test: (f) => f < -0.05 },
  { label: '0', color: 'var(--fb-0, #e8321c)', test: (f) => f >= -0.05 && f <= 0.05 },
  { label: '1-5', color: 'var(--fb-1, #f0701c)', test: (f) => f > 0.05 && f <= 5 },
  { label: '6-10', color: 'var(--fb-1, #f0a01c)', test: (f) => f > 5 && f <= 10 },
  { label: '11-20', color: 'var(--fb-2, #e0b010)', test: (f) => f > 10 && f <= 20 },
  { label: '21-30', color: 'var(--fb-4, #8cc040)', test: (f) => f > 20 && f <= 30 },
  { label: '30+', color: 'var(--fb-5, #2eae68)', test: (f) => f > 30 },
];

// ---------- Constraints ----------

const CONSTRAINT_NAMES: Record<string, string> = {
  CS_ALAP: 'As Late As Possible',
  CS_MSO: 'Start On',
  CS_MEO: 'Finish On',
  CS_MSOA: 'Start On or After',
  CS_MSOB: 'Start On or Before',
  CS_MEOA: 'Finish On or After',
  CS_MEOB: 'Finish On or Before',
  CS_MANDSTART: 'Mandatory Start',
  CS_MANDFIN: 'Mandatory Finish',
};

export function constraintName(type: string): string {
  return CONSTRAINT_NAMES[type] ?? type;
}

export type ConstraintClass = 'hard' | 'soft' | 'none';

export function constraintClass(a: Activity): ConstraintClass {
  if (!a.constraintType) return 'none';
  return isHardConstraint(a.constraintType) ? 'hard' : 'soft';
}

// ---------- Variance ----------

export interface VarianceRow {
  key: string;
  code: string;
  name: string;
  wbs: string;
  blStart: Date | null;
  blFinish: Date | null;
  start: Date | null;
  finish: Date | null;
  status: string;
  /** Finish vs target finish in days (positive = late). */
  variance: number | null;
  floatDays: number | null;
}

export const isMilestone = (a: Activity) => a.type === 'milestone-start' || a.type === 'milestone-finish';

const startOf = (a: Activity) => a.actualStart ?? a.earlyStart ?? a.targetStart;
const finishOf = (a: Activity) => a.actualFinish ?? a.earlyFinish ?? a.targetFinish;

export function milestoneVarianceRows(model: ScheduleModel): VarianceRow[] {
  return model.activities.filter(isMilestone).map((a) => {
    const finish = finishOf(a);
    return {
      key: a.id, code: a.code || a.id, name: a.name, wbs: a.wbsPath || '—',
      blStart: a.targetStart, blFinish: a.targetFinish, start: startOf(a), finish,
      status: a.status, variance: daysBetween(a.targetFinish, finish), floatDays: daysOf(a.totalFloatHours),
    };
  });
}

export function wbsVarianceRows(model: ScheduleModel): VarianceRow[] {
  const groups = new Map<string, Activity[]>();
  for (const a of model.activities) {
    if (a.type === 'wbs-summary') continue;
    const key = a.wbsPath || '—';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }
  const extreme = (dates: (Date | null)[], pick: 'min' | 'max'): Date | null => {
    const ts = dates.filter((d): d is Date => !!d).map((d) => d.getTime());
    return ts.length ? new Date(pick === 'min' ? Math.min(...ts) : Math.max(...ts)) : null;
  };
  return [...groups.entries()].map(([wbs, acts]) => {
    const done = acts.filter((a) => a.status === 'completed').length;
    const notStarted = acts.filter((a) => a.status === 'not-started').length;
    const finish = extreme(acts.map(finishOf), 'max');
    const blFinish = extreme(acts.map((a) => a.targetFinish), 'max');
    const floats = acts.map((a) => daysOf(a.totalFloatHours)).filter((f): f is number => f !== null);
    return {
      key: wbs, code: '', name: wbs, wbs,
      blStart: extreme(acts.map((a) => a.targetStart), 'min'), blFinish,
      start: extreme(acts.map(startOf), 'min'), finish,
      status: done === acts.length ? 'completed' : notStarted === acts.length ? 'not-started' : 'in-progress',
      variance: daysBetween(blFinish, finish), floatDays: floats.length ? Math.min(...floats) : null,
    };
  });
}
