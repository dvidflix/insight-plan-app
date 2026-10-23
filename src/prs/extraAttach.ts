import type { SearchSet } from '../viewer/searchSets';
import { isInFolder, setsInside } from '../viewer/setTree';
import type { ExtraAttach, ExtraTag, RelType } from './rules';

/** An extra activity can be attached to a search set, or to a folder of them (every set inside, at any depth): it is tied to the activities of those sets
    with a link of its own. The scenario keeps the target as typed (`target`: a set's name or a folder's path) in the extra's tag; the generator is given the
    names of the sets (`groups`), worked out here from the sets as they are now, so a set added to the folder later is included. Each set is a rule group of its name. */

const norm = (s: string) => s.trim().toUpperCase();

export interface AttachOption { value: string; label: string; direction: 'after' | 'before'; type: RelType }

/** The links an extra can have to its sets, in words. "After": the sets' activities come first and the extra follows; "before": the extra comes first. */
export const ATTACH_LINKS: AttachOption[] = [
  { value: 'after|FS', label: 'Starts when they finish', direction: 'after', type: 'FS' },
  { value: 'after|SS', label: 'Starts when they start', direction: 'after', type: 'SS' },
  { value: 'after|FF', label: 'Finishes when they finish', direction: 'after', type: 'FF' },
  { value: 'after|SF', label: 'Finishes when they start', direction: 'after', type: 'SF' },
  { value: 'before|FS', label: 'They start when it finishes', direction: 'before', type: 'FS' },
  { value: 'before|SS', label: 'They start when it starts', direction: 'before', type: 'SS' },
  { value: 'before|FF', label: 'They finish when it finishes', direction: 'before', type: 'FF' },
];

export const ATTACH_PICKS: { value: NonNullable<ExtraAttach['pick']>; label: string; tip: string }[] = [
  { value: 'each', label: 'Each', tip: 'Linked to every activity of the sets' },
  { value: 'first', label: 'First', tip: 'Linked to the first activity of the sets, in the programme’s order' },
  { value: 'last', label: 'Last', tip: 'Linked to the last activity of the sets, in the programme’s order' },
];

/** The sets a target stands for: the set of that name, else every set inside the folder of that path (a selection set holds fixed objects and is no group). */
export function setsOfTarget(target: string, sets: readonly SearchSet[]): SearchSet[] {
  if (!target.trim()) return [];
  const named = sets.filter((s) => s.kind !== 'selection' && norm(s.name) === norm(target));
  return named.length ? named : setsInside(sets, target).filter((s) => s.kind !== 'selection' && isInFolder(s.group ?? '', target));
}

/** The names of the sets extras are attached to (they must be rule groups for the generator to find them). */
export const attachedSetNames = (tags: Record<string, ExtraTag>, sets: readonly SearchSet[]): string[] =>
  [...new Set(Object.values(tags).flatMap((t) => (t.attach?.target ? setsOfTarget(t.attach.target, sets).map((s) => s.name) : [])))];

/** The tags as the generator reads them: each attachment with the names of its sets. The same object when nothing is attached. */
export function resolveAttachments(tags: Record<string, ExtraTag>, sets: readonly SearchSet[]): Record<string, ExtraTag> {
  if (!Object.values(tags).some((t) => t.attach?.target)) return tags;
  return Object.fromEntries(Object.entries(tags).map(([id, t]) => [id, t.attach?.target ? { ...t, attach: { ...t.attach, groups: [...new Set(setsOfTarget(t.attach.target, sets).map((s) => s.name))] } } : t]));
}

/** What an attachment will do, for the row: how many sets it finds. */
export const attachSummary = (a: ExtraAttach | undefined, sets: readonly SearchSet[]): string => {
  if (!a?.target) return '';
  const n = setsOfTarget(a.target, sets).length;
  return n === 0 ? `No search set or folder “${a.target}”: nothing is linked` : n === 1 ? '1 set' : `${n} sets`;
};
