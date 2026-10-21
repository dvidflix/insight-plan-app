import type { Activity, ResourceAssignment, ResourceInfo, ScheduleModel, UdfTypeDef } from './types';
import type { Result } from './programmeCommands';
import { DRIVEN_LABEL, FORMULA_LABEL, hoursPerDayOfCalendar, patchActivities } from './planEdit';
import { evaluateFormula, type FormulaResult } from './durationFormula';

/** Resources, what the activities have of them, and the duration that follows from quantity and productivity. Each returns the new
    model, or an error to show; what it does not change is the same objects (which is how saving finds the rows that changed). */

const numeric = (id: string) => (/^\d+$/.test(id) ? Number(id) : 0);
const nextId = (ids: Iterable<string>) => String(1 + Math.max(0, ...[...ids].map(numeric)));
const round4 = (n: number) => Math.round(n * 4) / 4;

export const RESOURCE_TYPES: { id: ResourceAssignment['resourceType']; label: string }[] = [
  { id: 'labor', label: 'Labour' },
  { id: 'equipment', label: 'Equipment' },
  { id: 'material', label: 'Material' },
];

const catalogOf = (m: ScheduleModel): ResourceInfo[] => m.resourceCatalog ?? [];
const withCatalog = (m: ScheduleModel, catalog: ResourceInfo[]): ScheduleModel => ({ ...m, resourceCatalog: catalog, resourceNames: [...new Set(catalog.map((r) => r.name))] });

/** A resource with a crew (people or machines working at the same time) rather than a quantity used. */
const isCrew = (type: ResourceAssignment['resourceType']) => type === 'labor' || type === 'equipment';

export function addResource(m: ScheduleModel, o: { name: string; type: ResourceAssignment['resourceType']; capacity?: number | null; costPerUnit?: number }): Result<{ id: string }> {
  const name = o.name.trim();
  if (!name) return { error: 'The resource needs a name.' };
  if (catalogOf(m).some((r) => r.name.toLowerCase() === name.toLowerCase())) return { error: `There is already a resource called “${name}”.` };
  const id = nextId([...catalogOf(m).map((r) => r.id), ...m.activities.flatMap((a) => a.resources.map((r) => r.resourceId))]);
  const info: ResourceInfo = { id, name, type: o.type, capacity: o.capacity ?? null, ...(o.costPerUnit ? { costPerUnit: o.costPerUnit } : {}) };
  return { model: withCatalog(m, [...catalogOf(m), info]), id };
}

export function updateResource(m: ScheduleModel, id: string, patch: Partial<Pick<ResourceInfo, 'name' | 'type' | 'capacity' | 'costPerUnit'>>): Result {
  const r = catalogOf(m).find((x) => x.id === id);
  if (!r) return { error: 'That resource is not in the programme.' };
  const name = patch.name?.trim();
  if (patch.name !== undefined && !name) return { error: 'The resource needs a name.' };
  if (name && catalogOf(m).some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) return { error: `There is already a resource called “${name}”.` };
  const next: ResourceInfo = { ...r, ...patch, ...(name ? { name } : {}) };
  if (next.costPerUnit === 0) delete next.costPerUnit;
  const model = withCatalog(m, catalogOf(m).map((x) => (x === r ? next : x)));
  // The assignments show its name and type.
  const changed = next.name !== r.name || next.type !== r.type;
  if (!changed) return { model };
  const activities = model.activities.map((a) => (a.resources.some((x) => x.resourceId === id) ? { ...a, resources: a.resources.map((x) => (x.resourceId === id ? { ...x, resourceName: next.name, resourceType: next.type } : x)) } : a));
  return { model: { ...model, activities } };
}

export function deleteResource(m: ScheduleModel, id: string): Result<{ assignments: number }> {
  const r = catalogOf(m).find((x) => x.id === id);
  if (!r) return { error: 'That resource is not in the programme.' };
  let assignments = 0;
  const activities = m.activities.map((a) => {
    if (!a.resources.some((x) => x.resourceId === id)) return a;
    assignments++;
    return { ...a, resources: a.resources.filter((x) => x.resourceId !== id) };
  });
  return { model: { ...withCatalog(m, catalogOf(m).filter((x) => x !== r)), activities }, assignments };
}

/** The quantity of a crew resource for a duration: units at once × the hours. */
const qtyFor = (units: number, hours: number) => round4(units * hours);

/** A resource assigned to activities: a crew of `units` working all the duration (labour, equipment), or a quantity (material). */
export function assignResource(m: ScheduleModel, activityIds: string[], resourceId: string, o: { units?: number; qty?: number } = {}): Result<{ assigned: number }> {
  const r = catalogOf(m).find((x) => x.id === resourceId);
  if (!r) return { error: 'That resource is not in the programme.' };
  let assigned = 0;
  const patches = new Map<string, Partial<Activity>>();
  for (const a of m.activities) {
    if (!activityIds.includes(a.id) || a.resources.some((x) => x.resourceId === resourceId)) continue;
    const units = o.units ?? 1;
    const crew = isCrew(r.type);
    const assignment: ResourceAssignment = {
      resourceId, resourceName: r.name, resourceType: r.type,
      targetQty: crew ? qtyFor(units, a.durationHours) : o.qty ?? 0,
      remainQty: crew ? qtyFor(units, a.remainingDurationHours) : o.qty ?? 0,
      targetCost: 0, actualCost: 0,
      ...(crew ? { unitsPerTime: units } : {}),
    };
    patches.set(a.id, { resources: [...a.resources, assignment] });
    assigned++;
  }
  if (!assigned) return { error: 'Nothing to assign: the picked activities already have it.' };
  const done = patchActivities(m, patches);
  return 'error' in done ? done : { model: followProductivity(done.model, [...patches.keys()]), assigned };
}

export function unassignResource(m: ScheduleModel, activityIds: string[], resourceId: string): Result<{ removed: number }> {
  let removed = 0;
  const patches = new Map<string, Partial<Activity>>();
  for (const a of m.activities) {
    if (!activityIds.includes(a.id) || !a.resources.some((x) => x.resourceId === resourceId)) continue;
    patches.set(a.id, { resources: a.resources.filter((x) => x.resourceId !== resourceId) });
    removed++;
  }
  if (!removed) return { model: m, removed };
  const done = patchActivities(m, patches);
  return 'error' in done ? done : { model: followProductivity(done.model, [...patches.keys()]), removed };
}

/** Changes an assignment: the crew size (units at once), or the quantity (material). */
export function setAssignment(m: ScheduleModel, activityId: string, resourceId: string, o: { units?: number; qty?: number; primary?: boolean }): Result {
  const a = m.activities.find((x) => x.id === activityId);
  const cur = a?.resources.find((x) => x.resourceId === resourceId);
  if (!a || !cur) return { error: 'That resource is not assigned to the activity.' };
  if (o.primary !== undefined && o.units === undefined && o.qty === undefined) {
    if (!isCrew(cur.resourceType)) return { error: 'Only a crew (labour or equipment) can be the primary one.' };
    const { primary: _was, ...rest } = cur;
    const flagged: ResourceAssignment = o.primary ? { ...rest, primary: true } : rest;
    const set = patchActivities(m, new Map([[activityId, { resources: a.resources.map((x) => (x === cur ? flagged : x)) }]]));
    return 'error' in set ? set : { model: followProductivity(set.model, [activityId]) };
  }
  const value = o.units ?? o.qty;
  if (value === undefined || !Number.isFinite(value) || value < 0) return { error: 'Type a number, 0 or more.' };
  const next: ResourceAssignment = isCrew(cur.resourceType) && o.units !== undefined
    ? { ...cur, unitsPerTime: o.units, targetQty: qtyFor(o.units, a.durationHours), remainQty: qtyFor(o.units, a.remainingDurationHours) }
    : { ...cur, targetQty: o.qty ?? cur.targetQty, remainQty: o.qty ?? cur.remainQty };
  const done = patchActivities(m, new Map([[activityId, { resources: a.resources.map((x) => (x === cur ? next : x)) }]]));
  return 'error' in done ? done : { model: followProductivity(done.model, [activityId]) };
}

/** The crew of an activity: the labour and equipment working at once (a crew of 1 when none is assigned). */
export function crewOf(a: Activity): number {
  const crews = a.resources.filter((r) => !r.virtual && isCrew(r.resourceType));
  // The crews marked primary set the pace: when there are any, only they count.
  const pace = crews.some((r) => r.primary) ? crews.filter((r) => r.primary) : crews;
  const units = pace.reduce((s, r) => s + (r.unitsPerTime ?? 0), 0);
  return units > 0 ? units : 1;
}

// ---- Quantity and productivity ----

export const QTY_LABEL = 'Quantity';
export const UNIT_LABEL = 'Quantity unit';
export const PROD_LABEL = 'Productivity (per day)';

const UDF_KINDS: Record<string, UdfTypeDef['dataType']> = { [QTY_LABEL]: 'number', [UNIT_LABEL]: 'text', [PROD_LABEL]: 'number', [DRIVEN_LABEL]: 'number', [FORMULA_LABEL]: 'text' };

export interface Productivity {
  quantity: number | null;
  unit: string;
  /** Output per day for each unit of the crew (a person, a machine). */
  perDay: number | null;
  /** The duration follows quantity ÷ (productivity × crew). */
  driven: boolean;
}

export function productivityOf(a: Activity): Productivity {
  const num = (k: string) => (typeof a.udf[k] === 'number' ? (a.udf[k] as number) : null);
  return { quantity: num(QTY_LABEL), unit: typeof a.udf[UNIT_LABEL] === 'string' ? (a.udf[UNIT_LABEL] as string) : '', perDay: num(PROD_LABEL), driven: num(DRIVEN_LABEL) === 1 };
}

/** Working days the quantity takes at this productivity with this crew; null when quantity or productivity is not set. */
export function daysFromProductivity(a: Activity): number | null {
  const p = productivityOf(a);
  if (!p.quantity || !p.perDay || p.quantity < 0 || p.perDay <= 0) return null;
  return p.quantity / (p.perDay * crewOf(a));
}

/** The user fields these need, made when the programme does not have them yet. */
function withUdfTypes(m: ScheduleModel, labels: string[]): ScheduleModel {
  const have = m.udfTypes ?? [];
  const missing = labels.filter((l) => !have.some((t) => t.label === l));
  if (!missing.length) return m;
  let used = have.map((t) => t.id);
  const added = missing.map((label): UdfTypeDef => {
    const id = nextId(used);
    used = [...used, id];
    return { id, label, dataType: UDF_KINDS[label] ?? 'text' };
  });
  return { ...m, udfTypes: [...have, ...added] };
}

/** Sets the quantity, its unit, the productivity and whether the duration follows them. When it does, the duration is made from them. */
export function setProductivity(m: ScheduleModel, id: string, patch: Partial<Productivity>): Result {
  const a = m.activities.find((x) => x.id === id);
  if (!a) return { error: 'That activity is not in the programme.' };
  if (patch.quantity !== undefined && patch.quantity !== null && (!Number.isFinite(patch.quantity) || patch.quantity < 0)) return { error: 'The quantity is a number, 0 or more.' };
  if (patch.perDay !== undefined && patch.perDay !== null && (!Number.isFinite(patch.perDay) || patch.perDay < 0)) return { error: 'The productivity is a number, 0 or more.' };
  const udf = { ...a.udf };
  const put = (label: string, value: string | number | null | undefined) => {
    if (value === undefined) return;
    if (value === null || value === '') delete udf[label];
    else udf[label] = value;
  };
  put(QTY_LABEL, patch.quantity);
  put(UNIT_LABEL, patch.unit?.trim());
  put(PROD_LABEL, patch.perDay);
  if (patch.driven !== undefined) put(DRIVEN_LABEL, patch.driven ? 1 : null);
  const labels = Object.keys(udf).filter((k) => k in UDF_KINDS);
  const prepared = withUdfTypes(m, labels);
  const done = patchActivities(prepared, new Map([[id, { udf }]]));
  if ('error' in done) return done;
  return { model: followProductivity(done.model, [id]) };
}

// ---- Duration formulas ----

export const formulaOf = (a: Activity): string => (typeof a.udf[FORMULA_LABEL] === 'string' ? (a.udf[FORMULA_LABEL] as string).trim() : '');

/** The names a formula can use for an activity: qty, rate (productivity per crew unit per day), crews, hours_per_day, and each number user field as
    udf_<Name> (spaces and signs become "_"). */
export function formulaVars(m: ScheduleModel, a: Activity): Record<string, number | null> {
  const p = productivityOf(a);
  const vars: Record<string, number | null> = { qty: p.quantity, quantity: p.quantity, rate: p.perDay, productivity: p.perDay, crews: crewOf(a), hours_per_day: hoursPerDayOfCalendar(m, a.calendarId) };
  for (const [k, v] of Object.entries(a.udf)) if (typeof v === 'number') vars[`udf_${k.replace(/[^A-Za-z0-9]+/g, '_')}`] = v;
  return vars;
}

/** Working days the activity's formula gives (an error says what is wrong); null when it has no formula. */
export function daysFromFormula(m: ScheduleModel, a: Activity): FormulaResult | null {
  const f = formulaOf(a);
  return f ? evaluateFormula(f, formulaVars(m, a)) : null;
}

/** Gives the picked activities this formula (empty: takes it off). The text must read, with the names the activities have; the duration then follows it. */
export function setDurationFormula(m: ScheduleModel, ids: string[], text: string): Result<{ changed: number }> {
  const formula = text.trim();
  const picked = m.activities.filter((a) => ids.includes(a.id) && (a.type === 'task' || a.type === 'loe'));
  if (!picked.length) return { error: 'Pick tasks to give the formula to.' };
  if (formula) {
    // The text is checked with every name set to 1: a typing error shows now, not as a missing duration later.
    const probe = evaluateFormula(formula, { ...formulaVars(m, picked[0]), ...Object.fromEntries(Object.keys(formulaVars(m, picked[0])).map((k) => [k, 1])) });
    if ('error' in probe && !/has no value/.test(probe.error)) return probe;
  }
  const patches = new Map<string, Partial<Activity>>();
  for (const a of picked) {
    const udf = { ...a.udf };
    if (formula) udf[FORMULA_LABEL] = formula; else delete udf[FORMULA_LABEL];
    patches.set(a.id, { udf });
  }
  const prepared = formula ? withUdfTypes(m, [FORMULA_LABEL]) : m;
  const done = patchActivities(prepared, patches);
  if ('error' in done) return done;
  return { model: followProductivity(done.model, picked.map((a) => a.id)), changed: picked.length };
}

/** The activities whose duration follows a formula or productivity get it again (after their quantity, productivity or crew changed). */
export function followProductivity(m: ScheduleModel, ids: string[]): ScheduleModel {
  const patches = new Map<string, Partial<Activity>>();
  for (const a of m.activities) {
    if (!ids.includes(a.id)) continue;
    const formula = daysFromFormula(m, a);
    if (!formula && !productivityOf(a).driven) continue;
    const days = formula ? ('value' in formula ? formula.value : null) : daysFromProductivity(a);
    if (days === null) continue;
    const hours = round4(days * hoursPerDayOfCalendar(m, a.calendarId));
    if (hours === a.durationHours) continue;
    const patch: Partial<Activity> = { durationHours: hours };
    if (a.status === 'not-started') patch.remainingDurationHours = hours;
    else if (a.status === 'in-progress') patch.remainingDurationHours = Math.max(0, round4(hours * (1 - a.percentComplete / 100)));
    patches.set(a.id, patch);
  }
  if (!patches.size) return m;
  const done = patchActivities(m, patches);
  return 'error' in done ? m : done.model;
}

// ---- Resources as text ----

/** "Gang A x4, Concrete 120": the crew resources with their units at once, the others with their quantity. */
export function resourcesText(a: Activity): string {
  return a.resources.filter((r) => !r.virtual).map((r) => (isCrew(r.resourceType) ? `${r.resourceName}${(r.unitsPerTime ?? 1) === 1 ? '' : ` x${r.unitsPerTime}`}` : `${r.resourceName} ${r.targetQty}`)).join(', ');
}

/** Makes the activity's resources these: the ones not listed come off, new ones go on, the units or quantity of the others change. */
export function setResourcesText(m: ScheduleModel, id: string, text: string): Result {
  const a = m.activities.find((x) => x.id === id);
  if (!a) return { error: 'That activity is not in the programme.' };
  const wanted: { info: ResourceInfo; units?: number; qty?: number }[] = [];
  for (const part of text.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean)) {
    const match = /^(.*?)(?:\s*[x×]\s*(\d+(?:[.,]\d+)?)|\s+(\d+(?:[.,]\d+)?))?$/i.exec(part);
    const name = (match?.[1] ?? part).trim();
    const info = catalogOf(m).find((r) => r.name.toLowerCase() === name.toLowerCase()) ?? catalogOf(m).find((r) => r.name.toLowerCase() === part.toLowerCase());
    if (!info) return { error: `There is no resource called “${name}”: add it in the Dictionary panel first.` };
    const given = match?.[2] ?? match?.[3];
    const value = given === undefined || info.name.toLowerCase() === part.toLowerCase() ? undefined : Number(given.replace(',', '.'));
    wanted.push(isCrew(info.type) ? { info, units: value ?? 1 } : { info, qty: value ?? 0 });
  }
  let model = m;
  for (const r of a.resources.filter((x) => !x.virtual)) {
    if (wanted.some((w) => w.info.id === r.resourceId)) continue;
    const done = unassignResource(model, [id], r.resourceId);
    if ('error' in done) return done;
    model = done.model;
  }
  for (const w of wanted) {
    const has = model.activities.find((x) => x.id === id)!.resources.some((r) => r.resourceId === w.info.id);
    const done = has ? setAssignment(model, id, w.info.id, w.units !== undefined ? { units: w.units } : { qty: w.qty ?? 0 }) : assignResource(model, [id], w.info.id, { units: w.units, qty: w.qty });
    if ('error' in done) return done;
    model = done.model;
  }
  return { model };
}
