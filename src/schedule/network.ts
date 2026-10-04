import { addWorkingDays, getCalendar, workingDaysBetween, type ScheduleCalendar, type WorkingCalendar } from './calendar';
import type { Activity, RelationType, ScheduleModel } from './types';

const HOURS_PER_DAY = 8;

export interface NetworkNode {
  id: string;
  code: string;
  name: string;
  type: Activity['type'];
  status: Activity['status'];
  durationDays: number;
  remainingDurationDays: number | null;
  percentComplete: number;
  actualStart: Date | null;
  actualFinish: Date | null;
  calendarId: string | null;
  wbsPath: string;
}

interface NetworkEdge {
  otherId: string;
  type: RelationType;
  lagDays: number;
}

export interface ScheduleNetwork {
  nodes: Map<string, NetworkNode>;
  preds: Map<string, NetworkEdge[]>;
  succs: Map<string, NetworkEdge[]>;
  calendarsById: Map<string, ScheduleCalendar>;
}

/** Builds a slim CPM network from a ScheduleModel. Excludes LOE and WBS
    Summary activities per standard P6 CPM semantics. Ported from
    insight-plan-web's cpmEngine.js buildNetwork. */
export function buildNetwork(model: ScheduleModel): ScheduleNetwork {
  const calendarsById = new Map(model.calendars.map((c) => [c.id, c]));
  const nodes = new Map<string, NetworkNode>();
  for (const a of model.activities) {
    if (a.type === 'loe' || a.type === 'wbs-summary') continue;
    nodes.set(a.id, {
      id: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      status: a.status,
      durationDays: a.durationHours / HOURS_PER_DAY,
      remainingDurationDays: a.remainingDurationHours != null ? a.remainingDurationHours / HOURS_PER_DAY : null,
      percentComplete: a.percentComplete,
      actualStart: a.actualStart,
      actualFinish: a.actualFinish,
      calendarId: a.calendarId,
      wbsPath: a.wbsPath,
    });
  }

  const preds = new Map<string, NetworkEdge[]>();
  const succs = new Map<string, NetworkEdge[]>();
  nodes.forEach((_n, id) => {
    preds.set(id, []);
    succs.set(id, []);
  });

  for (const r of model.relationships) {
    if (!nodes.has(r.predId) || !nodes.has(r.succId)) continue;
    const lagDays = r.lagHours / HOURS_PER_DAY;
    succs.get(r.predId)!.push({ otherId: r.succId, type: r.type, lagDays });
    preds.get(r.succId)!.push({ otherId: r.predId, type: r.type, lagDays });
  }

  return { nodes, preds, succs, calendarsById };
}

export function cloneNetwork(network: ScheduleNetwork): ScheduleNetwork {
  const nodes = new Map(Array.from(network.nodes, ([id, n]) => [id, { ...n }] as const));
  const preds = new Map(Array.from(network.preds, ([id, list]) => [id, list.map((e) => ({ ...e }))] as const));
  const succs = new Map(Array.from(network.succs, ([id, list]) => [id, list.map((e) => ({ ...e }))] as const));
  return { nodes, preds, succs, calendarsById: network.calendarsById };
}

export function codeIndex(network: ScheduleNetwork): Map<string, string> {
  const byCode = new Map<string, string>();
  network.nodes.forEach((n) => byCode.set(n.code, n.id));
  return byCode;
}

export interface ScenarioResult {
  ok: boolean;
  message: string;
}

export function applyDurationChange(network: ScheduleNetwork, activityCode: string, newDurationDays: number): ScenarioResult {
  const id = codeIndex(network).get(activityCode);
  if (!id) return { ok: false, message: `Task code "${activityCode}" not found — change skipped.` };
  const node = network.nodes.get(id)!;
  const oldDur = node.durationDays;
  node.durationDays = newDurationDays;
  if (node.remainingDurationDays != null) node.remainingDurationDays = newDurationDays;
  return { ok: true, message: `${activityCode} — Duration ${oldDur}d → ${newDurationDays}d` };
}

export interface RelationshipChange {
  op: 'add' | 'remove' | 'edit';
  predCode: string;
  succCode: string;
  type?: RelationType;
  lagDays?: number;
}

export function applyRelationshipChange(network: ScheduleNetwork, change: RelationshipChange): ScenarioResult {
  const idx = codeIndex(network);
  const predId = idx.get(change.predCode);
  const succId = idx.get(change.succCode);
  if (!predId || !succId) {
    return { ok: false, message: `Relationship ${change.predCode} → ${change.succCode} — task code not found, skipped.` };
  }
  const predSuccs = network.succs.get(predId)!;
  const succPreds = network.preds.get(succId)!;

  if (change.op === 'remove') {
    const before = predSuccs.length;
    network.succs.set(predId, predSuccs.filter((e) => e.otherId !== succId));
    network.preds.set(succId, succPreds.filter((e) => e.otherId !== predId));
    const removed = before !== network.succs.get(predId)!.length;
    return {
      ok: removed,
      message: removed
        ? `Removed relationship ${change.predCode} → ${change.succCode}`
        : `No existing relationship ${change.predCode} → ${change.succCode} to remove.`,
    };
  }

  const type = change.type ?? 'FS';
  const lagDays = change.lagDays ?? 0;
  if (change.op === 'edit') {
    const existing = predSuccs.find((e) => e.otherId === succId);
    const existingRev = succPreds.find((e) => e.otherId === predId);
    if (!existing || !existingRev) {
      return { ok: false, message: `No existing relationship ${change.predCode} → ${change.succCode} to edit.` };
    }
    existing.type = type;
    existing.lagDays = lagDays;
    existingRev.type = type;
    existingRev.lagDays = lagDays;
    return { ok: true, message: `Edited relationship ${change.predCode} → ${change.succCode} (${type}, lag ${lagDays}d)` };
  }

  if (predSuccs.some((e) => e.otherId === succId)) {
    return { ok: false, message: `Relationship ${change.predCode} → ${change.succCode} already exists.` };
  }
  predSuccs.push({ otherId: succId, type, lagDays });
  succPreds.push({ otherId: predId, type, lagDays });
  return { ok: true, message: `Added relationship ${change.predCode} → ${change.succCode} (${type}, lag ${lagDays}d)` };
}

function topoOrder(network: ScheduleNetwork): string[] {
  const ids = Array.from(network.nodes.keys());
  const inDegree = new Map(ids.map((id) => [id, network.preds.get(id)!.length]));
  const queue = ids.filter((id) => inDegree.get(id) === 0);
  const order: string[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    network.succs.get(id)!.forEach((e) => {
      inDegree.set(e.otherId, inDegree.get(e.otherId)! - 1);
      if (inDegree.get(e.otherId) === 0) queue.push(e.otherId);
    });
  }
  if (order.length < ids.length) ids.forEach((id) => { if (!seen.has(id)) order.push(id); });
  return order;
}

function nodeCalendar(node: NetworkNode, network: ScheduleNetwork): WorkingCalendar {
  return getCalendar(node.calendarId, network.calendarsById);
}

export interface NodeResult {
  earlyStart: Date;
  earlyFinish: Date;
  lateStart: Date;
  lateFinish: Date;
  totalFloatDays: number | null;
  freeFloatDays: number | null;
  isCritical: boolean;
}

export interface CpmResult {
  perNode: Map<string, NodeResult>;
  projectFinish: Date | null;
}

/** Full CPM forward+backward pass. Ported from cpmEngine.js's computeCPM:
    completed activities are pinned to their actual dates (0 float);
    in-progress activities start from max(dataDate, actualStart) using
    remaining duration; not-started activities use full duration from their
    computed early start. */
export function computeCPM(network: ScheduleNetwork, dataDate: Date | null, toleranceDays = 0): CpmResult {
  const order = topoOrder(network);
  const early = new Map<string, { start: Date; finish: Date }>();

  for (const id of order) {
    const node = network.nodes.get(id)!;
    const cal = nodeCalendar(node, network);

    if (node.actualFinish) {
      early.set(id, { start: node.actualStart || node.actualFinish, finish: node.actualFinish });
      continue;
    }

    let es: Date | null = null;
    for (const e of network.preds.get(id)!) {
      const pe = early.get(e.otherId);
      if (!pe) continue;
      let candidate: Date;
      if (e.type === 'FS') candidate = addWorkingDays(pe.finish, e.lagDays, cal);
      else if (e.type === 'SS') candidate = addWorkingDays(pe.start, e.lagDays, cal);
      else if (e.type === 'FF') candidate = addWorkingDays(pe.finish, e.lagDays, cal);
      else candidate = addWorkingDays(pe.start, e.lagDays, cal);
      if (es === null || candidate > es) es = candidate;
    }

    const predEdges = network.preds.get(id)!;
    const isFFonly = predEdges.length > 0 && predEdges.every((e) => e.type === 'FF' || e.type === 'SF');
    let start = es;
    const baseDate = node.actualStart || dataDate || new Date();
    if (start === null) start = baseDate;
    if (node.actualStart && !node.actualFinish) {
      const fromProgress = addWorkingDays(dataDate || baseDate, 0, cal);
      start = start && start > fromProgress ? start : fromProgress;
    }

    const dur = node.actualStart && !node.actualFinish
      ? node.remainingDurationDays ?? node.durationDays
      : node.durationDays;

    let finish: Date;
    if (isFFonly) {
      finish = start;
      start = addWorkingDays(finish, -dur, cal);
    } else {
      finish = addWorkingDays(start, dur, cal);
    }
    early.set(id, { start, finish });
  }

  let projectFinish: Date | null = null;
  network.nodes.forEach((_node, id) => {
    if (network.succs.get(id)!.length === 0) {
      const e = early.get(id);
      if (e && (projectFinish === null || e.finish > projectFinish)) projectFinish = e.finish;
    }
  });
  if (projectFinish === null) {
    early.forEach((e) => {
      if (projectFinish === null || e.finish > projectFinish) projectFinish = e.finish;
    });
  }

  const late = new Map<string, { start: Date; finish: Date }>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const node = network.nodes.get(id)!;
    const cal = nodeCalendar(node, network);

    if (node.actualFinish) {
      late.set(id, { start: node.actualStart || node.actualFinish, finish: node.actualFinish });
      continue;
    }

    let lf: Date | null = null;
    for (const e of network.succs.get(id)!) {
      const ls = late.get(e.otherId);
      if (!ls) continue;
      let candidate: Date;
      if (e.type === 'FS') candidate = addWorkingDays(ls.start, -e.lagDays, cal);
      else if (e.type === 'SS') candidate = addWorkingDays(ls.start, -e.lagDays, cal);
      else if (e.type === 'FF') candidate = addWorkingDays(ls.finish, -e.lagDays, cal);
      else candidate = addWorkingDays(ls.finish, -e.lagDays, cal);
      if (lf === null || candidate < lf) lf = candidate;
    }
    const e = early.get(id);
    if (lf === null) lf = projectFinish || (e ? e.finish : dataDate || new Date());
    const dur = node.actualStart && !node.actualFinish
      ? node.remainingDurationDays ?? node.durationDays
      : node.durationDays;
    const ls = addWorkingDays(lf, -dur, cal);
    late.set(id, { start: ls, finish: lf });
  }

  const result = new Map<string, NodeResult>();
  network.nodes.forEach((node, id) => {
    const e = early.get(id)!;
    const l = late.get(id)!;
    const cal = nodeCalendar(node, network);
    if (node.actualFinish) {
      result.set(id, { earlyStart: e.start, earlyFinish: e.finish, lateStart: l.start, lateFinish: l.finish, totalFloatDays: 0, freeFloatDays: 0, isCritical: false });
      return;
    }
    const totalFloatDays = workingDaysBetween(e.finish, l.finish, cal);
    let freeFloatDays = totalFloatDays;
    const mySuccs = network.succs.get(id)!;
    if (mySuccs.length) {
      let minGap: number | null = null;
      for (const se of mySuccs) {
        const succEarly = early.get(se.otherId);
        if (!succEarly) continue;
        let gap: number | null;
        if (se.type === 'FS') gap = workingDaysBetween(e.finish, addWorkingDays(succEarly.start, -se.lagDays, cal), cal);
        else if (se.type === 'SS') gap = workingDaysBetween(e.start, addWorkingDays(succEarly.start, -se.lagDays, cal), cal);
        else if (se.type === 'FF') gap = workingDaysBetween(e.finish, addWorkingDays(succEarly.finish, -se.lagDays, cal), cal);
        else gap = workingDaysBetween(e.start, addWorkingDays(succEarly.finish, -se.lagDays, cal), cal);
        if (gap !== null && (minGap === null || gap < minGap)) minGap = gap;
      }
      if (minGap !== null) freeFloatDays = minGap;
    }
    result.set(id, {
      earlyStart: e.start,
      earlyFinish: e.finish,
      lateStart: l.start,
      lateFinish: l.finish,
      totalFloatDays,
      freeFloatDays,
      isCritical: totalFloatDays !== null && totalFloatDays <= toleranceDays,
    });
  });

  return { perNode: result, projectFinish };
}

/** Simplified drag heuristic (not full path-enumeration drag — a known hard
    problem for complex merge/burst networks): for a critical activity with
    no parallel path, drag = its own duration; otherwise drag = min(own
    duration, smallest float among adjacent non-critical activities). */
export function computeDrag(network: ScheduleNetwork, cpmResult: CpmResult): Map<string, number> {
  const drag = new Map<string, number>();
  network.nodes.forEach((node, id) => {
    const r = cpmResult.perNode.get(id);
    if (!r || !r.isCritical) return;
    const neighborFloats: number[] = [];
    for (const e of [...network.preds.get(id)!, ...network.succs.get(id)!]) {
      const nr = cpmResult.perNode.get(e.otherId);
      if (nr && !nr.isCritical && nr.totalFloatDays !== null) neighborFloats.push(nr.totalFloatDays);
    }
    const dur = node.durationDays || 0;
    drag.set(id, neighborFloats.length === 0 ? dur : Math.min(dur, Math.min(...neighborFloats)));
  });
  return drag;
}
