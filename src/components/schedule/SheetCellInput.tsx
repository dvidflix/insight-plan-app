import type { SheetEditing } from './useSheetEditing';

/** The input in a cell while it is edited (Enter saves and goes down, Tab saves and goes across, Esc leaves the cell as it was). */
export function SheetCellInput({ sheet, align }: { sheet: SheetEditing; align?: 'right' }) {
  const { edit, setEdit, finishEdit } = sheet;
  if (!edit) return null;
  return (
    <input
      className="gantt-cell-input"
      autoFocus
      style={{ textAlign: align }}
      value={edit.draft}
      onChange={(e) => setEdit({ ...edit, draft: e.target.value })}
      onFocus={(e) => { if (edit.seeded) e.target.setSelectionRange(e.target.value.length, e.target.value.length); else e.target.select(); }}
      onBlur={() => finishEdit(true)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); finishEdit(true, 'down'); }
        else if (e.key === 'Escape') { e.preventDefault(); finishEdit(false); }
        else if (e.key === 'Tab') { e.preventDefault(); finishEdit(true, e.shiftKey ? 'prev' : 'next'); }
        e.stopPropagation();
      }}
    />
  );
}
