import { useEffect, useMemo, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { Activity, ScheduleModel } from '../../schedule/types';
import { addActivity, addWbs, deleteActivities, deleteWbs, dissolveActivities, nextCode, renameWbs, type Result } from '../../schedule/programmeCommands';
import { duplicateActivities, indentRows, moveRows, moveRowsToEnd, outdentRows, placeTaskAfter, placeWbsAfter, planRows, type PlanRef, type PlanRow } from '../../schedule/planOrder';
import { hoursPerDayOfCalendar, parsePredecessors, patchActivities, predecessorText, setDateConstraint, setDurationDays, setPercent, setPredecessors, setWbsCode } from '../../schedule/planEdit';
import { rescheduleProgramme } from '../../schedule/reschedule';
import { productivityOf, resourcesText, setProductivity, setResourcesText } from '../../schedule/planResources';
import { assignCode } from '../../schedule/planCodes';
import { constraintText, setConstraintText, setPercentMany, splitActivity } from '../../schedule/planActions';
import { setDataDate } from '../../schedule/programmeCommands';
import { applyLinkShortcut, unlinkActivities, type LinkKind } from '../../schedule/linkShortcuts';
import { useLinkTypeStore } from '../../state/linkTypeStore';
import { editStructure } from '../../state/programmeEdits';
import { commit } from '../../state/programmeHistory';
import { programmeKey } from '../../state/unloadedWbsStore';
import { useActivitySelectionStore } from '../../state/activitySelectionStore';
import { usePersistedState } from '../../utils/persistedState';
import { useDockStore } from '../../state/dockStore';
import { useRowPx } from '../../state/tableStyleStore';

/** The planner: the programme as a tree to build and edit, in the way of P6 and Synchro: WBS nodes as summary rows with their
    activities under them, every cell typed in place, rows moved (Alt+↑ ↓), indented (Tab) and outdented (Shift+Tab) with the
    keyboard or the buttons, and the bars beside them. Each change goes through the same undoable edit as the rest of the app. */

/** Taller rows on a touch screen: a finger needs more than a mouse. */
const BASE_ROW_H = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 36 : 26;
const DAY = 86400000;

/** A column: the fixed ones, and `code:<type>` for each activity code type of the programme. */
type ColumnId = string;

interface Column {
  id: ColumnId;
  label: string;
  width: number;
  title?: string;
  align?: 'right';
}

/** The first two columns stay in view when the grid scrolls sideways. */
const STICKY: Partial<Record<ColumnId, number>> = { code: 0, name: 90 };

const BASE_COLUMNS: Column[] = [
  { id: 'code', label: 'ID', width: 90, title: 'Activity ID (a WBS node: its code)' },
  { id: 'name', label: 'Name', width: 300 },
  { id: 'duration', label: 'Dur (d)', width: 64, align: 'right', title: 'Duration in working days of the activity’s calendar' },
  { id: 'start', label: 'Start', width: 94, title: 'Start. Typing a date holds the activity to start on or after it (a constraint)' },
  { id: 'finish', label: 'Finish', width: 94, title: 'Finish. Typing a date holds the activity to finish on or after it (a constraint)' },
  { id: 'constraint', label: 'Constraint', width: 120, title: 'SNET 2030-05-31 (start no earlier than), SNLT, FNET, FNLT, SO, FO, MSO, MFO, ALAP. Empty: none' },
  { id: 'pred', label: 'Predecessors', width: 170, title: 'Type the IDs: A1000, A1010SS+2 (type FS SS FF SF, then the lag in days)' },
  { id: 'qty', label: 'Quantity', width: 96, align: 'right', title: 'Quantity of work and its unit, like 240 m2. With the productivity it can make the duration (Resources & codes panel)' },
  { id: 'prod', label: 'Prod / day', width: 76, align: 'right', title: 'Output per day for each person or machine of the crew' },
  { id: 'res', label: 'Resources', width: 190, title: 'Type the resources: Gang A x4 (crew at once), Concrete 120 (a quantity). They come from the Dictionary panel' },
  { id: 'percent', label: '%', width: 48, align: 'right', title: 'Progress, percent of the duration' },
  { id: 'calendar', label: 'Calendar', width: 110 },
  { id: 'float', label: 'Float (d)', width: 64, align: 'right', title: 'Total float in working days (a critical activity has none)' },
];

const rowKey = (r: { kind: string; id: string }) => `${r.kind}:${r.id}`;
const refOf = (r: PlanRow): PlanRef => ({ kind: r.kind, id: r.id });

const pad = (n: number) => String(n).padStart(2, '0');
const toInput = (d: Date | null | undefined) => (d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '');
const fromInput = (s: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 8, 0) : null;
};
const show = (d: Date | null | undefined) => (d ? d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' }) : '');
const num2 = (n: number) => String(Math.round(n * 100) / 100);

export function PlannerView({ model, selectedId, onSelect, onNote }: {
  model: ScheduleModel;
  selectedId: string | null;
  onSelect: (activity: Activity | null) => void;
  onNote: (text: string) => void;
}) {
  const ROW_H = useRowPx(BASE_ROW_H);
  const key = programmeKey(model);
  const editable = !!model.editable;
  const [collapsed, setCollapsed] = usePersistedState<string[]>(`planner.collapsed.${key}`, []);
  const collapsedSet = useMemo(() => new Set(collapsed), [collapsed]);
  const rows = useMemo(() => planRows(model, collapsedSet), [model, collapsedSet]);
  // The fixed columns, then one for each activity code type.
  const codeTypes = model.activityCodeCatalog ?? [];
  const COLUMNS = useMemo<Column[]>(() => [...BASE_COLUMNS, ...codeTypes.map((t): Column => ({ id: `code:${t.name}`, label: t.name, width: 110, title: `Activity code “${t.name}”` }))], [codeTypes]);
  const [pxPerDay, setPxPerDay] = usePersistedState('planner.pxPerDay', 6);
  const linkKind = useLinkTypeStore((s) => s.kind);
  const setLinkKind = useLinkTypeStore((s) => s.setKind);

  // ---- Selection: the rows picked (by kind and id) and the cell the cursor is in.
  const [picked, setPicked] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ row: string; col: ColumnId } | null>(null);
  const [edit, setEdit] = useState<{ row: string; col: ColumnId; draft: string; seeded?: boolean } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ top: 0, height: 600 });

  const byKey = useMemo(() => new Map(rows.map((r, i) => [rowKey(r), i])), [rows]);
  const index = (k: string | undefined | null) => (k ? byKey.get(k) ?? -1 : -1);
  const pickedRefs = (): PlanRef[] => {
    const set = new Set(picked);
    const list = rows.filter((r) => set.has(rowKey(r))).map(refOf);
    if (list.length) return list;
    const c = cursor ? rows[index(cursor.row)] : undefined;
    return c ? [refOf(c)] : [];
  };

  /** Mirrors the picked activities into the shared selection (the toolbar's Link and the details pane work on them). */
  const syncSelection = (keys: string[], current: string | null) => {
    const ids = new Set(keys.filter((k) => k.startsWith('task:')).map((k) => k.slice(5)));
    useActivitySelectionStore.setState({ ids, anchor: current && current.startsWith('task:') ? current.slice(5) : null });
    const a = current && current.startsWith('task:') ? model.activities.find((x) => x.id === current.slice(5)) : undefined;
    if (a) onSelect(a);
  };

  const choose = (k: string, mods: { ctrl?: boolean; shift?: boolean } = {}, col?: ColumnId) => {
    let next: string[];
    if (mods.shift && anchor !== null && index(anchor) >= 0) {
      const [a, b] = [index(anchor), index(k)].sort((x, y) => x - y);
      next = rows.slice(a, b + 1).map(rowKey);
    } else if (mods.ctrl) next = picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k];
    else next = [k];
    if (!mods.shift) setAnchor(k);
    setPicked(next);
    setCursor({ row: k, col: col ?? cursor?.col ?? 'name' });
    syncSelection(next, k);
  };

  // The activity picked elsewhere (the Gantt, the details pane's links) moves the cursor here.
  useEffect(() => {
    if (selectedId && cursor?.row !== `task:${selectedId}` && byKey.has(`task:${selectedId}`)) {
      const k = `task:${selectedId}`;
      setPicked([k]);
      setCursor({ row: k, col: cursor?.col ?? 'name' });
      setAnchor(k);
    }
    // Only a change of the activity picked elsewhere matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // ---- Doing things: every change is one undoable edit.
  const run = <T extends object>(label: string, command: (m: ScheduleModel) => Result<T>): (Omit<{ model: ScheduleModel } & T, 'model'>) | null => {
    if (!editable) { onNote('This programme is not edited in place: make an editable copy of it first (Inputs, the pencil).'); return null; }
    const r = commit(label, () => editStructure(key, command));
    if ('error' in r) { onNote(r.error); return null; }
    return r as Omit<{ model: ScheduleModel } & T, 'model'>;
  };

  const focusCell = (k: string, col: ColumnId, begin = false) => {
    setCursor({ row: k, col });
    const at = index(k);
    const el = scroller.current;
    if (el && at >= 0) {
      const top = at * ROW_H;
      if (top < el.scrollTop) el.scrollTop = top;
      else if (top + ROW_H > el.scrollTop + el.clientHeight - ROW_H) el.scrollTop = top + ROW_H - el.clientHeight + ROW_H * 2;
    }
    if (begin) window.setTimeout(() => startEdit(k, col), 0);
  };

  const cellText = (r: PlanRow, col: ColumnId): string => {
    const a = r.activity;
    const cal = a ? model.calendars.find((c) => c.id === a.calendarId) : undefined;
    const perDay = hoursPerDayOfCalendar(model, a?.calendarId ?? null);
    switch (col) {
      case 'code': return r.kind === 'wbs' ? r.wbs!.code ?? '' : a!.code;
      case 'name': return r.kind === 'wbs' ? r.wbs!.name : a!.name;
      case 'duration': return r.kind === 'wbs' ? '' : a!.type === 'task' || a!.type === 'loe' ? num2(a!.durationHours / perDay) : '0';
      case 'start': return show(r.kind === 'wbs' ? r.summary?.start : a!.earlyStart ?? a!.targetStart);
      case 'finish': return show(r.kind === 'wbs' ? r.summary?.finish : a!.earlyFinish ?? a!.targetFinish);
      case 'pred': return a ? predecessorText(model, a) : '';
      case 'constraint': return a ? constraintText(a) : '';
      case 'percent': return r.kind === 'wbs' ? `${Math.round(r.summary?.percent ?? 0)}` : `${Math.round(a!.percentComplete)}`;
      case 'calendar': return cal?.name ?? '';
      case 'float': return a?.totalFloatHours != null ? num2(a.totalFloatHours / perDay) : '';
      case 'qty': { if (!a) return ''; const p = productivityOf(a); return p.quantity === null ? '' : `${p.quantity}${p.unit ? ` ${p.unit}` : ''}`; }
      case 'prod': { const p = a ? productivityOf(a).perDay : null; return p === null || p === undefined ? '' : String(p); }
      case 'res': return a ? resourcesText(a) : '';
    }
    if (col.startsWith('code:')) return a?.activityCodes[col.slice(5)] ?? '';
    return '';
  };

  const editText = (r: PlanRow, col: ColumnId): string => {
    const a = r.activity;
    switch (col) {
      case 'start': return toInput(a?.constraintType === 'CS_MSOA' ? a.constraintDate : a?.earlyStart);
      case 'finish': return toInput(a?.constraintType === 'CS_MEOA' ? a.constraintDate : a?.earlyFinish);
      default: return cellText(r, col);
    }
  };

  const canEdit = (r: PlanRow, col: ColumnId) => {
    if (r.kind === 'wbs') return col === 'code' || col === 'name';
    if (col === 'float') return false;
    if (col === 'duration' && actOf(r)!.type !== 'task' && actOf(r)!.type !== 'loe') return false;
    return true;
  };
  const actOf = (r: PlanRow) => r.activity;

  const startEdit = (k: string, col: ColumnId, seed?: string) => {
    const r = rows[index(k)];
    if (!r || !canEdit(r, col)) return;
    if (!editable) { onNote('This programme is not edited in place: make an editable copy of it first (Inputs, the pencil).'); return; }
    setEdit({ row: k, col, draft: seed ?? editText(r, col), seeded: seed !== undefined });
  };

  const apply = (k: string, col: ColumnId, text: string): boolean => {
    const r = rows[index(k)];
    if (!r || !canEdit(r, col)) return false;
    const value = text.trim();
    if (r.kind === 'wbs') {
      if (col === 'name') return run('Rename WBS node', (m) => renameWbs(m, r.id, value)) !== null;
      return run('Set the WBS code', (m) => setWbsCode(m, r.id, value)) !== null;
    }
    const act = r.activity!;
    switch (col) {
      case 'code': {
        if (!value) { onNote('The Activity ID cannot be empty.'); return false; }
        if (model.activities.some((x) => x.id !== act.id && x.code.toLowerCase() === value.toLowerCase())) { onNote(`The ID ${value} is already used.`); return false; }
        return run('Set the Activity ID', (m) => patchActivities(m, new Map([[act.id, { code: value }]]))) !== null;
      }
      case 'name': return run('Rename activity', (m) => patchActivities(m, new Map([[act.id, { name: value }]]))) !== null;
      case 'duration': return run('Set the duration', (m) => setDurationDays(m, act.id, Number(value.replace(',', '.')))) !== null;
      case 'start':
      case 'finish': {
        const d = value ? fromInput(value) ?? parseLooseDate(value) : null;
        if (value && !d) { onNote('Type the date as 2030-05-31 (year-month-day).'); return false; }
        return run(col === 'start' ? 'Set the start' : 'Set the finish', (m) => setDateConstraint(m, act.id, col, d)) !== null;
      }
      case 'constraint': return run('Set the constraint', (m) => setConstraintText(m, act.id, value, (t) => fromInput(t) ?? parseLooseDate(t))) !== null;
      case 'pred': {
        const parsed = parsePredecessors(value);
        if ('error' in parsed) { onNote(parsed.error); return false; }
        return run('Set the predecessors', (m) => setPredecessors(m, act.id, parsed.entries)) !== null;
      }
      case 'qty': {
        const m = /^\s*(-?\d+(?:[.,]\d+)?)?\s*(.*)$/.exec(value);
        const q = m?.[1] ? Number(m[1].replace(',', '.')) : null;
        return run('Set the quantity', (mm) => setProductivity(mm, act.id, { quantity: value === '' ? null : q, unit: m?.[2] ?? '' })) !== null;
      }
      case 'prod': return run('Set the productivity', (m) => setProductivity(m, act.id, { perDay: value === '' ? null : Number(value.replace(',', '.')) })) !== null;
      case 'res': return run('Set the resources', (m) => setResourcesText(m, act.id, value)) !== null;
      case 'percent': return run('Set the progress', (m) => setPercent(m, act.id, Number(value.replace(',', '.')))) !== null;
      case 'calendar': {
        const cal = model.calendars.find((c) => c.name.toLowerCase() === value.toLowerCase() || c.id === value);
        if (!cal) { onNote(`There is no calendar “${value}”.`); return false; }
        return run('Set the calendar', (m) => patchActivities(m, new Map([[act.id, { calendarId: cal.id }]]))) !== null;
      }
    }
    if (col.startsWith('code:')) return run('Set the activity code', (m) => assignCode(m, [act.id], col.slice(5), value === '' ? null : value)) !== null;
    return false;
  };

  const finishEdit = (save: boolean, move?: 'next' | 'down' | 'prev') => {
    if (!edit) return;
    const { row, col, draft } = edit;
    setEdit(null);
    let ok = true;
    if (save) ok = apply(row, col, draft);
    root.current?.focus();
    if (!ok || !move) return;
    const colsOpen = COLUMNS.map((c) => c.id);
    const at = index(row);
    if (move === 'down') { const next = rows[Math.min(rows.length - 1, at + 1)]; if (next) focusCell(rowKey(next), col); return; }
    const ci = colsOpen.indexOf(col) + (move === 'next' ? 1 : -1);
    if (ci >= 0 && ci < colsOpen.length) focusCell(row, colsOpen[ci]);
  };

  // ---- Row actions
  const addRow = (kind: 'task' | 'milestone-finish' | 'wbs') => {
    const c = cursor ? rows[index(cursor.row)] : undefined;
    if (kind === 'wbs') {
      const name = window.prompt('Name of the new WBS node:', '')?.trim();
      if (!name) return;
      const parent = c ? (c.kind === 'wbs' ? c.wbs!.parentId : c.parentId) : null;
      const r = run('Add WBS node', (m) => {
        const made = addWbs(m, name, parent);
        if ('error' in made) return made;
        return { model: c && c.kind === 'wbs' ? placeWbsAfter(made.model, made.id, c.id) : made.model, id: made.id };
      });
      if (r) { const k = `wbs:${(r as { id: string }).id}`; setPicked([k]); setCursor({ row: k, col: 'name' }); }
      return;
    }
    const r = run(kind === 'task' ? 'Add activity' : 'Add milestone', (m) => {
      const made = addActivity(m, { after: c?.kind === 'task' ? c.id : undefined, wbsId: c?.kind === 'wbs' ? c.id : undefined, type: kind });
      if ('error' in made) return made;
      return { model: c?.kind === 'task' ? placeTaskAfter(made.model, made.id, c.id) : made.model, id: made.id };
    });
    if (!r) return;
    const id = (r as { id: string }).id;
    const k = `task:${id}`;
    if (c?.kind === 'wbs') setCollapsed(collapsed.filter((x) => x !== c.id));
    setPicked([k]);
    setAnchor(k);
    syncSelection([k], k);
    setCursor({ row: k, col: 'name' });
    window.setTimeout(() => setEdit({ row: k, col: 'name', draft: 'New activity' }), 30);
  };

  const removeRows = () => {
    const refs = pickedRefs();
    if (!refs.length) return onNote('Pick the rows to delete first.');
    const tasks = refs.filter((r) => r.kind === 'task').map((r) => r.id);
    const nodes = refs.filter((r) => r.kind === 'wbs').map((r) => r.id);
    const done = run(`Delete ${refs.length} ${refs.length === 1 ? 'row' : 'rows'}`, (m) => {
      let model = m;
      if (tasks.length) {
        const r = deleteActivities(model, tasks);
        if ('error' in r) return r;
        model = r.model;
      }
      // Deepest nodes first, so a node goes after what is below it.
      for (const id of [...nodes].reverse()) {
        const r = deleteWbs(model, id);
        if ('error' in r) return r;
        model = r.model;
      }
      return { model };
    });
    if (done) { setPicked([]); setCursor(null); useActivitySelectionStore.getState().clear(); onSelect(null); onNote(`Deleted ${refs.length} ${refs.length === 1 ? 'row' : 'rows'}. Undo (Ctrl+Z) puts them back.`); }
  };

  const duplicate = () => {
    const ids = pickedRefs().filter((r) => r.kind === 'task').map((r) => r.id);
    if (!ids.length) return onNote('Pick the activities to duplicate first.');
    const r = run('Duplicate', (m) => duplicateActivities(m, ids, (used) => String(1 + Math.max(0, ...used.map((u) => (/^\d+$/.test(u) ? Number(u) : 0)))), nextCode));
    if (r) {
      const keys = (r as { ids: string[] }).ids.map((id) => `task:${id}`);
      setPicked(keys);
      setCursor({ row: keys[0], col: 'name' });
    }
  };

  const move = (how: 'up' | 'down' | 'top' | 'bottom') => {
    const refs = pickedRefs();
    run('Move rows', (m) => (how === 'up' || how === 'down' ? moveRows(m, refs, how) : moveRowsToEnd(m, refs, how === 'top' ? 'top' : 'bottom')));
  };
  const indent = () => { const refs = pickedRefs(); run('Indent', (m) => indentRows(m, refs)); };
  const outdent = () => { const refs = pickedRefs(); run('Outdent', (m) => outdentRows(m, refs)); };
  const schedule = () => { void rescheduleProgramme(model).then(onNote); };
  const dataDate0 = model.project.dataDate;
  const changeDataDate = (value: string) => {
    const d = fromInput(value);
    if (d) run('Set the data date', (m) => setDataDate(m, new Date(d.getFullYear(), d.getMonth(), d.getDate(), dataDate0?.getHours() ?? 8, dataDate0?.getMinutes() ?? 0)));
  };
  /** The activities picked, in the order they were picked (a chain follows that order). */
  const pickedTaskIds = () => {
    const ids = picked.filter((k) => k.startsWith('task:')).map((k) => k.slice(5));
    return ids.length ? ids : pickedRefs().filter((r) => r.kind === 'task').map((r) => r.id);
  };
  const linkPicked = () => onNote(applyLinkShortcut(linkKind, model, pickedTaskIds()).message);
  const unlinkPicked = () => onNote(unlinkActivities(model, pickedTaskIds()).message);
  const split = () => {
    const ids = pickedTaskIds();
    if (ids.length !== 1) return onNote('Pick one activity to split.');
    const n = Number(window.prompt('Split into how many parts?', '2'));
    if (!n) return;
    const done = run('Split activity', (m) => splitActivity(m, ids[0], n));
    if (done) onNote(`Split into ${n} parts, one after the other. Undo (Ctrl+Z) puts it back.`);
  };
  const progress = (percent: number) => {
    const ids = pickedTaskIds();
    const done = run(`Progress ${percent}%`, (m) => setPercentMany(m, ids, percent));
    if (done) onNote(`${(done as { done: number }).done} ${(done as { done: number }).done === 1 ? 'activity' : 'activities'} set to ${percent}%, as of the data date.`);
  };
  const dissolve = () => {
    const ids = pickedTaskIds();
    if (!ids.length) return onNote('Pick the activities to dissolve first.');
    const done = run(`Dissolve ${ids.length} ${ids.length === 1 ? 'activity' : 'activities'}`, (m) => dissolveActivities(m, ids));
    if (done) {
      const { removed, bridged } = done as { removed: number; bridged: number };
      setPicked([]); setCursor(null); useActivitySelectionStore.getState().clear(); onSelect(null);
      onNote(`Dissolved ${removed} ${removed === 1 ? 'activity' : 'activities'}: ${bridged} ${bridged === 1 ? 'link joins' : 'links join'} what was before them to what was after. Undo (Ctrl+Z) puts them back.`);
    }
  };
  const toggle = (id: string) => setCollapsed(collapsedSet.has(id) ? collapsed.filter((x) => x !== id) : [...collapsed, id]);
  const expandAll = () => setCollapsed([]);
  const collapseAll = () => setCollapsed(rows.filter((r) => r.kind === 'wbs' && r.hasChildren).map((r) => r.id).concat(model.wbs.map((n) => n.id)).filter((v, i, l) => l.indexOf(v) === i));

  // ---- Excel-like: fill down (Ctrl+D, or drag the square at the corner of the range), copy and paste cells. One undo step each.
  const pickedRange = (): { lo: number; hi: number } | null => {
    const idxs = picked.map(index).filter((i) => i >= 0);
    if (idxs.length) return { lo: Math.min(...idxs), hi: Math.max(...idxs) };
    const at = cursor ? index(cursor.row) : -1;
    return at >= 0 ? { lo: at, hi: at } : null;
  };
  /** The cells srcLo..srcHi of a column are copied down over the rows after srcHi, up to `end` (the source repeats if shorter). */
  const fillCells = (srcLo: number, srcHi: number, end: number, col: ColumnId) => {
    const len = srcHi - srcLo + 1;
    let n = 0;
    commit('Fill down', () => {
      for (let i = srcHi + 1; i <= end; i++) {
        const from = rows[srcLo + ((i - srcHi - 1) % len)];
        const to = rows[i];
        if (!from || !to || !canEdit(from, col) || !canEdit(to, col)) continue;
        if (apply(rowKey(to), col, editText(from, col))) n++;
      }
    });
    if (n) onNote(`Filled ${n} ${n === 1 ? 'cell' : 'cells'}. Undo (Ctrl+Z) takes the fill back in one step.`);
  };
  const fillDown = () => {
    const range = pickedRange();
    if (!cursor || !range) return;
    if (range.hi > range.lo) fillCells(range.lo, range.lo, range.hi, cursor.col);
    else if (range.lo > 0) fillCells(range.lo - 1, range.lo - 1, range.lo, cursor.col);
  };
  const startFill = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const range = pickedRange();
    if (!cursor || !range) return;
    const { lo, hi } = range;
    const col = cursor.col;
    let end = hi;
    const move = (ev: MouseEvent) => {
      const box = scroller.current?.getBoundingClientRect();
      if (box && scroller.current) {
        if (ev.clientY > box.bottom - 24) scroller.current.scrollTop += 24;
        else if (ev.clientY < box.top + 50) scroller.current.scrollTop -= 24;
      }
      const key = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-rowkey]')?.dataset.rowkey;
      const i = key ? index(key) : -1;
      if (i < 0) return;
      end = Math.max(hi, i);
      setPicked(rows.slice(lo, end + 1).map(rowKey));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (end > hi) fillCells(lo, hi, end, col);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const onCopy = (e: ReactClipboardEvent) => {
    if (edit || !cursor || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
    const range = pickedRange();
    if (!range) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', rows.slice(range.lo, range.hi + 1).map((r) => editText(r, cursor.col)).join('\n'));
    onNote(`Copied ${range.hi - range.lo + 1} ${range.hi === range.lo ? 'cell' : 'cells'}.`);
  };
  const onPaste = (e: ReactClipboardEvent) => {
    if (edit || !cursor || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    const grid = lines.map((l) => l.split('\t'));
    const range = pickedRange();
    const start = index(cursor.row);
    const col0 = COLUMNS.findIndex((c) => c.id === cursor.col);
    let n = 0;
    commit('Paste', () => {
      // One value into several picked rows: it goes into all of them, as in Excel.
      if (grid.length === 1 && grid[0].length === 1 && range && range.hi > range.lo) {
        for (let i = range.lo; i <= range.hi; i++) if (rows[i] && canEdit(rows[i], cursor.col) && apply(rowKey(rows[i]), cursor.col, grid[0][0])) n++;
        return;
      }
      grid.forEach((cells, dr) => {
        const to = rows[start + dr];
        if (!to) return;
        cells.forEach((value, dc) => {
          const col = COLUMNS[col0 + dc];
          if (col && canEdit(to, col.id) && apply(rowKey(to), col.id, value)) n++;
        });
      });
    });
    onNote(n ? `Pasted ${n} ${n === 1 ? 'cell' : 'cells'}.` : 'Nothing could be pasted there.');
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (edit) return;
    const t = e.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const at = cursor ? index(cursor.row) : -1;
    const ctrl = e.ctrlKey || e.metaKey;
    const go = (to: number, extend: boolean) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, to))];
      if (r) { choose(rowKey(r), { shift: extend }, cursor?.col); focusCell(rowKey(r), cursor?.col ?? 'name'); }
    };
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'Tab') { stop(); if (e.shiftKey) outdent(); else indent(); return; }
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { stop(); move(e.key === 'ArrowUp' ? 'up' : 'down'); return; }
    if (e.altKey && e.key === 'ArrowLeft') { stop(); outdent(); return; }
    if (e.altKey && e.key === 'ArrowRight') { stop(); indent(); return; }
    if (e.key === 'ArrowDown') { stop(); go(at + 1, e.shiftKey); return; }
    if (e.key === 'ArrowUp') { stop(); go(at - 1, e.shiftKey); return; }
    if (e.key === 'PageDown') { stop(); go(at + 15, e.shiftKey); return; }
    if (e.key === 'PageUp') { stop(); go(at - 15, e.shiftKey); return; }
    if (e.key === 'Home') { stop(); if (cursor) focusCell(cursor.row, ctrl ? 'code' : 'code'); if (ctrl) go(0, e.shiftKey); return; }
    if (e.key === 'End' && ctrl) { stop(); go(rows.length - 1, e.shiftKey); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      stop();
      const r = rows[at];
      if (ctrl && r?.kind === 'wbs') { if (e.key === 'ArrowLeft') { if (!collapsedSet.has(r.id)) toggle(r.id); } else if (collapsedSet.has(r.id)) toggle(r.id); return; }
      if (!cursor) return;
      const ids = COLUMNS.map((c) => c.id);
      const ci = ids.indexOf(cursor.col) + (e.key === 'ArrowRight' ? 1 : -1);
      if (ci >= 0 && ci < ids.length) setCursor({ row: cursor.row, col: ids[ci] });
      return;
    }
    if (e.key === 'F2' || e.key === 'Enter') { stop(); if (cursor) startEdit(cursor.row, cursor.col); return; }
    if (e.key === 'F9') { stop(); schedule(); return; }
    if (e.key === 'Insert') { stop(); addRow(e.shiftKey ? 'wbs' : e.ctrlKey ? 'milestone-finish' : 'task'); return; }
    if (e.key === 'Delete') { stop(); if (ctrl) dissolve(); else removeRows(); return; }
    if (ctrl && e.key.toLowerCase() === 'd') { stop(); if (e.shiftKey) duplicate(); else fillDown(); return; }
    if (ctrl && e.key.toLowerCase() === 'a') { stop(); const all = rows.map(rowKey); setPicked(all); syncSelection(all, cursor?.row ?? null); return; }
    if (e.key === 'Escape') { setPicked([]); return; }
    // Typing starts editing the cell with what was typed.
    if (!ctrl && !e.altKey && e.key.length === 1 && cursor) { stop(); startEdit(cursor.row, cursor.col, e.key); }
  };

  // ---- The bars
  const span = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of rows) {
      const s = r.kind === 'wbs' ? r.summary?.start : r.activity!.earlyStart ?? r.activity!.targetStart;
      const f = r.kind === 'wbs' ? r.summary?.finish : r.activity!.earlyFinish ?? r.activity!.targetFinish;
      if (s) lo = Math.min(lo, s.getTime());
      if (f) hi = Math.max(hi, f.getTime());
    }
    if (!Number.isFinite(lo)) { lo = Date.now(); hi = lo + 30 * DAY; }
    const start = Math.floor(lo / DAY) * DAY - 7 * DAY;
    return { start, days: Math.max(30, Math.ceil((hi - start) / DAY) + 30) };
  }, [rows]);
  const timelineWidth = span.days * pxPerDay;
  const x = (d: Date) => ((d.getTime() - span.start) / DAY) * pxPerDay;

  const gridWidth = COLUMNS.reduce((s, c) => s + c.width, 0);
  const first = Math.max(0, Math.floor(scroll.top / ROW_H) - 8);
  const last = Math.min(rows.length, Math.ceil((scroll.top + scroll.height) / ROW_H) + 8);
  const dataDate = model.project.dataDate;
  // The square to drag down sits at the corner of the range: its last row.
  const fillRange = pickedRange();
  const fillRowKey = fillRange && rows[fillRange.hi] ? rowKey(rows[fillRange.hi]) : null;

  const ticks = useMemo(() => {
    const out: { left: number; label: string; major: boolean }[] = [];
    const d = new Date(span.start);
    d.setDate(1);
    d.setMonth(d.getMonth() + 1);
    for (let i = 0; i < 400 && d.getTime() < span.start + span.days * DAY; i++) {
      out.push({ left: ((d.getTime() - span.start) / DAY) * pxPerDay, label: d.toLocaleDateString(undefined, { month: 'short', year: d.getMonth() === 0 ? '2-digit' : undefined }), major: d.getMonth() === 0 });
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  }, [span, pxPerDay]);

  const cell = (r: PlanRow, c: Column): ReactNode => {
    const k = rowKey(r);
    const editing = edit && edit.row === k && edit.col === c.id;
    if (editing) {
      return (
        <input
          className="planner__input"
          autoFocus
          value={edit.draft}
          type={c.id === 'start' || c.id === 'finish' ? 'date' : 'text'}
          onChange={(e) => setEdit({ ...edit, draft: e.target.value })}
          onFocus={(e) => { if (e.target.type !== 'text') return; if (edit.seeded) e.target.setSelectionRange(e.target.value.length, e.target.value.length); else e.target.select(); }}
          onBlur={() => finishEdit(true)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); finishEdit(true, e.shiftKey ? 'prev' : 'down'); }
            else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); }
            else if (e.key === 'Tab') { e.preventDefault(); finishEdit(true, e.shiftKey ? 'prev' : 'next'); }
          }}
        />
      );
    }
    const text = cellText(r, c.id);
    if (c.id === 'name') {
      return (
        <span className="planner__name" style={{ paddingLeft: r.depth * 16 }}>
          {r.kind === 'wbs' ? (
            <button type="button" className="planner__twist" tabIndex={-1} onClick={(ev) => { ev.stopPropagation(); toggle(r.id); }} aria-label={collapsedSet.has(r.id) ? 'Expand' : 'Collapse'}>{r.hasChildren ? (collapsedSet.has(r.id) ? '▸' : '▾') : ''}</button>
          ) : <span className="planner__twist" />}
          <span className="planner__text" title={text}>{text}</span>
        </span>
      );
    }
    return <span className="planner__text" title={text}>{text}</span>;
  };

  const bar = (r: PlanRow) => {
    if (r.kind === 'wbs') {
      const s = r.summary?.start;
      const f = r.summary?.finish;
      if (!s || !f) return null;
      return <span className="planner__summary" style={{ left: x(s), width: Math.max(2, x(f) - x(s)) }} />;
    }
    const act = r.activity!;
    const s = act.earlyStart ?? act.targetStart;
    const f = act.earlyFinish ?? act.targetFinish ?? s;
    if (!s || !f) return null;
    if (act.type === 'milestone-start' || act.type === 'milestone-finish') return <span className={`planner__milestone${act.isCritical ? ' is-critical' : ''}`} style={{ left: x(act.type === 'milestone-start' ? s : f) - 6 }} />;
    const width = Math.max(3, x(f) - x(s));
    return (
      <span className={`planner__bar${act.isCritical ? ' is-critical' : ''}${act.status === 'completed' ? ' is-done' : ''}`} style={{ left: x(s), width }} title={`${act.code} ${act.name}`}>
        {act.percentComplete > 0 && <span className="planner__done" style={{ width: `${Math.min(100, act.percentComplete)}%` }} />}
      </span>
    );
  };

  if (rows.length === 0) {
    return (
      <div className="planner">
        <div className="planner__empty">
          This programme has no activities yet.
          {editable ? <button type="button" className="btn primary" onClick={() => addRow('wbs')}>Add a WBS node</button> : ' Make an editable copy of a programme (Inputs) to build it here.'}
        </div>
      </div>
    );
  }

  return (
    <div className="planner" ref={root} tabIndex={0} onKeyDown={onKeyDown} onCopy={onCopy} onPaste={onPaste} aria-label="Planner: arrow keys move, Enter edits, Tab indents, Shift+Tab outdents, Alt+Up and Alt+Down move the rows">
      <div className="planner__bar">
        <span className="planner__group">
          <button type="button" className="btn btn--small" onClick={() => addRow('task')} title="Add an activity after the one picked (Insert)">+ Activity</button>
          <button type="button" className="btn btn--small" onClick={() => addRow('milestone-finish')} title="Add a milestone (Ctrl+Insert)">+ Milestone</button>
          <button type="button" className="btn btn--small" onClick={() => addRow('wbs')} title="Add a WBS node after the one picked (Shift+Insert)">+ WBS</button>
          <button type="button" className="btn btn--small" onClick={duplicate} title="Duplicate the picked activities (Ctrl+Shift+D)">Duplicate</button>
          <button type="button" className="btn btn--small" onClick={removeRows} title="Delete the picked rows (Delete)">Delete</button>
          <button type="button" className="btn btn--small" onClick={split} title="Split the picked activity into parts one after the other">Split</button>
          <button type="button" className="btn btn--small" onClick={dissolve} title="Dissolve the picked activities (Ctrl+Delete): they are taken out and what was before them is linked to what was after, so the logic stays">Dissolve</button>
        </span>
        <span className="planner__group">
          <button type="button" className="btn btn--small" onClick={() => move('up')} title="Move the picked rows up (Alt+↑)">▲</button>
          <button type="button" className="btn btn--small" onClick={() => move('down')} title="Move the picked rows down (Alt+↓)">▼</button>
          <button type="button" className="btn btn--small" onClick={outdent} title="Outdent: out of the WBS node (Shift+Tab)">⇤</button>
          <button type="button" className="btn btn--small" onClick={indent} title="Indent: into the WBS node above (Tab)">⇥</button>
        </span>
        <span className="planner__group">
          <button type="button" className="btn btn--small" onClick={expandAll} title="Open every WBS node">Expand</button>
          <button type="button" className="btn btn--small" onClick={collapseAll} title="Close every WBS node">Collapse</button>
          <button type="button" className="btn btn--small" onClick={schedule} title="Calculate the dates and float again (F9)">Schedule F9</button>
          <button type="button" className="btn btn--small" onClick={() => useDockStore.getState().reveal('planning')} title="Quantity, productivity, resources and codes of the picked activities">Resources &amp; codes</button>
          <button type="button" className="btn btn--small" onClick={() => useDockStore.getState().reveal('dictionary')} title="The programme's resources and activity code types and values">Dictionary</button>
        </span>
        <span className="planner__group">
          <label className="planner__zoom" title="The data date: progress is as of this day. What is not started cannot start before it.">Data date <input type="date" value={toInput(dataDate0)} onChange={(e) => changeDataDate(e.target.value)} /></label>
          <span className="np__seg" role="radiogroup" aria-label="Link type">
            {(['FS', 'SS', 'FF', 'SF'] as LinkKind[]).map((k) => <button key={k} type="button" role="radio" aria-checked={linkKind === k} className={linkKind === k ? 'is-on' : ''} onClick={() => setLinkKind(k)}>{k}</button>)}
          </span>
          <button type="button" className="btn btn--small" onClick={linkPicked} title="Link the picked activities with the type chosen: a chain in the order picked (the type is also in the status bar)">Link</button>
          <span className="np__seg" aria-label="Progress of the picked activities">
            {[0, 25, 50, 75, 100].map((p) => <button key={p} type="button" onClick={() => progress(p)} title={`Set the picked activities to ${p}% as of the data date`}>{p}%</button>)}
          </span>
          <button type="button" className="btn btn--small" onClick={unlinkPicked} title="Break the links between the picked activities">Unlink</button>
        </span>
        <span className="planner__group planner__zoom">
          <label>Zoom <input type="range" min={1} max={30} value={pxPerDay} onChange={(e) => setPxPerDay(Number(e.target.value))} /></label>
        </span>
        <span className="planner__hint">Enter edits · Tab / Shift+Tab indent · Alt+↑↓ move · Insert adds · Delete · Ctrl+D fills down (or drag the corner square) · Ctrl+C / V copy and paste cells · Ctrl+Shift+D duplicates · F9 schedules</span>
      </div>
      <div className="planner__scroll" ref={scroller} onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })} onMouseDown={() => { if (!edit) root.current?.focus(); }}>
        <div style={{ width: gridWidth + timelineWidth, minWidth: '100%' }}>
          <div className="planner__head">
            <div className="planner__headgrid" style={{ width: gridWidth }}>
              {COLUMNS.map((c) => <span key={c.id} className={`planner__hcell${c.id in STICKY ? ' is-sticky' : ''}`} style={{ width: c.width, textAlign: c.align, left: STICKY[c.id] }} title={c.title}>{c.label}</span>)}
            </div>
            <div className="planner__timehead" style={{ width: timelineWidth }}>
              {ticks.map((t, i) => <span key={i} className={`planner__tick${t.major ? ' is-major' : ''}`} style={{ left: t.left }}>{t.label}</span>)}
            </div>
          </div>
          <div style={{ height: rows.length * ROW_H, position: 'relative' }}>
            {dataDate && <span className="planner__datadate" style={{ left: gridWidth + x(dataDate), height: rows.length * ROW_H }} title="Data date" />}
            {rows.slice(first, last).map((r, i) => {
              const k = rowKey(r);
              const on = picked.includes(k);
              return (
                <div
                  key={k}
                  data-rowkey={k}
                  className={`planner__row${r.kind === 'wbs' ? ' is-wbs' : ''}${on ? ' is-picked' : ''}${r.activity?.isCritical ? ' is-critical' : ''}`}
                  style={{ top: (first + i) * ROW_H, height: ROW_H }}
                  onMouseDown={(e) => {
                    if ((e.target as HTMLElement).tagName === 'INPUT') return;
                    const col = (e.target as HTMLElement).closest<HTMLElement>('[data-col]')?.dataset.col as ColumnId | undefined;
                    choose(k, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }, col ?? cursor?.col);
                  }}
                >
                  <div className="planner__cells" style={{ width: gridWidth }}>
                    {COLUMNS.map((c) => (
                      <div
                        key={c.id}
                        className={`planner__cell${c.id in STICKY ? ' is-sticky' : ''}${cursor?.row === k && cursor.col === c.id ? ' is-cursor' : ''}${on && picked.length > 1 && cursor?.col === c.id ? ' is-range' : ''}${c.align === 'right' ? ' is-right' : ''}${canEdit(r, c.id) ? '' : ' is-readonly'}`}
                        style={{ width: c.width, left: STICKY[c.id] }}
                        data-col={c.id}
                        onDoubleClick={() => startEdit(k, c.id)}
                      >
                        {cell(r, c)}
                        {editable && !edit && cursor?.col === c.id && k === fillRowKey && canEdit(r, c.id) && (
                          <span className="planner__fill" onMouseDown={startFill} title="Drag down to fill (Ctrl+D)" />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="planner__line" style={{ width: timelineWidth }}>{bar(r)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "31/5/2030", "31 May 2030" and the like, as the browser reads them. */
function parseLooseDate(text: string): Date | null {
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 0);
}
