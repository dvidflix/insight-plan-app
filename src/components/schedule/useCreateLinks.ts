import type { Relationship, ScheduleModel } from '../../schedule/types';
import { toRelationships, type ProposedLink } from '../../schedule/generateLinks';
import { useGeneratedLinksStore } from '../../state/generatedLinksStore';
import { useScheduleStore, useVisibleSchedules } from '../../state/scheduleStore';

/** Adds generated links to the programme (kept in the app) and undoes the last batch. A combined
    view holds several schedules (ids "scheduleId:activityId"): each link goes to its own schedule. */
export function useCreateLinks(model: ScheduleModel) {
  const visible = useVisibleSchedules();
  const setRelationships = useScheduleStore((s) => s.setRelationships);
  const last = useGeneratedLinksStore((s) => s.last);
  const setLast = useGeneratedLinksStore((s) => s.setLast);

  const create = (links: ProposedLink[]) => {
    const perSchedule = new Map<string, Relationship[]>();
    for (const rel of toRelationships(links)) {
      const owner = model.id === 'combined'
        ? visible.find((v) => rel.predId.startsWith(`${v.id}:`) && rel.succId.startsWith(`${v.id}:`))
        : visible.find((v) => v.id === model.id);
      if (!owner) continue;
      const strip = (id: string) => (model.id === 'combined' ? id.slice(owner.id.length + 1) : id);
      (perSchedule.get(owner.id) ?? perSchedule.set(owner.id, []).get(owner.id)!).push({ ...rel, predId: strip(rel.predId), succId: strip(rel.succId) });
    }
    const undo = new Map<string, Relationship[]>();
    let count = 0;
    for (const [id, added] of perSchedule) {
      const schedule = visible.find((v) => v.id === id)!;
      undo.set(id, schedule.relationships);
      setRelationships(id, [...schedule.relationships, ...added]);
      count += added.length;
    }
    setLast({ count, undo, links: links.map((l) => ({ pred: l.pred.code, succ: l.succ.code })) });
  };

  const revert = () => {
    if (!last) return;
    for (const [id, rels] of last.undo) setRelationships(id, rels);
    setLast(null);
  };

  return { create, revert, created: last };
}
