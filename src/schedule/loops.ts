import type { Activity, Relationship, ScheduleModel } from './types';

/** Loops in the logic: a set of activities that each lead to the others, so none can ever start. Found as the strongly connected parts of the
    links (Tarjan, without recursion so a programme of 90,000 activities is no trouble). Level-of-effort and WBS-summary activities are not in the
    network (their dates span the work they are tied to), so a link to one cannot make a loop. */

const inNetwork = (a: Activity | undefined): a is Activity => !!a && a.type !== 'loe' && a.type !== 'wbs-summary';

/** Every loop: the ids of the activities in it (two or more, or one that follows itself), each loop's ids in the order they were reached. */
export function findLoops(activities: readonly Activity[], relationships: readonly Pick<Relationship, 'predId' | 'succId'>[]): string[][] {
  const net = new Set(activities.filter(inNetwork).map((a) => a.id));
  const next = new Map<string, string[]>();
  const selfLoop = new Set<string>();
  for (const r of relationships) {
    if (!net.has(r.predId) || !net.has(r.succId)) continue;
    if (r.predId === r.succId) { selfLoop.add(r.predId); continue; }
    (next.get(r.predId) ?? next.set(r.predId, []).get(r.predId)!).push(r.succId);
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [...selfLoop].map((id) => [id]);
  let counter = 0;
  for (const root of net) {
    if (index.has(root)) continue;
    // An explicit stack of [node, position among its successors].
    const work: [string, number][] = [[root, 0]];
    index.set(root, counter); low.set(root, counter); counter++;
    stack.push(root); onStack.add(root);
    while (work.length) {
      const top = work[work.length - 1];
      const [v, i] = top;
      const succ = next.get(v) ?? [];
      if (i < succ.length) {
        top[1]++;
        const w = succ[i];
        if (!index.has(w)) {
          index.set(w, counter); low.set(w, counter); counter++;
          stack.push(w); onStack.add(w);
          work.push([w, 0]);
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
      } else {
        work.pop();
        if (work.length) { const parent = work[work.length - 1][0]; low.set(parent, Math.min(low.get(parent)!, low.get(v)!)); }
        if (low.get(v) === index.get(v)) {
          const part: string[] = [];
          let w: string;
          do { w = stack.pop()!; onStack.delete(w); part.push(w); } while (w !== v);
          if (part.length > 1) out.push(part.reverse());
        }
      }
    }
  }
  return out;
}

/** "A1 → A2 → A3": the codes of a loop, shortened when it is long. */
export function describeLoop(m: Pick<ScheduleModel, 'activities'>, ids: readonly string[]): string {
  const code = new Map(m.activities.map((a) => [a.id, a.code || a.id]));
  const names = ids.map((id) => code.get(id) ?? id);
  return `${names.slice(0, 6).join(' → ')}${names.length > 6 ? ` … (${names.length} activities)` : ''} → ${names[0]}`;
}

/** The loops of the model that were not in `before` (one that was already there does not stop an edit that leaves it alone). */
export function newLoops(before: ScheduleModel, after: ScheduleModel): string[][] {
  if (after.relationships === before.relationships && after.activities === before.activities) return [];
  const old = new Set(findLoops(before.activities, before.relationships).flat());
  return findLoops(after.activities, after.relationships).filter((loop) => loop.some((id) => !old.has(id)));
}
