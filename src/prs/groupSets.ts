import type { GroupFilter, RuleGroup } from './rules';
import type { SearchCondition, SearchOp, SearchSet } from '../viewer/searchSets';

/** A rule group as a search set (the "Recipes sets" folder of Models > Search sets). A group tests the pour table's columns (Building, Level,
    Pour Type ...), which are the model's "CWA Pour" properties, so each condition becomes a condition on that property. What a search set
    cannot say is reported, not dropped silently: the derived fields (family, level number, external, double height, general type), the
    objects a group names one by one (`include`), and a mix of "and" / "or" between conditions. */

export const RECIPE_SETS_FOLDER = 'Recipes sets';
const PSET = 'CWA Pour';

/** The pour table's column behind each field of a group condition. */
const COLUMN: Record<string, string> = {
  building: 'Building',
  level: 'Level',
  type: 'Pour Type',
  stage: 'Concrete Stage',
  zone: 'Building Zone',
  volume: 'Pour Volume m3',
};

const NUMERIC: Partial<Record<GroupFilter['op'], SearchOp>> = { lessThan: 'lt', atMost: 'lte', greaterThan: 'gt', atLeast: 'gte' };
const TEXT: Partial<Record<GroupFilter['op'], SearchOp>> = { contains: 'contains', notContains: 'notContains', startsWith: 'startsWith', endsWith: 'endsWith' };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A pour type is written MAIN_SLAB in the rules and may read "Main Slab" in the model: a space and an underscore are the same. */
const flexible = (s: string) => escape(s.trim()).replace(/[ _]/g, '[ _]');

/** A "family" (wall, slab ...) is worked out by the generator from the pour type and the concrete stage; as conditions on those two columns it is
    close, not identical, so a group that uses one is marked approximate and a set never replaces it. */
const FAMILY: Record<string, { type: [SearchOp, string] | null; stage: 'precast' | 'not-precast' }> = {
  wall: { type: ['contains', 'WALL'], stage: 'not-precast' },
  raft: { type: ['regex', '^(RAFT)$'], stage: 'not-precast' },
  slab: { type: ['regex', '(SLAB|PIT|FLOOR)'], stage: 'not-precast' },
  landing: { type: ['contains', 'LANDING'], stage: 'not-precast' },
  stair: { type: ['contains', 'STAIR'], stage: 'not-precast' },
  pedestal: { type: ['contains', 'PEDESTAL'], stage: 'not-precast' },
  column: { type: ['contains', 'COLUMN'], stage: 'not-precast' },
  beam: { type: ['contains', 'BEAM'], stage: 'not-precast' },
  precast: { type: ['notEquals', 'HEAVY_PRECAST'], stage: 'precast' },
  heavyPrecast: { type: ['regex', '^(HEAVY[ _]PRECAST)$'], stage: 'not-precast' },
};

interface Converted {
  conditions?: SearchCondition[];
  lost?: string;
  approx?: string;
}

function toConditions(f: GroupFilter, newId: () => string): Converted {
  if (f.field === 'family') {
    const fam = FAMILY[f.value.trim()];
    if (f.op !== 'equals' || !fam) return { lost: `${f.field} ${f.op} ${f.value}` };
    const conditions: SearchCondition[] = [];
    if (fam.type) conditions.push({ id: newId(), field: `${PSET}.Pour Type`, op: fam.type[0], value: fam.type[1] });
    conditions.push({ id: newId(), field: `${PSET}.Concrete Stage`, op: fam.stage === 'precast' ? 'equals' : 'notEquals', value: 'PRECAST' });
    return { conditions, approx: `${f.value} is read from the pour type and the concrete stage` };
  }
  const field = f.field.startsWith('prop:') ? f.field.slice(5).split('/').slice(1).join('/') : COLUMN[f.field];
  if (!field) return { lost: `${f.field} ${f.op} ${f.value}` };
  const base = { id: newId(), field: `${PSET}.${field}` };
  const numeric = NUMERIC[f.op];
  if (numeric) return { conditions: [{ ...base, op: numeric, value: f.value }] };
  const text = TEXT[f.op];
  if (text) return { conditions: [{ ...base, op: text, value: f.value }] };
  // Equals / not equals: "BOSS|SCREED" lists alternatives.
  const alts = f.value.split('|').map(flexible).filter(Boolean);
  if (!alts.length) return { conditions: [{ ...base, op: f.op === 'equals' ? 'notSet' : 'set', value: '' }] };
  const any = alts.join('|');
  return { conditions: [{ ...base, op: 'regex', value: f.op === 'equals' ? `^(${any})$` : `^(?!(${any})$)` }] };
}

export interface GroupSetResult {
  set: SearchSet;
  /** What the set could not take over from the group. */
  notes: string[];
  /** What the set only approximates (a family read from type and stage, a group made per level). */
  approx: string[];
}

export function groupToSearchSet(group: RuleGroup, newId: () => string = () => crypto.randomUUID()): GroupSetResult {
  const notes: string[] = [];
  const approx: string[] = [];
  const conditions: SearchCondition[] = [];
  const used = group.filters.filter((f) => !f.ignore);
  for (const f of used) {
    const r = toConditions(f, newId);
    if (r.conditions) conditions.push(...r.conditions);
    else notes.push(`condition not converted: ${r.lost}`);
    if (r.approx && !approx.includes(r.approx)) approx.push(r.approx);
  }
  const conj = new Set(used.slice(1).map((f) => f.conj));
  if (conj.size > 1) notes.push('the conditions mix "and" and "or": the set takes them all as "and"');
  if (group.include?.length) notes.push(`${group.include.length} object${group.include.length === 1 ? '' : 's'} named one by one are not in the set`);
  if (group.forEach.length) approx.push(`the group is made per ${group.forEach.join(' and ')}: the set holds all of them`);
  return {
    set: { id: newId(), name: group.id, group: RECIPE_SETS_FOLDER, kind: 'search', match: conj.size === 1 && conj.has('or') ? 'any' : 'all', conditions },
    notes,
    approx,
  };
}

/** Whether the set says exactly what the group says (so the set may stand in for the group). */
export function isExact(group: RuleGroup): boolean {
  const r = groupToSearchSet(group, () => 'x');
  return r.notes.length === 0 && r.approx.length === 0 && r.set.conditions.length > 0 && groupFromSet(r.set).lost.length === 0;
}

/** (A set is named by its group's ID: a recipe names its group by ID, and the Recipes panel finds the recipe of a set by that name.)
    The sets for the groups the recipes name (a recipe with no group applies to every object: no set). A set already in the folder with the
    same name is replaced by the new one, keeping its id. */
export function recipeGroupSets(groups: RuleGroup[], recipeGroups: string[], existing: SearchSet[]): { sets: SearchSet[]; notes: { name: string; notes: string[] }[]; missing: string[] } {
  const wanted = [...new Set(recipeGroups.map((g) => g.trim()).filter(Boolean))];
  const sets: SearchSet[] = [];
  const notes: { name: string; notes: string[] }[] = [];
  const missing: string[] = [];
  for (const id of wanted) {
    const group = groups.find((g) => g.id.trim().toUpperCase() === id.toUpperCase());
    if (!group) {
      missing.push(id);
      continue;
    }
    const r = groupToSearchSet(group);
    const old = existing.find((s) => s.group === RECIPE_SETS_FOLDER && s.name === r.set.name);
    sets.push(old ? { ...r.set, id: old.id } : r.set);
    if (r.notes.length || r.approx.length) notes.push({ name: r.set.name, notes: [...r.notes, ...r.approx] });
  }
  return { sets, notes, missing };
}

/* ---- The other way: a set of the "Recipes sets" folder as the rule group the generator tests. The sets are the groups. ---- */

const FIELD_OF_COLUMN: Record<string, string> = Object.fromEntries(Object.entries(COLUMN).map(([field, column]) => [column, field]));
const BACK_NUMERIC: Partial<Record<SearchOp, GroupFilter['op']>> = { lt: 'lessThan', lte: 'atMost', gt: 'greaterThan', gte: 'atLeast' };
const BACK_TEXT: Partial<Record<SearchOp, GroupFilter['op']>> = { contains: 'contains', notContains: 'notContains', startsWith: 'startsWith', endsWith: 'endsWith' };

/** "[ _]" in a pattern this file wrote is a space or an underscore: the rules write MAIN_SLAB for both. */
const unflex = (s: string) => s.replace(/\[ _\]/g, '_').replace(/\\([.*+?^${}()|[\]\\])/g, '$1');

/** A set's conditions as group conditions; what a group cannot test is listed in `lost`. A selection set (fixed objects) has no conditions. */
export function groupFromSet(set: SearchSet, newId: () => string = () => crypto.randomUUID()): { group: RuleGroup; lost: string[] } {
  const filters: GroupFilter[] = [];
  const lost: string[] = [];
  const conj = set.match === 'any' ? 'or' : 'and';
  const add = (field: string, op: GroupFilter['op'], value: string) => filters.push({ id: newId(), field, op, value, conj });
  for (const c of set.conditions) {
    const m = /^CWA Pour\.(.+)$/.exec(c.field);
    if (!m) { lost.push(`${c.field} ${c.op}`); continue; }
    const field = FIELD_OF_COLUMN[m[1]] ?? `prop:CWA Pour/${m[1]}`;
    const numeric = BACK_NUMERIC[c.op];
    const text = BACK_TEXT[c.op];
    const eq = /^\^\((.*)\)\$$/.exec(c.value);
    const ne = /^\^\(\?!\((.*)\)\$\)$/.exec(c.value);
    if (numeric) add(field, numeric, c.value);
    else if (c.op === 'between') { if (c.value) add(field, 'atLeast', c.value); if (c.value2) add(field, 'atMost', c.value2); }
    else if (text) add(field, text, c.value);
    else if (c.op === 'equals' || c.op === 'notEquals') add(field, c.op, c.value);
    else if (c.op === 'anyOf' || c.op === 'noneOf') add(field, c.op === 'anyOf' ? 'equals' : 'notEquals', (c.values ?? []).join('|'));
    else if (c.op === 'regex' && eq) add(field, 'equals', unflex(eq[1]));
    else if (c.op === 'regex' && ne) add(field, 'notEquals', unflex(ne[1]));
    else lost.push(`${m[1]} ${c.op} ${c.value}`);
  }
  if (set.kind === 'selection') lost.push('a selection set has no conditions to test');
  return { group: { id: set.name, name: set.name, forEach: [], filters }, lost };
}

/** The rules' groups with those of the sets of the folder: a set replaces the group of its name, and the groups of other names stay. A set with no
    condition that can be tested is not made a group (a group with none holds nothing). Returns `groups` itself when nothing changes. */
export function groupsWithSets(groups: RuleGroup[], sets: SearchSet[]): RuleGroup[] {
  const made = sets.filter((s) => s.group === RECIPE_SETS_FOLDER).map((s) => groupFromSet(s, () => 'c')).filter((g) => g.group.filters.length > 0).map((g) => g.group);
  if (!made.length) return groups;
  // A group a set cannot say exactly keeps being the group (its set is a view of it).
  const inexact = new Set(groups.filter((g) => !isExact(g)).map((g) => g.id.toUpperCase()));
  made.splice(0, made.length, ...made.filter((g) => !inexact.has(g.id.toUpperCase())));
  if (!made.length) return groups;
  const names = new Set(made.map((g) => g.id.toUpperCase()));
  const next = [...groups.filter((g) => !names.has(g.id.toUpperCase())), ...made.map((g, i) => ({ ...g, filters: g.filters.map((f, j) => ({ ...f, id: `c${i}-${j}` })), ...(groups.find((o) => o.id.toUpperCase() === g.id.toUpperCase())?.treatAs ? { treatAs: groups.find((o) => o.id.toUpperCase() === g.id.toUpperCase())!.treatAs } : {}) }))];
  return JSON.stringify(next) === JSON.stringify(groups) ? groups : next;
}

/** The sets for the groups of the rules that become sets without losing anything (no per-level groups, no objects named one by one, no
    condition a set cannot test), unless the folder already has a set of that name. The others stay groups. */
export function setsForGroups(groups: RuleGroup[], existing: SearchSet[]): SearchSet[] {
  const have = new Set(existing.filter((s) => s.group === RECIPE_SETS_FOLDER).map((s) => s.name.toUpperCase()));
  return groups
    .filter((g) => !have.has(g.id.toUpperCase()) && g.filters.some((f) => !f.ignore))
    .map((g) => groupToSearchSet(g))
    .filter((r) => r.notes.length === 0 && r.set.conditions.length > 0 && groupFromSet(r.set).lost.length === 0)
    .map((r) => r.set);
}

/** Sets of the folder that an earlier version made from a group by dropping what it could not say (they find too many objects, or none): the
    group is not exact and the set holds only part of its conditions. They are removed so the group is made into a set again. */
export function staleSets(groups: RuleGroup[], existing: SearchSet[]): SearchSet[] {
  return existing.filter((set) => {
    if (set.group !== RECIPE_SETS_FOLDER || set.kind === 'selection') return false;
    const g = groups.find((x) => x.id.toUpperCase() === set.name.toUpperCase());
    if (!g) return false;
    const full = groupToSearchSet(g, () => 'x');
    const key = (c: SearchCondition) => `${c.field}|${c.op}|${c.value}`;
    const have = new Set(full.set.conditions.map(key));
    return full.notes.length > 0 && set.conditions.every((c) => have.has(key(c)));
  });
}

/** The groups with each ID once (the last one stays: it is the one written most recently). The same list when none repeats. */
export function uniqueGroups(groups: RuleGroup[]): RuleGroup[] {
  const last = new Map(groups.map((g, i) => [g.id.toUpperCase(), i]));
  return last.size === groups.length ? groups : groups.filter((g, i) => last.get(g.id.toUpperCase()) === i);
}

/** Sets of the folder that repeat the name of an earlier one (a recipe finds its set by name, so the name is once). */
export function duplicateSets(existing: SearchSet[]): SearchSet[] {
  const seen = new Set<string>();
  return existing.filter((s) => {
    if (s.group !== RECIPE_SETS_FOLDER) return false;
    const key = s.name.toUpperCase();
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
}
