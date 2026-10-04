import type { Activity, Relationship } from './types';

/** Level-of-effort and WBS-summary activities have no duration of their own:
    P6 stretches them from their predecessors (start) to their successors
    (finish). Exports sometimes carry no dates for them, and then they would
    not show at all. Where an LOE / summary has none, they are derived here,
    from the activities it is linked to (lags ignored):
      start  = earliest of  SS predecessor's start, FS predecessor's finish
      finish = latest of    FF successor's finish, FS successor's start
    Their links are otherwise kept as they are (CPM leaves them out). */
export function deriveLoeDates(activities: Activity[], relationships: Relationship[]): Activity[] {
  const spans = (a: Activity) => a.type === 'loe' || a.type === 'wbs-summary';
  const missing = activities.filter((a) => spans(a) && !(a.earlyStart ?? a.targetStart) && !(a.earlyFinish ?? a.targetFinish));
  if (!missing.length) return activities;
  const byId = new Map(activities.map((a) => [a.id, a]));
  const startOf = (a: Activity) => a.actualStart ?? a.earlyStart ?? a.targetStart;
  const finishOf = (a: Activity) => a.actualFinish ?? a.earlyFinish ?? a.targetFinish;
  const ids = new Set(missing.map((a) => a.id));
  const starts = new Map<string, Date>();
  const finishes = new Map<string, Date>();
  for (const r of relationships) {
    if (ids.has(r.succId)) {
      const pred = byId.get(r.predId);
      const d = pred && (r.type === 'SS' || r.type === 'SF' ? startOf(pred) : finishOf(pred));
      const cur = starts.get(r.succId);
      if (d && (r.type === 'SS' || r.type === 'FS') && (!cur || d < cur)) starts.set(r.succId, d);
    }
    if (ids.has(r.predId)) {
      const succ = byId.get(r.succId);
      const d = succ && (r.type === 'FF' || r.type === 'SF' ? finishOf(succ) : startOf(succ));
      const cur = finishes.get(r.predId);
      if (d && (r.type === 'FF' || r.type === 'FS') && (!cur || d > cur)) finishes.set(r.predId, d);
    }
  }
  return activities.map((a) => {
    if (!ids.has(a.id)) return a;
    const s = starts.get(a.id);
    const f = finishes.get(a.id);
    if (!s || !f || f < s) return a;
    return { ...a, earlyStart: s, earlyFinish: f };
  });
}
