import { IconArrowDown, IconArrowUp, IconChevronLeft, IconChevronRight, IconPencil, IconRelated, IconRemove } from '../icons';
import type { ScheduleModel } from '../../schedule/types';
import { deleteActivities } from '../../schedule/programmeCommands';
import { applyLinkShortcut, unlinkActivities } from '../../schedule/linkShortcuts';
import { indentRows, moveRows, outdentRows, type PlanRef } from '../../schedule/planOrder';
import { editStructure } from '../../state/programmeEdits';
import { commit } from '../../state/programmeHistory';
import { programmeKey } from '../../state/unloadedWbsStore';
import { useActivitySelectionStore } from '../../state/activitySelectionStore';
import { useLinkTypeStore } from '../../state/linkTypeStore';

/** The tools for the activities picked, in the bar after the search box: they appear when something is picked, and go when nothing is.
    Indent and outdent, move up and down, link and unlink (with the link type chosen in the planning tools), bulk edit and delete. */
export function SelectionTools({ model, onNote, onBulkEdit, onSelect }: { model: ScheduleModel; onNote: (text: string) => void; onBulkEdit: () => void; onSelect: (id: string | null) => void }) {
  const picked = useActivitySelectionStore((s) => s.ids);
  const linkKind = useLinkTypeStore((s) => s.kind);
  if (picked.size === 0) return null;
  const ids = [...picked];
  const refs: PlanRef[] = ids.map((id) => ({ kind: 'task', id }));
  const key = programmeKey(model);

  const run = (label: string, command: Parameters<typeof editStructure>[1]) => {
    const r = commit(label, () => editStructure(key, command));
    if ('error' in r) { onNote(r.error); return false; }
    return true;
  };
  const remove = () => {
    if (!run(`Delete ${ids.length} ${ids.length === 1 ? 'activity' : 'activities'}`, (m) => deleteActivities(m, ids))) return;
    useActivitySelectionStore.getState().clear();
    onSelect(null);
    onNote(`Deleted ${ids.length} ${ids.length === 1 ? 'activity' : 'activities'}, with their links. Undo (Ctrl+Z) puts them back.`);
  };
  const btn = (label: string, icon: JSX.Element, onClick: () => void, tip: string, disabled = false) => (
    <button type="button" className="icon-btn sel-tools__btn" aria-label={label} title={tip} disabled={disabled} onClick={onClick}>{icon}</button>
  );

  return (
    <span className="sel-tools" role="toolbar" aria-label="Tools for the picked activities">
      {btn('Indent', <IconChevronRight width={16} height={16} />, () => run('Indent', (m) => indentRows(m, refs)), 'Indent: move the picked rows into the group above')}
      {btn('Outdent', <IconChevronLeft width={16} height={16} />, () => run('Outdent', (m) => outdentRows(m, refs)), 'Outdent: move the picked rows out of their group')}
      {btn('Move up', <IconArrowUp width={16} height={16} />, () => run('Move rows', (m) => moveRows(m, refs, 'up')), 'Move the picked rows up')}
      {btn('Move down', <IconArrowDown width={16} height={16} />, () => run('Move rows', (m) => moveRows(m, refs, 'down')), 'Move the picked rows down')}
      {btn('Link', <IconRelated width={16} height={16} />, () => onNote(applyLinkShortcut(linkKind, model, ids).message), `Link the picked activities with ${linkKind} (change the type in the planning tools)`, picked.size < 2)}
      {btn('Unlink', <span className="sel-tools__unlink"><IconRelated width={16} height={16} /></span>, () => onNote(unlinkActivities(model, ids).message), 'Break the links between the picked activities', picked.size < 2)}
      {btn('Bulk edit', <IconPencil width={16} height={16} />, onBulkEdit, 'Bulk edit: change a field of the picked activities together')}
      {btn('Delete', <IconRemove width={16} height={16} />, remove, 'Delete the picked activities and their links (Delete). Undo puts them back.')}
    </span>
  );
}
