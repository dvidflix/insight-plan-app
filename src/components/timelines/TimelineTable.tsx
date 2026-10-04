import { useEffect, useMemo, useRef, useState } from 'react';
import { PALETTE, newId, shortName, useTimelinesStore, type Person, type Timeline, type TimelineRow } from '../../state/timelinesStore';
import { editSpan } from './shared';
import { parseDate, parseTsv, showDate, toTsv } from './gridText';
import { GROUP_NAME, GROUP_PLANNER, buildView, mergesOf, type Merge } from './view';

/** The timeline's rows as a spreadsheet, the way Excel and SeaTable work:
    click a cell to select it (drag or Shift+arrows for a block), type to
    replace it, Enter / F2 / double-click to edit, Delete to clear, arrows and
    Tab to move, Ctrl+C / Ctrl+X / Ctrl+V with Excel (a block pasted from a
    sheet lands from the selected cell, adding rows as needed; one value pasted
    onto a block fills it), Ctrl+Z to undo. Dates are day-first (05/01/2025);
    a planner is matched by name, and a new name adds that person.

    Grouping works as in the Programmes table: header rows that fold, or, with
    "Merge cells", the group's value shown once in a cell spanning its rows
    (like a pivot table) — editing that cell sets every row of the group. */

type Col =
  | { id: string; kind: 'name' | 'planner' | 'note'; label: string }
  | { id: string; kind: 'field'; label: string; fieldId: string }
  | { id: string; kind: 'start' | 'end' | 'done'; label: string; stageId: string; color: string };

interface Cell { r: number; c: number }

export function TimelineTable({ timeline, people, selectedRow, onSelect, addRow, removeRow, patch, collapsed, toggleGroup, widths, onResize, filter, frozen }: {
  timeline: Timeline;
  people: Person[];
  selectedRow: string | null;
  onSelect: (id: string) => void;
  addRow: () => void;
  removeRow: (id: string) => void;
  patch: (fn: (t: Timeline) => Timeline) => void;
  collapsed: ReadonlySet<string>;
  toggleGroup: (key: string) => void;
  /** Saved column widths by column id, and a pointer-down handler that resizes one. */
  widths: Record<string, number>;
  /** The search text from the toolbar. */
  filter: string;
  /** How many leading columns stay in view when scrolling sideways. */
  frozen: number;
  onResize: (key: string, current: number) => (e: React.PointerEvent) => void;
}) {
  const view = useMemo(() => buildView(timeline, people, collapsed, filter), [timeline, people, collapsed, filter]);
  const rows = view.rows;
  const personById = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const cols: Col[] = useMemo(
    () => [
      { id: 'planner', kind: 'planner', label: 'Planner' },
      { id: 'name', kind: 'name', label: 'Building' },
      ...timeline.fields.map((f): Col => ({ id: `f:${f.id}`, kind: 'field', label: f.name, fieldId: f.id })),
      ...timeline.stages.flatMap((s): Col[] => [
        { id: `${s.id}:start`, kind: 'start', label: `${s.name} · start`, stageId: s.id, color: s.color },
        { id: `${s.id}:end`, kind: 'end', label: `${s.name} · finish`, stageId: s.id, color: s.color },
        { id: `${s.id}:done`, kind: 'done', label: `${s.name} · % done`, stageId: s.id, color: s.color },
      ]),
      { id: 'note', kind: 'note', label: 'Note' },
    ],
    [timeline.stages, timeline.fields],
  );

  // Merged cells: the column of each group level shows its value once over the run of rows.
  const merged = !!timeline.mergeGroups && (timeline.groups?.length ?? 0) > 0;
  const merges = useMemo(() => {
    const list: { m: Merge; c: number }[] = [];
    if (!merged) return list;
    const fieldOfCol = (c: Col) => (c.kind === 'name' ? GROUP_NAME : c.kind === 'planner' ? GROUP_PLANNER : c.kind === 'field' ? c.fieldId : null);
    for (const m of mergesOf(rows, timeline.groups, people)) {
      const c = cols.findIndex((col) => fieldOfCol(col) === m.field);
      if (c >= 0) list.push({ m, c });
    }
    return list;
  }, [merged, rows, timeline.groups, people, cols]);
  const mergeStartingAt = (r: number, c: number) => merges.find((x) => x.c === c && x.m.start === r)?.m;
  const mergeCovering = (r: number, c: number) => merges.find((x) => x.c === c && r >= x.m.start && r < x.m.start + x.m.len)?.m;

  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [focus, setFocus] = useState<Cell | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; value: string } | null>(null);
  const dragging = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const undoStack = useRef<{ rows: TimelineRow[]; people: Person[] }[]>([]);

  // ---- cell text ----
  const textOf = (row: TimelineRow, col: Col): string => {
    switch (col.kind) {
      case 'name': return row.name;
      case 'note': return row.note;
      case 'field': return row.values[col.fieldId] ?? '';
      case 'planner': { const p = row.plannerId ? personById.get(row.plannerId) : undefined; return p ? shortName(p) : ''; }
      case 'start': return showDate(row.spans[col.stageId]?.start);
      case 'end': return showDate(row.spans[col.stageId]?.end);
      case 'done': return row.spans[col.stageId]?.done !== undefined ? `${row.spans[col.stageId].done}%` : '';
    }
  };

  /** Writes many cells at once (one undo step): displayed row index (past the end adds rows), column, text. */
  const write = (edits: { r: number; c: number; text: string }[]) => {
    if (!edits.length) return;
    undoStack.current.push({ rows: timeline.rows, people });
    if (undoStack.current.length > 60) undoStack.current.shift();
    const all = timeline.rows.map((r) => ({ ...r, spans: { ...r.spans }, values: { ...r.values } }));
    const visible = rows.map((r) => all[timeline.rows.indexOf(r)]);
    const newPeople = [...people];
    const personFor = (name: string): string | null => {
      const n = name.trim().toLowerCase();
      if (!n) return null;
      const hit = newPeople.find((p) => p.name.toLowerCase() === n || (p.knownAs ?? '').trim().toLowerCase() === n);
      if (hit) return hit.id;
      const p: Person = { id: newId(), name: name.trim(), role: 'Planner', color: PALETTE[newPeople.length % PALETTE.length] };
      newPeople.push(p);
      return p.id;
    };
    for (const { r, c, text } of edits) {
      let target = visible[r];
      while (!target) {
        const fresh: TimelineRow = { id: newId(), name: '', plannerId: null, note: '', values: {}, spans: {} };
        all.push(fresh);
        visible.push(fresh);
        target = visible[r];
      }
      const col = cols[c];
      if (!col) continue;
      let next: TimelineRow = target;
      if (col.kind === 'name') next = { ...target, name: text };
      else if (col.kind === 'note') next = { ...target, note: text };
      else if (col.kind === 'field') next = { ...target, values: { ...target.values, [col.fieldId]: text } };
      else if (col.kind === 'planner') next = { ...target, plannerId: personFor(text) };
      else if (col.kind === 'done') {
        const span = target.spans[col.stageId];
        if (!span) continue;
        const n = Number(text.replace('%', '').trim());
        const { done: _old, ...rest } = span;
        if (text.trim() === '') next = { ...target, spans: { ...target.spans, [col.stageId]: rest } };
        else if (Number.isFinite(n)) next = { ...target, spans: { ...target.spans, [col.stageId]: { ...rest, done: Math.max(0, Math.min(100, Math.round(n))) } } };
        else continue;
      } else if ('stageId' in col) {
        const iso = text.trim() === '' ? '' : parseDate(text);
        if (iso === null) continue; // not a date: leave the cell as it is
        next = editSpan(target, col.stageId, col.kind, iso);
      }
      const at = all.indexOf(target);
      all[at] = next;
      visible[r] = next;
    }
    patch((t) => ({ ...t, rows: all }));
    if (newPeople.length !== people.length) useTimelinesStore.getState().setPeople(newPeople);
  };

  const undo = () => {
    const snap = undoStack.current.pop();
    if (!snap) return;
    patch((t) => ({ ...t, rows: snap.rows }));
    useTimelinesStore.getState().setPeople(snap.people);
  };

  // ---- selection ----
  const range = anchor && focus ? { r0: Math.min(anchor.r, focus.r), r1: Math.max(anchor.r, focus.r), c0: Math.min(anchor.c, focus.c), c1: Math.max(anchor.c, focus.c) } : null;
  const inRange = (r: number, c: number, len = 1) => !!range && r + len - 1 >= range.r0 && r <= range.r1 && c >= range.c0 && c <= range.c1;
  const clamp = (cell: Cell): Cell => ({ r: Math.max(0, Math.min(rows.length - 1, cell.r)), c: Math.max(0, Math.min(cols.length - 1, cell.c)) });
  const select = (cell: Cell, extend = false) => {
    if (!rows.length) return;
    const c = clamp(cell);
    setFocus(c);
    if (!extend) setAnchor(c);
    const id = rows[c.r]?.id;
    if (id && !extend) onSelect(id);
  };

  useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);
  useEffect(() => {
    if (!focus) return;
    const m = mergeCovering(focus.r, focus.c);
    gridRef.current?.querySelector(`[data-cell="${m ? m.start : focus.r}:${focus.c}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // ---- copy, cut, paste ----
  const selectionText = (): string => {
    if (!range) return '';
    const out: string[][] = [];
    for (let r = range.r0; r <= range.r1; r++) out.push(cols.slice(range.c0, range.c1 + 1).map((col) => (rows[r] ? textOf(rows[r], col) : '')));
    return toTsv(out);
  };
  const clearSelection = () => {
    if (!range) return;
    const edits: { r: number; c: number; text: string }[] = [];
    for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) edits.push({ r, c, text: '' });
    write(edits);
  };
  const onCopy = (e: React.ClipboardEvent) => {
    if (editing || !range) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', selectionText());
  };
  const onCut = (e: React.ClipboardEvent) => {
    if (editing || !range) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', selectionText());
    clearSelection();
  };
  const onPaste = (e: React.ClipboardEvent) => {
    if (editing || !range) return;
    e.preventDefault();
    const grid = parseTsv(e.clipboardData.getData('text/plain'));
    if (!grid.length) return;
    const edits: { r: number; c: number; text: string }[] = [];
    const single = grid.length === 1 && grid[0].length === 1;
    if (single && (range.r1 > range.r0 || range.c1 > range.c0)) {
      for (let r = range.r0; r <= range.r1; r++) for (let c = range.c0; c <= range.c1; c++) edits.push({ r, c, text: grid[0][0] });
    } else {
      grid.forEach((line, i) => line.forEach((text, j) => {
        if (range.c0 + j < cols.length) edits.push({ r: range.r0 + i, c: range.c0 + j, text });
      }));
    }
    write(edits);
    const lastR = range.r0 + grid.length - 1;
    const lastC = Math.min(cols.length - 1, range.c0 + Math.max(...grid.map((l) => l.length)) - 1);
    setAnchor({ r: range.r0, c: range.c0 });
    setFocus({ r: single ? range.r1 : lastR, c: single ? range.c1 : lastC });
  };

  // ---- keyboard ----
  const startEdit = (cell: Cell, initial?: string) => {
    const m = mergeCovering(cell.r, cell.c);
    const row = rows[m ? m.start : cell.r];
    if (!row) return;
    setEditing({ r: m ? m.start : cell.r, c: cell.c, value: initial ?? textOf(row, cols[cell.c]) });
  };
  const commit = (move?: Cell) => {
    if (!editing) return;
    // A merged cell sets every row of its group.
    const m = mergeCovering(editing.r, editing.c);
    const rowsToSet = m ? Array.from({ length: m.len }, (_, i) => m.start + i) : [editing.r];
    write(rowsToSet.map((r) => ({ r, c: editing.c, text: editing.value })));
    setEditing(null);
    gridRef.current?.focus();
    if (move) select(move);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (editing || !focus) return;
    const mod = e.ctrlKey || e.metaKey;
    const step = (dr: number, dc: number) => {
      e.preventDefault();
      if (e.shiftKey && e.key !== 'Tab') select({ r: focus.r + dr, c: focus.c + dc }, true);
      else select({ r: focus.r + dr, c: focus.c + dc });
    };
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setAnchor({ r: 0, c: 0 }); setFocus({ r: rows.length - 1, c: cols.length - 1 }); }
    else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (mod) return; // copy / cut / paste go through their own events
    else if (e.key === 'ArrowDown') step(1, 0);
    else if (e.key === 'ArrowUp') step(-1, 0);
    else if (e.key === 'ArrowLeft') step(0, -1);
    else if (e.key === 'ArrowRight') step(0, 1);
    else if (e.key === 'Tab') step(0, e.shiftKey ? -1 : 1);
    else if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); startEdit(focus); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); clearSelection(); }
    else if (e.key === 'Escape') setAnchor(focus);
    else if (e.key.length === 1 && !e.altKey) { e.preventDefault(); startEdit(focus, e.key); }
  };

  const widthOf = (c: Col) => widths[`t:${c.id}`] ?? (c.kind === 'name' ? 220 : c.kind === 'planner' ? 170 : c.kind === 'field' ? 130 : c.kind === 'note' ? 240 : c.kind === 'done' ? 84 : 112);
  const template = `44px ${cols.map((c) => `${widthOf(c)}px`).join(' ')} 36px`;
  const lastCol = cols.length + 2; // grid column of the delete button
  /** Frozen columns stick to the left, one after the other. */
  const stickyLeft = (c: number): React.CSSProperties => {
    if (c >= frozen) return {};
    const left = 44 + cols.slice(0, c).reduce((n, col) => n + widthOf(col), 0);
    return { position: 'sticky', left, zIndex: 2 };
  };
  const planners = people.map((p) => shortName(p));

  // ---- grid placement: one CSS grid, so a merged cell can span rows ----
  const cells: JSX.Element[] = [];
  let gridRow = 2; // 1 is the header
  let r = 0;
  const cellInput = (col: Col, row: number, c: number) => (
    <input
      autoFocus
      className="tl-gcell__input"
      value={editing!.value}
      list={col.kind === 'planner' ? 'tl-planners' : undefined}
      placeholder={col.kind === 'start' || col.kind === 'end' ? 'dd/mm/yyyy' : undefined}
      onFocus={(e) => { const v = e.target.value; e.target.setSelectionRange(v.length, v.length); }}
      onChange={(e) => setEditing({ ...editing!, value: e.target.value })}
      onBlur={() => commit()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commit({ r: row + 1, c }); }
        else if (e.key === 'Tab') { e.preventDefault(); commit({ r: row, c: c + (e.shiftKey ? -1 : 1) }); }
        else if (e.key === 'Escape') { setEditing(null); gridRef.current?.focus(); }
      }}
    />
  );

  for (const item of view.items) {
    if (item.kind === 'group') {
      const first = rows.indexOf(item.rows[0]);
      const canSelect = !item.collapsed && first >= 0;
      cells.push(
        <div key={`g:${item.key}`} className="tl-gcell tl-gcell--group" style={{ gridRow, gridColumn: '1 / -1', paddingLeft: 8 + item.depth * 16 }} onClick={() => toggleGroup(item.key)}>
          <span className="tl-chev">{item.collapsed ? '▸' : '▾'}</span>
          <b className="tl-grouplabel">{item.label}</b>
          <span className="tl-groupcount">{item.count}</span>
          {canSelect && (
            <button
              type="button"
              className="mdt__mini"
              style={{ marginLeft: 'auto' }}
              onClick={(e) => { e.stopPropagation(); setAnchor({ r: first, c: 0 }); setFocus({ r: first + item.rows.length - 1, c: cols.length - 1 }); onSelect(item.rows[0].id); gridRef.current?.focus(); }}
              title={`Select the ${item.count} rows of this group`}
            >
              Select
            </button>
          )}
        </div>,
      );
      gridRow++;
      continue;
    }
    const row = item.row;
    const sel = (row.id === selectedRow ? ' is-selected' : '') + (r % 2 ? ' is-alt' : '');
    const here = r;
    cells.push(
      <div key={`n:${row.id}`} className={`tl-gcell tl-gcell--num${sel}`} style={{ gridRow, gridColumn: 1, ...(frozen > 0 ? { position: 'sticky', left: 0, zIndex: 2 } : undefined) }} onMouseDown={() => { setAnchor({ r: here, c: 0 }); setFocus({ r: here, c: cols.length - 1 }); onSelect(row.id); gridRef.current?.focus(); }}>
        <span className="tl-num">{timeline.rows.indexOf(row) + 1}</span>
        <button type="button" className="tl-expand" title="Open this row on the right" aria-label="Open row" onMouseDown={(e) => e.stopPropagation()} onClick={() => onSelect(row.id)}>⤢</button>
      </div>,
    );
    cols.forEach((col, c) => {
      const m = mergeStartingAt(here, c);
      if (!m && mergeCovering(here, c)) return; // inside a merged cell: drawn by its first row
      const len = m?.len ?? 1;
      const isEditing = editing?.r === here && editing.c === c;
      const isFocus = !!focus && focus.c === c && focus.r >= here && focus.r < here + len;
      const cls = `tl-gcell${inRange(here, c, len) ? ' in-range' : ''}${isFocus ? ' is-focus' : ''}${col.kind === 'start' || col.kind === 'end' ? ' is-date' : ''}${m ? ' is-merged' : ''}${sel}`;
      cells.push(
        <div
          key={`${row.id}:${col.id}`}
          data-cell={`${here}:${c}`}
          className={cls}
          style={{ gridRow: len > 1 ? `${gridRow} / span ${len}` : gridRow, gridColumn: c + 2, ...stickyLeft(c), ...(col.kind === 'planner' && row.plannerId && personById.get(row.plannerId) ? { background: personById.get(row.plannerId)!.color, color: '#fff', fontWeight: 600 } : undefined) }}
          onMouseDown={() => {
            if (isEditing) return;
            dragging.current = true;
          }}
          onMouseDownCapture={(e) => {
            if (isEditing) return;
            select({ r: here, c }, e.shiftKey);
            gridRef.current?.focus();
          }}
          onMouseEnter={() => dragging.current && !editing && setFocus({ r: here, c })}
          onDoubleClick={() => startEdit({ r: here, c })}
        >
          {isEditing ? cellInput(col, here, c) : col.kind === 'planner' ? (
            <span className="tl-gcell__text">{textOf(row, col)}</span>
          ) : (
            <span className="tl-gcell__text">{textOf(row, col)}</span>
          )}
        </div>,
      );
    });
    cells.push(
      <div key={`d:${row.id}`} className={`tl-gcell tl-gcell--del${sel}`} style={{ gridRow, gridColumn: lastCol }}>
        <button type="button" className="tl-rowdel" title="Delete the row" aria-label="Delete row" onClick={() => removeRow(row.id)}>✕</button>
      </div>,
    );
    gridRow++;
    r++;
  }

  return (
    <div className="tl-table">
      <div className="tl-table__bar">
        <span className="scn-dim">{rows.length} of {timeline.rows.length} rows · click a cell, then type, paste from Excel (Ctrl+V) or copy (Ctrl+C)</span>
      </div>
      <div className="tl-table__scroll">
        <div className="tl-grid2" ref={gridRef} tabIndex={0} onKeyDown={onKeyDown} onCopy={onCopy} onCut={onCut} onPaste={onPaste} style={{ gridTemplateColumns: template }}>
          <div className="tl-gcell tl-gcell--head tl-gcell--num" style={{ gridRow: 1, gridColumn: 1, ...(frozen > 0 ? { left: 0, zIndex: 4 } : undefined) }}>#</div>
          {cols.map((c, i) => (
            <div key={c.id} className="tl-gcell tl-gcell--head" style={{ gridRow: 1, gridColumn: i + 2, ...(i < frozen ? { left: stickyLeft(i).left, zIndex: 4 } : undefined) }} title={c.label}>
              {c.kind === 'start' || c.kind === 'end' ? <span className="tl-swatch" style={{ background: c.color }} /> : null}
              <span className="tl-gcell__text">{c.label}</span>
              <span className="tl-resizer" onPointerDown={onResize(`t:${c.id}`, widthOf(c))} />
            </div>
          ))}
          <div className="tl-gcell tl-gcell--head" style={{ gridRow: 1, gridColumn: lastCol }} />
          {cells}
          <button type="button" className="tl-addrow" style={{ gridRow, gridColumn: '1 / -1' }} onClick={() => addRow()} title="Add a row">+</button>
        </div>
        <datalist id="tl-planners">{planners.map((n) => <option key={n} value={n} />)}</datalist>
        {timeline.stages.length === 0 && (
          <div className="scn-dim" style={{ padding: 10 }}>
            No stages yet.{' '}
            <button type="button" className="link-btn" onClick={() => patch((t) => ({ ...t, stages: [...t.stages, { id: newId(), name: 'Stage 1', color: PALETTE[0] }] }))}>Add one</button>
          </div>
        )}
      </div>
    </div>
  );
}
