import type { Activity, ScheduleModel } from './types';
import { activityStartMs } from './linking';

/** "modelId:localId" -> the activities linked to that object, from `sharedActivityObjects(...).objectsOf`. */
export function activitiesByObject(objectsOf: Map<string, Map<string, Iterable<number>>>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [activityId, perModel] of objectsOf) {
    for (const [modelId, ids] of perModel) for (const id of ids) (out.get(`${modelId}:${id}`) ?? out.set(`${modelId}:${id}`, []).get(`${modelId}:${id}`)!).push(activityId);
  }
  return out;
}

/** The activities of the objects picked in the 3D model, in the order the objects were picked (the Highlighter keeps its picks in order):
    pick the objects one by one in the order of the work and the activities come out in that order. The activities of one object
    (rebar, formwork, concrete...) go in the order they start. */
export function orderedActivities(byModel: Record<string, number[]>, activitiesOf: Map<string, string[]>, model: ScheduleModel): Activity[] {
  const byId = new Map(model.activities.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const out: Activity[] = [];
  for (const [modelId, ids] of Object.entries(byModel)) {
    for (const id of ids) {
      const mine = (activitiesOf.get(`${modelId}:${id}`) ?? []).map((a) => byId.get(a)).filter((a): a is Activity => !!a && !seen.has(a.id));
      mine.sort((a, b) => (activityStartMs(a, 'planned') ?? 0) - (activityStartMs(b, 'planned') ?? 0));
      for (const a of mine) { seen.add(a.id); out.push(a); }
    }
  }
  return out;
}
