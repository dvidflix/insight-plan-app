import type { ActivityCodeTypeDef, ResourceInfo, ScheduleModel } from './types';

const minDate = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a < b ? a : b);
const maxDate = (a: Date | null, b: Date | null) => (!a ? b : !b ? a : a > b ? a : b);

/** Combines several schedules (e.g. one P6 export per building) into one, so
    the 4D sequence can play them all at once. Ids are prefixed per source so
    separate exports can't collide, and each source becomes its own top-level
    WBS band named after its project. A single schedule is returned as-is. */
export function mergeSchedules(schedules: ScheduleModel[]): ScheduleModel | null {
  if (schedules.length === 0) return null;
  if (schedules.length === 1) return schedules[0];

  const codeTypes = new Set<string>();
  const resourceNames = new Set<string>();
  const catalog = new Map<string, ActivityCodeTypeDef>();
  const merged: ScheduleModel = {
    id: `merged:${schedules.map((s) => s.id).join('+')}`,
    sourceFileName: schedules.map((s) => s.sourceFileName).join(', '),
    sourceFormat: schedules[0].sourceFormat,
    project: { id: '', name: `${schedules.length} programmes`, dataDate: null, planStart: null, planFinish: null },
    activities: [],
    relationships: [],
    wbs: [],
    activityCodeTypes: [],
    resourceNames: [],
    calendars: [],
    computedFloat: false,
  };

  schedules.forEach((s, i) => {
    const px = (id: string) => `${i}:${id}`;
    const band = s.project.name || s.sourceFileName;
    const bandCode = s.sourceFileName;

    merged.project.dataDate = maxDate(merged.project.dataDate, s.project.dataDate);
    merged.project.planStart = minDate(merged.project.planStart, s.project.planStart);
    merged.project.planFinish = maxDate(merged.project.planFinish, s.project.planFinish);
    merged.computedFloat ||= s.computedFloat;

    for (const a of s.activities) {
      merged.activities.push({
        ...a,
        id: px(a.id),
        wbsId: a.wbsId ? px(a.wbsId) : null,
        calendarId: a.calendarId ? px(a.calendarId) : null,
        wbsPath: a.wbsPath ? `${band} / ${a.wbsPath}` : band,
        wbsCodePath: a.wbsCodePath !== undefined ? (a.wbsPath ? `${bandCode} / ${a.wbsCodePath}` : bandCode) : undefined,
      });
    }
    for (const r of s.relationships) merged.relationships.push({ ...r, predId: px(r.predId), succId: px(r.succId) });
    for (const w of s.wbs) merged.wbs.push({ ...w, id: px(w.id), parentId: w.parentId ? px(w.parentId) : null });
    for (const c of s.calendars) merged.calendars.push({ ...c, id: px(c.id) });
    for (const t of s.activityCodeTypes) codeTypes.add(t);
    for (const r of s.resourceNames) resourceNames.add(r);
    for (const def of s.activityCodeCatalog ?? []) {
      const existing = catalog.get(def.name);
      if (!existing) {
        catalog.set(def.name, { ...def, values: [...def.values] });
        continue;
      }
      const known = new Set(existing.values.map((v) => v.value));
      for (const v of def.values) if (!known.has(v.value)) existing.values.push(v);
    }
  });

  merged.activityCodeTypes = [...codeTypes];
  merged.resourceNames = [...resourceNames];
  merged.resourceCatalog = mergeResourceCatalogs(schedules);
  if (catalog.size > 0) merged.activityCodeCatalog = [...catalog.values()];
  return merged;
}

/** Resources of several schedules, one per name (the first capacity found wins). */
export function mergeResourceCatalogs(schedules: ScheduleModel[]): ResourceInfo[] {
  const byName = new Map<string, ResourceInfo>();
  for (const s of schedules) {
    for (const r of s.resourceCatalog ?? []) {
      const prev = byName.get(r.name);
      if (!prev) byName.set(r.name, { ...r });
      else if (prev.capacity === null && r.capacity !== null) prev.capacity = r.capacity;
    }
  }
  return [...byName.values()];
}
