import { constraintName } from './reports';
import type { Activity, ActivityStatus, ActivityType, ScheduleModel } from './types';

export const TYPE_LABEL: Record<ActivityType, string> = {
  task: 'Task Dependent',
  'milestone-start': 'Start Milestone',
  'milestone-finish': 'Finish Milestone',
  loe: 'Level of Effort',
  'wbs-summary': 'WBS Summary',
};

export const STATUS_LABEL: Record<ActivityStatus, string> = {
  'not-started': 'Not Started',
  'in-progress': 'In Progress',
  completed: 'Completed',
};

export type FilterKind = 'text' | 'select' | 'number' | 'date';

export const FILTER_GROUPS = ['General', 'Dates', 'Duration & Float', 'Flags', 'Constraints', 'Resources', 'Calculated', 'Activity Codes', 'User Fields'] as const;

export interface FilterFieldDef {
  id: string;
  label: string;
  group: string;
  kind: FilterKind;
  /** Few-valued select fields render as toggle chips instead of a list. */
  display?: 'chips';
  /** Whether any activity has a value — fields with none are hidden. */
  hasData: boolean;
  /** Distinct selectable values (select). */
  values: { value: string; label: string }[];
  /** All raw value(s) this activity has for the field — many-valued for
      resource, single-valued otherwise. Used both for matching and for the
      cross-filter "how many remain" counts (select). */
  activityValues: (a: Activity) => string[];
  /** Free-text match target (text). */
  rawValue?: (a: Activity) => string;
  numberValue?: (a: Activity) => number | null;
  dateValue?: (a: Activity) => Date | null;
  unit?: string;
  /** Smallest/largest value present, shown as placeholders (number/date). */
  extent?: [string, string];
}

const HOURS_PER_DAY = 8;
const round1 = (n: number) => Math.round(n * 10) / 10;
const days = (h: number | null | undefined) => (h === null || h === undefined ? null : round1(h / HOURS_PER_DAY));
const yesNo = (v: boolean) => (v ? 'Yes' : 'No');

/** yyyy-mm-dd in local time — the format <input type="date"> uses, and
    string-comparable, so a date range check is plain string comparison. */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function distinct(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** Builds the filter fields for a schedule: the fixed P6 ones plus one per
    activity code type and user-defined field (neither is a fixed schema, so
    they are discovered from the model). */
/** A number field computed by the caller (the calculated columns), filterable like the built-in ones. */
export interface ExtraNumberField {
  id: string;
  label: string;
  group?: string;
  unit?: string;
  numberValue: (a: Activity) => number | null;
}

export function buildFilterFields(model: ScheduleModel, extra: ExtraNumberField[] = []): FilterFieldDef[] {
  const acts = model.activities;
  const fields: FilterFieldDef[] = [];

  const text = (id: string, label: string, group: string, rawValue: (a: Activity) => string) =>
    fields.push({ id, label, group, kind: 'text', hasData: true, values: [], activityValues: (a) => [rawValue(a)], rawValue });

  const select = (id: string, label: string, group: string, get: (a: Activity) => string[], labelOf: (v: string) => string = (v) => v, display?: 'chips') => {
    const values = distinct(acts.flatMap(get)).map((value) => ({ value, label: labelOf(value) }));
    values.sort((a, b) => a.label.localeCompare(b.label));
    fields.push({ id, label, group, kind: 'select', display, hasData: values.length > 0, values, activityValues: get });
  };

  const number = (id: string, label: string, group: string, get: (a: Activity) => number | null, unit?: string) => {
    const vals = acts.map(get).filter((v): v is number => v !== null);
    fields.push({
      id, label, group, kind: 'number', unit, hasData: vals.length > 0, values: [], activityValues: () => [], numberValue: get,
      extent: vals.length ? [String(Math.min(...vals)), String(Math.max(...vals))] : undefined,
    });
  };

  const dateField = (id: string, label: string, group: string, get: (a: Activity) => Date | null | undefined) => {
    const vals = acts.map((a) => get(a)).filter((d): d is Date => !!d).map(isoDay).sort();
    fields.push({
      id, label, group, kind: 'date', hasData: vals.length > 0, values: [], activityValues: () => [], dateValue: (a) => get(a) ?? null,
      extent: vals.length ? [vals[0], vals[vals.length - 1]] : undefined,
    });
  };

  const startOf = (a: Activity) => a.actualStart ?? a.earlyStart ?? a.targetStart;
  const finishOf = (a: Activity) => a.actualFinish ?? a.earlyFinish ?? a.targetFinish;

  // General
  text('code', 'Activity ID', 'General', (a) => a.code || '');
  text('name', 'Activity Name', 'General', (a) => a.name || '');
  text('wbs', 'WBS', 'General', (a) => a.wbsPath);
  select('status', 'Activity Status', 'General', (a) => [a.status], (v) => STATUS_LABEL[v as ActivityStatus] ?? v, 'chips');
  select('type', 'Activity Type', 'General', (a) => [a.type], (v) => TYPE_LABEL[v as ActivityType] ?? v);
  const calendarNames = new Map(model.calendars.map((c) => [c.id, c.name || c.id]));
  select('calendar', 'Calendar', 'General', (a) => (a.calendarId ? [a.calendarId] : []), (v) => calendarNames.get(v) ?? v);

  // Dates
  dateField('start', 'Start', 'Dates', startOf);
  dateField('finish', 'Finish', 'Dates', finishOf);
  dateField('actualStart', 'Actual Start', 'Dates', (a) => a.actualStart);
  dateField('actualFinish', 'Actual Finish', 'Dates', (a) => a.actualFinish);
  dateField('targetStart', 'Baseline Start', 'Dates', (a) => a.targetStart);
  dateField('targetFinish', 'Baseline Finish', 'Dates', (a) => a.targetFinish);

  // Duration & float
  number('durationDays', 'Original Duration', 'Duration & Float', (a) => days(a.durationHours), 'd');
  number('remainingDays', 'Remaining Duration', 'Duration & Float', (a) => days(a.remainingDurationHours), 'd');
  number('floatDays', 'Total Float', 'Duration & Float', (a) => days(a.totalFloatHours), 'd');
  number('freeFloatDays', 'Free Float', 'Duration & Float', (a) => days(a.freeFloatHours), 'd');
  number('percentComplete', '% Complete', 'Duration & Float', (a) => a.percentComplete, '%');

  // Flags
  select('critical', 'Critical', 'Flags', (a) => [yesNo(a.isCritical)], undefined, 'chips');
  select('longestPath', 'Longest Path', 'Flags', (a) => [yesNo(!!a.longestPath)], undefined, 'chips');
  const hasPred = new Set(model.relationships.map((r) => r.succId));
  const hasSucc = new Set(model.relationships.map((r) => r.predId));
  select('noPreds', 'No Predecessors', 'Flags', (a) => [yesNo(!hasPred.has(a.id))], undefined, 'chips');
  select('noSuccs', 'No Successors', 'Flags', (a) => [yesNo(!hasSucc.has(a.id))], undefined, 'chips');

  // Constraints
  select('constraint', 'Primary Constraint', 'Constraints', (a) => (a.constraintType ? [constraintName(a.constraintType)] : []));
  dateField('constraintDate', 'Constraint Date', 'Constraints', (a) => a.constraintDate);

  // Resources
  const resourceNames = new Map<string, string>();
  for (const a of acts) for (const r of a.resources) resourceNames.set(r.resourceId, r.resourceName);
  select('resource', 'Resource', 'Resources', (a) => a.resources.map((r) => r.resourceId), (v) => resourceNames.get(v) ?? v);
  select('primaryResource', 'Primary Resource', 'Resources', (a) => (a.primaryResource ? [a.primaryResource] : []));

  // Activity codes
  for (const codeType of model.activityCodeTypes) {
    select(`code:${codeType}`, codeType, 'Activity Codes', (a) => (a.activityCodes[codeType] ? [a.activityCodes[codeType]] : []));
  }

  // User-defined fields: numeric → range, date → date range, few values →
  // list, otherwise free text.
  for (const key of collectUdfKeys(model)) {
    const vals = acts.map((a) => a.udf[key]).filter((v) => v !== undefined && v !== '');
    if (vals.length === 0) continue;
    const id = `udf:${key}`;
    if (vals.every((v) => v instanceof Date)) {
      dateField(id, key, 'User Fields', (a) => (a.udf[key] instanceof Date ? (a.udf[key] as Date) : null));
    } else if (vals.every((v) => typeof v === 'number')) {
      number(id, key, 'User Fields', (a) => (typeof a.udf[key] === 'number' ? (a.udf[key] as number) : null));
    } else if (new Set(vals.map(String)).size <= 60) {
      select(id, key, 'User Fields', (a) => (a.udf[key] === undefined || a.udf[key] === '' ? [] : [String(a.udf[key])]));
    } else {
      text(id, key, 'User Fields', (a) => String(a.udf[key] ?? ''));
    }
  }

  for (const x of extra) {
    let lo = Infinity;
    let hi = -Infinity;
    let n = 0;
    for (const a of acts) {
      const v = x.numberValue(a);
      if (v === null) continue;
      n++;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    fields.push({
      id: x.id, label: x.label, group: x.group ?? 'Calculated', kind: 'number', unit: x.unit, hasData: n > 0, values: [], activityValues: () => [],
      numberValue: x.numberValue, extent: n ? [String(round1(lo)), String(round1(hi))] : undefined,
    });
  }

  return fields;
}

/** Truncates a "/"-joined WBS path to its first `level + 1` segments (level
    0 = top band only), for the "Group Levels" WBS-depth control shared by
    the Activities table and the Gantt view. A path shorter than the
    requested depth is returned as-is (its deepest available level). */
export function wbsAtLevel(wbsPath: string, level: number): string {
  const parts = wbsPath.split(' / ').filter(Boolean);
  return parts.slice(0, level + 1).join(' / ') || wbsPath;
}

/** Every distinct user-defined-field name present on any activity — UDFs
    are per-activity Records, not a fixed schema, so the set has to be
    discovered rather than declared. */
export function collectUdfKeys(model: ScheduleModel): string[] {
  const keys = new Set<string>();
  for (const a of model.activities) {
    for (const key of Object.keys(a.udf)) keys.add(key);
  }
  return [...keys].sort();
}

/** Number bounds are numeric text; date bounds are yyyy-mm-dd. Blank = open. */
export interface RangeFilter {
  min: string;
  max: string;
  /** Numbers: "greater than min" instead of "at least min" (for "> 0"). */
  minExclusive?: boolean;
}

/** How a text filter's terms are compared with the field (default: contains). */
export type TextMode = 'contains' | 'starts' | 'ends' | 'equals' | 'excludes';

export const TEXT_MODES: { value: TextMode; label: string; title: string }[] = [
  { value: 'contains', label: 'Contains', title: 'The field contains the text' },
  { value: 'starts', label: 'Starts', title: 'The field starts with the text' },
  { value: 'ends', label: 'Ends', title: 'The field ends with the text' },
  { value: 'equals', label: 'Is', title: 'The field is exactly the text' },
  { value: 'excludes', label: 'Not', title: 'The field does not contain the text' },
];

export interface FieldFilterState {
  selections: Record<string, Set<string>>;
  textFilters: Record<string, string>;
  /** Per text field; absent = contains. */
  textModes?: Record<string, TextMode>;
  ranges: Record<string, RangeFilter>;
}

export function emptyFilterState(): FieldFilterState {
  return { selections: {}, textFilters: {}, ranges: {} };
}

function searchTokens(query: string): string[] {
  return String(query || '').split(/\r?\n|,|;|\|\|/).map((t) => t.trim().toLowerCase()).filter(Boolean);
}
function matchesSearchTokens(text: string | undefined, tokens: string[], mode: TextMode = 'contains'): boolean {
  const v = String(text || '').toLowerCase().trim();
  switch (mode) {
    case 'starts': return tokens.some((t) => v.startsWith(t));
    case 'ends': return tokens.some((t) => v.endsWith(t));
    case 'equals': return tokens.some((t) => v === t);
    case 'excludes': return !tokens.some((t) => v.includes(t));
    default: return tokens.some((t) => v.includes(t));
  }
}

export function rangeActive(r: RangeFilter | undefined): r is RangeFilter {
  return !!r && (r.min.trim() !== '' || r.max.trim() !== '');
}

function matchesRange(f: FilterFieldDef, a: Activity, r: RangeFilter): boolean {
  if (f.kind === 'date') {
    const d = f.dateValue?.(a);
    if (!d) return false;
    const day = isoDay(d);
    return (r.min === '' || day >= r.min) && (r.max === '' || day <= r.max);
  }
  const v = f.numberValue?.(a);
  if (v === null || v === undefined) return false;
  const lo = parseFloat(r.min);
  const hi = parseFloat(r.max);
  return (Number.isNaN(lo) || (r.minExclusive ? v > lo : v >= lo)) && (Number.isNaN(hi) || v <= hi);
}

/** Applies every field filter except `excludeFieldId`, matching
    insight-plan-web's associative-filtering model: AND across fields, OR
    within a field's own selected checkbox values. */
export function applyFieldFilters(activities: Activity[], fields: FilterFieldDef[], state: FieldFilterState, excludeFieldId?: string): Activity[] {
  let acts = activities;
  for (const f of fields) {
    if (f.id === excludeFieldId) continue;
    if (f.kind === 'text') {
      const tokens = searchTokens(state.textFilters[f.id] || '');
      if (tokens.length > 0 && f.rawValue) acts = acts.filter((a) => matchesSearchTokens(f.rawValue!(a), tokens, state.textModes?.[f.id]));
    } else if (f.kind === 'select') {
      const sel = state.selections[f.id];
      if (sel && sel.size > 0) acts = acts.filter((a) => f.activityValues(a).some((v) => sel.has(v)));
    } else {
      const r = state.ranges[f.id];
      if (rangeActive(r)) acts = acts.filter((a) => matchesRange(f, a, r));
    }
  }
  return acts;
}

/** How many separate fields currently narrow the list. */
export function countActiveFilters(state: FieldFilterState): number {
  return (
    Object.values(state.selections).filter((s) => s.size > 0).length +
    Object.values(state.textFilters).filter((v) => v.trim().length > 0).length +
    Object.values(state.ranges).filter(rangeActive).length
  );
}

export function hasActiveFilters(state: FieldFilterState): boolean {
  return countActiveFilters(state) > 0;
}
