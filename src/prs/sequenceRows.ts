import type { ScenarioExtra } from '../scenarios/api';
import type { ExtraTag, LevelTask } from './rules';
import { patchTags } from './extrasTable';

/** Extra activities and level tasks as rows of the Sequence list (the Order tab). The rules file does not change: an extra stays in the scenario's
    extras (ID, name, days, baseline dates) with its tag in `rules.extraTags`, a level task stays in `rules.levelTasks`. These functions only map them
    to a row for the list and write an edited row back, so a row that is not edited leaves the data exactly as it was (tests/unit/sequenceRows.test.ts).

    A row has no pours, and its place in the list is not its logic: the generator ties an extra to the programme by its baseline dates, its level links
    and the manual links, and a level task by its group. So these rows are listed after the steps, and carry no drag handle. */

/** Where an extra goes in the WBS, in the words of the list. `once`: the Extra activities folder; `level`: on the building's level; `slabs`: the
    level's Slabs group; `folder`: a folder of its own (the path is kept as typed). */
export type ExtraScope = 'once' | 'level' | 'slabs' | 'folder';

export interface ExtraRow {
  kind: 'extra';
  id: string;
  name: string;
  days: number;
  start: string;
  finish: string;
  building: string;
  level: string;
  scope: ExtraScope;
  /** The folder path of `scope: 'folder'` (the part after "path:"). */
  path: string;
  /** The one level task it is tied to (empty: every task the level link names). */
  task: string;
  /** What it is: task, start / finish milestone, WBS summary, level of effort (empty: a task). */
  type: string;
}

export interface LevelTaskRow {
  kind: 'levelTask';
  id: string;
  name: string;
  group: string;
  enabled: boolean;
}

export type OtherRow = ExtraRow | LevelTaskRow;

export function scopeOf(wbs: string | undefined): { scope: ExtraScope; path: string } {
  if (!wbs) return { scope: 'once', path: '' };
  if (wbs === 'level' || wbs === 'slabs') return { scope: wbs, path: '' };
  return { scope: 'folder', path: wbs.startsWith('path:') ? wbs.slice(5) : wbs };
}

export function wbsOf(scope: ExtraScope, path: string): string {
  return scope === 'once' ? '' : scope === 'folder' ? `path:${path}` : scope;
}

export function extraRows(extras: ScenarioExtra[], tags: Record<string, ExtraTag>): ExtraRow[] {
  return extras.map((e) => {
    const t = tags[e.TaskID] ?? {};
    const { scope, path } = scopeOf(t.wbs);
    return { kind: 'extra', id: e.TaskID, name: e.Name, days: e.DurationDays, start: e.BaselineStart, finish: e.BaselineFinish, building: t.building ?? '', level: t.level ?? '', scope, path, task: t.task ?? '', type: t.kind ?? '' };
  });
}

export function levelTaskRows(tasks: LevelTask[]): LevelTaskRow[] {
  return tasks.map((t) => ({ kind: 'levelTask', id: t.id, name: t.name, group: t.group, enabled: t.enabled !== false }));
}

/** An edited extra row written back: the extra itself, and its tag (the same as the Extra activities table writes it, so nothing is lost). */
export function applyExtraRow(extras: ScenarioExtra[], tags: Record<string, ExtraTag>, was: string, row: ExtraRow): { extras: ScenarioExtra[]; tags: Record<string, ExtraTag> } {
  const nextExtras = extras.map((e) => (e.TaskID === was ? { ...e, TaskID: row.id, Name: row.name, DurationDays: row.days, BaselineStart: row.start, BaselineFinish: row.finish } : e));
  const moved = { ...tags };
  if (row.id !== was && moved[was]) { moved[row.id] = moved[was]; delete moved[was]; }
  const nextTags = patchTags(moved, [row.id], { building: row.building, level: row.level, wbs: wbsOf(row.scope, row.path), task: row.task, kind: row.type });
  return { extras: nextExtras, tags: nextTags };
}

export function applyLevelTaskRow(tasks: LevelTask[], row: LevelTaskRow): LevelTask[] {
  return tasks.map((t) => (t.id === row.id ? { ...t, name: row.name, group: row.group, enabled: row.enabled ? undefined : false } : t));
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** A new extra activity for the "+ Extra" button: the next free ID, one working day, starting on the scenario's start date (today when it has none) so
    the baseline dates are valid without being invented. It is untagged, so it goes in the Extra activities folder. */
export function newExtra(extras: ScenarioExtra[], startDate: string, today: Date = new Date()): ScenarioExtra {
  const used = new Set(extras.map((e) => e.TaskID.trim().toUpperCase()));
  let n = extras.length + 1;
  while (used.has(`X-${n}`)) n++;
  const given = /^\d{4}-\d{2}-\d{2}$/.test(startDate.trim()) ? startDate.trim() : isoDate(today);
  return { TaskID: `X-${n}`, Name: 'New extra activity', DurationDays: 1, BaselineStart: given, BaselineFinish: given };
}
