import { useEffect, useMemo, useState } from 'react';
import { useDismiss } from '../useDismiss';
import { IconMenu } from '../icons';
import type { ScheduleModel } from '../../schedule/types';
import { assignResource } from '../../schedule/planResources';
import { addActivity, addTasksFromObjects, addWbs, deleteActivities, deleteWbs, dissolveActivities, moveActivities, moveWbs, renameWbs, setDataDate, wbsPathOf } from '../../schedule/programmeCommands';
import { applyLinkShortcut, unlinkActivities, type LinkKind } from '../../schedule/linkShortcuts';
import { useLinkTypeStore } from '../../state/linkTypeStore';
import { setPercentMany, splitActivity } from '../../schedule/planActions';
import { rescheduleProgramme } from '../../schedule/reschedule';
import { editStructure } from '../../state/programmeEdits';
import { commit } from '../../state/programmeHistory';
import { useActivitySelectionStore } from '../../state/activitySelectionStore';
import { programmeKey } from '../../state/unloadedWbsStore';
import { useSelectionStore } from '../../state/selectionStore';
import { useModelsStore } from '../../state/modelsStore';
import { useLinkGroupsStore } from '../../state/linkGroupsStore';
import { useScheduleStore } from '../../state/scheduleStore';
import { computeGroupLinks, matchesObjectFilters } from '../../schedule/linkGroups';
import type { RelationType } from '../../schedule/types';

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
  const linkKind = useLinkTypeStore((s) => s.kind);
  const setLinkKind = useLinkTypeStore((s) => s.setKind);

  // ---- New tasks from the objects picked in the 3D model, linked to them by a Link Group (or none: linked by hand later) ----
  const [from3d, setFrom3d] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useDismiss<HTMLDivElement>(menu, () => setMenu(false));
  /** A tool that does something closes the menu; the toggles (the link type, the drop-downs) leave it open. */
  const closeOnAction = (e: React.MouseEvent) => {
    const b = (e.target as HTMLElement).closest('button');
    if (b && !b.hasAttribute('aria-expanded') && b.getAttribute('role') !== 'radio' && !b.closest('.schedule-toolbar__edit-panel')) setMenu(false);
  };
  const from3dRef = useDismiss<HTMLSpanElement>(from3d, () => setFrom3d(false));
  const wbsRef = useDismiss<HTMLSpanElement>(open, () => setOpen(false));
  const [groupId, setGroupId] = useState('');
  const [perObject, setPerObject] = useState(true);
  const [taskDays, setTaskDays] = useState('5');
  const [taskCalendar, setTaskCalendar] = useState('');
  const [taskChain, setTaskChain] = useState<RelationType | ''>('FS');
  const [workType, setWorkType] = useState('Install');
  const [taskKind, setTaskKind] = useState<'task' | 'milestone-finish' | 'milestone-start'>('task');
  const [taskResource, setTaskResource] = useState('');
  const selection = useSelectionStore((s) => s.byModel);
  const loadedModels = useModelsStore((s) => s.models);
  const groups = useLinkGroupsStore((s) => s.groups);
  const objects = useMemo(() => loadedModels.flatMap((m) => {
    const wanted = new Set(selection[m.modelId] ?? []);
    return wanted.size ? m.elements.filter((el) => wanted.has(el.localId)) : [];
  }), [loadedModels, selection]);
  const usable = useMemo(() => groups.filter((g) => g.matchRules.length > 0 && objects.length > 0 && objects.every((el) => matchesObjectFilters(el, g.objectFilters))), [groups, objects]);
  const group = groups.find((g) => g.id === groupId && usable.includes(g)) ?? usable[0] ?? null;

  const ids = () => (picked.size ? [...picked] : selectedId ? [selectedId] : []);
  const count = picked.size || (selectedId ? 1 : 0);
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
  const createFrom3d = () => {
    const r = commit('Add tasks from 3D', () => editStructure(key, (m) => {
      const made = addTasksFromObjects(m, objects, group, {
        perObject, days: Math.max(0, Number(taskDays) || 0), calendarId: taskCalendar || null, chain: taskChain || null, after: selectedId ?? undefined,
        workType, type: taskKind,
      });
      if ('error' in made || !taskResource) return made;
      // The resource goes on every new task, in the same step (one undo).
      const assigned = assignResource(made.model, made.ids, taskResource);
      return 'error' in assigned ? assigned : { ...made, model: assigned.model };
    }));
    if (failed(r)) return onNote(r.error);
    const { ids: made, notes } = r as { ids: string[]; notes: string[] };
    const now = useScheduleStore.getState().schedules.find((x) => x.id === model.id);
    let linked = 0;
    if (now && group) {
      const found = new Set<string>();
      for (const m of loadedModels) for (const id of computeGroupLinks(now, m.elements, group).taskToElements.keys()) found.add(id);
      linked = made.filter((id) => found.has(id)).length;
    }
    useActivitySelectionStore.getState().click(made[0], {}, made);
    if (made.length > 1) for (const id of made.slice(1)) useActivitySelectionStore.getState().click(id, { ctrl: true }, made);
    onSelect(made[0]);
    onNote(`Added ${made.length} ${made.length === 1 ? 'task' : 'tasks'}${group ? `; ${linked} linked to their objects by “${group.name}”` : ', not linked to the objects (no Link Group matches them: define one, or link by hand)'}. ${notes.join(' ')}`.trim());
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
  const link = () => onNote(applyLinkShortcut(linkKind, model, ids()).message);
  const unlink = () => onNote(unlinkActivities(model, ids()).message);
  const progress = (percent: number) => {
    const list = ids();
    const r = commit(`Progress ${percent}%`, () => editStructure(key, (m) => setPercentMany(m, list, percent)));
    if (failed(r)) return onNote(r.error);
    onNote(`${(r as { done: number }).done} set to ${percent}%, as of the data date. Press F9 to schedule.`);
  };
  const split = () => {
    const list = ids();
    if (list.length !== 1) return onNote('Pick one activity to split.');
    const n = Number(window.prompt('Split into how many parts?', '2'));
    if (!n) return;
    const r = commit('Split activity', () => editStructure(key, (m) => splitActivity(m, list[0], n)));
    if (failed(r)) return onNote(r.error);
    onNote(`Split into ${n} parts, one after the other. Undo (Ctrl+Z) puts it back.`);
  };
  const dissolve = () => {
    const list = ids();
    if (!list.length) return onNote('Pick the activities to dissolve first.');
    const r = commit(`Dissolve ${list.length} ${list.length === 1 ? 'activity' : 'activities'}`, () => editStructure(key, (m) => dissolveActivities(m, list)));
    if (failed(r)) return onNote(r.error);
    useActivitySelectionStore.getState().clear();
    onSelect(null);
    const { removed, bridged } = r as { removed: number; bridged: number };
    onNote(`Dissolved ${removed} ${removed === 1 ? 'activity' : 'activities'}: ${bridged} ${bridged === 1 ? 'link joins' : 'links join'} what was before them to what was after. Undo (Ctrl+Z) puts them back.`);
  };
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
    <div className="schedule-toolbar__edit ctx-menu" ref={menuRef}>
      <button type="button" className={`btn btn--small ctx-menu__btn${menu ? ' is-open' : ''}`} aria-expanded={menu} aria-haspopup="menu" aria-label="Planning tools" title="Planning tools: add, link, progress, split, dissolve, schedule, delete, 3D, WBS" onClick={() => setMenu(!menu)}>
        <IconMenu width={18} height={18} />
      </button>
      {menu && (
      <div className="ctx-menu__panel" role="menu" onClick={closeOnAction}>
      {count <= 1 && (
        <>
          <button type="button" className="btn btn--small" onClick={() => add('task')} title="Add an activity after the picked one, in its WBS node (Insert)">+ Activity</button>
          <button type="button" className="btn btn--small" onClick={() => add('milestone-finish')} title="Add a finish milestone after the picked activity">+ Milestone</button>
        </>
      )}
      {count >= 2 && (
        <span className="schedule-toolbar__edit-link">
          <span className="np__seg" role="radiogroup" aria-label="Link type">
            {LINK_KINDS.map(([k, tip]) => (
              <button key={k} type="button" role="radio" aria-checked={linkKind === k} className={linkKind === k ? 'is-on' : ''} title={tip} onClick={() => setLinkKind(k)}>{k}</button>
            ))}
          </span>
          <button type="button" className="btn btn--small primary" onClick={link} title={`Link the picked activities with ${linkKind}: ${LINK_KINDS.find(([k]) => k === linkKind)![1]} ${linkKind === 'FS' ? 'They are chained in start order.' : 'Each is linked from the earliest one.'}`}>Link</button>
        </span>
      )}
      {count >= 2 && <button type="button" className="btn btn--small" onClick={unlink} title="Break the links between the picked activities">Unlink</button>}
      {count === 1 && <button type="button" className="btn btn--small" onClick={split} title="Split the activity into parts one after the other">Split</button>}
      {count >= 1 && (
        <span className="np__seg" aria-label="Progress of the picked activities">
          {[0, 25, 50, 75, 100].map((p) => <button key={p} type="button" onClick={() => progress(p)} title={`Set to ${p}% as of the data date`}>{p}%</button>)}
        </span>
      )}
      {count >= 1 && <button type="button" className="btn btn--small" onClick={dissolve} title="Dissolve: the picked activities are taken out and what was before them is linked to what was after, so the logic stays">Dissolve</button>}
      <button type="button" className="btn btn--small" onClick={() => void rescheduleProgramme(model).then(onNote)} title="Calculate the dates and float again from the links, calendars, constraints and the data date (F9)">Schedule F9</button>
      {count >= 1 && <button type="button" className="btn btn--small" onClick={remove} title="Delete the picked activities and their links (Delete). Undo puts them back.">Delete</button>}
      {(objects.length > 0 || from3d) && (
      <span className="schedule-toolbar__edit-wbs" ref={from3dRef}>
        <button type="button" className="btn btn--small" aria-expanded={from3d} onClick={() => setFrom3d(!from3d)} title="Make tasks from the objects picked in the 3D model: each gets the values its Link Group matches on, so it is linked to its object at once">From 3D ({objects.length}) ▾</button>
        {from3d && (
          <div className="schedule-toolbar__edit-panel" role="group" aria-label="Tasks from 3D">
            <div className="scn-dim">{objects.length === 0 ? 'Pick objects in the 3D model (Models or 4D page), then come back.' : `${objects.length.toLocaleString()} ${objects.length === 1 ? 'object' : 'objects'} picked.`}</div>
            <select value={group?.id ?? ''} onChange={(e) => setGroupId(e.target.value)} aria-label="Link Group" disabled={usable.length === 0} title="The Link Group that links the new tasks to the objects: its matching rules say what each task takes from its object">
              {usable.length === 0 && <option value="">{groups.length === 0 ? 'No Link Groups defined' : 'No Link Group takes these objects'}</option>}
              {usable.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <select value={workType} onChange={(e) => setWorkType(e.target.value)} aria-label="Task type" title="What the work is: the word the task name starts with">
              {['Install', 'Construct', 'Remove', 'Demolish', 'Temporary'].map((t) => <option key={t} value={t}>Task type: {t}</option>)}
              <option value="">Task type: none</option>
            </select>
            <select value={taskKind} onChange={(e) => setTaskKind(e.target.value as typeof taskKind)} aria-label="Activity type" title="A task with a duration, or a milestone">
              <option value="task">Activity type: Task</option>
              <option value="milestone-finish">Activity type: Finish milestone</option>
              <option value="milestone-start">Activity type: Start milestone</option>
            </select>
            <select value={taskResource} onChange={(e) => setTaskResource(e.target.value)} aria-label="Resource" title="A resource of the programme to put on every new task (add them in Resources)">
              <option value="">Resource: none</option>
              {(model.resourceCatalog ?? []).filter((r) => !r.virtual).map((r) => <option key={r.id} value={r.id}>Resource: {r.name}</option>)}
            </select>
            <label className="np__check"><input type="checkbox" checked={perObject} onChange={(e) => setPerObject(e.target.checked)} /> One task per object</label>
            <label title="Working days of each new task">Days <input type="number" min={0} step="0.5" value={taskDays} onChange={(e) => setTaskDays(e.target.value)} style={{ width: 56 }} /></label>
            <select value={taskCalendar} onChange={(e) => setTaskCalendar(e.target.value)} aria-label="Calendar">
              <option value="">Calendar of the task above</option>
              {model.calendars.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
            </select>
            <select value={taskChain} onChange={(e) => setTaskChain(e.target.value as RelationType | '')} aria-label="Relation between the new tasks" title="How the new tasks follow one another, and the picked task before them">
              <option value="FS">Relation: Finish to start (FS)</option>
              <option value="SS">Relation: Start to start (SS)</option>
              <option value="FF">Relation: Finish to finish (FF)</option>
              <option value="SF">Relation: Start to finish (SF)</option>
              <option value="">No links</option>
            </select>
            <button type="button" className="btn btn--small primary" disabled={objects.length === 0} onClick={createFrom3d}>Create {perObject ? objects.length || '' : 1} {perObject && objects.length !== 1 ? 'tasks' : 'task'}</button>
          </div>
        )}
      </span>
      )}
      {count === 0 && (
        <label className="schedule-toolbar__edit-date" title="The data date: the day the progress is as of. What is not started cannot start before it, and what is left of a started activity runs from it.">
          Data date <input type="date" value={dateText} onChange={(e) => changeDataDate(e.target.value)} />
        </label>
      )}
      <span className="schedule-toolbar__edit-wbs" ref={wbsRef}>
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
      )}
    </div>
  );
}
