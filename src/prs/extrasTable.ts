import type { ScenarioExtra } from '../scenarios/api';
import type { ExtraTag } from './rules';

/** The Extra activities table: what an extra can be, and moving the whole table to and from a spreadsheet (a pasted block of cells, or the
    table copied as text). */

export type ExtraKind = 'task' | 'start' | 'finish' | 'summary' | 'loe';

export const EXTRA_KINDS: { value: ExtraKind | ''; label: string; tip: string }[] = [
  { value: '', label: 'Automatic', tip: 'A task, or a finish milestone when it has no days' },
  { value: 'task', label: 'Task', tip: 'An activity with days' },
  { value: 'start', label: 'Start milestone', tip: 'A milestone at the start of what it follows (no days)' },
  { value: 'finish', label: 'Finish milestone', tip: 'A milestone at the finish of what it follows (no days)' },
  { value: 'summary', label: 'WBS summary', tip: 'A summary of the activities under its WBS node: it starts with the first and finishes with the last' },
  { value: 'loe', label: 'Level of effort', tip: 'Dated from the activities it is linked to' },
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A date as yyyy-mm-dd from yyyy-mm-dd, 29/06/2029 (day first), or 6 Apr 2029 / 13 Sept 2030; anything else is left as written. */
export function parseDate(text: string): string {
  const t = text.trim();
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = /^(\d{1,2})\s+([A-Za-z]{3,})\.?\s+(\d{4})$/.exec(t);
  const month = m ? MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) : -1;
  return m && month >= 0 ? `${m[3]}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}` : t;
}

const kindOf = (text: string): ExtraKind | '' | undefined => {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  if (t.startsWith('start')) return 'start';
  if (t.startsWith('finish') || t === 'milestone') return 'finish';
  if (t.includes('summary')) return 'summary';
  if (t.includes('effort') || t === 'loe') return 'loe';
  if (t === 'task') return 'task';
  return '';
};

/** Where in the WBS, from a cell: "level", "slabs" (or the words for them), or a folder path. */
export function wbsOf(text: string): string | undefined {
  const t = text.trim();
  const l = t.toLowerCase();
  if (!t) return undefined;
  if (/^(on )?(its )?level$/.test(l)) return 'level';
  if (/slabs?$/.test(l) && /^(in )?(its |the )?(level'?s? )?slabs?$/.test(l)) return 'slabs';
  if (l === 'default' || l.startsWith('extra activities')) return '';
  return `path:${t.replace(/^path:/i, '')}`;
}

export interface ParsedExtras {
  extras: ScenarioExtra[];
  /** Only what the rows gave: kind, building, level, wbs, task. */
  tags: Record<string, ExtraTag>;
}

/** Rows pasted from a spreadsheet (tab or semicolon separated): ID, Name, Days, Baseline start, Baseline finish, and optionally Type,
    Building, Level, WBS, Level task. A first row of headings is skipped. */
export function parseExtrasPaste(text: string): ParsedExtras {
  const extras: ScenarioExtra[] = [];
  const tags: Record<string, ExtraTag> = {};
  for (const line of text.split(/\r?\n/)) {
    const c = line.split(/\t|;/).map((x) => x.trim());
    if (!c[0] || /^(activity id|id|task ?id)$/i.test(c[0])) continue;
    extras.push({
      TaskID: c[0],
      Name: c[1] ?? '',
      DurationDays: Math.max(0, Number((c[2] ?? '').replace(',', '.')) || 0),
      BaselineStart: parseDate(c[3] ?? ''),
      BaselineFinish: parseDate(c[4] ?? ''),
    });
    const kind = kindOf(c[5] ?? '');
    const tag: ExtraTag = {
      ...(kind ? { kind } : {}),
      ...(c[6] ? { building: c[6] } : {}),
      ...(c[7] ? { level: c[7].toUpperCase() } : {}),
      ...(wbsOf(c[8] ?? '') ? { wbs: wbsOf(c[8] ?? '') } : {}),
      ...(c[9] ? { task: c[9].toUpperCase() } : {}),
    };
    if (Object.keys(tag).length) tags[c[0]] = tag;
  }
  return { extras, tags };
}

const wbsText = (wbs: string | undefined) => (!wbs ? '' : wbs === 'level' || wbs === 'slabs' ? wbs : wbs.replace(/^path:/, ''));

/** The table as text to paste into a spreadsheet (the same columns parseExtrasPaste reads). */
export function extrasToTsv(extras: ScenarioExtra[], tags: Record<string, ExtraTag>): string {
  const head = ['Activity ID', 'Activity Name', 'Days', 'Baseline start', 'Baseline finish', 'Type', 'Building', 'Level', 'WBS', 'Level task'];
  const rows = extras.map((e) => {
    const t = tags[e.TaskID] ?? {};
    return [e.TaskID, e.Name, e.DurationDays, e.BaselineStart, e.BaselineFinish, EXTRA_KINDS.find((k) => k.value === (t.kind ?? ''))?.label ?? '', t.building ?? '', t.level ?? '', wbsText(t.wbs), t.task ?? ''].join('\t');
  });
  return [head.join('\t'), ...rows].join('\n');
}

/** The tags with `patch` applied to the extras with these IDs (an empty value takes the field away; no field left, no tag). */
export function patchTags(tags: Record<string, ExtraTag>, ids: string[], patch: Partial<ExtraTag>): Record<string, ExtraTag> {
  const next = { ...tags };
  for (const id of ids) {
    const merged = { ...(next[id] ?? {}), ...patch };
    const kept = Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== undefined && v !== '')) as ExtraTag;
    if (Object.keys(kept).length) next[id] = kept;
    else delete next[id];
  }
  return next;
}
