import { useEffect, useMemo, useState } from 'react';
import { sharedActivityObjects } from '../schedule/activityObjects';
import { applyLinkShortcut, unlinkActivities, type LinkKind } from '../schedule/linkShortcuts';
import { activitiesByObject, orderedActivities } from '../schedule/pickOrder';
import { baselineOnSchedule, levelProgramme, rescheduleProgramme, setBaselineOnSchedule } from '../schedule/reschedule';
import { useActivitySelectionStore } from '../state/activitySelectionStore';
import { useLinkGroupsStore } from '../state/linkGroupsStore';
import { useLinkTypeStore } from '../state/linkTypeStore';
import { useModelsStore } from '../state/modelsStore';
import { useVisibleSchedules } from '../state/scheduleStore';
import { useSelectionStore } from '../state/selectionStore';
import { IconLink } from './icons';

const KINDS: [LinkKind, string][] = [
  ['FS', 'Finish to start: the next activity starts when this one finishes.'],
  ['SS', 'Start to start: the next activity starts when this one starts.'],
  ['FF', 'Finish to finish: the next activity finishes when this one finishes.'],
  ['SF', 'Start to finish: the next activity finishes when this one starts.'],
];

/** F9 schedules the programme on screen, wherever the strip of planning tools is not shown (the status bar no longer has it). */
export function ScheduleHotkey() {
  const visible = useVisibleSchedules();
  const model = visible.length === 1 ? visible[0] : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F9' || e.defaultPrevented || !model) return;
      e.preventDefault();
      void rescheduleProgramme(model);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [model]);
  return null;
}

/** In the status bar, on every page that has a programme: the relation to link with (one tap), Link and Unlink for what is picked, and
    Schedule (F9). Picked is read where the page picks: the activities of the table / Gantt ('activities'), or the objects picked in the 3D
    model one by one ('objects': each object's activities, in the order the objects were picked, are linked as a chain). */
export function PlanningTools({ source }: { source: 'activities' | 'objects' }) {
  const visible = useVisibleSchedules();
  const model = visible.length === 1 ? visible[0] : null;
  const kind = useLinkTypeStore((s) => s.kind);
  const setKind = useLinkTypeStore((s) => s.setKind);
  const picked = useActivitySelectionStore((s) => s.ids);
  const byModel = useSelectionStore((s) => s.byModel);
  const loadedModels = useModelsStore((s) => s.models);
  const groups = useLinkGroupsStore((s) => s.groups);
  const [note, setNote] = useState<string | null>(null);
  const say = (text: string) => {
    setNote(text);
    window.setTimeout(() => setNote((cur) => (cur === text ? null : cur)), 6000);
  };

  const objects = useMemo(() => (model && source === 'objects' && loadedModels.length && groups.length ? sharedActivityObjects(model, loadedModels, groups) : null), [model, source, loadedModels, groups]);
  const activitiesOf = useMemo(() => (objects ? activitiesByObject(objects.objectsOf) : new Map<string, string[]>()), [objects]);
  /** What is picked, in the order it was picked. */
  const ids = useMemo(() => {
    if (!model) return [];
    if (source === 'objects') return orderedActivities(byModel, activitiesOf, model).map((a) => a.id);
    const known = new Set(model.activities.map((a) => a.id));
    return [...picked].filter((id) => known.has(id));
  }, [model, source, byModel, activitiesOf, picked]);

  const [baseline, setBaseline] = useState(baselineOnSchedule());
  const schedule = () => { if (model) void rescheduleProgramme(model).then(say); };
  /** Resource levelling: report the overloads, delay within float, delay as needed, or take the levelling off. */
  const level = () => {
    if (!model) return;
    const how = window.prompt('Level resources:\n1  Report the overloads only (nothing changes)\n2  Delay within float (the finish does not move)\n3  Delay as needed (the finish may move)\n4  Clear levelling (put the activities back)', '1');
    const pick = { '1': 'report', '2': 'float', '3': 'needed', '4': 'clear' }[(how ?? '').trim()] as 'report' | 'float' | 'needed' | 'clear' | undefined;
    if (pick) say(levelProgramme(model, pick));
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F9' || e.defaultPrevented || !model) return;
      e.preventDefault();
      void rescheduleProgramme(model).then(say);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model]);

  if (!model) return null;
  const many = ids.length >= 2;
  return (
    <span className="ptools" role="group" aria-label="Planning tools">
      {note && <span className="ptools__note" role="status">{note}</span>}
      <span className="ptools__count" title={source === 'objects' ? 'Activities of the objects picked in the 3D model, in the order picked' : 'Activities picked in the table or Gantt, in the order picked'}>{ids.length} picked</span>
      <span className="np__seg" role="radiogroup" aria-label="Relation to link with">
        {KINDS.map(([k, tip]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'is-on' : ''} title={tip} onClick={() => setKind(k)}>{k}</button>
        ))}
      </span>
      <button type="button" className="btn btn--small primary" disabled={!many} onClick={() => say(applyLinkShortcut(kind, model, ids).message)} title={`Link the picked activities with ${kind}: ${kind === 'FS' ? 'a chain, in the order picked' : 'each one from the first picked'}`}>
        <IconLink width={14} height={14} /> Link
      </button>
      <button type="button" className="btn btn--small" disabled={!many} onClick={() => say(unlinkActivities(model, ids).message)} title="Break the links between the picked activities">Unlink</button>
      <button type="button" className="btn btn--small" onClick={level} title="Resource levelling: report the overloads, delay activities within float or as needed, or clear it">Level…</button>
      <button type="button" className="btn btn--small" onClick={schedule} title={model.editable ? 'Calculate the dates and float again from the links, calendars and constraints (F9)' : 'Make an editable copy of the programme to schedule it here (F9)'}>Schedule F9</button>
      <label className="ptools__check" title="Each run of Schedule first keeps the programme as it is as a baseline and shows the run against it: the Gantt's baseline bars show what moved">
        <input type="checkbox" checked={baseline} onChange={(e) => { setBaseline(e.target.checked); setBaselineOnSchedule(e.target.checked); }} /> Baseline each run
      </label>
    </span>
  );
}
