import { projectConfig } from '../projectConfig';
import type { Activity, ResourceAssignment, ResourceInfo } from './types';

/** App-only ("virtual") resources: attached to activities here, shown in the
    app's resource views and activity details, never part of the programme
    file and never written to the XML the scenario engine produces.

    Precast (m3) is the precast concrete of each Precast Installation
    activity, in m³ — the pour volume the scenario engine writes into the
    activity's CWA-Quantity field — kept apart from Concrete (m3), which only
    the in-situ pours carry. */
export const PRECAST_RESOURCE = `${projectConfig.projectPrefix}.Precast (m3)`;

export const PRECAST_ACTIVITY = 'precast installation';
export const QUANTITY_FIELD = 'CWA-Quantity';

/** Precast (m3) of one activity: the volume of a Precast Installation, else null (no such resource on it). */
export function precastVolume(a: Activity): number | null {
  if (!a.name.toLowerCase().includes(PRECAST_ACTIVITY)) return null;
  const field = a.udf[QUANTITY_FIELD] !== undefined ? QUANTITY_FIELD : Object.keys(a.udf).find((k) => /quantity/i.test(k));
  return (field && Number(a.udf[field])) || 0;
}

/** The activities with Precast (m3) added to the precast installations (the
    same object for every other activity). A programme generated before the
    volume was written has no quantity to read: the resource is still there,
    with 0 m³. */
export function applyVirtualResources(activities: Activity[]): Activity[] {
  return activities.map((a) => {
    if (!a.name.toLowerCase().includes(PRECAST_ACTIVITY)) return a;
    const field = a.udf[QUANTITY_FIELD] !== undefined ? QUANTITY_FIELD : Object.keys(a.udf).find((k) => /quantity/i.test(k));
    const volume = (field && Number(a.udf[field])) || 0;
    const added: ResourceAssignment = {
      resourceId: 'virtual:precast',
      resourceName: PRECAST_RESOURCE,
      resourceType: 'material',
      targetQty: volume,
      remainQty: volume,
      targetCost: 0,
      actualCost: 0,
      virtual: true,
    };
    return { ...a, resources: [...a.resources, added] };
  });
}

export const virtualCatalog: ResourceInfo[] = [{ id: 'virtual:precast', name: PRECAST_RESOURCE, type: 'material', capacity: null, virtual: true }];
