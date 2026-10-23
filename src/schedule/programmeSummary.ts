import type { ScheduleModel } from './types';
import { DAY_MS, bucketsOf, buildLoading, finishOf, midnight, startOf } from './resourceLoading';
import { buildDistribution } from './resourceDistribution';
import { applyVirtualResources, virtualCatalog } from './virtualResources';

/** What a planner wants to know the moment a programme is generated: how long it is, how much of it is critical, and the busiest day of each kind of
    resource. Read from the programme as it is loaded (so it is the same figure the Gantt shows). Nothing here knows what the activities are. */

export interface Peak {
  /** Labour, Equipment or Materials. */
  group: string;
  /** The resource with the highest peak in the group (people on the busiest week, equipment in use, or the most in a week). */
  name: string;
  value: number;
  unit: string;
}

export interface ProgrammeSummary {
  activities: number;
  start: Date | null;
  finish: Date | null;
  /** Calendar days from the first start to the last finish. */
  days: number;
  critical: number;
  /** The share of activities with no float, 0 to 1. */
  criticalShare: number;
  peaks: Peak[];
}

export function summariseProgramme(model: ScheduleModel): ProgrammeSummary {
  const tasks = model.activities.filter((a) => a.type === 'task' || a.type === 'loe');
  let start: Date | null = null;
  let finish: Date | null = null;
  for (const a of tasks) {
    const s = startOf(a, 'current');
    const f = finishOf(a, 'current');
    if (s && (!start || s < start)) start = s;
    if (f && (!finish || f > finish)) finish = f;
  }
  const critical = tasks.filter((a) => a.isCritical).length;
  const days = start && finish ? Math.max(0, Math.round((midnight(finish).getTime() - midnight(start).getTime()) / DAY_MS)) : 0;

  const peaks: Peak[] = [];
  if (tasks.length) {
    const catalog = [...(model.resourceCatalog ?? []), ...virtualCatalog];
    const loading = buildLoading(applyVirtualResources(tasks), catalog, model.calendars, 'current');
    if (loading.dayCount > 0) {
      for (const group of buildDistribution(loading, bucketsOf(loading.origin, loading.dayCount, 'week'), 'peak', 0)) {
        const top = [...group.children].sort((a, b) => b.total - a.total)[0];
        if (top && top.total > 0) peaks.push({ group: group.label, name: top.label, value: group.unit === 'people' ? group.total : top.total, unit: group.unit || top.unit });
      }
    }
  }
  return { activities: tasks.length, start, finish, days, critical, criticalShare: tasks.length ? critical / tasks.length : 0, peaks };
}
