import type { Activity, ResourceAssignment, ResourceInfo, ScheduleModel, UdfTypeDef } from './types';
import type { Result } from './programmeCommands';
import { DRIVEN_LABEL, hoursPerDayOfCalendar, patchActivities } from './planEdit';

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
export function setAssignment(m: ScheduleModel, activityId: string, resourceId: string, o: { units?: number; qty?: number }): Result {
  const a = m.activities.find((x) => x.id === activityId);
  const cur = a?.resources.find((x) => x.resourceId === resourceId);
  if (!a || !cur) return { error: 'That resource is not assigned to the activity.' };
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
  const units = a.resources.filter((r) => !r.virtual && isCrew(r.resourceType)).reduce((s, r) => s + (r.unitsPerTime ?? 0), 0);
  return units > 0 ? units : 1;
}

// ---- Quantity and productivity ----

export const QTY_LABEL = 'Quantity';
export const UNIT_LABEL = 'Quantity unit';
export const PROD_LABEL = 'Productivity (per day)';

const UDF_KINDS: Record<string, UdfTypeDef['dataType']> = { [QTY_LABEL]: 'number', [UNIT_LABEL]: 'text', [PROD_LABEL]: 'number', [DRIVEN_LABEL]: 'number' };

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

/** The activities whose duration follows productivity get it again (after their quantity, productivity or crew changed). */
export function followProductivity(m: ScheduleModel, ids: string[]): ScheduleModel {
  const patches = new Map<string, Partial<Activity>>();
  for (const a of m.activities) {
    if (!ids.includes(a.id) || !productivityOf(a).driven) continue;
    const days = daysFromProductivity(a);
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
