import type { Activity } from './types';
import type { ElementSummary } from '../viewer/types';
import { activityFinishMs, activityStartMs } from './linking';
import { objectFieldValue, parseObjectFieldKey, taskFieldValue } from './linkGroups';

/** Tag label templates: free text with {tokens} between it.
      {TaskName} {TaskCode} {Start} {Finish}   the active task
      {Duration} {Remaining} {Float}          days (8 h/day, as the Programmes tables)
      {Complete} {Status} {Type} {WBS}
      {ActualStart} {ActualFinish}
      {Task:<field>}                          any task field (activity code type, UDF)
      {Obj:<property>}                        a property of the task's linked objects,
                                              e.g. {Obj:Pset_Concrete.PourID}, {Obj:_name}
      {Count}                                 how many of the group's tasks are active
    Anything outside braces is kept as typed, so "Pour {Obj:PourID} - {Obj:Volume} m3" works. */

export interface TagContext {
  activeCount: number;
  task?: Activity;
  /** The elements linked to `task` (across models). */
  elements?: ElementSummary[];
  basis: 'planned' | 'actual';
}

const TOKEN_RE = /\{([^{}]+)\}/g;
const MAX_OBJECT_VALUES = 3;

export const TASK_TOKENS: { token: string; label: string }[] = [
  { token: '{TaskName}', label: 'Task name' },
  { token: '{TaskCode}', label: 'Task ID' },
  { token: '{Start}', label: 'Start' },
  { token: '{Finish}', label: 'Finish' },
  { token: '{Duration}', label: 'Duration' },
  { token: '{Remaining}', label: 'Remaining' },
  { token: '{Complete}', label: '% Complete' },
  { token: '{Float}', label: 'Total float' },
  { token: '{Status}', label: 'Status' },
  { token: '{Type}', label: 'Activity type' },
  { token: '{WBS}', label: 'WBS' },
  { token: '{ActualStart}', label: 'Actual start' },
  { token: '{ActualFinish}', label: 'Actual finish' },
  { token: '{Count}', label: 'Active count' },
];

const HOURS_PER_DAY = 8;
const fmtDays = (hours: number | null | undefined) =>
  hours === null || hours === undefined ? '' : `${Math.round((hours / HOURS_PER_DAY) * 10) / 10}d`;
const STATUS_LABEL: Record<Activity['status'], string> = { 'not-started': 'Not started', 'in-progress': 'In progress', completed: 'Completed' };
const TYPE_LABEL: Record<Activity['type'], string> = {
  task: 'Task',
  'milestone-start': 'Start milestone',
  'milestone-finish': 'Finish milestone',
  loe: 'Level of effort',
  'wbs-summary': 'WBS summary',
};

const fmtDate = (ms: number | null) =>
  ms === null ? '' : new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });

/** Does the label depend on the task/objects (so it repeats per active task)? */
export function isPerTask(template: string): boolean {
  return /\{(TaskName|TaskCode|Start|Finish|Duration|Remaining|Complete|Float|Status|Type|WBS|ActualStart|ActualFinish|Task:[^}]*|Obj:[^}]*)\}/i.test(template);
}

function objectValues(elements: ElementSummary[] | undefined, key: string): string {
  if (!elements || elements.length === 0) return '';
  const { propertySet, attribute } = parseObjectFieldKey(key);
  const seen = new Set<string>();
  for (const el of elements) {
    const v = objectFieldValue(el, propertySet, attribute).trim();
    if (v) seen.add(v);
  }
  const list = [...seen];
  return list.length > MAX_OBJECT_VALUES ? `${list.slice(0, MAX_OBJECT_VALUES).join(', ')}…` : list.join(', ');
}

export function renderTag(template: string, ctx: TagContext): string {
  return template.replace(TOKEN_RE, (_m, raw: string) => {
    const token = raw.trim();
    const lower = token.toLowerCase();
    if (lower === 'count') return String(ctx.activeCount);
    if (lower === 'taskname') return ctx.task?.name ?? '';
    if (lower === 'taskcode') return ctx.task?.code ?? '';
    if (lower === 'start') return ctx.task ? fmtDate(activityStartMs(ctx.task, ctx.basis)) : '';
    if (lower === 'finish') return ctx.task ? fmtDate(activityFinishMs(ctx.task, ctx.basis)) : '';
    const t = ctx.task;
    if (lower === 'duration') return t ? fmtDays(t.durationHours) : '';
    if (lower === 'remaining') return t ? fmtDays(t.remainingDurationHours) : '';
    if (lower === 'float') return t ? fmtDays(t.totalFloatHours) : '';
    if (lower === 'complete') return t ? `${Math.round(t.percentComplete)}%` : '';
    if (lower === 'status') return t ? STATUS_LABEL[t.status] : '';
    if (lower === 'type') return t ? TYPE_LABEL[t.type] : '';
    if (lower === 'wbs') return t ? t.wbsPath.split(' / ').pop() ?? '' : '';
    if (lower === 'actualstart') return t?.actualStart ? fmtDate(t.actualStart.getTime()) : '';
    if (lower === 'actualfinish') return t?.actualFinish ? fmtDate(t.actualFinish.getTime()) : '';
    if (lower.startsWith('task:')) return ctx.task ? taskFieldValue(ctx.task, token.slice(5).trim()) : '';
    if (lower.startsWith('obj:')) return objectValues(ctx.elements, token.slice(4).trim());
    return `{${raw}}`; // unknown: leave visible so a typo is noticed
  });
}

/** The label lines for one group's active tasks: one per distinct rendering. */
export function renderTagLines(template: string, active: { task: Activity; elements: ElementSummary[] }[], basis: 'planned' | 'actual', maxLines = 6): string[] {
  if (!isPerTask(template)) return [renderTag(template, { activeCount: active.length, basis })];
  const lines = new Set<string>();
  for (const { task, elements } of active) {
    const line = renderTag(template, { activeCount: active.length, task, elements, basis }).trim();
    if (line) lines.add(line);
  }
  const all = [...lines];
  return all.length > maxLines ? [...all.slice(0, maxLines), `+${all.length - maxLines} more`] : all;
}
