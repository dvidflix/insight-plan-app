import type { ScheduleModel } from './types';
import type { ElementSummary } from '../viewer/types';
import { parseObjectFieldKey, taskFieldOptions, taskFieldValue, objectFieldLabel, type MatchRule } from './linkGroups';
import type { ObjectsByModel } from './activityRelation';

/** Suggested matches for the tasks and objects that no Link Group links yet. A Link Group links a task to an object when a task field and an object
    property hold the same value (after trimming and lower-casing, as computeGroupLinks does). So a suggestion is a match rule: the pair of fields that,
    among the unlinked tasks and objects, would link the most. It is scored by the share of the unlinked tasks it would link, and accepting it adds an
    ordinary Link Group with that one match rule. Nothing here knows what the fields are called. */

export type Confidence = 'high' | 'medium' | 'low';

export interface LoadedObjects { modelId: string; elements: ElementSummary[] }

export interface Unlinked {
  /** Activity ids of the tasks no group gives an object to. */
  tasks: string[];
  /** Objects no group links: "modelId:localId". */
  objects: Set<string>;
  totalTasks: number;
  totalObjects: number;
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
const objectKey = (modelId: string, localId: number) => `${modelId}:${localId}`;

/** Which tasks and objects have no link now. `objectsOf` is each activity's objects (activityObjects.ts), `owned` the objects some group links. */
export function unlinked(model: ScheduleModel, models: readonly LoadedObjects[], objectsOf: ReadonlyMap<string, ObjectsByModel>, owned: ReadonlySet<string>): Unlinked {
  const tasks = model.activities.filter((a) => a.type === 'task' || a.type === 'loe');
  const none = tasks.filter((a) => {
    const objs = objectsOf.get(a.id);
    if (!objs) return true;
    for (const ids of objs.values()) if (ids.size > 0) return false;
    return true;
  }).map((a) => a.id);
  const objects = new Set<string>();
  let totalObjects = 0;
  for (const m of models) for (const e of m.elements) { totalObjects++; if (!owned.has(objectKey(m.modelId, e.localId))) objects.add(objectKey(m.modelId, e.localId)); }
  return { tasks: none, objects, totalTasks: tasks.length, totalObjects };
}

export interface Suggestion {
  id: string;
  rule: Omit<MatchRule, 'id'>;
  /** The task field's and the object property's names, for the row. */
  taskLabel: string;
  objectLabel: string;
  /** Unlinked tasks the rule would link, and the unlinked objects it would link them to. */
  tasks: number;
  objects: number;
  /** The share of the unlinked tasks it links, 0 to 1. */
  coverage: number;
  confidence: Confidence;
  /** An example value both sides hold. */
  example: string;
  /** The objects it would link, to show them in 3D. */
  objectKeys: string[];
  taskIds: string[];
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: 'High', medium: 'Medium', low: 'Low' };
export const confidenceOf = (coverage: number): Confidence => (coverage >= 0.6 ? 'high' : coverage >= 0.25 ? 'medium' : 'low');

const MAX_SUGGESTIONS = 12;
/** Fields with a different value on nearly every object say nothing about a group (an id each), and those with one value for all say nothing either. */
const MAX_VALUES = 200_000;

/** The best match rules for what is unlinked now, most useful first. */
export function suggestMatches(model: ScheduleModel, models: readonly LoadedObjects[], gaps: Unlinked): Suggestion[] {
  if (gaps.tasks.length === 0 || gaps.objects.size === 0) return [];
  const taskById = new Map(model.activities.map((a) => [a.id, a]));
  const tasks = gaps.tasks.map((id) => taskById.get(id)!).filter(Boolean);

  // The object side: for every property, value -> the unlinked objects that hold it (one pass over the objects).
  const byField = new Map<string, Map<string, string[]>>();
  const add = (field: string, value: unknown, key: string) => {
    const v = norm(value);
    if (!v) return;
    let m = byField.get(field);
    if (!m) byField.set(field, (m = new Map()));
    const list = m.get(v);
    if (list) list.push(key); else m.set(v, [key]);
  };
  for (const m of models) {
    for (const e of m.elements) {
      const key = objectKey(m.modelId, e.localId);
      if (!gaps.objects.has(key)) continue;
      add('_name', e.name, key);
      add('_guid', e.guid, key);
      for (const [k, v] of Object.entries(e.props)) if (typeof v === 'string' || typeof v === 'number') add(k, v, key);
    }
  }

  const out: Suggestion[] = [];
  for (const field of taskFieldOptions(model)) {
    // The task side: value -> the unlinked tasks that hold it.
    const byValue = new Map<string, string[]>();
    for (const a of tasks) {
      const v = norm(taskFieldValue(a, field.value));
      if (!v) continue;
      const list = byValue.get(v);
      if (list) list.push(a.id); else byValue.set(v, [a.id]);
    }
    if (byValue.size === 0) continue;
    for (const [objField, values] of byField) {
      if (values.size > MAX_VALUES) continue;
      let taskIds: string[] = [];
      const objectKeys: string[] = [];
      let example = '';
      for (const [v, ids] of byValue) {
        const objs = values.get(v);
        if (!objs) continue;
        if (!example) example = v;
        taskIds = taskIds.concat(ids);
        for (const k of objs) objectKeys.push(k);
      }
      if (taskIds.length === 0) continue;
      const coverage = taskIds.length / tasks.length;
      const { propertySet, attribute } = parseObjectFieldKey(objField);
      out.push({
        id: `${field.value}\u0001${objField}`,
        rule: { taskField: field.value, objectPropertySet: propertySet, objectAttribute: attribute, conj: 'and' },
        taskLabel: field.label, objectLabel: objectFieldLabel(objField),
        tasks: taskIds.length, objects: objectKeys.length, coverage, confidence: confidenceOf(coverage), example, objectKeys, taskIds,
      });
    }
  }
  // Most of the unlinked tasks first; among equals, the rule that reaches fewer objects per task (a tighter match) and a name that is not the Name.
  return out.sort((a, b) => b.coverage - a.coverage || a.objects / a.tasks - b.objects / b.tasks || a.id.localeCompare(b.id)).slice(0, MAX_SUGGESTIONS);
}

/** A Link Group that links by one suggested rule (the suggestion's fields, no filters: it links wherever the two values are equal). */
export const groupNameOf = (s: Pick<Suggestion, 'taskLabel' | 'objectLabel'>) => `Suggested: ${s.taskLabel} = ${s.objectLabel}`;
