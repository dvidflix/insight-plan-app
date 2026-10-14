import type { Activity, ScheduleModel } from './types';
import type { LinkOp } from '../state/activityOverridesStore';
import { commit } from '../state/programmeHistory';
import { setLinkOp } from '../state/programmeEdits';
import { programmeKey } from '../state/unloadedWbsStore';

/** The Gantt's link shortcuts (and the Link tool in the toolbar, which offers all four types: FF, SF fan out from the earliest like SS), as in the Scenarios table: with several activities picked, Alt+S makes them start together
    (each other activity gets a start-to-start link from the earliest one) and Alt+F makes them follow one another in start
    order (finish-to-start). The links are kept with the project like the other edits, so they survive re-importing or
    regenerating the programme. A link that would close a loop is left out. */

const startMs = (a: Activity) => (a.actualStart ?? a.earlyStart ?? a.targetStart)?.getTime() ?? Number.MAX_SAFE_INTEGER;

/** Whether `from` already leads to `to` through the links. */
export function reaches(model: ScheduleModel, from: string, to: string, extra: { predId: string; succId: string }[]): boolean {
  const next = new Map<string, string[]>();
  for (const r of [...model.relationships, ...extra]) (next.get(r.predId) ?? next.set(r.predId, []).get(r.predId)!).push(r.succId);
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

export interface ShortcutResult {
  added: number;
  skipped: number;
  message: string;
}

/** `model` is the programme the activities are in (one programme, not a combined display). */
export type LinkKind = 'FS' | 'SS' | 'FF' | 'SF';

export function applyLinkShortcut(kind: LinkKind, model: ScheduleModel, ids: ReadonlySet<string>): ShortcutResult {
  const picked = model.activities.filter((a) => ids.has(a.id) && a.type !== 'wbs-summary').sort((a, b) => startMs(a) - startMs(b));
  if (picked.length < 2) return { added: 0, skipped: 0, message: 'Pick two or more activities first (Ctrl+click or Shift+click).' };
  const pairs: [Activity, Activity][] = kind === 'FS'
    ? picked.slice(1).map((a, i) => [picked[i], a])
    : picked.slice(1).map((a) => [picked[0], a]);
  const key = programmeKey(model);
  const adding: { predId: string; succId: string }[] = [];
  let skipped = 0;
  commit(kind === 'FS' ? 'Link in start order' : 'Link from the earliest', () => {
    for (const [pred, succ] of pairs) {
      const exists = model.relationships.some((r) => r.predId === pred.id && r.succId === succ.id && r.type === kind && r.lagHours === 0);
      if (exists || reaches(model, succ.id, pred.id, adding)) {
        skipped++;
        continue;
      }
      const op: LinkOp = { op: 'add', pred: pred.code, succ: succ.code, type: kind, lagHours: 0 };
      setLinkOp(key, op);
      adding.push({ predId: pred.id, succId: succ.id });
    }
  });
  const what = kind === 'FS' ? 'finish-to-start links in start order' : `${{ SS: 'start-to-start', FF: 'finish-to-finish', SF: 'start-to-finish' }[kind]} links from the earliest`;
  return {
    added: adding.length,
    skipped,
    message: `${adding.length} ${what}${skipped ? `; ${skipped} left out (already there, or they would make a loop)` : ''}.`,
  };
}
