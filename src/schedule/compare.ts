import { buildNetwork, computeCPM, computeDrag, type CpmResult } from './network';
import type { Activity, ScheduleModel } from './types';

const HOURS_PER_DAY = 8;
const DURATION_EPSILON_DAYS = 0.5;
const DATE_EPSILON_DAYS = 0.5;

function dayDelta(a: Date | null, b: Date | null): number | null {
  if (!a || !b) return null;
  return (b.getTime() - a.getTime()) / 86400000;
}

interface MatchResult {
  matched: { code: string; base: Activity; curr: Activity }[];
  onlyInBaseline: Activity[];
  onlyInCurrent: Activity[];
}

const isRelevant = (a: Activity) => a.type !== 'loe' && a.type !== 'wbs-summary';

/** Matches activities between two independently-loaded schedules by
    `code` (not internal id, since ids aren't stable across exports). */
export function matchActivities(baseline: ScheduleModel, current: ScheduleModel): MatchResult {
  const baseByCode = new Map<string, Activity>();
  for (const a of baseline.activities.filter(isRelevant)) baseByCode.set(a.code, a);
  const currByCode = new Map<string, Activity>();
  for (const a of current.activities.filter(isRelevant)) currByCode.set(a.code, a);

  const matched: MatchResult['matched'] = [];
  const onlyInBaseline: Activity[] = [];
  baseByCode.forEach((base, code) => {
    const curr = currByCode.get(code);
    if (curr) matched.push({ code, base, curr });
    else onlyInBaseline.push(base);
  });
  const onlyInCurrent: Activity[] = [];
  currByCode.forEach((curr, code) => {
    if (!baseByCode.has(code)) onlyInCurrent.push(curr);
  });

  return { matched, onlyInBaseline, onlyInCurrent };
}

export type DelayEventType =
  | 'Scope Addition'
  | 'Scope Removed'
  | 'Duration Extension'
  | 'Duration Reduction'
  | 'Date Slip'
  | 'Date Pull-ahead';

export interface DelayEvent {
  id: string;
  type: DelayEventType;
  code: string;
  name: string;
  baseDurationDays: number | null;
  currDurationDays: number | null;
  deltaDurationDays: number | null;
  delayDays: number | null;
  onCriticalPath: boolean | null;
  description: string;
}

function durationDays(a: Activity): number {
  return a.durationHours / HOURS_PER_DAY;
}
function finishDate(a: Activity): Date | null {
  return a.earlyFinish ?? a.targetFinish;
}

/** Builds the Delay Events table: one row per activity that changed between
    baseline and current, classified by the most relevant single change. */
export function buildDelayEvents(match: MatchResult, currentCpm: CpmResult): DelayEvent[] {
  const rows: DelayEvent[] = [];
  let seq = 1;
  const nextId = () => `CE-${String(seq++).padStart(3, '0')}`;
  const onCP = (id: string): boolean | null => currentCpm.perNode.get(id)?.isCritical ?? null;

  for (const a of match.onlyInCurrent) {
    rows.push({
      id: nextId(), type: 'Scope Addition', code: a.code, name: a.name,
      baseDurationDays: null, currDurationDays: durationDays(a), deltaDurationDays: null,
      delayDays: null, onCriticalPath: onCP(a.id),
      description: 'Activity added in current schedule (not present in baseline).',
    });
  }
  for (const a of match.onlyInBaseline) {
    rows.push({
      id: nextId(), type: 'Scope Removed', code: a.code, name: a.name,
      baseDurationDays: durationDays(a), currDurationDays: null, deltaDurationDays: null,
      delayDays: null, onCriticalPath: null,
      description: 'Activity present in baseline but removed from current schedule.',
    });
  }
  for (const { code, base, curr } of match.matched) {
    const baseDur = durationDays(base);
    const currDur = durationDays(curr);
    const deltaDur = currDur - baseDur;
    const finishDelta = dayDelta(finishDate(base), finishDate(curr));
    const critical = onCP(curr.id);

    if (Math.abs(deltaDur) > DURATION_EPSILON_DAYS) {
      rows.push({
        id: nextId(), type: deltaDur > 0 ? 'Duration Extension' : 'Duration Reduction',
        code, name: curr.name, baseDurationDays: baseDur, currDurationDays: currDur,
        deltaDurationDays: deltaDur, delayDays: finishDelta, onCriticalPath: critical,
        description: `Duration ${deltaDur > 0 ? 'extended' : 'reduced'} by ${Math.abs(Math.round(deltaDur * 10) / 10)}d (${Math.round(baseDur)}d → ${Math.round(currDur)}d)`,
      });
      continue;
    }
    if (finishDelta !== null && Math.abs(finishDelta) > DATE_EPSILON_DAYS) {
      rows.push({
        id: nextId(), type: finishDelta > 0 ? 'Date Slip' : 'Date Pull-ahead',
        code, name: curr.name, baseDurationDays: baseDur, currDurationDays: currDur,
        deltaDurationDays: 0, delayDays: finishDelta, onCriticalPath: critical,
        description: `Finish date ${finishDelta > 0 ? 'slipped' : 'pulled ahead'} by ${Math.abs(Math.round(finishDelta))} day(s)`,
      });
    }
  }
  return rows;
}

export interface DragAnalysisRow {
  code: string;
  name: string;
  baseOnCP: boolean;
  currOnCP: boolean;
  baseDrag: number;
  currDrag: number;
  deltaDrag: number;
  classification: 'Unchanged' | 'Added to CP' | 'Removed from CP' | 'Drag Increased' | 'Drag Reduced';
}

export function buildDragAnalysis(
  match: MatchResult,
  baselineCpm: CpmResult,
  baselineDrag: Map<string, number>,
  currentCpm: CpmResult,
  currentDrag: Map<string, number>,
): DragAnalysisRow[] {
  const rows: DragAnalysisRow[] = [];
  for (const { code, base, curr } of match.matched) {
    const baseR = baselineCpm.perNode.get(base.id);
    const currR = currentCpm.perNode.get(curr.id);
    const baseOnCP = baseR?.isCritical ?? false;
    const currOnCP = currR?.isCritical ?? false;
    const baseDragV = baselineDrag.get(base.id) || 0;
    const currDragV = currentDrag.get(curr.id) || 0;

    let classification: DragAnalysisRow['classification'] = 'Unchanged';
    if (!baseOnCP && currOnCP) classification = 'Added to CP';
    else if (baseOnCP && !currOnCP) classification = 'Removed from CP';
    else if (baseOnCP && currOnCP) {
      if (currDragV > baseDragV + 0.05) classification = 'Drag Increased';
      else if (currDragV < baseDragV - 0.05) classification = 'Drag Reduced';
    }
    if (classification === 'Unchanged' && !baseOnCP && !currOnCP) continue;

    rows.push({
      code, name: curr.name, baseOnCP, currOnCP,
      baseDrag: baseOnCP ? baseDragV : 0, currDrag: currOnCP ? currDragV : 0,
      deltaDrag: (currOnCP ? currDragV : 0) - (baseOnCP ? baseDragV : 0),
      classification,
    });
  }
  return rows;
}

export interface CompareSummary {
  baselineFinish: Date | null;
  currentFinish: Date | null;
  slipDays: number | null;
  cpImpactDays: number;
  eventCount: number;
  countOnCP: number;
}

export function buildSummary(baselineCpm: CpmResult, currentCpm: CpmResult, events: DelayEvent[], dragRows: DragAnalysisRow[]): CompareSummary {
  const slipDays = dayDelta(baselineCpm.projectFinish, currentCpm.projectFinish);
  const cpImpactDays = dragRows.reduce((sum, r) => sum + Math.max(0, r.deltaDrag), 0);
  const countOnCP = events.filter((e) => e.onCriticalPath).length;
  return {
    baselineFinish: baselineCpm.projectFinish,
    currentFinish: currentCpm.projectFinish,
    slipDays, cpImpactDays, eventCount: events.length, countOnCP,
  };
}

export interface CompareResult {
  summary: CompareSummary;
  events: DelayEvent[];
  dragRows: DragAnalysisRow[];
}

export function compareSchedules(baseline: ScheduleModel, current: ScheduleModel): CompareResult {
  const match = matchActivities(baseline, current);
  const baselineNetwork = buildNetwork(baseline);
  const currentNetwork = buildNetwork(current);
  const baselineCpm = computeCPM(baselineNetwork, baseline.project.dataDate);
  const currentCpm = computeCPM(currentNetwork, current.project.dataDate);
  const baselineDrag = computeDrag(baselineNetwork, baselineCpm);
  const currentDrag = computeDrag(currentNetwork, currentCpm);

  const events = buildDelayEvents(match, currentCpm);
  const dragRows = buildDragAnalysis(match, baselineCpm, baselineDrag, currentCpm, currentDrag);
  const summary = buildSummary(baselineCpm, currentCpm, events, dragRows);
  return { summary, events, dragRows };
}
