import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import type { Activity } from '../../schedule/types';
import type { ColumnCtx, ColumnDef } from '../../schedule/columns';
import { NOT_EDITABLE_NOTE, parseTsv, tsvCell, type GanttEditor } from '../../schedule/ganttEdit';

/** The spreadsheet behaviour of a grid of activities (the Gantt's label grid, the Table view), always on: the cell under the cursor
    takes typing (a letter starts it over, F2 / Enter edit what is there, Tab moves across), and copy and paste work with Excel:
    several picked rows are copied with their headings, and a block pasted back is matched by Activity ID and heading, so it may be
    sorted or filtered in Excel. Only cells that changed are set, and a paste is one undo step. The cursor's row is the selected
    activity; the grid only has to show `is-cursor` on the cell and an input while `edit` is set. */
export interface SheetEditingOptions {
  editor?: GanttEditor;
  /** The columns shown, in order. */
  columns: ColumnDef[];
  /** Every column the schedule offers (a pasted block may name columns that are not shown). */
  catalog?: ColumnDef[];
  columnCtx: ColumnCtx;
  /** The activities in the order listed now (collapsed groups left out). */
  shown: Activity[];
  selectedId: string | null;
  /** The rows picked with Ctrl / Shift click. */
  picked: Set<string>;
  /** Enter in a cell moves down one row. */
  moveDown: () => void;
  /** Puts the focus back on the grid when an edit is over. */
  refocus?: () => void;
}

const isField = (t: EventTarget) => /^(INPUT|TEXTAREA|SELECT)$/.test((t as HTMLElement).tagName);

export function useSheetEditing(o: SheetEditingOptions) {
  const { editor, columns, catalog, columnCtx, shown, selectedId, picked } = o;
  const [curCol, setCurCol] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ id: string; col: string; draft: string; seeded: boolean } | null>(null);
  // The edit in force, read at once: finishing it takes the input away, and its blur must not save it a second time.
  const editRef = useRef(edit);
  editRef.current = edit;
  const latest = useRef(o);
  latest.current = o;

  const byId = (id: string | null) => (id ? shown.find((a) => a.id === id) : undefined);
  const idColumn = catalog?.find((c) => c.id === 'code') ?? columns.find((c) => c.id === 'code');
  const withId = (cols: ColumnDef[]) => (idColumn && !cols.some((c) => c.id === 'code') ? [idColumn, ...cols] : cols);
  const cellText = (a: Activity, c: ColumnDef) => (editor?.canEdit(a, c.id) ? editor.text(a, c.id) : c.text(a, columnCtx));
  const tableText = (acts: Activity[], cols: ColumnDef[]) =>
    [cols.map((c) => tsvCell(c.label)).join('\t'), ...acts.map((a) => cols.map((c) => tsvCell(cellText(a, c))).join('\t'))].join('\n');
  const pickedActs = () => (picked.size > 1 ? shown.filter((a) => picked.has(a.id)) : []);
  const cursorCol = () => columns.find((c) => c.id === curCol) ?? columns[0];

  const startEdit = (a: Activity, col: string, seed?: string) => {
    if (!editor || !editor.canEdit(a, col)) return;
    if (!editor.editable) { editor.note(NOT_EDITABLE_NOTE); return; }
    setCurCol(col);
    setEdit({ id: a.id, col, draft: seed ?? editor.text(a, col), seeded: seed !== undefined });
  };

  const finishEdit = (save: boolean, move?: 'down' | 'next' | 'prev') => {
    const cur = editRef.current;
    if (!cur || !editor) return;
    editRef.current = null;
    setEdit(null);
    const a = byId(cur.id);
    const ok = !save || !a || editor.apply(a, cur.col, cur.draft) !== 'failed';
    latest.current.refocus?.();
    if (!ok || !move) return;
    if (move === 'down') { latest.current.moveDown(); return; }
    const at = columns.findIndex((c) => c.id === cur.col) + (move === 'next' ? 1 : -1);
    if (at >= 0 && at < columns.length) setCurCol(columns[at].id);
  };

  /** Returns true when the key was taken. */
  const onKeyDown = (e: KeyboardEvent): boolean => {
    if (!editor || edit || isField(e.target)) return false;
    const cur = byId(selectedId);
    const col = cursorCol();
    if (!cur || !col) return false;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === 'F2' || (e.key === 'Enter' && plain)) { e.preventDefault(); startEdit(cur, col.id); return true; }
    if (plain && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      setCurCol(columns[Math.min(columns.length - 1, Math.max(0, columns.indexOf(col) + (e.key === 'ArrowRight' ? 1 : -1)))].id);
      return true;
    }
    if (plain && (e.key === 'Delete' || e.key === 'Backspace') && col.id !== 'code' && col.id !== 'name' && editor.canEdit(cur, col.id) && editor.editable) {
      e.preventDefault();
      const targets = pickedActs().length ? pickedActs() : [cur];
      editor.batch('Clear cells', () => targets.forEach((a) => editor.apply(a, col.id, '')));
      return true;
    }
    if (plain && e.key.length === 1 && editor.canEdit(cur, col.id)) { e.preventDefault(); startEdit(cur, col.id, e.key); return true; }
    return false;
  };

  const onCopy = (e: ClipboardEvent) => {
    if (edit || isField(e.target)) return;
    const rows = pickedActs();
    let text: string;
    let note: string;
    if (rows.length) {
      text = tableText(rows, withId(columns));
      note = `Copied ${rows.length} rows with their headings: paste them into Excel, change them there, then copy the rows back and paste here.`;
    } else {
      const a = byId(selectedId);
      const col = cursorCol();
      if (!a || !col) return;
      text = tsvCell(cellText(a, col));
      note = `Copied ${col.label} of ${a.code}.`;
    }
    e.preventDefault();
    e.clipboardData.setData('text/plain', text);
    editor?.note(note);
  };

  const onPaste = (e: ClipboardEvent) => {
    if (!editor || edit || isField(e.target)) return;
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;
    e.preventDefault();
    if (!editor.editable) { editor.note(NOT_EDITABLE_NOTE); return; }
    const grid = parseTsv(text);
    if (grid.length && grid[grid.length - 1].every((c) => c === '')) grid.pop();
    if (!grid.length) return;
    const pool = [...columns, ...(catalog ?? [])];
    const colOf = (h: string) => {
      const k = h.trim().toLowerCase();
      return pool.find((c) => c.label.toLowerCase() === k || c.baseLabel?.toLowerCase() === k);
    };
    let changed = 0;
    let same = 0;
    let failed = 0;
    let missing = 0;
    const count = (r: 'changed' | 'same' | 'failed') => { if (r === 'changed') changed++; else if (r === 'same') same++; else failed++; };

    const heads = grid[0].map(colOf);
    const idAt = heads.findIndex((c) => c?.id === 'code');
    if (idAt >= 0 && grid.length > 1) {
      // A block with its headings (copied from here, then changed in Excel): each row finds its activity by Activity ID, each cell its column by heading.
      editor.batch('Paste from Excel', () => {
        for (const cells of grid.slice(1)) {
          const a = editor.byCode(cells[idAt] ?? '');
          if (!a) { if ((cells[idAt] ?? '').trim()) missing++; continue; }
          cells.forEach((value, i) => {
            const col = heads[i];
            if (!col || i === idAt || !editor.canEdit(a, col.id)) return;
            count(editor.apply(a, col.id, value));
          });
        }
      });
    } else {
      // Plain cells: they go down and across from the cell under the cursor (one value into several picked rows goes into all of them).
      const start = Math.max(0, shown.findIndex((a) => a.id === selectedId));
      const col0 = Math.max(0, columns.findIndex((c) => c.id === curCol));
      const rows = pickedActs();
      editor.batch('Paste from Excel', () => {
        if (grid.length === 1 && grid[0].length === 1 && rows.length) {
          const col = columns[col0];
          if (col) for (const a of rows) count(editor.apply(a, col.id, grid[0][0]));
          return;
        }
        grid.forEach((cells, dr) => {
          const a = shown[start + dr];
          if (!a) return;
          cells.forEach((value, dc) => {
            const col = columns[col0 + dc];
            if (col && editor.canEdit(a, col.id)) count(editor.apply(a, col.id, value));
          });
        });
      });
    }
    const parts = [`Pasted ${changed} ${changed === 1 ? 'change' : 'changes'}`];
    if (same) parts.push(`${same} cells were the same`);
    if (failed) parts.push(`${failed} could not be set`);
    if (missing) parts.push(`${missing} rows had an Activity ID that is not in the programme`);
    editor.note(`${parts.join(', ')}. Undo (Ctrl+Z) takes it all back in one step.`);
  };

  /** All the rows shown, with headings, on the clipboard. Resolves to how many rows. */
  const copyTable = async () => {
    await navigator.clipboard.writeText(tableText(shown, withId(columns)));
    return shown.length;
  };

  return { curCol: cursorCol()?.id ?? null, setCurCol, edit, setEdit, startEdit, finishEdit, onKeyDown, onCopy, onPaste, copyTable };
}

/** The cell of an activity's row: its text, or the input while it is edited. Shared by both grids. */
export type SheetEditing = ReturnType<typeof useSheetEditing>;
