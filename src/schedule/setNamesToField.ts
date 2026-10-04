/** Copies search-set names onto tasks: a task gets the name of every search
    set that holds the objects it is linked to, written to a task field
    (a user-defined field, "CWA-Methods Break Down" by default). */

export const DEFAULT_METHODS_FIELD = 'CWA-Methods Break Down';

/** How much of a task's linked objects a set must hold to count: any of them, most of them (over half) or all of them. */
export type SetMatch = 'any' | 'most' | 'all';

export const SET_MATCH_OPTIONS: { value: SetMatch; label: string }[] = [
  { value: 'most', label: 'Most of the task’s objects' },
  { value: 'any', label: 'Any of the task’s objects' },
  { value: 'all', label: 'All of the task’s objects' },
];

export interface NamedSet {
  name: string;
  /** The set's objects, per model id. */
  ids: Record<string, number[]>;
}

export interface SetNamePlan {
  /** Task id (of the merged programme) -> the text to write. */
  values: Map<string, string>;
  /** Tasks with at least one linked object. */
  linkedTasks: number;
  /** Tasks that more than one set matched (their names are joined). */
  joined: number;
}

/** `taskToElements`: per model id, each task's linked object ids. */
export function planSetNames(
  taskToElements: Map<string, Map<string, number[]>>,
  sets: NamedSet[],
  match: SetMatch,
  separator = '; ',
): SetNamePlan {
  // Each set as per-model id lookups, built once.
  const lookups = sets.map((s) => ({ name: s.name, byModel: new Map(Object.entries(s.ids).map(([m, ids]) => [m, new Set(ids)])) }));
  const taskIds = new Set<string>();
  for (const tasks of taskToElements.values()) for (const id of tasks.keys()) taskIds.add(id);

  const values = new Map<string, string>();
  let linkedTasks = 0;
  let joined = 0;
  for (const taskId of taskIds) {
    let total = 0;
    for (const tasks of taskToElements.values()) total += tasks.get(taskId)?.length ?? 0;
    if (total === 0) continue;
    linkedTasks++;
    const names: string[] = [];
    for (const set of lookups) {
      let inside = 0;
      for (const [modelId, tasks] of taskToElements) {
        const members = set.byModel.get(modelId);
        if (!members) continue;
        for (const id of tasks.get(taskId) ?? []) if (members.has(id)) inside++;
      }
      const share = inside / total;
      const ok = match === 'any' ? inside > 0 : match === 'all' ? inside === total : share > 0.5;
      if (ok && !names.includes(set.name)) names.push(set.name);
    }
    if (names.length === 0) continue;
    if (names.length > 1) joined++;
    values.set(taskId, names.join(separator));
  }
  return { values, linkedTasks, joined };
}
