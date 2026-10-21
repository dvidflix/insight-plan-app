import { recomputeCpm } from './cpm';
import type { Relationship, RelationType, ScheduleModel } from './types';
import type { Result } from './programmeCommands';
import { hoursPerDayOfCalendar } from './planEdit';

/** Bulk logic tools for a programme edited in place, after ALICE's: give many activities the same predecessor or successor, remove the links
    inside a selection or every link that touches it (after a look at them), and make links soft (preferential) or hard. Each returns the
    new model, or an error to show; the dates are calculated again when a link was added or removed. */

export const linkKey = (r: Pick<Relationship, 'predId' | 'succId'>) => `${r.predId}>${r.succId}`;

const calculated = (m: ScheduleModel) => recomputeCpm(m, { keepOwnStarts: true });

/** Whether `from` leads to `to` through the links (the loop check). */
function leadsTo(links: readonly Pick<Relationship, 'predId' | 'succId'>[], from: string, to: string): boolean {
  const next = new Map<string, string[]>();
  for (const r of links) (next.get(r.predId) ?? next.set(r.predId, []).get(r.predId)!).push(r.succId);
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

export interface AddLinksOptions {
  /** The picked activities get these as predecessors ('pred') or successors ('succ'). */
  role: 'pred' | 'succ';
  type: RelationType;
  lagDays: number;
  soft?: boolean;
}

/** Links each picked activity to each of the other activities: they become the predecessors (or successors) of every picked one. A link that is
    there already (same ends) is left as it is, one that would close a loop is left out, and an activity is never linked to itself. */
export function addLinks(m: ScheduleModel, picked: Iterable<string>, others: Iterable<string>, o: AddLinksOptions): Result<{ added: number; skipped: number }> {
  const byId = new Map(m.activities.map((a) => [a.id, a]));
  const mine = [...new Set(picked)].filter((id) => byId.has(id) && byId.get(id)!.type !== 'wbs-summary');
  const theirs = [...new Set(others)].filter((id) => byId.has(id) && byId.get(id)!.type !== 'wbs-summary');
  if (!mine.length) return { error: 'Pick the activities first.' };
  if (!theirs.length) return { error: o.role === 'pred' ? 'Choose the predecessors.' : 'Choose the successors.' };
  if (!Number.isFinite(o.lagDays)) return { error: 'The lag is a number of days.' };
  const relationships = [...m.relationships];
  const have = new Set(relationships.map(linkKey));
  let added = 0;
  let skipped = 0;
  for (const id of mine) {
    for (const other of theirs) {
      if (other === id) { skipped++; continue; }
      const predId = o.role === 'pred' ? other : id;
      const succId = o.role === 'pred' ? id : other;
      if (have.has(`${predId}>${succId}`) || leadsTo(relationships, succId, predId)) { skipped++; continue; }
      const perDay = hoursPerDayOfCalendar(m, byId.get(succId)!.calendarId);
      relationships.push({ predId, succId, type: o.type, lagHours: Math.round(o.lagDays * perDay * 4) / 4, ...(o.soft ? { soft: true } : {}) });
      have.add(`${predId}>${succId}`);
      added++;
    }
  }
  if (!added) return { model: m, added, skipped };
  return { model: calculated({ ...m, relationships }), added, skipped };
}

/** The links to look at before removing: 'contained' are those with both ends among the picked, 'uncontained' every link with an end among them
    (so also the ones to activities outside the selection). */
export function linksOf(m: ScheduleModel, picked: Iterable<string>, mode: 'contained' | 'uncontained'): Relationship[] {
  const set = new Set(picked);
  return m.relationships.filter((r) => (mode === 'contained' ? set.has(r.predId) && set.has(r.succId) : set.has(r.predId) || set.has(r.succId)));
}

/** Removes the links with these keys (see linkKey). */
export function removeLinks(m: ScheduleModel, keys: Iterable<string>): Result<{ removed: number }> {
  const gone = new Set(keys);
  const relationships = m.relationships.filter((r) => !gone.has(linkKey(r)));
  const removed = m.relationships.length - relationships.length;
  if (!removed) return { model: m, removed };
  return { model: calculated({ ...m, relationships }), removed };
}

/** Makes the links with these keys soft or hard. The dates do not change: both kinds drive them alike. */
export function setLinksSoft(m: ScheduleModel, keys: Iterable<string>, soft: boolean): Result<{ changed: number }> {
  const wanted = new Set(keys);
  let changed = 0;
  const relationships = m.relationships.map((r) => {
    if (!wanted.has(linkKey(r)) || !!r.soft === soft) return r;
    changed++;
    const { soft: _was, ...rest } = r;
    return soft ? { ...rest, soft: true } : rest;
  });
  return changed ? { model: { ...m, relationships }, changed } : { model: m, changed };
}

/** Takes every soft link out (to see what the hard logic alone allows). */
export function removeSoftLogic(m: ScheduleModel): Result<{ removed: number }> {
  return removeLinks(m, m.relationships.filter((r) => r.soft).map(linkKey));
}
