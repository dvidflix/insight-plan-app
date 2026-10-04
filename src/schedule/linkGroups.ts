import type { Activity, ScheduleModel } from './types';
import type { ElementSummary } from '../viewer/types';

export type CompareOp = 'equals' | 'notEquals' | 'contains' | 'notContains' | 'startsWith' | 'endsWith';
export type Conjunction = 'and' | 'or';

/** `_code`/`_name` are the activity's own code/name; anything else is looked
    up first as an activity-code type, then as a UDF label. */
export interface TaskFilterRule {
  id: string;
  attribute: string;
  op: CompareOp;
  value: string;
  conj: Conjunction;
}

/** `_category`/`_name`/`_guid`/`_file` are the element's own fields (`_file`
    being the model's file name); anything else
    is `propertySet` + `attribute` looked up in the flattened Pset/Qto props. */
export interface ObjectFilterRule {
  id: string;
  propertySet: string;
  attribute: string;
  op: CompareOp;
  value: string;
  conj: Conjunction;
  caseSensitive: boolean;
  ignore: boolean;
}

export interface MatchRule {
  id: string;
  taskField: string;
  objectPropertySet: string;
  objectAttribute: string;
  /** 'and' merges this rule into the previous one's cluster (all fields in a
      cluster must hold simultaneously for the same task/object pair); 'or'
      starts a new, independent alternative. Ignored on the first rule. */
  conj: Conjunction;
}

export interface LinkGroup {
  id: string;
  name: string;
  color: string;
  taskFilters: TaskFilterRule[];
  objectFilters: ObjectFilterRule[];
  matchRules: MatchRule[];
  /** Appearance Profile (see appearance.ts) driving this group's 4D playback
      colors/opacity; null means fall back to the default pending/in-progress/
      done look. */
  appearanceProfileId: string | null;
  /** Tag (see tagsStore) whose label shows on the viewer while any task of
      this group is active. */
  tagId?: string | null;
  /** Hidden from the 3D view (the eye in the Link Groups table): its objects
      stay hidden whatever the timeline says, unless another group shows them. */
  hidden?: boolean;
}

const OBJECT_BUILTIN_KEYS = new Set(['_category', '_name', '_guid', '_file']);

/** Display label for an object field key in the filter/match dropdowns. */
export function objectFieldLabel(key: string): string {
  if (key === '_category') return 'IFC class';
  if (key === '_name') return 'Name';
  if (key === '_guid') return 'GUID';
  if (key === '_file') return 'File name';
  return key;
}

export function newId(): string {
  return crypto.randomUUID();
}

export function taskFieldOptions(model: ScheduleModel): { value: string; label: string }[] {
  const udfLabels = new Set<string>();
  for (const a of model.activities) for (const k of Object.keys(a.udf)) udfLabels.add(k);
  return [
    { value: '_code', label: 'Activity ID' },
    { value: '_name', label: 'Activity Name' },
    ...model.activityCodeTypes.map((c) => ({ value: c, label: c })),
    ...[...udfLabels].map((u) => ({ value: u, label: `UDF: ${u}` })),
  ];
}

export function emptyGroup(name = 'New Group'): LinkGroup {
  return { id: newId(), name, color: '#7c5cff', taskFilters: [], objectFilters: [], matchRules: [], appearanceProfileId: null };
}

export function taskFieldValue(a: Activity, field: string): string {
  if (field === '_code') return a.code;
  if (field === '_name') return a.name;
  if (field in a.activityCodes) return a.activityCodes[field];
  if (field in a.udf) {
    const v = a.udf[field];
    return v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '');
  }
  return '';
}

export function objectFieldKey(propertySet: string, attribute: string): string {
  return OBJECT_BUILTIN_KEYS.has(propertySet) ? propertySet : `${propertySet}.${attribute}`;
}

export function parseObjectFieldKey(key: string): { propertySet: string; attribute: string } {
  if (OBJECT_BUILTIN_KEYS.has(key)) return { propertySet: key, attribute: '' };
  const idx = key.indexOf('.');
  if (idx === -1) return { propertySet: key, attribute: '' };
  return { propertySet: key.slice(0, idx), attribute: key.slice(idx + 1) };
}

export function objectFieldValue(el: ElementSummary, propertySet: string, attribute: string): string {
  if (propertySet === '_category') return el.category;
  if (propertySet === '_name') return el.name;
  if (propertySet === '_guid') return el.guid;
  if (propertySet === '_file') return el.fileName;
  return String(el.props[`${propertySet}.${attribute}`] ?? '');
}

function evalOp(actual: string, expected: string, op: CompareOp, caseSensitive = false): boolean {
  const a = caseSensitive ? actual : actual.toLowerCase();
  const b = caseSensitive ? expected : expected.toLowerCase();
  switch (op) {
    case 'notEquals':
      return a !== b;
    case 'contains':
      return a.includes(b);
    case 'notContains':
      return !a.includes(b);
    case 'startsWith':
      return a.startsWith(b);
    case 'endsWith':
      return a.endsWith(b);
    case 'equals':
    default:
      return a === b;
  }
}

function evalChain<T extends { conj: Conjunction }>(rules: T[], test: (rule: T) => boolean): boolean {
  if (rules.length === 0) return true;
  let result = test(rules[0]);
  for (let i = 1; i < rules.length; i++) {
    const m = test(rules[i]);
    result = rules[i].conj === 'or' ? result || m : result && m;
  }
  return result;
}

function matchesTaskFilters(a: Activity, rules: TaskFilterRule[]): boolean {
  const active = rules.filter((r) => r.value !== '');
  return evalChain(active, (r) => evalOp(taskFieldValue(a, r.attribute), r.value, r.op));
}

function matchesObjectFilters(el: ElementSummary, rules: ObjectFilterRule[]): boolean {
  const active = rules.filter((r) => !r.ignore && r.value !== '');
  return evalChain(active, (r) => evalOp(objectFieldValue(el, r.propertySet, r.attribute), r.value, r.op, r.caseSensitive));
}

/** Groups consecutive matchRules into clusters: an 'and' rule joins the
    previous cluster (all its fields must hold for the same task/object pair
    at once, i.e. a composite-key join); an 'or' rule (or the first rule)
    starts a new independent cluster. A pair links if ANY cluster matches. */
function clusterMatchRules(rules: MatchRule[]): MatchRule[][] {
  const clusters: MatchRule[][] = [];
  for (const r of rules) {
    if (r.conj === 'and' && clusters.length > 0) clusters[clusters.length - 1].push(r);
    else clusters.push([r]);
  }
  return clusters;
}

export interface GroupLinkResult {
  groupId: string;
  taskIds: Set<string>;
  elementIds: Set<number>;
  taskToElements: Map<string, number[]>;
}

/** Evaluates one Group: filters tasks and objects independently, then pairs
    them via the explicit matching-criteria rules (task field value equals
    an object property value) — mirrors the Filter Tasks / Filter Objects /
    Matching criteria structure of Navisworks-style search-set tools. When a
    group has no matching-criteria rules, it's treated as a plain "select
    these tasks and these objects" group with no 1:1 pairing. */
export function computeGroupLinks(model: ScheduleModel, elements: ElementSummary[], group: LinkGroup): GroupLinkResult {
  const candidateTasks = model.activities.filter((a) => matchesTaskFilters(a, group.taskFilters));
  const candidateObjects = elements.filter((el) => matchesObjectFilters(el, group.objectFilters));

  const taskIds = new Set<string>();
  const elementIds = new Set<number>();
  const taskToElements = new Map<string, number[]>();

  if (group.matchRules.length === 0) {
    for (const a of candidateTasks) taskIds.add(a.id);
    for (const el of candidateObjects) elementIds.add(el.localId);
    return { groupId: group.id, taskIds, elementIds, taskToElements };
  }

  for (const cluster of clusterMatchRules(group.matchRules)) {
    const index = new Map<string, number[]>();
    for (const el of candidateObjects) {
      const parts = cluster.map((rule) => objectFieldValue(el, rule.objectPropertySet, rule.objectAttribute).trim().toLowerCase());
      if (parts.some((p) => !p)) continue;
      const key = parts.join('');
      (index.get(key) ?? index.set(key, []).get(key)!).push(el.localId);
    }
    for (const task of candidateTasks) {
      const parts = cluster.map((rule) => taskFieldValue(task, rule.taskField).trim().toLowerCase());
      if (parts.some((p) => !p)) continue;
      const key = parts.join('');
      const ids = index.get(key);
      if (!ids || ids.length === 0) continue;
      taskIds.add(task.id);
      const existing = taskToElements.get(task.id) ?? [];
      taskToElements.set(task.id, [...new Set([...existing, ...ids])]);
      for (const id of ids) elementIds.add(id);
    }
  }

  return { groupId: group.id, taskIds, elementIds, taskToElements };
}

/** Merges every group's task->element links into one map, for driving the
    4D timeline the same way a single Quick Match link would. */
export function mergeGroupLinks(results: GroupLinkResult[]): Map<string, number[]> {
  const merged = new Map<string, number[]>();
  for (const r of results) {
    for (const [taskId, ids] of r.taskToElements) {
      const existing = merged.get(taskId) ?? [];
      merged.set(taskId, [...new Set([...existing, ...ids])]);
    }
  }
  return merged;
}

export interface MatchExportRow {
  group: string;
  activityId: string;
  activityName: string;
  elementGuid: string;
  elementName: string;
  elementCategory: string;
  /** e.g. "Activity ID = Type.Mark ('A1000')" for every rule that actually
      fired for this specific pair — a task/element can be linked by more
      than one rule in the same group. */
  matchedOn: string;
}

/** One row per matched task/object pair, across every group, for handing to
    the export button — includes which field(s) actually drove each match,
    not just that a match happened. */
export function buildMatchExportRows(model: ScheduleModel, elements: ElementSummary[], groups: LinkGroup[]): MatchExportRow[] {
  const activityById = new Map(model.activities.map((a) => [a.id, a]));
  const elementByLocalId = new Map(elements.map((el) => [el.localId, el]));
  const taskFieldLabels = new Map(taskFieldOptions(model).map((o) => [o.value, o.label]));
  const rows: MatchExportRow[] = [];

  for (const group of groups) {
    if (group.matchRules.length === 0) continue;
    const { taskToElements } = computeGroupLinks(model, elements, group);
    for (const [taskId, elementIds] of taskToElements) {
      const task = activityById.get(taskId);
      if (!task) continue;
      for (const elementId of elementIds) {
        const el = elementByLocalId.get(elementId);
        if (!el) continue;
        const clusters = clusterMatchRules(group.matchRules);
        const matchedClusters = clusters.filter((cluster) =>
          cluster.every((rule) => {
            const taskVal = taskFieldValue(task, rule.taskField).trim().toLowerCase();
            const objVal = objectFieldValue(el, rule.objectPropertySet, rule.objectAttribute).trim().toLowerCase();
            return taskVal !== '' && taskVal === objVal;
          }),
        );
        const matchedOn = matchedClusters
          .map((cluster) =>
            cluster
              .map((rule) => {
                const taskLabel = taskFieldLabels.get(rule.taskField) ?? rule.taskField;
                const objKey = objectFieldKey(rule.objectPropertySet, rule.objectAttribute);
                return `${taskLabel} = ${objKey} ('${taskFieldValue(task, rule.taskField)}')`;
              })
              .join(' AND '),
          )
          .join('; ');
        rows.push({
          group: group.name,
          activityId: task.code,
          activityName: task.name,
          elementGuid: el.guid,
          elementName: el.name,
          elementCategory: el.category,
          matchedOn,
        });
      }
    }
  }
  return rows;
}
