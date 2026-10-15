import type { Activity, ActivityCodeTypeDef, ScheduleModel } from './types';
import type { Result } from './programmeCommands';
import { patchActivities } from './planEdit';

/** The activity code dictionary (types with their values) and what the activities have of it. Each returns the new model, or an error
    to show. An activity holds a code as the text of its value under the type's name (as the programme reader gives it). */

const numeric = (id: string) => (/^\d+$/.test(id) ? Number(id) : 0);
const nextId = (ids: Iterable<string>) => String(1 + Math.max(0, ...[...ids].map(numeric)));

const catalogOf = (m: ScheduleModel): ActivityCodeTypeDef[] => m.activityCodeCatalog ?? [];
const withCatalog = (m: ScheduleModel, catalog: ActivityCodeTypeDef[], activities?: Activity[]): ScheduleModel => ({
  ...m, activityCodeCatalog: catalog, activityCodeTypes: catalog.map((t) => t.name), ...(activities ? { activities } : {}),
});

export function addCodeType(m: ScheduleModel, name: string): Result<{ id: string }> {
  const clean = name.trim();
  if (!clean) return { error: 'The code type needs a name.' };
  if (catalogOf(m).some((t) => t.name.toLowerCase() === clean.toLowerCase())) return { error: `There is already a code type called “${clean}”.` };
  const id = nextId(catalogOf(m).map((t) => t.id));
  return { model: withCatalog(m, [...catalogOf(m), { id, name: clean, values: [] }]), id };
}

export function renameCodeType(m: ScheduleModel, id: string, name: string): Result {
  const t = catalogOf(m).find((x) => x.id === id);
  const clean = name.trim();
  if (!t) return { error: 'That code type is not in the programme.' };
  if (!clean) return { error: 'The code type needs a name.' };
  if (clean === t.name) return { model: m };
  if (catalogOf(m).some((x) => x.id !== id && x.name.toLowerCase() === clean.toLowerCase())) return { error: `There is already a code type called “${clean}”.` };
  // The activities hold their codes under the type's name.
  const activities = m.activities.map((a) => {
    if (!(t.name in a.activityCodes)) return a;
    const { [t.name]: value, ...rest } = a.activityCodes;
    return { ...a, activityCodes: { ...rest, [clean]: value } };
  });
  return { model: withCatalog(m, catalogOf(m).map((x) => (x === t ? { ...x, name: clean } : x)), activities) };
}

export function deleteCodeType(m: ScheduleModel, id: string): Result {
  const t = catalogOf(m).find((x) => x.id === id);
  if (!t) return { error: 'That code type is not in the programme.' };
  const activities = m.activities.map((a) => {
    if (!(t.name in a.activityCodes)) return a;
    const { [t.name]: _gone, ...rest } = a.activityCodes;
    return { ...a, activityCodes: rest };
  });
  return { model: withCatalog(m, catalogOf(m).filter((x) => x !== t), activities) };
}

export function addCodeValue(m: ScheduleModel, typeId: string, value: string, parentId: string | null = null): Result<{ id: string }> {
  const t = catalogOf(m).find((x) => x.id === typeId);
  const clean = value.trim();
  if (!t) return { error: 'That code type is not in the programme.' };
  if (!clean) return { error: 'The code needs a value.' };
  if (t.values.some((v) => v.value.toLowerCase() === clean.toLowerCase())) return { error: `“${t.name}” already has the value “${clean}”.` };
  const id = nextId(catalogOf(m).flatMap((x) => x.values.map((v) => v.id)));
  const next = { ...t, values: [...t.values, { id, value: clean, description: clean, parentId }] };
  return { model: withCatalog(m, catalogOf(m).map((x) => (x === t ? next : x))), id };
}

export function renameCodeValue(m: ScheduleModel, typeId: string, valueId: string, value: string): Result {
  const t = catalogOf(m).find((x) => x.id === typeId);
  const v = t?.values.find((x) => x.id === valueId);
  const clean = value.trim();
  if (!t || !v) return { error: 'That code is not in the programme.' };
  if (!clean) return { error: 'The code needs a value.' };
  if (clean === v.value) return { model: m };
  if (t.values.some((x) => x.id !== valueId && x.value.toLowerCase() === clean.toLowerCase())) return { error: `“${t.name}” already has the value “${clean}”.` };
  const activities = m.activities.map((a) => (a.activityCodes[t.name] === v.value ? { ...a, activityCodes: { ...a.activityCodes, [t.name]: clean } } : a));
  const next = { ...t, values: t.values.map((x) => (x === v ? { ...x, value: clean, description: clean } : x)) };
  return { model: withCatalog(m, catalogOf(m).map((x) => (x === t ? next : x)), activities) };
}

export function deleteCodeValue(m: ScheduleModel, typeId: string, valueId: string): Result<{ assignments: number }> {
  const t = catalogOf(m).find((x) => x.id === typeId);
  const v = t?.values.find((x) => x.id === valueId);
  if (!t || !v) return { error: 'That code is not in the programme.' };
  let assignments = 0;
  const activities = m.activities.map((a) => {
    if (a.activityCodes[t.name] !== v.value) return a;
    assignments++;
    const { [t.name]: _gone, ...rest } = a.activityCodes;
    return { ...a, activityCodes: rest };
  });
  // Codes below it move up to its parent.
  const next = { ...t, values: t.values.filter((x) => x !== v).map((x) => (x.parentId === valueId ? { ...x, parentId: v.parentId } : x)) };
  return { model: withCatalog(m, catalogOf(m).map((x) => (x === t ? next : x)), activities), assignments };
}

/** Gives the activities this code of the type (null: takes the type's code off them). A value not yet in the dictionary is added to it. */
export function assignCode(m: ScheduleModel, activityIds: string[], typeName: string, value: string | null): Result<{ changed: number }> {
  let model = m;
  let t = catalogOf(model).find((x) => x.name === typeName);
  if (!t) return { error: `There is no code type “${typeName}”.` };
  const clean = value?.trim() ?? null;
  if (clean && !t.values.some((v) => v.value === clean)) {
    const made = addCodeValue(model, t.id, clean);
    if ('error' in made) return made;
    model = made.model;
    t = catalogOf(model).find((x) => x.name === typeName)!;
  }
  const patches = new Map<string, Partial<Activity>>();
  for (const a of model.activities) {
    if (!activityIds.includes(a.id)) continue;
    if (clean ? a.activityCodes[typeName] === clean : !(typeName in a.activityCodes)) continue;
    const codes = { ...a.activityCodes };
    if (clean) codes[typeName] = clean;
    else delete codes[typeName];
    patches.set(a.id, { activityCodes: codes });
  }
  if (!patches.size) return { model, changed: 0 };
  const done = patchActivities(model, patches);
  return 'error' in done ? done : { model: done.model, changed: done.changed };
}

/** Puts a code under another of the same type (null: at the top), as P6's code hierarchy: indent and outdent. */
export function moveCodeValue(m: ScheduleModel, typeId: string, valueId: string, parentId: string | null): Result {
  const t = catalogOf(m).find((x) => x.id === typeId);
  const v = t?.values.find((x) => x.id === valueId);
  if (!t || !v) return { error: 'That code is not in the programme.' };
  if (parentId !== null && !t.values.some((x) => x.id === parentId)) return { error: 'That parent code is not in the type.' };
  // Not under itself, or under one of its own descendants.
  for (let at: string | null = parentId; at !== null; at = t.values.find((x) => x.id === at)?.parentId ?? null) {
    if (at === valueId) return { error: 'A code cannot go under itself or under its own codes.' };
  }
  if (v.parentId === parentId) return { model: m };
  return { model: withCatalog(m, catalogOf(m).map((x) => (x === t ? { ...t, values: t.values.map((y) => (y === v ? { ...y, parentId } : y)) } : x))) };
}

/** The activity codes of the activities of the programme (by the types' names) as the value ids they hold: how many have each. */
export function codeUsage(m: ScheduleModel, typeName: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of m.activities) {
    const v = a.activityCodes[typeName];
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
}
