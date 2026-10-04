import type { ContactRow } from '../viewer/relations';
import { neighbourActivities, summariseRelation, type RelationSummary } from './activityRelation';
import { SLAB_TYPES, isWallType, type ActivityObjects } from './activityObjects';
import type { Activity, Relationship, ScheduleModel } from './types';

/** Why a link is proposed: a pour touching below, a wall touching beside, or the previous pour in the Scenarios sequence. */
export type LinkReason = 'below' | 'beside' | 'sequence';

export const REASON_LABEL: Record<LinkReason, string> = { below: 'Pour below', beside: 'Wall beside', sequence: 'Previous pour' };

export interface ProposedLink {
  pred: Activity;
  succ: Activity;
  reason: LinkReason;
  /** How the predecessor's objects sit against the successor's, when they touch. */
  relation: RelationSummary | null;
}

/** Walks `next` from `start` and returns everything reached (not `start` itself). */
function reach(start: string, next: Map<string, Set<string>>): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    for (const n of next.get(stack.pop()!) ?? []) {
      if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return seen;
}

/** Finish-to-start links the 3D model and the pour sequence imply but the schedule lacks, for slabs only.
    Pours below and walls beside count only when they are on the slab's own level (CWA Pour > Level), when it has one.
    A slab is an element (the activities sharing an Element ID, or one activity with none) whose pour type is
    SLAB or MAIN_SLAB. Its first activity (no predecessor inside the element) gets as predecessors the last
    activity (no successor inside the element, with objects of its own) of:
      - every pour touching below it (any pour type),
      - every wall touching beside it,
      - the pour(s) of the previous step of the Scenarios pour order (`sequence`: steps of activity ids).
    Links the schedule already implies, directly or through other activities, and links that would close a
    loop are left out. `only` limits it to the elements of those activity ids. */
export function proposeLinks(
  model: ScheduleModel,
  objects: ActivityObjects,
  contacts: Map<string, ContactRow[]>,
  opts: { only?: Set<string>; sequence?: string[][] } = {},
): ProposedLink[] {
  const { objectsOf, ownersOf, elementOf, pourTypeOf, levelOf } = objects;
  const { only, sequence = [] } = opts;
  const byId = new Map(model.activities.map((a) => [a.id, a]));
  const keyOf = (a: Activity) => elementOf(a) || a.id;
  const members = new Map<string, Activity[]>();
  for (const a of model.activities) (members.get(keyOf(a)) ?? members.set(keyOf(a), []).get(keyOf(a))!).push(a);

  const succs = new Map<string, Set<string>>();
  const preds = new Map<string, Set<string>>();
  const link = (p: string, s: string) => {
    (succs.get(p) ?? succs.set(p, new Set()).get(p)!).add(s);
    (preds.get(s) ?? preds.set(s, new Set()).get(s)!).add(p);
  };
  for (const r of model.relationships) if (byId.has(r.predId) && byId.has(r.succId)) link(r.predId, r.succId);

  const sameElement = (id: string, key: string) => { const a = byId.get(id); return !!a && keyOf(a) === key; };
  const owned = new Set([...ownersOf.values()].flat());
  const isExit = (a: Activity) => owned.has(a.id) && ![...(succs.get(a.id) ?? [])].some((s) => sameElement(s, keyOf(a)));

  // Where each activity's element sits in the pour order (index of its step).
  const stepOf = new Map<string, number>();
  sequence.forEach((step, i) => { for (const id of step) { const a = byId.get(id); if (a) stepOf.set(keyOf(a), i); } });

  const wanted = only && new Set([...only].map((id) => byId.get(id)).filter((a): a is Activity => !!a).map(keyOf));
  const out: ProposedLink[] = [];
  for (const [key, list] of members) {
    if (wanted && !wanted.has(key)) continue;
    const entries = list.filter((a) => ![...(preds.get(a.id) ?? [])].some((p) => sameElement(p, key)));
    entries.sort((a, b) => (a.targetStart?.getTime() ?? 0) - (b.targetStart?.getTime() ?? 0) || a.code.localeCompare(b.code));
    const entry = entries[0];
    const mine = entry && objectsOf.get(entry.id);
    if (!entry || !mine) continue;
    if (!SLAB_TYPES.has(pourTypeOf(entry.id))) continue;

    const before = reach(entry.id, preds); // already implied
    const after = reach(entry.id, succs); // would close a loop
    const taken = new Set<string>();
    // Level from the pour's property, else from the activity ID (<project>-<building>-<level>-...).
    const levelFor = (id: string) => levelOf(id) || (byId.get(id)?.code.split('-')[2] ?? '').toUpperCase();
    const slabLevel = levelFor(entry.id);
    const add = (pred: Activity | undefined, reason: LinkReason, relation: RelationSummary | null) => {
      if (!pred || keyOf(pred) === key || !isExit(pred) || taken.has(pred.id) || before.has(pred.id) || after.has(pred.id)) return;
      taken.add(pred.id);
      out.push({ pred, succ: entry, reason, relation });
    };

    for (const id of neighbourActivities(contacts, mine, ownersOf)) {
      const pred = byId.get(id);
      const theirs = objectsOf.get(id);
      const relation = theirs && summariseRelation(contacts, mine, theirs);
      if (!pred || !relation) continue;
      // Only the slab's own level: the pours of the level below are already behind the ones it sits on.
      if (slabLevel && levelFor(id) !== slabLevel) continue;
      if (relation.dominant === 'below' || relation.dominant === 'mostly-below') add(pred, 'below', relation);
      else if (relation.dominant === 'side' && isWallType(pourTypeOf(id))) add(pred, 'beside', relation);
    }

    const step = stepOf.get(key);
    if (step !== undefined && step > 0) for (const id of sequence[step - 1]) add(byId.get(id), 'sequence', null);

    // Later elements see these links, so loops through them are caught too.
    for (const p of out) if (p.succ === entry) link(p.pred.id, entry.id);
  }
  return out;
}

export function toRelationships(links: ProposedLink[]): Relationship[] {
  return links.map((l) => ({ predId: l.pred.id, succId: l.succ.id, type: 'FS', lagHours: 0 }));
}
