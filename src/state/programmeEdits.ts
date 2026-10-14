import type { Activity, ScheduleModel } from '../schedule/types';
import type { Result } from '../schedule/programmeCommands';
import { applyEdits, useActivityOverridesStore, type LinkOp } from './activityOverridesStore';
import { useScheduleStore } from './scheduleStore';
import { programmeKey } from './unloadedWbsStore';

/** Where an edit of a programme goes. A programme edited in place takes it into its model (and the database, see projectDbStore's
    saving); any other (imported, generated) keeps it on top of the programme, in the overrides, so re-importing or regenerating the
    file does not lose it. The editing screens call these, not the overrides store. `key` is the programme's key (programmeKey). */

const editable = (key: string) => useScheduleStore.getState().schedules.find((m) => m.editable && programmeKey(m) === key) ?? null;

function replace(id: string, next: ReturnType<typeof applyEdits>) {
  useScheduleStore.setState((s) => ({ schedules: s.schedules.map((m) => (m.id === id ? next : m)) }));
}

/** Whether the programme is edited in place (it has no "original" to reset to). */
export const isEditableProgramme = (key: string) => editable(key) !== null;

/** Changes fields of activities, by Activity ID. */
export function setEdits(key: string, edits: Map<string, Partial<Activity>>) {
  const m = editable(key);
  if (m) replace(m.id, applyEdits(m, edits));
  else useActivityOverridesStore.getState().set(key, edits);
}

/** Puts activities back as the imported or generated programme has them (nothing to do in a programme edited in place). */
export function resetEdits(key: string, codes?: string[]) {
  if (!editable(key)) useActivityOverridesStore.getState().reset(key, codes);
}

/** Adds, takes out or changes a link, by the two Activity IDs. */
export function setLinkOp(key: string, op: LinkOp) {
  const m = editable(key);
  if (m) replace(m.id, applyEdits(m, new Map(), [op]));
  else useActivityOverridesStore.getState().setLink(key, op);
}

export function resetLinkOps(key: string, codes?: string[]) {
  if (!editable(key)) useActivityOverridesStore.getState().resetLinks(key, codes);
}

/** Changes the structure of a programme edited in place (see schedule/programmeCommands.ts): the command is given the programme's model
    and returns the new one, or an error to show. The rest of what the command returns (the new activity's id ...) comes back. */
export function editStructure<T extends object>(key: string, command: (m: ScheduleModel) => Result<T>): { error: string } | Omit<{ model: ScheduleModel } & T, 'model'> {
  const m = editable(key);
  if (!m) return { error: 'This programme is not edited in place: make an editable copy of it first.' };
  const result = command(m);
  if ('error' in result) return result;
  const { model, ...rest } = result;
  if (model !== m) replace(m.id, { ...model, id: m.id, dbProgrammeId: m.dbProgrammeId, editable: true, sourceFileName: m.sourceFileName });
  return rest as Omit<{ model: ScheduleModel } & T, 'model'>;
}
