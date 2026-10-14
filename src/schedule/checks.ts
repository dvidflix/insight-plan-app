import { hoursPerDayOf } from './hoursPerDay';
import { buildNetwork, cloneNetwork, computeCPM } from './network';
import type { ScheduleCalendar } from './calendar';
import type { Activity, ScheduleModel } from './types';

export type CheckSeverity = 'high' | 'medium' | 'low' | 'info';
/** Traffic-light outcome of a check. `info` = not scored (needs a baseline,
    couldn't be computed, or the check is switched off). */
export type CheckBand = 'green' | 'amber' | 'red' | 'info';

/** Everything the user can tune per check (the "Check N — Settings" popover):
    which activities are in scope, the flagged-% thresholds that decide
    Green/Amber/Red (Red is automatic at or above `amberBelowPct`), and the
    points each band awards. */
export interface CheckSettings {
  enabled: boolean;
  includeLoe: boolean;
  includeSummary: boolean;
  includeMilestones: boolean;
  excludeCompleted: boolean;
  /** Comma-separated, case-insensitive fragments of an activity name to leave out. */
  excludeName: string;
  greenBelowPct: number;
  amberBelowPct: number;
  greenPts: number;
  amberPts: number;
}

/** Only the values a user changed from a check's defaults, keyed by check id. */
export type CheckSettingsMap = Record<string, Partial<CheckSettings>>;

export interface CheckResult {
  id: string;
  num: number | null;
  category: 'DCMA 14-Point' | 'Additional';
  name: string;
  description: string;
  risk: string;
  action: string;
  severity: CheckSeverity;
  count: number | null;
  total: number | null;
  /** Flagged share of the checked population, 0–100 (null for info/disabled). */
  pct: number | null;
  activities: Activity[];
  info: boolean;
  band: CheckBand;
  points: number;
  maxPoints: number;
  /** Whether the scope filters (LOE/summary/milestone/completed/name) apply. */
  scoped: boolean;
  /** Needs a baseline schedule, so it has no thresholds or points to tune. */
  baseline: boolean;
  settings: CheckSettings;
  defaults: CheckSettings;
}

export interface ChecksResult {
  dcma: CheckResult[];
  additional: CheckResult[];
}

export interface ChecksScore {
  points: number;
  maxPoints: number;
  pct: number;
  green: number;
  amber: number;
  red: number;
}

const HIGH_FLOAT_DAYS = 44; // standard DCMA threshold (working days)
const HIGH_DURATION_DAYS = 44; // standard DCMA threshold (~2 working months)
/** Working days in an activity's hours: a day is as long as its calendar says. */
const calendarsOf = new WeakMap<ScheduleModel, Map<string, ScheduleCalendar>>();
function hoursPerDay(a: Activity, model: ScheduleModel): number {
  let calendars = calendarsOf.get(model);
  if (!calendars) calendarsOf.set(model, (calendars = new Map(model.calendars.map((c) => [c.id, c]))));
  return hoursPerDayOf(a.calendarId, calendars);
}
const LAG_RISK_FLOAT_DAYS = 45;
/** Zero-tolerance checks are Green only while nothing at all is flagged. */
const NONE_ALLOWED = 0.01;

function durationDays(a: Activity, model: ScheduleModel): number {
  return a.durationHours / hoursPerDay(a, model);
}
function floatDays(a: Activity, model: ScheduleModel): number | null {
  return a.totalFloatHours === null ? null : a.totalFloatHours / hoursPerDay(a, model);
}
function remainingDurationDays(a: Activity, model: ScheduleModel): number {
  return a.remainingDurationHours / hoursPerDay(a, model);
}

export function isHardConstraint(type: string | null): boolean {
  return /mandatory|^start on$|^finish on$|CS_MANDSTART|CS_MANDFIN|CS_MEO$|CS_MSO$/i.test(type || '');
}
function isALAP(type: string | null): boolean {
  return /as late as possible|CS_ALAP/i.test(type || '');
}
function isMilestone(a: Activity): boolean {
  return a.type === 'milestone-start' || a.type === 'milestone-finish';
}

interface Ctx {
  model: ScheduleModel;
  actById: Map<string, Activity>;
  predOf: Set<string>;
  succOf: Set<string>;
  fs: { fs: number; total: number };
  nonFsActivities: Activity[];
  sets: Record<'sf' | 'lag' | 'lead' | 'sch15' | 'sch16' | 'sch17' | 'sch18', Set<string>>;
}

interface Outcome {
  flagged: Activity[];
  /** Population size when it isn't the scoped activity count. */
  total?: number;
  /** Overrides for checks whose wording depends on the data. */
  description?: string;
  info?: boolean;
}

interface CheckDef {
  id: string;
  num: number | null;
  name: string;
  description: string;
  risk: string;
  action: string;
  severity: CheckSeverity;
  /** Scope filters apply (false for checks measured over relationships or the whole file). */
  scoped: boolean;
  scope?: Partial<Pick<CheckSettings, 'includeLoe' | 'includeSummary' | 'includeMilestones' | 'excludeCompleted'>>;
  green: number;
  amber: number;
  points?: [green: number, amber: number];
  info?: boolean;
  run?: (ctx: Ctx, pool: Activity[]) => Outcome;
}

const inSet = (set: Set<string>) => (_ctx: Ctx, pool: Activity[]): Outcome => ({ flagged: pool.filter((a) => set.has(a.id)) });

const BASELINE_RISK = 'Without a baseline comparison this indicator cannot be reported, so slippage against plan goes unmeasured.';
const BASELINE_ACTION = 'Load the approved baseline in Schedule Comparison to enable this check.';

const DEFS: CheckDef[] = [
  {
    id: 'DCMA01', num: 1, name: 'Logic', severity: 'high', scoped: true, green: 5, amber: 10,
    description: 'Activities missing a predecessor and/or successor (excluding start/finish milestones, which are allowed to have only one side). Should not exceed 5%.',
    risk: 'Open-ended activities do not drive or respond to change, so the critical path and forecast dates cannot be trusted.',
    action: 'Add the missing predecessor and successor links so every activity is tied into the network; only the project start and finish should be open.',
    run: (c, pool) => ({
      flagged: pool.filter((a) => (a.type !== 'milestone-start' && !c.predOf.has(a.id)) || (a.type !== 'milestone-finish' && !c.succOf.has(a.id))),
    }),
  },
  {
    id: 'DCMA02', num: 2, name: 'Leads (Negative Lag)', severity: 'high', scoped: true, green: NONE_ALLOWED, amber: NONE_ALLOWED,
    description: 'Relationships with negative lag ("leads"), which let a successor start before its predecessor truly finishes. There should be none.',
    risk: 'Leads distort the critical path and can hide float, making the forecast look shorter than the logic supports.',
    action: 'Remove all leads. Split the predecessor into overlapping activities or use SS relationships with a positive lag instead.',
    run: (c, pool) => inSet(c.sets.lead)(c, pool),
  },
  {
    id: 'DCMA03', num: 3, name: 'Lags', severity: 'medium', scoped: true, green: 5, amber: 10,
    description: 'Activities whose driving relationship carries positive lag. Should not exceed 5%.',
    risk: 'Lags are invisible, unresourced time in the logic and are easily used to force dates rather than model work.',
    action: 'Replace lags with explicit activities that describe the waiting or curing time, and keep any remaining lags justified in the notes.',
    run: (c, pool) => inSet(c.sets.lag)(c, pool),
  },
  {
    id: 'DCMA04', num: 4, name: 'Relationship Types (FS)', severity: 'medium', scoped: false, green: 10, amber: 20,
    description: 'Finish-to-Start relationships should make up at least 90% of all logic links. Non-FS logic (SS/FF/SF) is harder to trace and more error-prone.',
    risk: 'A high share of non-FS logic makes the network hard to audit and can produce unrealistic overlaps.',
    action: 'Audit the non-FS relationships. Convert to FS wherever feasible and document the ones that must stay.',
    run: (c) => ({
      flagged: c.nonFsActivities,
      total: c.fs.total || 1,
      description: `Finish-to-Start relationships should make up at least 90% of all logic links (currently ${c.fs.total ? ((c.fs.fs / c.fs.total) * 100).toFixed(1) : 'n/a'}%). Non-FS logic (SS/FF/SF) is harder to trace and more error-prone.`,
    }),
  },
  {
    id: 'DCMA05', num: 5, name: 'Hard Constraints', severity: 'medium', scoped: true, green: 5, amber: 10, scope: { excludeCompleted: true },
    description: 'Activities with a hard or two-way constraint (Mandatory Start/Finish, Start On, Finish On), which override network logic and can hide true schedule risk. Should not exceed 5%.',
    risk: 'Hard constraints override the logic, so dates no longer respond to delays upstream and float is masked.',
    action: 'Replace hard constraints with logic. Where a date is contractual, model it as a deadline or a soft constraint and record the reason.',
    run: (_c, pool) => ({ flagged: pool.filter((a) => isHardConstraint(a.constraintType)) }),
  },
  {
    id: 'DCMA06', num: 6, name: `High Float (≥ ${HIGH_FLOAT_DAYS}d)`, severity: 'medium', scoped: true, green: 5, amber: 10, scope: { excludeCompleted: true },
    description: `Activities with total float of at least ${HIGH_FLOAT_DAYS} working days, often a sign of missing logic. Should not exceed 5%.`,
    risk: 'Widespread large float undermines critical path reliability and suggests errors or missing relationships.',
    action: 'Review the logic of all flagged activities. Add missing relationships and constraints so float reflects real flexibility.',
    run: (c, pool) => ({ flagged: pool.filter((a) => { const f = floatDays(a, c.model); return f !== null && f >= HIGH_FLOAT_DAYS; }) }),
  },
  {
    id: 'DCMA07', num: 7, name: 'Negative Float', severity: 'high', scoped: true, green: NONE_ALLOWED, amber: NONE_ALLOWED, scope: { excludeCompleted: true },
    description: 'Activities with total (downstream) float less than 0 working days — the schedule cannot meet its own constraints as logic-linked. There should be none.',
    risk: 'Negative float means the plan cannot achieve a required date; the forecast is already late against its own constraints.',
    action: 'Identify the cause on the driving path, then recover with resequencing, resource changes or an agreed revision to the constraint.',
    run: (c, pool) => ({ flagged: pool.filter((a) => { const f = floatDays(a, c.model); return f !== null && f < 0; }) }),
  },
  {
    id: 'DCMA08', num: 8, name: `High Duration (≥ ${HIGH_DURATION_DAYS}d)`, severity: 'medium', scoped: true, green: 5, amber: 10, scope: { excludeCompleted: true, includeLoe: false },
    description: `Activities with a duration of at least ${HIGH_DURATION_DAYS} working days (~2 months) — usually a sign the work should be broken down further. Should not exceed 5%.`,
    risk: 'Long activities lack the granularity needed for progress tracking, cost control and early warning.',
    action: 'Decompose flagged activities into shorter tasks. Where that is not feasible, add interim milestones.',
    run: (c, pool) => ({ flagged: pool.filter((a) => durationDays(a, c.model) >= HIGH_DURATION_DAYS) }),
  },
  {
    id: 'DCMA09', num: 9, name: 'Invalid Dates', severity: 'high', scoped: true, green: NONE_ALLOWED, amber: NONE_ALLOWED,
    description: 'Tasks with forecast (early) start/finish dates before the data date, and/or actual start/finish dates after the data date — either way, a data-entry or status-update error. There should be none.',
    risk: 'Dates on the wrong side of the data date mean the schedule was not properly status-updated, so the forecast is unreliable.',
    action: 'Re-status the schedule: record actuals up to the data date and move all remaining work forward of it.',
    run: (c, pool) => {
      const dd = c.model.project.dataDate;
      if (!dd) return { flagged: [] };
      return {
        flagged: pool.filter((a) => {
          if (a.actualFinish && a.actualFinish > dd) return true;
          if (a.actualStart && a.actualStart > dd) return true;
          if (a.status !== 'completed') {
            if (a.earlyStart && a.earlyStart < dd) return true;
            if (a.earlyFinish && a.earlyFinish < dd) return true;
          }
          return false;
        }),
      };
    },
  },
  {
    id: 'DCMA10', num: 10, name: 'Resources', severity: 'low', scoped: true, green: 5, amber: 10,
    scope: { excludeCompleted: true, includeMilestones: false, includeLoe: false },
    description: 'Incomplete activities (excluding milestones and LOE) with no resource assignment. Not itself a pass/fail threshold in most organizations, but a high count usually means cost/effort isn’t being tracked at the activity level.',
    risk: 'A largely resource-unloaded schedule cannot support credible cost forecasting, earned value analysis or resource management.',
    action: 'Resource-load all flagged activities. Obtain resource data from project and functional managers and update the schedule.',
    run: (_c, pool) => ({ flagged: pool.filter((a) => a.resources.length === 0) }),
  },
  { id: 'DCMA11', num: 11, name: 'Missed Activities', severity: 'medium', scoped: false, green: 0, amber: 0, info: true,
    description: 'Requires a baseline schedule to compute (tasks with actual finish dates later than baseline plan finish dates). Load a baseline in Schedule Comparison to assess this.',
    risk: BASELINE_RISK, action: BASELINE_ACTION },
  {
    id: 'DCMA12', num: 12, name: 'Critical Path Test', severity: 'high', scoped: false, green: NONE_ALLOWED, amber: NONE_ALLOWED,
    description: 'Confirms the critical path is unbroken. Unavailable — no schedulable activities found.',
    risk: 'If the finish date does not respond to a delay on the longest path, the critical path is broken and the forecast is not driven by the logic.',
    action: 'Trace the longest path from the finish backwards and fix the open end, constraint or missing link that breaks it.',
    run: (c) => criticalPathTest(c.model, c.actById),
  },
  { id: 'DCMA13', num: 13, name: 'Critical Path Length Index (CPLI)', severity: 'medium', scoped: false, green: 0, amber: 0, info: true,
    description: 'Requires a baseline schedule to compute (CPLI = (critical path length + total float) ÷ critical path length). Load a baseline in Schedule Comparison and compare against the current schedule to assess this.',
    risk: BASELINE_RISK, action: BASELINE_ACTION },
  { id: 'DCMA14', num: 14, name: 'Baseline Execution Index (BEI)', severity: 'medium', scoped: false, green: 0, amber: 0, info: true,
    description: 'Requires a baseline schedule to compute (BEI = activities completed ÷ activities that should have completed by the data date, per the baseline). Load a baseline in Schedule Comparison to assess this.',
    risk: BASELINE_RISK, action: BASELINE_ACTION },

  // ---------- Additional checks (beyond the 14-point standard) ----------
  {
    id: 'ADD01', num: null, name: 'SF Predecessors', severity: 'medium', scoped: true, green: NONE_ALLOWED, amber: NONE_ALLOWED, points: [5, 4],
    description: 'Activities with a Start-to-Finish (SF) predecessor — the least intuitive relationship type and a frequent source of scheduling mistakes.',
    risk: 'SF logic is counter-intuitive and is almost always a modelling error.',
    action: 'Replace each SF relationship with an FS or SS relationship that reflects the real dependency.',
    run: (c, pool) => inSet(c.sets.sf)(c, pool),
  },
  {
    id: 'ADD02', num: null, name: 'As Late As Possible', severity: 'low', scoped: true, green: NONE_ALLOWED, amber: NONE_ALLOWED, points: [5, 4],
    description: 'Activities with a soft (one-way) constraint that forces the activity to start as late as possible without impacting the early or late dates — can mask true float.',
    risk: 'ALAP constraints consume float silently and hide how much flexibility the activity really has.',
    action: 'Remove the ALAP constraint unless there is a documented reason, and let logic determine the dates.',
    run: (_c, pool) => ({ flagged: pool.filter((a) => isALAP(a.constraintType)) }),
  },
  {
    id: 'ADD03', num: null, name: 'Zero Duration', severity: 'medium', scoped: true, green: NONE_ALLOWED, amber: NONE_ALLOWED, points: [5, 4], scope: { includeMilestones: false },
    description: 'Non-milestone activities with a duration of zero — usually should be milestones instead.',
    risk: 'Zero-duration tasks carry no work, so they mislead progress measurement.',
    action: 'Convert each to a milestone, or give it a realistic duration if it represents work.',
    run: (c, pool) => ({ flagged: pool.filter((a) => durationDays(a, c.model) === 0) }),
  },
  {
    id: 'ADD04', num: null, name: 'Lag > Remaining Duration & TF < 45d', severity: 'high', scoped: true, green: NONE_ALLOWED, amber: NONE_ALLOWED, points: [5, 4],
    description: 'The lag applied exceeds the remaining duration of the activity it delays, and that activity has less than 45 days of float — a high-risk combination.',
    risk: 'A lag longer than the work it delays, on a near-critical activity, can drive the finish date without any visible work.',
    action: 'Replace the lag with explicit activities or remove it.',
    run: (c, pool) => inSet(c.sets.sch15)(c, pool),
  },
  {
    id: 'ADD05', num: null, name: 'Lag > Remaining Duration & TF ≥ 45d', severity: 'medium', scoped: true, green: NONE_ALLOWED, amber: NONE_ALLOWED, points: [5, 4],
    description: 'The lag applied exceeds the remaining duration, with 45 days of float or more — lower risk than the above but still worth reviewing.',
    risk: 'Large lags on high-float activities are low risk today but can become critical as the project progresses.',
    action: 'Review each lag and replace it with an explicit activity where it represents real work or waiting time.',
    run: (c, pool) => inSet(c.sets.sch16)(c, pool),
  },
  {
    id: 'ADD06', num: null, name: 'Lag > 50% of Remaining Duration & TF < 45d', severity: 'medium', scoped: true, green: NONE_ALLOWED, amber: NONE_ALLOWED, points: [5, 4],
    description: 'The lag is more than half the remaining duration it delays, with less than 45 days of float.',
    risk: 'Substantial lags on near-critical activities make the forecast sensitive to unmodelled time.',
    action: 'Replace the lag with explicit activities or justify it in the schedule notes.',
    run: (c, pool) => inSet(c.sets.sch17)(c, pool),
  },
  {
    id: 'ADD07', num: null, name: 'Lag ≤ 50% of Remaining Duration & TF < 45d', severity: 'low', scoped: true, green: NONE_ALLOWED, amber: NONE_ALLOWED, points: [5, 4],
    description: 'The lag is at most half the remaining duration, with less than 45 days of float.',
    risk: 'Small lags on near-critical activities are a minor but real source of hidden time.',
    action: 'Confirm each lag is intentional and documented.',
    run: (c, pool) => inSet(c.sets.sch18)(c, pool),
  },
  {
    id: 'ADD08', num: null, name: 'Summary Activities With Links', severity: 'high', scoped: false, green: NONE_ALLOWED, amber: NONE_ALLOWED, points: [5, 4],
    description: 'WBS Summary rows that carry a predecessor or successor relationship. Summary rows aren’t real schedulable activities — any logic attached to one has no effect on the critical path and usually indicates a mis-linked activity.',
    risk: 'Logic on a summary row is ignored by the critical path, so the real activities beneath it may be unlinked.',
    action: 'Move each link onto the detail activities it was meant for and clear the summary row.',
    run: (c) => {
      const summaries = c.model.activities.filter((a) => a.type === 'wbs-summary');
      return {
        flagged: summaries.filter((a) => c.model.relationships.some((r) => r.predId === a.id || r.succId === a.id)),
        total: summaries.length || 1,
      };
    },
  },
  {
    id: 'ADD09', num: null, name: 'Duplicate Activity IDs', severity: 'high', scoped: false, green: NONE_ALLOWED, amber: NONE_ALLOWED, points: [5, 4],
    description: 'Activity IDs that appear on more than one activity — makes an activity ambiguous to reference (in reports, claims, or this app’s own What-If/Comparison tools, which match by activity code).',
    risk: 'Duplicate IDs make activities ambiguous in reports, claims and comparisons between schedule versions.',
    action: 'Renumber the duplicates so every activity ID is unique.',
    run: (c) => {
      const counts = new Map<string, number>();
      for (const a of c.model.activities) if (a.code) counts.set(a.code, (counts.get(a.code) ?? 0) + 1);
      return { flagged: c.model.activities.filter((a) => (counts.get(a.code) ?? 0) > 1), total: c.model.activities.length || 1 };
    },
  },
  {
    id: 'ADD10', num: null, name: 'Missing Calendar Assignment', severity: 'medium', scoped: true, green: NONE_ALLOWED, amber: NONE_ALLOWED, points: [5, 4], scope: { includeLoe: false },
    description: 'Activities whose assigned calendar isn’t one of the project’s defined calendars (or has none at all) — date/duration math for these can’t be trusted.',
    risk: 'Without a valid calendar, durations and dates for these activities cannot be trusted.',
    action: 'Assign each flagged activity a calendar that exists in the project.',
    run: (c, pool) => {
      const ids = new Set(c.model.calendars.map((cal) => cal.id));
      return { flagged: pool.filter((a) => !a.calendarId || !ids.has(a.calendarId)) };
    },
  },
];

const BASE_SCOPE = { includeLoe: true, includeSummary: false, includeMilestones: true, excludeCompleted: false, excludeName: '' };

export function defaultCheckSettings(id: string): CheckSettings {
  const def = DEFS.find((d) => d.id === id);
  if (!def) throw new Error(`Unknown check ${id}`);
  return defaultsOf(def);
}

function defaultsOf(def: CheckDef): CheckSettings {
  return {
    enabled: true,
    ...BASE_SCOPE,
    ...def.scope,
    greenBelowPct: def.green,
    amberBelowPct: def.amber,
    greenPts: def.points?.[0] ?? 10,
    amberPts: def.points?.[1] ?? 8,
  };
}

function inScope(a: Activity, s: CheckSettings, excludeNames: string[]): boolean {
  if (a.type === 'wbs-summary') { if (!s.includeSummary) return false; }
  else if (a.type === 'loe') { if (!s.includeLoe) return false; }
  else if (isMilestone(a) && !s.includeMilestones) return false;
  if (s.excludeCompleted && a.status === 'completed') return false;
  if (excludeNames.length > 0) {
    const name = a.name.toLowerCase();
    if (excludeNames.some((t) => name.includes(t))) return false;
  }
  return true;
}

function bandFor(pct: number, s: CheckSettings): CheckBand {
  if (pct < s.greenBelowPct) return 'green';
  if (pct < s.amberBelowPct) return 'amber';
  return 'red';
}

/** Runs the standard DCMA 14-Point Assessment plus the "Additional Checks"
    beyond it (ported from insight-plan-web's checks.js), each scoped,
    thresholded and scored per `overrides`. `info` results can't be computed
    without a baseline schedule (use Schedule Comparison to load one) and are
    shown as informational, never scored. */
export function runChecks(model: ScheduleModel, overrides: CheckSettingsMap = {}): ChecksResult {
  const actById = new Map(model.activities.filter((a) => a.type !== 'wbs-summary').map((a) => [a.id, a]));
  const sets: Ctx['sets'] = { sf: new Set(), lag: new Set(), lead: new Set(), sch15: new Set(), sch16: new Set(), sch17: new Set(), sch18: new Set() };
  const fs = { fs: 0, total: 0 };
  const nonFsActivities: Activity[] = [];

  for (const r of model.relationships) {
    const succ = actById.get(r.succId);
    if (!succ) continue;
    fs.total++;
    if (r.type === 'FS') fs.fs++;
    else nonFsActivities.push(succ);
    if (r.type === 'SF') sets.sf.add(succ.id);
    const lagDays = r.lagHours / hoursPerDay(succ, model);
    if (lagDays > 0) {
      sets.lag.add(succ.id);
      const remDur = remainingDurationDays(succ, model) || 0;
      const tf = floatDays(succ, model);
      if (tf === null) continue;
      if (lagDays > remDur) {
        if (tf < LAG_RISK_FLOAT_DAYS) sets.sch15.add(succ.id);
        else sets.sch16.add(succ.id);
      } else if (lagDays > remDur * 0.5) {
        if (tf < LAG_RISK_FLOAT_DAYS) sets.sch17.add(succ.id);
      } else if (tf < LAG_RISK_FLOAT_DAYS) {
        sets.sch18.add(succ.id);
      }
    } else if (lagDays < 0) {
      sets.lead.add(succ.id);
    }
  }

  const ctx: Ctx = {
    model, actById, fs, nonFsActivities, sets,
    predOf: new Set(model.relationships.map((r) => r.succId)),
    succOf: new Set(model.relationships.map((r) => r.predId)),
  };

  const dcma: CheckResult[] = [];
  const additional: CheckResult[] = [];

  for (const def of DEFS) {
    const defaults = defaultsOf(def);
    const settings: CheckSettings = { ...defaults, ...overrides[def.id] };
    const category = def.num ? 'DCMA 14-Point' : 'Additional';
    const base = {
      id: def.id, num: def.num, category, name: def.name, risk: def.risk, action: def.action,
      severity: def.severity, scoped: def.scoped, baseline: !!def.info, settings, defaults,
    } as const;

    let outcome: Outcome | null = null;
    if (def.info || !settings.enabled) {
      outcome = null;
    } else {
      const names = settings.excludeName.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      const pool = def.scoped ? model.activities.filter((a) => inScope(a, settings, names)) : [];
      outcome = def.run!(ctx, pool);
      if (def.scoped && outcome.total === undefined) outcome.total = pool.length || 1;
    }

    const list = def.num ? dcma : additional;
    if (!outcome || outcome.info) {
      list.push({
        ...base, description: outcome?.description ?? def.description, severity: def.info ? 'info' : def.severity,
        count: null, total: null, pct: null, activities: [], info: true,
        band: 'info', points: 0, maxPoints: 0,
      });
      continue;
    }
    const total = outcome.total ?? 1;
    const count = outcome.flagged.length;
    const pct = (count / total) * 100;
    const band = bandFor(pct, settings);
    list.push({
      ...base, description: outcome.description ?? def.description,
      count, total, pct, activities: outcome.flagged, info: false, band,
      points: band === 'green' ? settings.greenPts : band === 'amber' ? settings.amberPts : 0,
      maxPoints: settings.greenPts,
    });
  }

  dcma.sort((a, b) => (a.num ?? 0) - (b.num ?? 0));
  return { dcma, additional };
}

export function scoreChecks(results: CheckResult[]): ChecksScore {
  const scored = results.filter((r) => !r.info);
  const points = scored.reduce((n, r) => n + r.points, 0);
  const maxPoints = scored.reduce((n, r) => n + r.maxPoints, 0);
  return {
    points, maxPoints, pct: maxPoints ? (points / maxPoints) * 100 : 0,
    green: scored.filter((r) => r.band === 'green').length,
    amber: scored.filter((r) => r.band === 'amber').length,
    red: scored.filter((r) => r.band === 'red').length,
  };
}

// #12 Critical Path Test — a real CPM recompute (not the file's own
// pass-through float): push the activity with the latest early finish out by
// a large amount and confirm the project finish moves by (approximately) the
// same amount, proving the critical path actually drives the finish rather
// than being broken by an open end or a constraint.
function criticalPathTest(model: ScheduleModel, activityById: Map<string, Activity>): Outcome {
  const unavailable = (reason: string): Outcome => ({ flagged: [], info: true, description: `Confirms the critical path is unbroken. ${reason}` });
  try {
    const network = buildNetwork(model);
    const dataDate = model.project.dataDate || new Date();
    const before = computeCPM(network, dataDate);
    let latestId: string | null = null;
    let latestEF: Date | null = null;
    network.nodes.forEach((_n, id) => {
      const r = before.perNode.get(id);
      if (r && (!latestEF || r.earlyFinish > latestEF)) {
        latestEF = r.earlyFinish;
        latestId = id;
      }
    });
    if (!latestId) return unavailable('Unavailable — no schedulable activities found.');
    const PUSH_DAYS = 100;
    const clone = cloneNetwork(network);
    const node = clone.nodes.get(latestId)!;
    node.durationDays = (node.durationDays || 0) + PUSH_DAYS;
    const after = computeCPM(clone, dataDate);
    const shiftDays = before.projectFinish && after.projectFinish ? (after.projectFinish.getTime() - before.projectFinish.getTime()) / 86400000 : 0;
    const passed = shiftDays >= PUSH_DAYS * 0.9; // allow for weekend/calendar rounding
    return {
      flagged: passed ? [] : [activityById.get(latestId)].filter((a): a is Activity => !!a),
      total: 1,
      description: `Extending the longest-path activity by ${PUSH_DAYS}d shifted the project finish by ${Math.round(shiftDays)}d. ${passed ? 'The critical path is unbroken — it drives the finish as expected.' : 'The finish barely moved, which usually means the critical path is broken by an open end, a constraint, or missing logic somewhere along it.'}`,
    };
  } catch (e) {
    return unavailable(`Could not be computed for this schedule (${e instanceof Error ? e.message : String(e)}).`);
  }
}
