import type { Activity, ScheduleModel } from './types';
import { hoursPerDayOfCalendar, parsePredecessors, patchActivities, predecessorText, setDateConstraint, setDurationDays, setPercent, setPredecessors } from './planEdit';
import { constraintText, setConstraintText } from './planActions';
import { setResourcesText, resourcesText } from './planResources';
import { assignCode } from './planCodes';
import { startOf, finishOf } from './columns';
import { editStructure } from '../state/programmeEdits';
import { commit } from '../state/programmeHistory';
import { programmeKey } from '../state/unloadedWbsStore';
import type { Result } from './programmeCommands';

/** Editing the Gantt in place: what typing (or pasting from Excel) into a cell of a Gantt column does to the programme.
    The Gantt is always ready to be edited: no edit mode to switch on, the cell under the cursor takes typing. Every change is one
    undoable edit; a paste of many cells is one undo step. */

export type CellResult = 'changed' | 'same' | 'failed';

export interface GanttEditor {
  /** The programme can be edited in place (otherwise typing says how to get an editable copy). */
  editable: boolean;
  canEdit: (a: Activity, col: string) => boolean;
  /** The text of a cell as it is typed and copied (dates as 2030-05-31, so Excel reads them as dates). */
  text: (a: Activity, col: string) => string;
  apply: (a: Activity, col: string, text: string) => CellResult;
  /** Several changes as one undo step. */
  batch: (label: string, fn: () => void) => void;
  note: (text: string) => void;
  /** An activity of the programme by its Activity ID (any case). */
  byCode: (code: string) => Activity | undefined;
}

export const NOT_EDITABLE_NOTE = 'This programme is not edited in place: make an editable copy of it first (Inputs, the pencil).';

/** A cell as Excel takes it from the clipboard: quoted when it holds a tab, a line break or a quote. */
export const tsvCell = (s: string) => (/[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The text Excel puts on the clipboard (tabs between the cells, a line for each row; quoted cells may hold tabs and line breaks). */
export function parseTsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const t = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (quoted) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date | null | undefined) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '');
const num2 = (n: number) => String(Math.round(n * 100) / 100);

/** 2030-05-31, 31/05/2030, 5/31/2030 (the part over 12 is the day; otherwise the browser's language decides) and "31 May 2030". */
export function parseLooseDate(text: string): Date | null {
  const s = text.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 8, 0);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const monthFirst = b > 12 ? true : a > 12 ? false : /^en-US/i.test(typeof navigator !== 'undefined' ? navigator.language : '');
    const [day, month] = monthFirst ? [b, a] : [a, b];
    return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? new Date(year, month - 1, day, 8, 0) : null;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 0);
}

const EDITABLE = new Set(['code', 'name', 'durationDays', 'start', 'finish', 'percentComplete', 'predecessors', 'constraint', 'resources', 'calendar']);

export function makeGanttEditor(model: ScheduleModel | null, onNote: (text: string) => void): GanttEditor {
  const editable = !!model?.editable;
  const NOT_EDITABLE = NOT_EDITABLE_NOTE;

  const run = <T extends object>(label: string, command: (m: ScheduleModel) => Result<T>): boolean => {
    if (!model || !editable) { onNote(NOT_EDITABLE); return false; }
    const r = commit(label, () => editStructure(programmeKey(model), command));
    if ('error' in r) { onNote(r.error); return false; }
    return true;
  };

  const canEdit = (a: Activity, col: string) => {
    if (!EDITABLE.has(col) && !col.startsWith('code:')) return false;
    if (col === 'durationDays') return a.type === 'task' || a.type === 'loe';
    return true;
  };

  const text = (a: Activity, col: string): string => {
    if (!model) return '';
    switch (col) {
      case 'code': return a.code;
      case 'name': return a.name;
      case 'durationDays': return a.type === 'task' || a.type === 'loe' ? num2(a.durationHours / hoursPerDayOfCalendar(model, a.calendarId)) : '0';
      case 'start': return toIso(startOf(a));
      case 'finish': return toIso(finishOf(a));
      case 'percentComplete': return String(Math.round(a.percentComplete));
      case 'predecessors': return predecessorText(model, a);
      case 'constraint': return constraintText(a);
      case 'resources': return resourcesText(a);
      case 'calendar': return model.calendars.find((c) => c.id === a.calendarId)?.name ?? '';
    }
    return col.startsWith('code:') ? a.activityCodes[col.slice(5)] ?? '' : '';
  };

  const apply = (a: Activity, col: string, raw: string): CellResult => {
    if (!model || !canEdit(a, col)) return 'failed';
    const value = raw.trim();
    // What is already there is left alone: a paste of the whole table must not turn every date into a constraint.
    if (value === text(a, col).trim()) return 'same';
    const done = (ok: boolean): CellResult => (ok ? 'changed' : 'failed');
    switch (col) {
      case 'code': {
        if (!value) { onNote('The Activity ID cannot be empty.'); return 'failed'; }
        if (model.activities.some((x) => x.id !== a.id && x.code.toLowerCase() === value.toLowerCase())) { onNote(`The ID ${value} is already used.`); return 'failed'; }
        return done(run('Set the Activity ID', (m) => patchActivities(m, new Map([[a.id, { code: value }]]))));
      }
      case 'name': return done(run('Rename activity', (m) => patchActivities(m, new Map([[a.id, { name: value }]]))));
      case 'durationDays': return done(run('Set the duration', (m) => setDurationDays(m, a.id, Number(value.replace(',', '.')))));
      case 'start':
      case 'finish': {
        const d = value ? parseLooseDate(value) : null;
        if (value && !d) { onNote(`“${value}” is not a date: type it as 2030-05-31.`); return 'failed'; }
        return done(run(col === 'start' ? 'Set the start' : 'Set the finish', (m) => setDateConstraint(m, a.id, col, d)));
      }
      case 'constraint': return done(run('Set the constraint', (m) => setConstraintText(m, a.id, value, parseLooseDate)));
      case 'predecessors': {
        const parsed = parsePredecessors(value);
        if ('error' in parsed) { onNote(parsed.error); return 'failed'; }
        return done(run('Set the predecessors', (m) => setPredecessors(m, a.id, parsed.entries)));
      }
      case 'resources': return done(run('Set the resources', (m) => setResourcesText(m, a.id, value)));
      case 'percentComplete': return done(run('Set the progress', (m) => setPercent(m, a.id, Number(value.replace('%', '').replace(',', '.')))));
      case 'calendar': {
        const cal = model.calendars.find((c) => c.name.toLowerCase() === value.toLowerCase() || c.id === value);
        if (!cal) { onNote(`There is no calendar “${value}”.`); return 'failed'; }
        return done(run('Set the calendar', (m) => patchActivities(m, new Map([[a.id, { calendarId: cal.id }]]))));
      }
    }
    if (col.startsWith('code:')) return done(run('Set the activity code', (m) => assignCode(m, [a.id], col.slice(5), value === '' ? null : value)));
    return 'failed';
  };

  return { editable, canEdit, text, apply, batch: (label, fn) => { commit(label, fn); },
    note: onNote,
    byCode: (code) => model?.activities.find((x) => x.code.toLowerCase() === code.trim().toLowerCase()),
  };
}
