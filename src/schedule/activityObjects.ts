import type { Activity, ScheduleModel } from './types';
import type { ElementSummary } from '../viewer/types';
import { computeGroupLinks, getObjectJoins, taskFieldValue, type LinkGroup, type ObjectJoinLink } from './linkGroups';
import type { ObjectsByModel } from './activityRelation';

/** The activity code type or UDF that holds the element ID (e.g. "CWA-Element ID"), if the schedule has one. */
export function elementIdField(model: ScheduleModel): string | null {
  const isElementId = (k: string) => /element[\s_-]*id/i.test(k);
  const code = model.activityCodeTypes.find(isElementId);
  if (code) return code;
  for (const a of model.activities) {
    const udf = Object.keys(a.udf).find(isElementId);
    if (udf) return udf;
  }
  return null;
}

export interface ActivityObjects {
  /** Each activity's objects: its own (Link Groups), else those of the activities with the same Element ID. */
  objectsOf: Map<string, ObjectsByModel>;
  /** Who owns each object directly: "modelId:localId" -> activity ids. */
  ownersOf: Map<string, string[]>;
  /** The activity's Element ID, '' when it has none. */
  elementOf: (a: Activity) => string;
  /** The pour type of the activity's objects (CWA Pour > Pour Type, e.g. "MAIN_SLAB", "WALL"), '' when unknown. */
  pourTypeOf: (activityId: string) => string;
  /** The level of the activity's objects (CWA Pour > Level, e.g. "L3"), '' when unknown. */
  levelOf: (activityId: string) => string;
}

/** Pour types of slabs, the elements that get generated links. */
export const SLAB_TYPES = new Set(['SLAB', 'MAIN_SLAB']);
export const isWallType = (type: string) => type.includes('WALL');

const normaliseType = (v: unknown) => String(v ?? '').trim().replace(/ /g, '_').toUpperCase();

/** The last result, kept while its inputs are the same objects, so the panes showing it share one run. */
let last: { model: ScheduleModel; models: unknown; groups: LinkGroup[]; joins: ObjectJoinLink[]; result: ActivityObjects } | null = null;
export function sharedActivityObjects(model: ScheduleModel, loadedModels: { modelId: string; elements: ElementSummary[] }[], groups: LinkGroup[]): ActivityObjects {
  if (last && last.model === model && last.models === loadedModels && last.groups === groups && last.joins === getObjectJoins()) return last.result;
  const result = buildActivityObjects(model, loadedModels, groups);
  last = { model, models: loadedModels, groups, joins: getObjectJoins(), result };
  return result;
}

export function buildActivityObjects(model: ScheduleModel, loadedModels: { modelId: string; elements: ElementSummary[] }[], groups: LinkGroup[]): ActivityObjects {
  const objectsOf = new Map<string, ObjectsByModel>();
  for (const m of loadedModels) {
    for (const g of groups) {
      for (const [taskId, ids] of computeGroupLinks(model, m.elements, g).taskToElements) {
        const byModel = objectsOf.get(taskId) ?? objectsOf.set(taskId, new Map()).get(taskId)!;
        const set = byModel.get(m.modelId) ?? byModel.set(m.modelId, new Set()).get(m.modelId)!;
        for (const id of ids) set.add(id);
      }
    }
  }
  // Who owns each object directly (before sharing), to find the activities next to one's objects.
  const ownersOf = new Map<string, string[]>();
  for (const [taskId, byModel] of objectsOf) {
    for (const [modelId, ids] of byModel) {
      for (const id of ids) (ownersOf.get(`${modelId}:${id}`) ?? ownersOf.set(`${modelId}:${id}`, []).get(`${modelId}:${id}`)!).push(taskId);
    }
  }
  // Activities with no objects of their own (Decking, Rebar, FWK...) share the objects of the
  // activities that have the same Element ID (e.g. the Concrete one the model is linked to).
  const field = elementIdField(model);
  const elementOf = (a: Activity) => (field ? taskFieldValue(a, field).trim().toLowerCase() : '');
  const byElement = new Map<string, ObjectsByModel[]>();
  for (const a of model.activities) {
    const objs = objectsOf.get(a.id);
    const key = elementOf(a);
    if (objs && key) (byElement.get(key) ?? byElement.set(key, []).get(key)!).push(objs);
  }
  for (const a of model.activities) {
    if (objectsOf.has(a.id)) continue;
    const shared = byElement.get(elementOf(a));
    if (!shared) continue;
    const merged: ObjectsByModel = new Map();
    for (const objs of shared) for (const [modelId, ids] of objs) {
      const set = merged.get(modelId) ?? merged.set(modelId, new Set()).get(modelId)!;
      for (const id of ids) set.add(id);
    }
    objectsOf.set(a.id, merged);
  }
  // Pour type of each activity, read from the first of its objects that has one.
  const elementByKey = new Map<string, ElementSummary>();
  for (const m of loadedModels) for (const el of m.elements) elementByKey.set(`${m.modelId}:${el.localId}`, el);
  /** A value read from the first of the activity's objects that has one (cached). */
  const reader = (read: (props: Record<string, unknown>) => string) => {
    const cache = new Map<string, string>();
    return (activityId: string) => {
      const hit = cache.get(activityId);
      if (hit !== undefined) return hit;
      let value = '';
      outer: for (const [modelId, ids] of objectsOf.get(activityId) ?? []) {
        for (const id of ids) {
          value = read(elementByKey.get(`${modelId}:${id}`)?.props ?? {});
          if (value) break outer;
        }
      }
      cache.set(activityId, value);
      return value;
    };
  };
  const pourTypeOf = reader((p) => normaliseType(p['CWA Pour.Pour Type'] || p['CWA Pour.General Pour Type']));
  const levelOf = reader((p) => String(p['CWA Pour.Level'] ?? '').trim().toUpperCase());
  return { objectsOf, ownersOf, elementOf, pourTypeOf, levelOf };
}
