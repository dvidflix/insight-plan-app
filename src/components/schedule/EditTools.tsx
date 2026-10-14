import { useEffect, useMemo, useState } from 'react';
import type { ScheduleModel } from '../../schedule/types';
import { addActivity, addWbs, deleteActivities, deleteWbs, moveActivities, moveWbs, renameWbs, setDataDate, wbsPathOf } from '../../schedule/programmeCommands';
import { applyLinkShortcut, type LinkKind } from '../../schedule/linkShortcuts';
import { editStructure } from '../../state/programmeEdits';
import { commit } from '../../state/programmeHistory';
import { useActivitySelectionStore } from '../../state/activitySelectionStore';
import { programmeKey } from '../../state/unloadedWbsStore';

interface EditToolsProps {
  /** The programme edited in place that is shown (the only one). */
  model: ScheduleModel;
  /** The activity last clicked. */
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNote: (text: string) => void;
  /** Insert and Delete work on the activities (the Table and the Gantt). */
  keys: boolean;
}

const LINK_KINDS: [LinkKind, string][] = [
  ['FS', 'Finish to start: the next task starts when this one is finished.'],
  ['SS', 'Start to start: the next task starts when this one starts.'],
  ['FF', 'Finish to finish: the next task finishes when this one finishes.'],
  ['SF', 'Start to finish: the next task finishes when this one starts.'],
];

type Done = { error: string } | object;
const failed = (r: Done): r is { error: string } => 'error' in r;

/** Building a programme in the Programmes toolbar: add an activity or a milestone after the picked one (Insert), delete the picked
    ones (Delete; undo puts them back), and the WBS: add a node, rename it, move it, move the picked activities into it, delete it. */
export function EditTools({ model, selectedId, onSelect, onNote, keys }: EditToolsProps) {
  const key = programmeKey(model);
  const picked = useActivitySelectionStore((s) => s.ids);
  const [open, setOpen] = useState(false);
  const [node, setNode] = useState('');
  const [linkKind, setLinkKind] = useState<LinkKind>('FS');

  const ids = () => (picked.size ? [...picked] : selectedId ? [selectedId] : []);
  const nodes = useMemo(() => model.wbs.map((n) => ({ id: n.id, label: wbsPathOf(model.wbs, n.id) || n.name })).sort((a, b) => a.label.localeCompare(b.label)), [model.wbs]);
  const current = nodes.some((n) => n.id === node) ? node : '';

  const add = (type: 'task' | 'milestone-finish') => {
    const r = commit(type === 'task' ? 'Add activity' : 'Add milestone', () => editStructure(key, (m) => addActivity(m, { after: selectedId ?? undefined, type })));
    if (failed(r)) return onNote(r.error);
    const id = (r as { id: string }).id;
    onSelect(id);
    useActivitySelectionStore.getState().click(id, {}, [id]);
    onNote(`Added ${model.activities.find((a) => a.id === id)?.code ?? 'an activity'}. Rename it and set its duration in the details pane, link it from its predecessor.`);
  };
  const remove = () => {
    const list = ids();
    if (!list.length) return onNote('Pick the activities to delete first.');
    const r = commit(`Delete ${list.length} ${list.length === 1 ? 'activity' : 'activities'}`, () => editStructure(key, (m) => deleteActivities(m, list)));
    if (failed(r)) return onNote(r.error);
    useActivitySelectionStore.getState().clear();
    onSelect(null);
    onNote(`Deleted ${list.length} ${list.length === 1 ? 'activity' : 'activities'}, with their links. Undo (Ctrl+Z) puts them back.`);
  };
  const wbs = (label: string, command: Parameters<typeof editStructure>[1]) => {
    const r = commit(label, () => editStructure(key, command));
    if (failed(r)) onNote(r.error);
    return !failed(r);
  };
  const dataDate = model.project.dataDate;
  const dateText = dataDate ? `${dataDate.getFullYear()}-${String(dataDate.getMonth() + 1).padStart(2, '0')}-${String(dataDate.getDate()).padStart(2, '0')}` : '';
  const changeDataDate = (value: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!m) return;
    wbs('Set the data date', (p) => setDataDate(p, new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), dataDate?.getHours() ?? 8, dataDate?.getMinutes() ?? 0)));
  };
  const link = () => onNote(applyLinkShortcut(linkKind, model, new Set(ids())).message);
  const nameNode = (what: string, initial = '') => window.prompt(what, initial)?.trim() ?? '';

  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      if (e.key === 'Insert') add('task');
      else if (e.key === 'Delete') remove();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="schedule-toolbar__edit">
      <button type="button" className="btn btn--small" onClick={() => add('task')} title="Add an activity after the picked one, in its WBS node (Insert)">+ Activity</button>
      <button type="button" className="btn btn--small" onClick={() => add('milestone-finish')} title="Add a finish milestone after the picked activity">+ Milestone</button>
      <button type="button" className="btn btn--small" onClick={remove} disabled={ids().length === 0} title="Delete the picked activities and their links (Delete). Undo puts them back.">Delete</button>
      <span className="schedule-toolbar__edit-link">
        <span className="np__seg" role="radiogroup" aria-label="Link type">
          {LINK_KINDS.map(([k, tip]) => (
            <button key={k} type="button" role="radio" aria-checked={linkKind === k} className={linkKind === k ? 'is-on' : ''} title={tip} onClick={() => setLinkKind(k)}>{k}</button>
          ))}
        </span>
        <button type="button" className="btn btn--small" onClick={link} disabled={ids().length < 2} title={`Link the picked activities with ${linkKind}: ${LINK_KINDS.find(([k]) => k === linkKind)![1]} ${linkKind === 'FS' ? 'They are chained in start order.' : 'Each is linked from the earliest one.'}`}>Link</button>
      </span>
      <label className="schedule-toolbar__edit-date" title="The data date: the day the progress is as of. What is not started cannot start before it, and what is left of a started activity runs from it.">
        Data date <input type="date" value={dateText} onChange={(e) => changeDataDate(e.target.value)} />
      </label>
      <span className="schedule-toolbar__edit-wbs">
        <button type="button" className="btn btn--small" aria-expanded={open} onClick={() => setOpen(!open)} title="Add, rename, move and delete WBS nodes, and move the picked activities into one">WBS ▾</button>
        {open && (
          <div className="schedule-toolbar__edit-panel" role="group" aria-label="WBS">
            <select value={current} onChange={(e) => setNode(e.target.value)} aria-label="WBS node">
              <option value="">Choose a WBS node…</option>
              {nodes.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
            <button type="button" className="btn btn--small" onClick={() => { const name = nameNode('Name of the new WBS node:'); if (name) wbs('Add WBS node', (m) => addWbs(m, name, current || null)); }} title={current ? 'Add a node under the chosen one' : 'Add a top node'}>Add {current ? 'under it' : 'top node'}</button>
            <button type="button" className="btn btn--small" disabled={!current} onClick={() => { const name = nameNode('New name:', nodes.find((n) => n.id === current)?.label.split(' / ').pop() ?? ''); if (name) wbs('Rename WBS node', (m) => renameWbs(m, current, name)); }}>Rename</button>
            <button type="button" className="btn btn--small" disabled={!current} onClick={() => { const to = window.prompt('Move it under (type part of the WBS path; empty for the top):', '')?.trim(); if (to === undefined) return; const hit = to ? nodes.filter((n) => n.label.toLowerCase().includes(to.toLowerCase())) : []; if (to && hit.length !== 1) return onNote(hit.length ? `More than one WBS node matches “${to}”: type more of the path.` : `No WBS node matches “${to}”.`); wbs('Move WBS node', (m) => moveWbs(m, current, hit[0]?.id ?? null)); }}>Move…</button>
            <button type="button" className="btn btn--small" disabled={!current || ids().length === 0} onClick={() => wbs(`Move ${ids().length} to WBS`, (m) => moveActivities(m, ids(), current))} title="Move the picked activities into the chosen node">Move activities here</button>
            <button type="button" className="btn btn--small" disabled={!current} onClick={() => { if (wbs('Delete WBS node', (m) => deleteWbs(m, current))) setNode(''); }} title="Delete the chosen node: only when it has no activities and no nodes below">Delete node</button>
          </div>
        )}
      </span>
    </div>
  );
}
