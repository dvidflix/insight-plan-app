import type { Activity } from './types';

/** Bulk edit: pick activities with rules, apply one change to all of them, look at
    the preview, then apply. The plan is pure (nothing changes until it is applied). */

export type RuleOp = 'contains' | 'notContains' | 'equals' | 'startsWith' | 'empty' | 'notEmpty';

export const RULE_OPS: { op: RuleOp; label: string; needsValue: boolean }[] = [
  { op: 'contains', label: 'contains', needsValue: true },
  { op: 'notContains', label: "doesn't contain", needsValue: true },
  { op: 'equals', label: 'equals', needsValue: true },
  { op: 'startsWith', label: 'starts with', needsValue: true },
  { op: 'empty', label: 'is empty', needsValue: false },
  { op: 'notEmpty', label: 'is not empty', needsValue: false },
];

export interface BulkRule {
  id: string;
  /** A column id of the activity catalog (see schedule/columns). */
  field: string;
  op: RuleOp;
  value: string;
}

export type BulkAction =
  | { kind: 'setField'; field: string; template: string }
  | { kind: 'replace'; find: string; replaceWith: string; matchCase: boolean }
  | { kind: 'shift'; days: number; includeActuals: boolean }
  | { kind: 'duration'; mode: 'set' | 'scale'; value: number }
  | { kind: 'constraint'; type: string; date: string }
  | { kind: 'calendar'; calendarId: string };

export const CONSTRAINT_TYPES: { value: string; label: string }[] = [
  { value: '', label: 'None (clear)' },
  { value: 'CS_MSOA', label: 'Start On or After' },
  { value: 'CS_MSOB', label: 'Start On or Before' },
  { value: 'CS_MSO', label: 'Start On' },
  { value: 'CS_MEOA', label: 'Finish On or After' },
  { value: 'CS_MEOB', label: 'Finish On or Before' },
  { value: 'CS_MEO', label: 'Finish On' },
  { value: 'CS_MANDSTART', label: 'Mandatory Start' },
  { value: 'CS_MANDFIN', label: 'Mandatory Finish' },
  { value: 'CS_ALAP', label: 'As Late As Possible' },
];

export interface BulkChange {
  id: string;
  code: string;
  name: string;
  /** What changes, e.g. "Method (user field)". */
  what: string;
  before: string;
  after: string;
  patch: Partial<Activity>;
}

const DAY = 86_400_000;
const fmt = (d: Date | null | undefined) => (d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const shifted = (d: Date | null, days: number) => (d ? new Date(d.getTime() + days * DAY) : d);

export function ruleMatches(rule: BulkRule, text: string): boolean {
  const t = text.toLowerCase();
  const v = rule.value.toLowerCase();
  switch (rule.op) {
    case 'contains': return t.includes(v);
    case 'notContains': return !t.includes(v);
    case 'equals': return t === v;
    case 'startsWith': return t.startsWith(v);
    case 'empty': return text.trim() === '';
    default: return text.trim() !== '';
  }
}

/** Tokens in a template: {code} {name} {wbs} {wbsName} {start} {finish} {udf:Field} {code:Type} (an activity code). */
export function fillTemplate(template: string, a: Activity): string {
  return template.replace(/\{([^{}]+)\}/g, (_m, token: string) => {
    const [head, ...rest] = token.split(':');
    const arg = rest.join(':');
    switch (head.trim().toLowerCase()) {
      case 'code': return arg ? a.activityCodes[arg] ?? '' : a.code;
      case 'name': return a.name;
      case 'wbs': return a.wbsPath;
      case 'wbsname': return a.wbsPath.split(' / ').pop() ?? '';
      case 'start': return fmt(a.actualStart ?? a.earlyStart ?? a.targetStart);
      case 'finish': return fmt(a.actualFinish ?? a.earlyFinish ?? a.targetFinish);
      case 'udf': {
        const v = a.udf[arg];
        return v instanceof Date ? fmt(v) : v === undefined ? '' : String(v);
      }
      default: return `{${token}}`;
    }
  });
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The change `action` makes to one activity, or null when it leaves it as it is. */
function changeFor(a: Activity, action: BulkAction, calendarName: (id: string | null) => string): BulkChange | null {
  const base = { id: a.id, code: a.code, name: a.name };
  switch (action.kind) {
    case 'setField': {
      const field = action.field.trim();
      if (!field) return null;
      const next = fillTemplate(action.template, a);
      const prev = a.udf[field];
      const before = prev instanceof Date ? fmt(prev) : prev === undefined ? '' : String(prev);
      if (next === before) return null;
      return { ...base, what: `${field} (user field)`, before, after: next, patch: { udf: { ...a.udf, [field]: next } } };
    }
    case 'replace': {
      if (!action.find) return null;
      const re = new RegExp(escapeRegex(action.find), action.matchCase ? 'g' : 'gi');
      const next = a.name.replace(re, action.replaceWith);
      return next === a.name ? null : { ...base, what: 'Activity name', before: a.name, after: next, patch: { name: next } };
    }
    case 'shift': {
      if (!action.days) return null;
      const d = action.days;
      const patch: Partial<Activity> = {
        targetStart: shifted(a.targetStart, d), targetFinish: shifted(a.targetFinish, d),
        earlyStart: shifted(a.earlyStart, d), earlyFinish: shifted(a.earlyFinish, d),
        lateStart: shifted(a.lateStart, d), lateFinish: shifted(a.lateFinish, d),
        constraintDate: shifted(a.constraintDate, d),
      };
      if (action.includeActuals) Object.assign(patch, { actualStart: shifted(a.actualStart, d), actualFinish: shifted(a.actualFinish, d) });
      const s0 = a.earlyStart ?? a.targetStart;
      const f0 = a.earlyFinish ?? a.targetFinish;
      return { ...base, what: `Dates ${d > 0 ? '+' : ''}${d} d`, before: `${fmt(s0)} – ${fmt(f0)}`, after: `${fmt(shifted(s0, d))} – ${fmt(shifted(f0, d))}`, patch };
    }
    case 'duration': {
      // Only work still to do: finished and started activities keep their durations.
      if (a.status !== 'not-started' || a.type === 'milestone-start' || a.type === 'milestone-finish') return null;
      const hours = action.mode === 'set' ? action.value * 8 : a.durationHours * (action.value / 100);
      const rounded = Math.max(0, Math.round(hours * 4) / 4);
      if (rounded === a.durationHours) return null;
      return { ...base, what: 'Duration (d)', before: String(a.durationHours / 8), after: String(rounded / 8), patch: { durationHours: rounded, remainingDurationHours: rounded } };
    }
    case 'constraint': {
      const date = action.date ? new Date(`${action.date}T00:00:00`) : null;
      const type = action.type || null;
      if (type && !date && type !== 'CS_ALAP') return null;
      const before = a.constraintType ? `${a.constraintType}${a.constraintDate ? ` ${fmt(a.constraintDate)}` : ''}` : '';
      const after = type ? `${type}${date ? ` ${fmt(date)}` : ''}` : '';
      if (before === after) return null;
      return { ...base, what: 'Primary constraint', before, after, patch: { constraintType: type, constraintDate: type ? date : null } };
    }
    case 'calendar': {
      if (!action.calendarId || a.calendarId === action.calendarId) return null;
      return { ...base, what: 'Calendar', before: calendarName(a.calendarId), after: calendarName(action.calendarId), patch: { calendarId: action.calendarId } };
    }
  }
}

/** The changes for the activities the rules pick. `textOf(activity, fieldId)` reads a column's text. */
export function planBulkEdit(
  activities: Activity[],
  rules: BulkRule[],
  match: 'all' | 'any',
  action: BulkAction,
  textOf: (a: Activity, fieldId: string) => string,
  calendarName: (id: string | null) => string,
): { picked: number; changes: BulkChange[] } {
  const active = rules.filter((r) => r.field && (r.op === 'empty' || r.op === 'notEmpty' || r.value !== ''));
  const picked = activities.filter((a) => {
    if (a.type === 'wbs-summary') return false;
    if (active.length === 0) return true;
    const hit = (r: BulkRule) => ruleMatches(r, textOf(a, r.field));
    return match === 'all' ? active.every(hit) : active.some(hit);
  });
  const changes: BulkChange[] = [];
  for (const a of picked) {
    const c = changeFor(a, action, calendarName);
    if (c) changes.push(c);
  }
  return { picked: picked.length, changes };
}
