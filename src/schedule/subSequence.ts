import type { Activity } from './types';
import { basisFinish, basisStart } from './linking';

/** Sub-sequence: some programmes carry one activity for a whole parent ("P101") while the model holds its parts as
    "P101-1", "P101-2", … (parent ID + separator + index). With this on for a Link Group, the parts link to the parent's
    activity, and the activity's time is shared between them in index order: they appear one at a time, each over its
    own slot of the activity — the sequence the single activity only implies. Overlap lets the slots run into one
    another (a part starts before the one before it is finished); a negative overlap leaves a gap between them. */
export interface SubSequence {
  enabled: boolean;
  /** The object field holding "parent + separator + index" (an objectFieldKey). Empty: the first matching rule's object field. */
  field: string;
  /** What comes between the parent ID and the index: "-", ".", "_", "/" … */
  separator: string;
  /** Percent of a slot the next part starts early (0 = one after the other, 50 = half-way through the one before).
      Negative leaves a gap of that share of a slot. Between -100 and 90. */
  overlapPct: number;
}

export const DEFAULT_SUB_SEQUENCE: SubSequence = { enabled: false, field: '', separator: '-', overlapPct: 0 };
export const MAX_OVERLAP_PCT = 90;
export const MIN_OVERLAP_PCT = -100;

/** "P101-12" with "-" → parent "P101", index 12. A value without a numeric tail after the separator is its own parent (index null). */
export function splitIndex(value: string, separator: string): { parent: string; index: number | null } {
  const text = value.trim();
  if (separator === '') return { parent: text, index: null };
  const at = text.lastIndexOf(separator);
  if (at <= 0) return { parent: text, index: null };
  const tail = text.slice(at + separator.length).trim();
  if (!/^\d+$/.test(tail)) return { parent: text, index: null };
  return { parent: text.slice(0, at).trim(), index: Number(tail) };
}

/** Where slot `slot` of `slots` sits inside [start, finish] (ms). The slots are equal; each starts `1 − overlap` of a slot
    after the one before, and together they fill the whole window: one slot = D ÷ (1 + (slots − 1) × (1 − overlap)). */
export function slotWindow(start: number, finish: number, slot: number, slots: number, overlapPct: number): [number, number] {
  if (slots <= 1 || finish <= start) return [start, finish];
  const o = Math.min(MAX_OVERLAP_PCT, Math.max(MIN_OVERLAP_PCT, overlapPct)) / 100;
  const length = (finish - start) / (1 + (slots - 1) * (1 - o));
  const from = start + slot * length * (1 - o);
  return [from, Math.min(finish, from + length)];
}

/** An activity as one of its parts sees it: the same, with the dates of the part's slot. */
export function partOf(activity: Activity, slot: number, from: number, to: number): Activity {
  const s = new Date(from);
  const f = new Date(to);
  return { ...activity, id: `${activity.id}#${slot}`, earlyStart: s, earlyFinish: f, targetStart: s, targetFinish: f, actualStart: s, actualFinish: f };
}

/** What a group's link for one activity breaks into: the objects of each slot. */
export type SubSlots = Map<number, { slot: number; slots: number }>;

export interface LinkedWork {
  activity: Activity;
  ids: number[];
}

/** An activity's linked objects as the work to drive: the activity with all its objects, or — for those with slots —
    one part per slot, each with the dates of its slot. */
export function expandWork(
  taskToElements: Map<string, number[]>,
  sub: Map<string, SubSlots> | undefined,
  activityById: Map<string, Activity>,
  basis: 'planned' | 'actual',
  overlapPct: number,
): LinkedWork[] {
  const out: LinkedWork[] = [];
  for (const [activityId, ids] of taskToElements) {
    const activity = activityById.get(activityId);
    if (!activity) continue;
    const slots = sub?.get(activityId);
    const start = basisStart(activity, basis)?.getTime();
    const finish = basisFinish(activity, basis)?.getTime();
    if (!slots || start === undefined || finish === undefined) {
      out.push({ activity, ids });
      continue;
    }
    const bySlot = new Map<number, number[]>();
    const loose: number[] = [];
    for (const id of ids) {
      const s = slots.get(id);
      if (s) (bySlot.get(s.slot) ?? bySlot.set(s.slot, []).get(s.slot)!).push(id);
      else loose.push(id);
    }
    const count = Math.max(...[...slots.values()].map((s) => s.slots));
    for (const [slot, list] of [...bySlot].sort((a, b) => a[0] - b[0])) {
      const [from, to] = slotWindow(start, finish, slot, count, overlapPct);
      out.push({ activity: partOf(activity, slot, from, to), ids: list });
    }
    if (loose.length) out.push({ activity, ids: loose });
  }
  return out;
}
