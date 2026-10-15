import type { ScheduleModel } from './types';
import { recomputeCpm } from './cpm';
import { clearLevelling, describeOverloads, levelResources } from './leveling';
import { useBaselineChoiceStore } from '../state/baselines';
import { editStructure } from '../state/programmeEdits';
import { commit } from '../state/programmeHistory';
import { saveBaselineOf, useProjectDbStore } from '../state/projectDbStore';
import { useScheduleStore } from '../state/scheduleStore';
import { programmeKey } from '../state/unloadedWbsStore';

/** Whether each run of Schedule (F9) first keeps the programme as it is as a baseline, and shows the run against it (the Gantt's baseline
    bars show what the run moved). Kept between sessions. */
const BASELINE_KEY = 'planning.baselineOnSchedule';
export const baselineOnSchedule = (): boolean => {
  try { return localStorage.getItem(BASELINE_KEY) === '1'; } catch { return false; }
};
export const setBaselineOnSchedule = (on: boolean) => {
  try { localStorage.setItem(BASELINE_KEY, on ? '1' : '0'); } catch { /* kept for this session only */ }
};

const stamp = () => new Date().toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Schedule (F9): the dates and float are calculated again from the links, calendars, constraints and the data date. One undo step.
    Only a programme edited in place has its dates calculated here. With "Baseline at each run" on, the programme is first saved as a
    baseline and chosen to show against. Returns what the run did, to tell the user. */
export async function rescheduleProgramme(model: ScheduleModel): Promise<string> {
  if (!model.editable) return 'Make an editable copy of this programme first (Inputs, the pencil): then it can be scheduled here.';
  let kept = '';
  if (baselineOnSchedule()) {
    const record = useProjectDbStore.getState().programmes.find((p) => p.id === model.dbProgrammeId);
    if (record && record.baselineOf === null) {
      try {
        await saveBaselineOf(record, `Before run ${stamp()}`);
        const latest = useProjectDbStore.getState().programmes.filter((p) => p.baselineOf === record.id).sort((a, b) => b.id - a.id)[0];
        if (latest) useBaselineChoiceStore.getState().choose(programmeKey(model), latest.id);
        kept = ' The programme before the run is kept as a baseline and shown against.';
      } catch {
        kept = ' (The baseline could not be saved.)';
      }
    }
  }
  const r = commit('Schedule', () => editStructure(programmeKey(model), (m) => ({ model: recomputeCpm(m, { keepOwnStarts: true }) })));
  if ('error' in r) return r.error;
  // What the run did: the programme as it was against as it is now.
  const now = useScheduleStore.getState().schedules.find((x) => x.id === model.id);
  if (!now) return 'Scheduled.';
  const before = new Map(model.activities.map((a) => [a.id, a]));
  const t = (d: Date | null | undefined) => d?.getTime() ?? null;
  let moved = 0;
  for (const a of now.activities) {
    const b = before.get(a.id);
    if (b && (t(b.earlyStart) !== t(a.earlyStart) || t(b.earlyFinish) !== t(a.earlyFinish))) moved++;
  }
  const finish = (m: ScheduleModel) => m.activities.reduce((hi, a) => Math.max(hi, t(a.earlyFinish) ?? 0), 0);
  const [f0, f1] = [finish(model), finish(now)];
  const days = Math.round((f1 - f0) / 86400000);
  const crit = (m: ScheduleModel) => m.activities.filter((a) => a.isCritical).length;
  const show = (ms: number) => (ms ? new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' }) : '—');
  const end = days === 0 ? `the finish stays ${show(f1)}` : `the finish ${show(f0)} → ${show(f1)} (${days > 0 ? '+' : ''}${days} d)`;
  return `Scheduled: ${moved} ${moved === 1 ? 'activity' : 'activities'} moved; ${end}; ${crit(now)} critical (was ${crit(model)}).${kept}`;
}

/** Resource levelling, as asked: 'report' only lists the overloads; 'float' delays only within float; 'needed' delays as far as it takes
    (it may move the finish); 'clear' takes the levelling off. Returns what to tell the user. */
export function levelProgramme(model: ScheduleModel, how: 'report' | 'float' | 'needed' | 'clear'): string {
  if (how === 'report') return describeOverloads(model);
  if (!model.editable) return 'Make an editable copy of this programme first (Inputs, the pencil): then it can be levelled here.';
  if (how === 'clear') {
    const r = commit('Clear levelling', () => editStructure(programmeKey(model), (m) => clearLevelling(m)));
    return 'error' in r ? r.error : `Levelling taken off ${(r as { cleared: number }).cleared} ${(r as { cleared: number }).cleared === 1 ? 'activity' : 'activities'}: their constraints are as they were.`;
  }
  const r = commit('Level resources', () => editStructure(programmeKey(model), (m) => levelResources(m, { withinFloat: how === 'float' })));
  if ('error' in r) return r.error;
  const { delayed, remaining, capped } = r as { delayed: number; remaining: number; capped: boolean };
  return `Levelled: ${delayed} ${delayed === 1 ? 'activity' : 'activities'} delayed (Start On or After, marked "Levelled"); ${remaining ? `${remaining} overloaded ${remaining === 1 ? 'day' : 'days'} left${how === 'float' ? ' (not possible within float)' : ''}` : 'no overload left'}${capped ? '; stopped at the step limit, run it again' : ''}. Clear levelling puts them back. Undo (Ctrl+Z) takes it all back.`;
}
