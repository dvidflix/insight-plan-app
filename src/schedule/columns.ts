import { noteText } from '../state/activityNotesStore';
import { STATUS_LABEL, TYPE_LABEL, collectUdfKeys } from './filterFields';
import { constraintName, daysBetween } from './reports';
import type { Activity, ScheduleModel } from './types';
import type { ScheduleCalendar } from './calendar';
import { PRECAST_RESOURCE, precastVolume } from './virtualResources';

/** Things a column may need beyond the activity itself. */
export interface ColumnCtx {
  calendarNameById: Record<string, string>;
  /** Activity id → codes of its predecessors / successors. */
  predsOf: Map<string, string[]>;
  succsOf: Map<string, string[]>;
  dataDate: Date | null;
  /** The schedule's calendars, for working-day totals. */
  calendarsById?: Map<string, ScheduleCalendar>;
}

export interface ColumnDef {
  id: string;
  label: string;
  /** The column's own name, when `label` is a name the user gave it. */
  baseLabel?: string;
  /** Section it is listed under in the column picker. */
  group: string;
  /** Default pixel width. */
  width: number;
  align?: 'right';
  /** Numeric column whose values are added up in a totals bar. */
  summable?: boolean;
  text: (a: Activity, ctx: ColumnCtx) => string;
  sort: (a: Activity, ctx: ColumnCtx) => string | number;
  /** Numeric columns: the number, for totals (sum, average, min, max). */
  value?: (a: Activity, ctx: ColumnCtx) => number | null;
  /** Date columns: the date, for totals (earliest, latest, span). */
  dateValue?: (a: Activity) => Date | null;
}

export const COLUMN_GROUPS = [
  'General',
  'Dates',
  'Duration & Progress',
  'Float & Criticality',
  'Constraints',
  'Resources & Cost',
  'Resource Units',
  'Relationships',
  'Activity Codes',
  'User Fields',
  'Calculated',
] as const;

const HOURS_PER_DAY = 8;
const round1 = (n: number) => Math.round(n * 10) / 10;
const days = (hours: number | null | undefined) => (hours === null || hours === undefined ? null : round1(hours / HOURS_PER_DAY));
const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
const fmtNum = (n: number | null) => (n === null ? '' : n.toLocaleString(undefined, { maximumFractionDigits: 2 }));
const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

const pad2 = (n: number) => String(n).padStart(2, '0');
/** ISO week of a date, "2029-W30" (weeks start Monday; the year is the ISO week-year). */
export function isoWeekLabel(d: Date): string {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day); // the Thursday of this week decides the year
  const week = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${pad2(week)}`;
}
/** Calendar month of a date, "2029-07". */
export const monthLabel = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
/** Calendar quarter of a date, "2029-Q3". */
export const quarterLabel = (d: Date) => `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
/** Calendar year of a date, "2029". */
export const yearLabel = (d: Date) => String(d.getFullYear());

/** A column that buckets a date into a year, quarter, week or month, for grouping and sorting (text sorts chronologically). */
function period(id: string, label: string, get: (a: Activity) => Date | null | undefined, fmt: (d: Date) => string): ColumnDef {
  const of = (a: Activity) => { const d = get(a); return d ? fmt(d) : ''; };
  return { id, label, group: 'Dates', width: 100, text: of, sort: of };
}

export const startOf = (a: Activity) => a.actualStart ?? a.earlyStart ?? a.targetStart;
export const finishOf = (a: Activity) => a.actualFinish ?? a.earlyFinish ?? a.targetFinish;

function text(id: string, label: string, group: string, width: number, get: (a: Activity, c: ColumnCtx) => string): ColumnDef {
  return { id, label, group, width, text: get, sort: (a, c) => get(a, c).toLowerCase() };
}
function date(id: string, label: string, group: string, get: (a: Activity) => Date | null | undefined, width = 104): ColumnDef {
  return { id, label, group, width, text: (a) => fmtDate(get(a)), sort: (a) => get(a)?.getTime() ?? 0, dateValue: (a) => get(a) ?? null };
}
function num(id: string, label: string, group: string, get: (a: Activity, c: ColumnCtx) => number | null, width = 96, suffix = '', summable = false): ColumnDef {
  return {
    id, label, group, width, align: 'right', summable, value: get,
    text: (a, c) => { const v = get(a, c); return v === null ? '' : `${fmtNum(v)}${suffix}`; },
    sort: (a, c) => get(a, c) ?? Number.NEGATIVE_INFINITY,
  };
}

const sum = (a: Activity, pick: (r: Activity['resources'][number]) => number) => a.resources.reduce((n, r) => n + pick(r), 0);

/** The fixed part of the catalog — everything a P6 layout normally offers
    that this app's schedule model carries. Activity-code and user-field
    columns are appended per schedule by buildColumns. Ids of the original
    twelve columns are unchanged, so saved layouts, sort and group rules keep
    working. */
const STATIC_COLUMNS: ColumnDef[] = [
  // General
  text('code', 'Activity ID', 'General', 120, (a) => a.code),
  text('name', 'Activity Name', 'General', 260, (a) => a.name),
  text('wbs', 'WBS', 'General', 180, (a) => a.wbsPath),
  text('wbsName', 'WBS Name', 'General', 160, (a) => a.wbsPath.split(' / ').pop() ?? ''),
  text('type', 'Activity Type', 'General', 120, (a) => TYPE_LABEL[a.type]),
  text('status', 'Activity Status', 'General', 110, (a) => STATUS_LABEL[a.status]),
  text('calendar', 'Calendar', 'General', 170, (a, c) => (a.calendarId ? (c.calendarNameById[a.calendarId] ?? a.calendarId) : '')),
  text('durationType', 'Duration Type', 'General', 170, (a) => a.durationType ?? ''),
  text('percentCompleteType', '% Complete Type', 'General', 120, (a) => a.percentCompleteType ?? ''),
  text('primaryResource', 'Primary Resource', 'General', 150, (a) => a.primaryResource ?? ''),
  text('notes', 'Notes', 'General', 240, (a) => noteText(a)),

  // Dates
  date('start', 'Start', 'Dates', startOf),
  date('finish', 'Finish', 'Dates', finishOf),
  period('startYear', 'Start Year', startOf, yearLabel),
  period('startQuarter', 'Start Quarter', startOf, quarterLabel),
  period('startWeek', 'Start Week', startOf, isoWeekLabel),
  period('startMonth', 'Start Month', startOf, monthLabel),
  period('finishYear', 'Finish Year', finishOf, yearLabel),
  period('finishQuarter', 'Finish Quarter', finishOf, quarterLabel),
  period('finishWeek', 'Finish Week', finishOf, isoWeekLabel),
  period('finishMonth', 'Finish Month', finishOf, monthLabel),
  date('actualStart', 'Actual Start', 'Dates', (a) => a.actualStart),
  date('actualFinish', 'Actual Finish', 'Dates', (a) => a.actualFinish),
  date('earlyStart', 'Early Start', 'Dates', (a) => a.earlyStart),
  date('earlyFinish', 'Early Finish', 'Dates', (a) => a.earlyFinish),
  date('lateStart', 'Late Start', 'Dates', (a) => a.lateStart),
  date('lateFinish', 'Late Finish', 'Dates', (a) => a.lateFinish),
  date('remainingStart', 'Remaining Early Start', 'Dates', (a) => a.remainingStart, 130),
  date('remainingFinish', 'Remaining Early Finish', 'Dates', (a) => a.remainingFinish, 130),
  date('targetStart', 'Baseline Start', 'Dates', (a) => a.targetStart),
  date('targetFinish', 'Baseline Finish', 'Dates', (a) => a.targetFinish),
  num('startVariance', 'Start Variance (cal d)', 'Dates', (a) => daysBetween(a.targetStart, startOf(a)), 130),
  num('finishVariance', 'Finish Variance (cal d)', 'Dates', (a) => daysBetween(a.targetFinish, finishOf(a)), 130),
  date('suspendDate', 'Suspend Date', 'Dates', (a) => a.suspendDate),
  date('resumeDate', 'Resume Date', 'Dates', (a) => a.resumeDate),
  date('expectedFinish', 'Expected Finish', 'Dates', (a) => a.expectedFinish),

  // Duration & progress
  num('durationDays', 'Original Duration (d)', 'Duration & Progress', (a) => days(a.durationHours), 130),
  num('remainingDays', 'Remaining Duration (d)', 'Duration & Progress', (a) => days(a.remainingDurationHours), 140),
  num('durationHours', 'Original Duration (h)', 'Duration & Progress', (a) => round1(a.durationHours), 140),
  num('remainingHours', 'Remaining Duration (h)', 'Duration & Progress', (a) => round1(a.remainingDurationHours), 150),
  num('actualDays', 'Actual Duration (cal d)', 'Duration & Progress', (a, c) => {
    if (!a.actualStart) return null;
    return daysBetween(a.actualStart, a.actualFinish ?? c.dataDate);
  }, 140),
  { id: 'percentComplete', label: '% Complete', group: 'Duration & Progress', width: 90, align: 'right',
    text: (a) => `${a.percentComplete}%`, sort: (a) => a.percentComplete, value: (a) => a.percentComplete },
  { id: 'durationPct', label: 'Duration % Complete', group: 'Duration & Progress', width: 140, align: 'right',
    text: (a) => (a.durationHours > 0 ? `${Math.round(Math.max(0, Math.min(1, 1 - a.remainingDurationHours / a.durationHours)) * 100)}%` : ''),
    sort: (a) => (a.durationHours > 0 ? 1 - a.remainingDurationHours / a.durationHours : -1),
    value: (a) => (a.durationHours > 0 ? Math.round(Math.max(0, Math.min(1, 1 - a.remainingDurationHours / a.durationHours)) * 100) : null) },
  { id: 'physicalPct', label: 'Physical % Complete', group: 'Duration & Progress', width: 140, align: 'right',
    text: (a) => (a.physicalPercentComplete === null || a.physicalPercentComplete === undefined ? '' : `${a.physicalPercentComplete}%`),
    sort: (a) => a.physicalPercentComplete ?? -1,
    value: (a) => a.physicalPercentComplete ?? null },

  // Float & criticality
  num('floatDays', 'Total Float (d)', 'Float & Criticality', (a) => days(a.totalFloatHours), 110),
  num('freeFloatDays', 'Free Float (d)', 'Float & Criticality', (a) => days(a.freeFloatHours), 100),
  text('critical', 'Critical', 'Float & Criticality', 80, (a) => yesNo(a.isCritical)),
  text('longestPath', 'Longest Path', 'Float & Criticality', 100, (a) => yesNo(!!a.longestPath)),

  // Constraints
  text('constraint', 'Primary Constraint', 'Constraints', 160, (a) => (a.constraintType ? constraintName(a.constraintType) : '')),
  date('constraintDate', 'Primary Constraint Date', 'Constraints', (a) => a.constraintDate, 140),
  text('constraint2', 'Secondary Constraint', 'Constraints', 160, (a) => (a.secondaryConstraintType ? constraintName(a.secondaryConstraintType) : '')),
  date('constraint2Date', 'Secondary Constraint Date', 'Constraints', (a) => a.secondaryConstraintDate, 150),

  // Resources & cost
  text('resources', 'Resources', 'Resources & Cost', 190, (a) => a.resources.map((r) => r.resourceName).join(', ')),
  num('resourceCount', 'Resource Count', 'Resources & Cost', (a) => a.resources.length, 110),
  num('budgetedUnits', 'Budgeted Units (h)', 'Resources & Cost', (a) => sum(a, (r) => r.targetQty), 130, '', true),
  num('actualUnits', 'Actual Units (h)', 'Resources & Cost', (a) => sum(a, (r) => Math.max(0, r.targetQty - r.remainQty)), 120, '', true),
  num('remainingUnits', 'Remaining Units (h)', 'Resources & Cost', (a) => sum(a, (r) => r.remainQty), 130, '', true),
  num('budgetedCost', 'Budgeted Cost', 'Resources & Cost', (a) => sum(a, (r) => r.targetCost), 110, '', true),
  num('actualCost', 'Actual Cost', 'Resources & Cost', (a) => sum(a, (r) => r.actualCost), 100, '', true),
  num('remainingCost', 'Remaining Cost', 'Resources & Cost', (a) => sum(a, (r) => Math.max(0, r.targetCost - r.actualCost)), 110, '', true),

  // Relationships
  num('predCount', 'Predecessors (count)', 'Relationships', (a, c) => c.predsOf.get(a.id)?.length ?? 0, 130),
  num('succCount', 'Successors (count)', 'Relationships', (a, c) => c.succsOf.get(a.id)?.length ?? 0, 130),
  text('predecessors', 'Predecessors', 'Relationships', 220, (a, c) => (c.predsOf.get(a.id) ?? []).join(', ')),
  text('successors', 'Successors', 'Relationships', 220, (a, c) => (c.succsOf.get(a.id) ?? []).join(', ')),
];

export function buildColumns(model: ScheduleModel): ColumnDef[] {
  const cols = [...STATIC_COLUMNS];
  for (const type of model.activityCodeTypes) {
    cols.push(text(`code:${type}`, type, 'Activity Codes', 140, (a) => a.activityCodes[type] ?? ''));
  }
  // One "budget units" column per resource (e.g. Rebar, Concrete), so units
  // can be compared and totalled side by side.
  const resourceNames = [...new Set(model.activities.flatMap((a) => a.resources.map((r) => r.resourceName)).filter(Boolean))].sort();
  for (const name of resourceNames) {
    cols.push(num(`res:${name}`, `${name} (units)`, 'Resource Units', (a) => {
      const mine = a.resources.filter((r) => r.resourceName === name);
      return mine.length ? mine.reduce((n, r) => n + r.targetQty, 0) : null;
    }, 130, '', true));
  }
  // The app-only resource (see virtualResources.ts): never in the programme file, but a column here.
  cols.push(num(`res:${PRECAST_RESOURCE}`, `◇ ${PRECAST_RESOURCE} (units)`, 'Resource Units', (a) => precastVolume(a), 130, '', true));
  for (const key of collectUdfKeys(model)) {
    cols.push({
      id: `udf:${key}`, label: key, group: 'User Fields', width: 130,
      text: (a) => {
        const v = a.udf[key];
        return v instanceof Date ? fmtDate(v) : v === undefined || v === '' ? '' : String(v);
      },
      sort: (a) => {
        const v = a.udf[key];
        if (v instanceof Date) return v.getTime();
        return typeof v === 'number' ? v : String(v ?? '').toLowerCase();
      },
    });
  }
  return cols;
}

export function buildColumnContext(model: ScheduleModel): ColumnCtx {
  const codeById = new Map(model.activities.map((a) => [a.id, a.code || a.id]));
  const predsOf = new Map<string, string[]>();
  const succsOf = new Map<string, string[]>();
  for (const r of model.relationships) {
    const p = codeById.get(r.predId);
    const s = codeById.get(r.succId);
    if (p === undefined || s === undefined) continue;
    (predsOf.get(r.succId) ?? predsOf.set(r.succId, []).get(r.succId)!).push(p);
    (succsOf.get(r.predId) ?? succsOf.set(r.predId, []).get(r.predId)!).push(s);
  }
  return {
    calendarNameById: Object.fromEntries(model.calendars.map((c) => [c.id, c.name || c.id])),
    predsOf, succsOf, dataDate: model.project.dataDate,
    calendarsById: new Map(model.calendars.map((c) => [c.id, c])),
  };
}

/** Catalog entries for `ids`, in that order, skipping ids this schedule
    doesn't have (e.g. a user field saved from a different file). */
export function resolveColumns(catalog: ColumnDef[], ids: string[]): ColumnDef[] {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  return ids.map((id) => byId.get(id)).filter((c): c is ColumnDef => !!c);
}

export const DEFAULT_TABLE_COLUMNS = [
  'code', 'name', 'wbs', 'calendar', 'type', 'status', 'resources', 'start', 'finish', 'durationDays', 'percentComplete', 'floatDays',
];
export const DEFAULT_GANTT_COLUMNS = ['code', 'name', 'durationDays', 'start', 'finish'];

export const COLUMN_PRESETS: { id: string; label: string; ids: string[] }[] = [
  { id: 'scheduling', label: 'Scheduling', ids: ['code', 'name', 'status', 'start', 'finish', 'durationDays', 'remainingDays', 'floatDays', 'freeFloatDays', 'critical', 'constraint', 'constraintDate'] },
  { id: 'progress', label: 'Progress', ids: ['code', 'name', 'status', 'actualStart', 'actualFinish', 'percentComplete', 'durationPct', 'remainingDays'] },
  { id: 'baseline', label: 'Baseline', ids: ['code', 'name', 'start', 'finish', 'targetStart', 'targetFinish', 'startVariance', 'finishVariance'] },
  { id: 'resources', label: 'Resources & cost', ids: ['code', 'name', 'resources', 'budgetedUnits', 'actualUnits', 'remainingUnits', 'budgetedCost', 'actualCost', 'remainingCost'] },
  { id: 'logic', label: 'Logic', ids: ['code', 'name', 'predCount', 'succCount', 'predecessors', 'successors', 'floatDays'] },
];
