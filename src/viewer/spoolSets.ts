import type { ModelIndex } from './ViewerEngine';
import { NO_VALUE, elementValue } from './bimTables';
import { itemsOf, type SearchSet } from './searchSets';

/** "Spool" sets: one set per distinct value of a property (or per combination of the values of several), made in one go, and sorted
    into folders by splitting the value (for a name like 6-CHWR-6500-CSC-001 split on "-": part 2 is the system, part 3 the area). */

export interface SpoolOptions {
  /** The properties; one set per combination of their values (the first is the one the name is split on). */
  fields: string[];
  /** The folder the sets go in (the top of their folder path). */
  folder: string;
  /** Search sets (conditions that find the value again) or selection sets (the objects, fixed). */
  output: 'search' | 'selection';
  /** Only the objects of this selection (per model id) are looked at; absent: every object. */
  restrictTo?: Record<string, number[]>;
  /** Split the first value into folders: the part at `primary` (1 = first) is a folder, then the part at `secondary` a folder in it. */
  split?: { delimiter: string; primary?: number; secondary?: number };
}

export const MAX_SPOOL_SETS = 2000;
/** Folders are one level: a path is written "Top / Next / Last". */
export const FOLDER_SEP = ' / ';

const part = (value: string, delimiter: string, index: number | undefined): string => {
  if (!index || index < 1 || !delimiter) return '';
  return (value.split(delimiter)[index - 1] ?? '').trim();
};

/** The folder path of a set made from `value` (the folder, then the parts the split picks out). */
export function spoolPath(folder: string, value: string, split: SpoolOptions['split']): string {
  const levels = [folder.trim()];
  if (split) {
    for (const index of [split.primary, split.secondary]) {
      const p = part(value, split.delimiter, index);
      if (p) levels.push(p);
    }
  }
  return levels.filter(Boolean).join(FOLDER_SEP);
}

export interface SpoolResult {
  sets: SearchSet[];
  /** Objects the sets cover. */
  objects: number;
  /** Combinations left out because they have no value in one of the properties. */
  empty: number;
  /** True when more than MAX_SPOOL_SETS would have been made (the rest are not). */
  truncated: boolean;
}

export function buildSpoolSets(indexes: ReadonlyMap<string, ModelIndex>, opts: SpoolOptions, newId: () => string = () => crypto.randomUUID()): SpoolResult {
  const { fields } = opts;
  const out: SpoolResult = { sets: [], objects: 0, empty: 0, truncated: false };
  if (!fields.length) return out;
  const only = opts.restrictTo ? new Map(Object.entries(opts.restrictTo).map(([m, ids]) => [m, new Set(ids)])) : null;
  // value combination -> its objects, per model
  const combos = new Map<string, { values: string[]; ids: Record<string, number[]> }>();
  for (const [modelId, index] of indexes) {
    const allowed = only ? only.get(modelId) : undefined;
    if (only && !allowed) continue;
    for (const [id, e] of index.elements) {
      if (allowed && !allowed.has(id)) continue;
      const values = fields.map((f) => elementValue(e, f).trim());
      if (values.some((v) => v === '' || v === NO_VALUE)) { out.empty++; continue; }
      const key = values.join('\u0001');
      let c = combos.get(key);
      if (!c) combos.set(key, (c = { values, ids: {} }));
      (c.ids[modelId] ??= []).push(id);
    }
  }
  const ordered = [...combos.values()].sort((a, b) => a.values.join(' ').localeCompare(b.values.join(' '), undefined, { numeric: true }));
  for (const c of ordered) {
    if (out.sets.length >= MAX_SPOOL_SETS) { out.truncated = true; break; }
    const name = c.values.join(' - ');
    const group = spoolPath(opts.folder, c.values[0], opts.split);
    const count = Object.values(c.ids).reduce((n, l) => n + l.length, 0);
    out.objects += count;
    out.sets.push(opts.output === 'selection'
      ? { id: newId(), name, group, kind: 'selection', match: 'all', conditions: [], items: itemsOf(indexes, c.ids) }
      : { id: newId(), name, group, kind: 'search', match: 'all', conditions: fields.map((field, i) => ({ id: newId(), field, op: 'equals' as const, value: c.values[i] })) });
  }
  return out;
}

/** The sets of a folder and of the folders inside it ("Top" and "Top / Next"). */
export const inFolderTree = (group: string, folder: string) => group === folder || group.startsWith(folder + FOLDER_SEP);
