import type { Activity, ScheduleModel, WbsNode } from './types';
import type { Result } from './programmeCommands';
import { wbsPathOf } from './programmeCommands';

/** The programme as the planner shows it: WBS nodes (summary rows) with their child nodes first and then their activities, each
    list in the order the user set (`seq`) or, where none is set, in the natural order of the WBS codes / activity IDs.

    Every function here returns a new model (or an error to show) and leaves the objects it does not change as they were, which is
    how saving finds the rows that changed (schedule/nativeOps.ts). */

export type PlanRef = { kind: 'wbs' | 'task'; id: string };

export interface PlanRow {
  kind: 'wbs' | 'task';
  id: string;
  depth: number;
  /** The WBS node holding this row (null: a top row). */
  parentId: string | null;
  wbs?: WbsNode;
  activity?: Activity;
  /** WBS rows: what is below (collapsed or not). */
  summary?: { start: Date | null; finish: Date | null; count: number; hours: number; percent: number };
  hasChildren: boolean;
}

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** `list` in order: by seq where it is set (those without come after), else by `fallback`. */
function ordered<T>(list: T[], seq: (x: T) => number | undefined, fallback: (a: T, b: T) => number): T[] {
  return [...list].sort((a, b) => {
    const sa = seq(a);
    const sb = seq(b);
    if (sa !== undefined && sb !== undefined && sa !== sb) return sa - sb;
    if (sa !== undefined && sb === undefined) return -1;
    if (sa === undefined && sb !== undefined) return 1;
    return fallback(a, b);
  });
}

export const wbsFallback = (a: WbsNode, b: WbsNode) => (a.code && b.code ? natural(a.code, b.code) : 0) || natural(a.name, b.name);
export const taskFallback = (a: Activity, b: Activity) => natural(a.code, b.code);

/** The child WBS nodes and the activities directly in `parentId` (null: the top), in order. */
export function childrenOf(m: ScheduleModel, parentId: string | null): { wbs: WbsNode[]; tasks: Activity[] } {
  const ids = new Set(m.wbs.map((n) => n.id));
  // A node whose parent is not in the programme is a top node.
  const wbs = m.wbs.filter((n) => (parentId === null ? n.parentId === null || !ids.has(n.parentId) : n.parentId === parentId));
  const tasks = m.activities.filter((a) => (parentId === null ? a.wbsId === null || !ids.has(a.wbsId) : a.wbsId === parentId));
  return { wbs: ordered(wbs, (n) => n.seq, wbsFallback), tasks: ordered(tasks, (a) => a.seq, taskFallback) };
}

const start = (a: Activity) => a.earlyStart ?? a.actualStart ?? a.targetStart;
const finish = (a: Activity) => a.earlyFinish ?? a.actualFinish ?? a.targetFinish;

/** The rows of the planner, top to bottom; the WBS nodes in `collapsed` hide what is below them. */
export function planRows(m: ScheduleModel, collapsed: ReadonlySet<string> = new Set()): PlanRow[] {
  const rows: PlanRow[] = [];
  const walk = (parentId: string | null, depth: number): PlanRow['summary'] & object => {
    const { wbs, tasks } = childrenOf(m, parentId);
    const total = { start: null as Date | null, finish: null as Date | null, count: 0, hours: 0, percent: 0 };
    let weighted = 0;
    const take = (s: Date | null, f: Date | null) => {
      if (s && (!total.start || s < total.start)) total.start = s;
      if (f && (!total.finish || f > total.finish)) total.finish = f;
    };
    for (const n of wbs) {
      const at = rows.length;
      rows.push({ kind: 'wbs', id: n.id, depth, parentId, wbs: n, hasChildren: false });
      const inner = walk(n.id, depth + 1);
      const row = rows[at];
      row.summary = inner;
      row.hasChildren = inner.count > 0 || m.wbs.some((x) => x.parentId === n.id);
      if (collapsed.has(n.id)) rows.splice(at + 1);
      take(inner.start, inner.finish);
      total.count += inner.count;
      total.hours += inner.hours;
      weighted += inner.percent * inner.hours;
    }
    for (const a of tasks) {
      rows.push({ kind: 'task', id: a.id, depth, parentId, activity: a, hasChildren: false });
      take(start(a), finish(a));
      total.count++;
      total.hours += a.durationHours;
      weighted += a.percentComplete * a.durationHours;
    }
    total.percent = total.hours > 0 ? weighted / total.hours : 0;
    return total;
  };
  walk(null, 0);
  return rows;
}

// ---- Making the order ----

const STEP = 10;

/** `list` renumbered 10, 20, 30... in its order (only the items whose number changes are new objects). */
function renumbered<T extends { seq?: number }>(list: T[]): T[] {
  return list.map((x, i) => (x.seq === (i + 1) * STEP ? x : { ...x, seq: (i + 1) * STEP }));
}

/** The programme with `wbs` / `activities` replaced by these (matched by id; the rest as it was). */
function withChanged(m: ScheduleModel, wbs: WbsNode[] = [], activities: Activity[] = []): ScheduleModel {
  if (!wbs.length && !activities.length) return m;
  const w = new Map(wbs.map((n) => [n.id, n]));
  const a = new Map(activities.map((x) => [x.id, x]));
  return {
    ...m,
    wbs: wbs.length ? m.wbs.map((n) => w.get(n.id) ?? n) : m.wbs,
    activities: activities.length ? m.activities.map((x) => a.get(x.id) ?? x) : m.activities,
  };
}

/** Gives the siblings these places, in this order. */
function placeWbs(m: ScheduleModel, order: WbsNode[]): ScheduleModel {
  return withChanged(m, renumbered(order).filter((n, i) => n !== order[i]));
}
function placeTasks(m: ScheduleModel, order: Activity[]): ScheduleModel {
  return withChanged(m, [], renumbered(order).filter((n, i) => n !== order[i]));
}

/** The picked rows, by the node or the activity holding them. */
const groupKey = (m: ScheduleModel, ref: PlanRef) => {
  if (ref.kind === 'wbs') return `w:${m.wbs.find((n) => n.id === ref.id)?.parentId ?? ''}`;
  return `t:${m.activities.find((a) => a.id === ref.id)?.wbsId ?? ''}`;
};

/** Moves the picked rows one place up or down among their siblings (WBS nodes among nodes, activities among activities). */
export function moveRows(m: ScheduleModel, refs: PlanRef[], direction: 'up' | 'down'): Result<{ moved: number }> {
  if (!refs.length) return { error: 'Pick the rows to move first.' };
  let model = m;
  let moved = 0;
  const groups = new Map<string, PlanRef[]>();
  for (const r of refs) groups.set(groupKey(m, r), [...(groups.get(groupKey(m, r)) ?? []), r]);
  for (const [key, group] of groups) {
    const picked = new Set(group.map((r) => r.id));
    const [kind, container] = [key[0], key.slice(2) || null];
    const siblings = kind === 'w' ? childrenOf(model, container).wbs : childrenOf(model, container).tasks;
    const list = [...siblings] as (WbsNode | Activity)[];
    const isPicked = (x: WbsNode | Activity) => picked.has(x.id);
    const swap = (i: number, j: number) => { [list[i], list[j]] = [list[j], list[i]]; moved++; };
    if (direction === 'up') {
      for (let i = 1; i < list.length; i++) if (isPicked(list[i]) && !isPicked(list[i - 1])) swap(i, i - 1);
    } else {
      for (let i = list.length - 2; i >= 0; i--) if (isPicked(list[i]) && !isPicked(list[i + 1])) swap(i, i + 1);
    }
    model = kind === 'w' ? placeWbs(model, list as WbsNode[]) : placeTasks(model, list as Activity[]);
  }
  return moved ? { model, moved } : { error: direction === 'up' ? 'Already at the top.' : 'Already at the bottom.' };
}

/** Moves the picked rows to the top or the bottom of their siblings. */
export function moveRowsToEnd(m: ScheduleModel, refs: PlanRef[], end: 'top' | 'bottom'): Result<{ moved: number }> {
  if (!refs.length) return { error: 'Pick the rows to move first.' };
  let model = m;
  const groups = new Map<string, PlanRef[]>();
  for (const r of refs) groups.set(groupKey(m, r), [...(groups.get(groupKey(m, r)) ?? []), r]);
  for (const [key, group] of groups) {
    const picked = new Set(group.map((r) => r.id));
    const [kind, container] = [key[0], key.slice(2) || null];
    const list = (kind === 'w' ? childrenOf(model, container).wbs : childrenOf(model, container).tasks) as (WbsNode | Activity)[];
    const mine = list.filter((x) => picked.has(x.id));
    const rest = list.filter((x) => !picked.has(x.id));
    const next = end === 'top' ? [...mine, ...rest] : [...rest, ...mine];
    model = kind === 'w' ? placeWbs(model, next as WbsNode[]) : placeTasks(model, next as Activity[]);
  }
  return model === m ? { error: end === 'top' ? 'Already at the top.' : 'Already at the bottom.' } : { model, moved: refs.length };
}

/** Repaths the activities of the nodes whose place in the tree changed. */
function repathed(m: ScheduleModel, wbs: WbsNode[]): Activity[] {
  const names = new Map<string, string>();
  const codes = new Map<string, string>();
  return m.activities.map((a) => {
    if (a.wbsId === null) return a;
    if (!names.has(a.wbsId)) {
      names.set(a.wbsId, wbsPathOf(wbs, a.wbsId));
      codes.set(a.wbsId, wbsPathOf(wbs, a.wbsId, 'code'));
    }
    const wbsPath = names.get(a.wbsId)!;
    const wbsCodePath = codes.get(a.wbsId)!;
    return a.wbsPath === wbsPath && a.wbsCodePath === wbsCodePath ? a : { ...a, wbsPath, wbsCodePath };
  });
}

const isBelow = (wbs: readonly WbsNode[], id: string, ancestor: string): boolean => {
  const byId = new Map(wbs.map((n) => [n.id, n]));
  for (let cursor: string | null = id, guard = 0; cursor && guard < 50; guard++) {
    if (cursor === ancestor) return true;
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
};

/** Puts a WBS node under `parentId` (null: at the top), at `index` among that node's child nodes (default: the end). */
function putWbs(m: ScheduleModel, id: string, parentId: string | null, index?: number): ScheduleModel {
  const node = m.wbs.find((n) => n.id === id)!;
  const moved = node.parentId === parentId ? node : { ...node, parentId };
  const others = childrenOf(m, parentId).wbs.filter((n) => n.id !== id);
  others.splice(index === undefined ? others.length : Math.min(index, others.length), 0, moved);
  const wbs = m.wbs.map((n) => (n.id === id ? moved : n));
  const step: ScheduleModel = { ...m, wbs };
  const placed = placeWbs(step, others.map((n) => (n.id === id ? moved : n)));
  return node.parentId === parentId ? placed : { ...placed, activities: repathed(placed, placed.wbs) };
}

/** Puts an activity in WBS node `wbsId`, at `index` among that node's activities (default: the end). */
function putTask(m: ScheduleModel, id: string, wbsId: string | null, index?: number): ScheduleModel {
  const a = m.activities.find((x) => x.id === id)!;
  const moved = a.wbsId === wbsId ? a : { ...a, wbsId, wbsPath: wbsPathOf(m.wbs, wbsId), wbsCodePath: wbsPathOf(m.wbs, wbsId, 'code') };
  const others = childrenOf(m, wbsId).tasks.filter((x) => x.id !== id);
  others.splice(index === undefined ? others.length : Math.min(index, others.length), 0, moved);
  const activities = m.activities.map((x) => (x.id === id ? moved : x));
  return placeTasks({ ...m, activities }, others.map((x) => (x.id === id ? moved : x)));
}

/** Indents the picked rows: a WBS node goes under the node above it, an activity into the last WBS node above it in its own
    node (the row above it, visually). */
export function indentRows(m: ScheduleModel, refs: PlanRef[]): Result<{ moved: number }> {
  if (!refs.length) return { error: 'Pick the rows to indent first.' };
  let model = m;
  let moved = 0;
  // In the order they are shown, so a picked node goes under the one above it and the next follows it.
  const rank = new Map(planRows(m).map((r, i) => [`${r.kind}:${r.id}`, i]));
  const sorted = [...refs].sort((a, b) => (rank.get(`${a.kind}:${a.id}`) ?? 0) - (rank.get(`${b.kind}:${b.id}`) ?? 0));
  for (const ref of sorted) {
    if (ref.kind === 'wbs') {
      const node = model.wbs.find((n) => n.id === ref.id);
      if (!node) continue;
      const siblings = childrenOf(model, node.parentId).wbs;
      const at = siblings.findIndex((n) => n.id === ref.id);
      const target = siblings[at - 1];
      if (!target) continue;
      model = putWbs(model, ref.id, target.id);
      moved++;
    } else {
      const a = model.activities.find((x) => x.id === ref.id);
      if (!a) continue;
      const nodes = childrenOf(model, a.wbsId).wbs;
      const target = nodes[nodes.length - 1];
      if (!target) continue;
      model = putTask(model, ref.id, target.id);
      moved++;
    }
  }
  if (!moved) return { error: 'Nothing above to indent under: a row goes under the WBS node above it.' };
  return { model, moved };
}

/** Outdents the picked rows: out of their WBS node, into its parent (a node right after the one it was in). */
export function outdentRows(m: ScheduleModel, refs: PlanRef[]): Result<{ moved: number }> {
  if (!refs.length) return { error: 'Pick the rows to outdent first.' };
  let model = m;
  let moved = 0;
  const rank = new Map(planRows(m).map((r, i) => [`${r.kind}:${r.id}`, i]));
  const sorted = [...refs].sort((a, b) => (rank.get(`${b.kind}:${b.id}`) ?? 0) - (rank.get(`${a.kind}:${a.id}`) ?? 0));
  // Each goes right after the node it leaves, so doing them from the bottom keeps their order.
  for (const ref of sorted) {
    if (ref.kind === 'wbs') {
      const node = model.wbs.find((n) => n.id === ref.id);
      const parent = node?.parentId ? model.wbs.find((n) => n.id === node.parentId) : undefined;
      if (!node || !parent) continue;
      const at = childrenOf(model, parent.parentId).wbs.findIndex((n) => n.id === parent.id);
      model = putWbs(model, ref.id, parent.parentId, at + 1);
      moved++;
    } else {
      const a = model.activities.find((x) => x.id === ref.id);
      const parent = a?.wbsId ? model.wbs.find((n) => n.id === a.wbsId) : undefined;
      if (!a || !parent || parent.parentId === null) continue;
      model = putTask(model, ref.id, parent.parentId, 0);
      moved++;
    }
  }
  if (!moved) return { error: 'Already at the top level: there is no WBS node to move out to.' };
  return { model, moved };
}

/** Puts an activity right after another one in the same WBS node (a new activity, say). */
export function placeTaskAfter(m: ScheduleModel, id: string, afterId: string): ScheduleModel {
  const a = m.activities.find((x) => x.id === id);
  const ref = m.activities.find((x) => x.id === afterId);
  if (!a || !ref || a.wbsId !== ref.wbsId) return m;
  const at = childrenOf(m, a.wbsId).tasks.filter((x) => x.id !== id).findIndex((x) => x.id === afterId);
  return putTask(m, id, a.wbsId, at + 1);
}

/** Copies of the activities (new IDs, " copy" after the name) each right after its original, with its resources and codes; not its links. */
export function duplicateActivities(m: ScheduleModel, ids: string[], nextId: (used: string[]) => string, nextCode: (codes: string[], like?: string) => string): Result<{ ids: string[] }> {
  const picked = m.activities.filter((a) => ids.includes(a.id));
  if (!picked.length) return { error: 'Pick the activities to duplicate first.' };
  let model = m;
  const made: string[] = [];
  for (const a of picked) {
    const id = nextId(model.activities.map((x) => x.id));
    const copy: Activity = { ...a, id, code: nextCode(model.activities.map((x) => x.code), a.code), name: `${a.name} copy`, seq: undefined, activityCodes: { ...a.activityCodes }, resources: a.resources.map((r) => ({ ...r })), udf: { ...a.udf } };
    model = { ...model, activities: [...model.activities, copy] };
    model = placeTaskAfter(model, id, a.id);
    made.push(id);
  }
  return { model, ids: made };
}

export { isBelow };

/** Puts a WBS node right after a sibling (same parent). */
export function placeWbsAfter(m: ScheduleModel, id: string, afterId: string): ScheduleModel {
  const n = m.wbs.find((x) => x.id === id);
  const ref = m.wbs.find((x) => x.id === afterId);
  if (!n || !ref || n.parentId !== ref.parentId) return m;
  const at = childrenOf(m, n.parentId).wbs.filter((x) => x.id !== id).findIndex((x) => x.id === afterId);
  return putWbs(m, id, n.parentId, at + 1);
}
