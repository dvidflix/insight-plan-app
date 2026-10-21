import { useRef, useState } from 'react';
import { useDismiss } from '../useDismiss';
import { IconChevronDown } from '../icons';
import type { ScheduleModel } from '../../schedule/types';
import { applySheets } from '../../schedule/workbook';
import { readWorkbook, writeWorkbook } from '../../schedule/workbookFile';
import { editStructure } from '../../state/programmeEdits';
import { commit } from '../../state/programmeHistory';
import { programmeKey } from '../../state/unloadedWbsStore';

/** Edit the programme in Excel as one workbook (ALICE's "Edit data in Excel"): download it, change tasks, links, resources and assignments in
    Excel, upload it. What the upload would do is shown first and nothing changes until it is confirmed; one undo puts it all back. */
export function WorkbookTools({ model, onNote }: { model: ScheduleModel; onNote: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss<HTMLSpanElement>(open, () => setOpen(false));
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const download = () => {
    const stem = (model.project.name || model.sourceFileName || 'programme').replace(/[^\w.-]+/g, '_');
    writeWorkbook(model, `${stem}.workbook.xlsx`);
    onNote('Workbook downloaded. Change it in Excel, then upload it here. Columns marked * are needed; read-only ones are ignored.');
  };
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const sheets = await readWorkbook(file);
      const applied = applySheets(model, sheets);
      if ('error' in applied) return onNote(applied.error);
      const lines = [...applied.summary, ...(applied.warnings.length ? ['', `${applied.warnings.length} left out:`, ...applied.warnings.slice(0, 8), ...(applied.warnings.length > 8 ? [`… and ${applied.warnings.length - 8} more`] : [])] : [])];
      if (applied.summary.length === 1 && /Nothing/.test(applied.summary[0]) && !applied.warnings.length) return onNote(applied.summary[0]);
      if (!window.confirm(`${lines.join('\n')}\n\nApply these changes? (Undo, Ctrl+Z, puts them back.)`)) return onNote('Upload cancelled: nothing was changed.');
      const r = commit('Upload workbook', () => editStructure(programmeKey(model), () => ({ model: applied.model })));
      onNote('error' in r ? r.error : `Workbook applied. ${applied.summary.join(' ')}`);
    } catch (e) {
      onNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="schedule-toolbar__edit-wbs" ref={ref}>
      <button type="button" className="btn btn--small" aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)} title="Edit the programme in Excel as one workbook: tasks, links, resources and assignments">
        Excel <IconChevronDown width={14} height={14} />
      </button>
      {open && (
        <div className="schedule-toolbar__edit-panel" role="group" aria-label="Excel">
          <button type="button" className="btn btn--small" onClick={download} title="One .xlsx with Tasks, Relationships, Resources and Assignments sheets">Download workbook</button>
          <button type="button" className="btn btn--small primary" onClick={() => input.current?.click()} title="Read a workbook made with Download workbook: the changes are listed first, and nothing is changed until you confirm">Upload workbook…</button>
          <div className="scn-dim">Relationships and Assignments are the whole list: a row you delete is removed. A deleted Tasks row is not.</div>
        </div>
      )}
      <input ref={input} type="file" accept=".xlsx,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
    </span>
  );
}
