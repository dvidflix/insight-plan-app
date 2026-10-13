import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSelectionStore } from '../../state/selectionStore';
import { usePropertyQueueStore } from '../../state/propertyQueueStore';
import type { Activity, ResourceAssignment, ScheduleModel } from '../../schedule/types';
import { CollapsibleSection, useOpenSections } from '../CollapsibleSection';
import { IconClose, IconList, IconPencil, IconRoadSurface } from '../icons';
import { applyVirtualResources } from '../../schedule/virtualResources';
import { ActivityNote } from './ActivityNote';
import { relationDetail, sharedContactIndex } from '../../schedule/activityRelation';
import { sharedActivityObjects } from '../../schedule/activityObjects';
import { REASON_LABEL, proposeLinks } from '../../schedule/generateLinks';
import { usePourSequence } from './usePourSequence';
import { useModelsStore } from '../../state/modelsStore';
import { useLinkGroupsStore } from '../../state/linkGroupsStore';
import { useClashStore } from '../../state/clashStore';
import { useViewerEngine } from '../../viewer/ViewerEngineContext';
import { useSequenceTimelineStore } from '../../state/sequenceTimelineStore';
import { activityStartMs } from '../../schedule/linking';
import { constraintName } from '../../schedule/reports';
import { alignDown } from '../../schedule/period';
import { useActivitySelectionStore } from '../../state/activitySelectionStore';
import { useVisibleSchedules } from '../../state/scheduleStore';
import { programmeKey } from '../../state/unloadedWbsStore';
import { useActivityOverridesStore } from '../../state/activityOverridesStore';

type SectionId = 'details' | 'dates' | 'cpm' | 'notes' | 'suggested' | 'codes' | 'udf' | 'resources';
const DEFAULT_OPEN: SectionId[] = ['details', 'dates', 'cpm', 'notes', 'suggested', 'codes', 'udf', 'resources'];

/** What a resource's quantity is counted in: a unit in its name ("Concrete (m3)", "Rebar (t)"), else hours for labour and equipment, nothing for other materials. */
function unitOf(r: ResourceAssignment): string {
  const named = /\(([^()]+)\)\s*$/.exec(r.resourceName)?.[1].trim();
  if (named) return ` ${named}`;
  return r.resourceType === 'material' || r.resourceType === 'other' ? '' : ' h';
}
const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const fmtDate = (d: Date | null) => (d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');

const TYPE_LABEL: Record<Activity['type'], string> = {
  task: 'Task dependent',
  'milestone-start': 'Start milestone',
  'milestone-finish': 'Finish milestone',
  loe: 'Level of effort',
  'wbs-summary': 'WBS summary',
};
/** P6's coded values, spelt out (DT_FixedDUR2 → Fixed duration & units / time). */
const DURATION_TYPE: Record<string, string> = {
  DT_FixedDUR2: 'Fixed duration & units/time', DT_FixedDrtn: 'Fixed duration & units/time',
  DT_FixedQty: 'Fixed units', DT_FixedQty2: 'Fixed units/time', DT_FixedRate: 'Fixed units/time', DT_FixedDUR: 'Fixed duration & units',
};
const PCT_TYPE: Record<string, string> = { CP_Phys: 'Physical', CP_Drtn: 'Duration', CP_Units: 'Units' };
const nice = (map: Record<string, string>, v?: string | null) => (v ? map[v] ?? v : '—');

const days = (hours: number) => Math.round((hours / 8) * 10) / 10;

/** The Activity pane of the Table and Gantt: the activity's fields in collapsible
    sections (remembered); its predecessors and successors are in the pane under the Gantt / table. */
/** The buttons under Details share one height. */
const DETAIL_BTN = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', height: 30, verticalAlign: 'top' } as const;

export function ActivityDetails({ activity, model, drivingTarget, onDrivingTarget, onSelect, onClose }: {
  activity: Activity;
  model: ScheduleModel;
  drivingTarget: string | null;
  onDrivingTarget: (id: string | null) => void;
  onSelect: (activity: Activity) => void;
  onClose: () => void;
}) {
  const sections = useOpenSections<SectionId>('schedule.detailSections3', DEFAULT_OPEN);
  // The objects each activity is linked to (Link Groups), and the contacts found between objects (Clashes & contacts).
  const loadedModels = useModelsStore((s) => s.models);
  const groups = useLinkGroupsStore((s) => s.groups);
  const clashResults = useClashStore((s) => s.results);
  const objects = useMemo(() => sharedActivityObjects(model, loadedModels, groups), [model, loadedModels, groups]);
  const contacts = useMemo(() => sharedContactIndex(clashResults), [clashResults]);
  const hasContacts = contacts.size > 0;
  const engine = useViewerEngine();
  // The activities the buttons act on: the ones picked in the table / Gantt (Ctrl / Shift+click) when this one is among them, else just this one.
  const picked = useActivitySelectionStore((s) => s.ids);
  const targets = useMemo(
    () => (picked.size > 1 && picked.has(activity.id) ? model.activities.filter((a) => picked.has(a.id)) : [activity]),
    [picked, model, activity],
  );
  // Their linked objects (each one's own, or those it shares by Element ID), as the viewer takes them.
  const linkedIds = useMemo(() => {
    const merged = new Map<string, Set<number>>();
    for (const a of targets) {
      for (const [modelId, ids] of objects.objectsOf.get(a.id) ?? []) {
        const set = merged.get(modelId) ?? merged.set(modelId, new Set()).get(modelId)!;
        for (const id of ids) set.add(id);
      }
    }
    const out: Record<string, number[]> = {};
    for (const [modelId, ids] of merged) if (ids.size) out[modelId] = [...ids];
    return out;
  }, [objects, targets]);
  const linkedCount = Object.values(linkedIds).reduce((n, l) => n + l.length, 0);
  const many = targets.length > 1;
  const ofThem = many ? `the ${targets.length} selected activities'` : 'its';

  /** Takes you to 4D Sequencing with the objects selected and the timeline on the earliest start date. */
  const showIn4D = () => {
    const timeline = useSequenceTimelineStore.getState();
    const starts = targets.map((a) => activityStartMs(a, timeline.basis)).filter((t): t is number => t !== null);
    if (starts.length) timeline.setDate(alignDown(Math.min(...starts), timeline.stepUnit));
    window.dispatchEvent(new CustomEvent('ip-goto-page', { detail: 'sequence' }));
    // Once the 4D page's viewer has its size back, select the objects and frame them.
    window.setTimeout(() => void engine.selectElements(linkedIds, true), 400);
  };

  /** Takes you to the 3D models with only the objects shown (Show all in the viewer brings the rest back). */
  const showIn3D = () => {
    window.dispatchEvent(new CustomEvent('ip-goto-page', { detail: 'model' }));
    window.setTimeout(() => void engine.isolateElements(linkedIds, true), 400);
  };


  // The objects selected in the model viewer, by GlobalId.
  const selectedByModel = useSelectionStore((s) => s.byModel);
  const selectedGuids = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const [modelId, ids] of Object.entries(selectedByModel)) {
      const index = engine.getIndexes().get(modelId);
      for (const id of ids) {
        const guid = index?.elements.get(id)?.guid;
        if (guid) (out[modelId] ??= []).push(guid);
      }
    }
    return out;
  }, [selectedByModel, engine]);
  const selectedCount = Object.values(selectedGuids).reduce((n, g) => n + g.length, 0);
  const [queued, setQueued] = useState(false);
  useEffect(() => setQueued(false), [activity.id, selectedByModel]);

  /** Stages Program / Activity ID and Activity Name on the selected objects (Properties › Edit properties); written to the IFC from there. */
  const queueIdAndName = () => {
    const add = usePropertyQueueStore.getState().add;
    add({ pset: 'Program', name: 'Activity ID', value: activity.code, valueType: 'IfcLabel', targets: selectedGuids });
    add({ pset: 'Program', name: 'Activity Name', value: activity.name, valueType: 'IfcLabel', targets: selectedGuids });
    setQueued(true);
  };

  // Links the model implies for this activity's element but the schedule lacks.
  const sequence = usePourSequence(objects);
  // Same whole-programme calculation as the generator (links added to earlier slabs count for later ones),
  // so what is listed here is exactly what generating would still add.
  const proposed = useMemo(
    () => (hasContacts ? proposeLinks(model, objects, contacts, { sequence }) : []),
    [model, objects, contacts, hasContacts, sequence],
  );
  const missing = useMemo(() => {
    const keyOf = (a: Activity) => objects.elementOf(a) || a.id;
    const mine = keyOf(activity);
    return proposed.filter((l) => keyOf(l.succ) === mine);
  }, [proposed, objects, activity]);


  // ---- Editing: the pencil next to the close button makes the fields below editable. An edit is kept with the project on top of
  // the programme (imported or generated), matched by Activity ID, and can be reset here.
  const visible = useVisibleSchedules();
  const overrides = useActivityOverridesStore((s) => s.byProgramme);
  const origin = useMemo(() => {
    const own = visible.length === 1 ? visible[0] : visible.find((v) => activity.id.startsWith(`${v.id}:`));
    return own ? programmeKey(own) : null;
  }, [visible, activity.id]);
  const edited = origin !== null && !!overrides[origin]?.[activity.code.trim().toUpperCase()];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: '', days: '', calendarId: '' });
  useEffect(() => setEditing(false), [activity.id]);
  const startEdit = () => {
    setDraft({ name: activity.name, days: String(days(activity.durationHours)), calendarId: activity.calendarId ?? '' });
    setEditing(true);
  };
  const saveEdit = () => {
    if (origin === null) return;
    const patch: Partial<Activity> = {};
    if (draft.name.trim() && draft.name !== activity.name) patch.name = draft.name.trim();
    const d = Number(draft.days);
    if (draft.days.trim() !== '' && Number.isFinite(d) && d >= 0) {
      const hours = Math.round(d * 8 * 4) / 4;
      if (hours !== activity.durationHours) {
        patch.durationHours = hours;
        // Work still to do follows; a started activity keeps its remaining duration.
        if (activity.status === 'not-started') patch.remainingDurationHours = hours;
      }
    }
    if (draft.calendarId && draft.calendarId !== (activity.calendarId ?? '')) patch.calendarId = draft.calendarId;
    if (Object.keys(patch).length) useActivityOverridesStore.getState().set(origin, new Map([[activity.code, patch]]));
    setEditing(false);
  };
  const resetEdits = () => {
    if (origin !== null) useActivityOverridesStore.getState().reset(origin, [activity.code]);
    setEditing(false);
  };

  const codes = Object.entries(activity.activityCodes);
  const udfs = Object.entries(activity.udf);


  const grid = (rows: [string, ReactNode][]) => (
    <table className="ad-grid">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row" title={k}>{k}</th>
            <td title={typeof v === 'string' || typeof v === 'number' ? String(v) : undefined}>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  // The app-only resources (◇) are shown with the programme's own.
  const resources = applyVirtualResources([activity])[0].resources;

  return (
    <div className="activity-details">
      <div className="side-pane__bar scn-dock__bar">
        <span className="layouts-dock__title">
          <IconList /> Activity
        </span>
        <button
          type="button"
          className={`side-pane__hide layouts-dock__close${editing ? ' is-on' : ''}`}
          title={origin === null ? 'Editing needs a single programme (or a combined one from files)' : editing ? 'Stop editing' : 'Edit this activity: name, original duration, calendar'}
          aria-label="Edit activity"
          aria-pressed={editing}
          disabled={origin === null}
          onClick={() => (editing ? setEditing(false) : startEdit())}
        >
          <IconPencil />
        </button>
        <button type="button" className="side-pane__hide layouts-dock__close" title="Close activity details" aria-label="Close activity details" onClick={onClose}>
          <IconClose />
        </button>
      </div>

      <CollapsibleSection title="Details" flush open={sections.isOpen('details')} onToggle={() => sections.toggle('details')}>
        {grid([
          ['Code', activity.code],
          ['Name', editing ? <input className="ad-edit" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="Name" /> : activity.name],
          ['Activity type', TYPE_LABEL[activity.type] ?? activity.type],
          ['Status', activity.status],
          ['WBS', activity.wbsPath || '—'],
          ['Calendar', editing
            ? (
              <select className="ad-edit" value={draft.calendarId} onChange={(e) => setDraft({ ...draft, calendarId: e.target.value })} aria-label="Calendar">
                {!activity.calendarId && <option value="">—</option>}
                {model.calendars.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
              </select>
            )
            : activity.calendarId ? (model.calendars.find((c) => c.id === activity.calendarId)?.name || activity.calendarId) : '—'],
          ['Original duration (d)', editing
            ? <input className="ad-edit" type="number" min={0} step="0.25" value={draft.days} onChange={(e) => setDraft({ ...draft, days: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false); }} aria-label="Original duration in days" />
            : days(activity.durationHours)],
          ['Remaining duration (d)', days(activity.remainingDurationHours)],
          ['Float (d)', activity.totalFloatHours !== null ? days(activity.totalFloatHours) : '—'],
          ['% Complete', `${activity.percentComplete}%`],
          ['% Complete type', nice(PCT_TYPE, activity.percentCompleteType)],
          ['Physical %', activity.physicalPercentComplete != null ? `${activity.physicalPercentComplete}%` : '—'],
          ['Duration type', nice(DURATION_TYPE, activity.durationType)],
          ['Primary resource', activity.primaryResource || '—'],
          ['Critical', activity.isCritical ? 'Yes' : 'No'],
        ])}
        {(editing || edited) && (
          <div className="ad-edit-bar">
            {editing && <button type="button" className="btn btn--small primary" onClick={saveEdit}>Save</button>}
            {editing && <button type="button" className="btn btn--small" onClick={() => setEditing(false)}>Cancel</button>}
            {edited && <span className="ad-edit-bar__note" title="Kept with the project on top of the programme, so re-importing or regenerating it keeps this edit">Edited</span>}
            {edited && <button type="button" className="btn btn--small" onClick={resetEdits} title="Put this activity back as in the imported or generated programme">Reset</button>}
          </div>
        )}
        <button
          type="button"
          className={`btn btn--small${drivingTarget === activity.id ? ' primary' : ''}`}
          style={{ ...DETAIL_BTN, margin: 6, minWidth: 52, padding: 0 }}
          onClick={() => onDrivingTarget(drivingTarget === activity.id ? null : activity.id)}
          title={drivingTarget === activity.id ? 'Hide driving path' : "Show driving path: pick out the chain of predecessors that drives this activity's start"}
          aria-label={drivingTarget === activity.id ? 'Hide driving path' : 'Show driving path'}
          aria-pressed={drivingTarget === activity.id}
        >
          <IconRoadSurface width={18} height={18} />
        </button>
        <button
          type="button"
          className="btn btn--small"
          style={{ ...DETAIL_BTN, margin: '6px 6px 6px 0', minWidth: 52 }}
          onClick={showIn4D}
          disabled={linkedCount === 0}
          title={linkedCount === 0 ? `${many ? 'These activities have' : 'This activity has'} no linked objects (Link Groups), so there is nothing to select` : `Go to 4D Sequencing: select ${ofThem} ${linkedCount.toLocaleString()} linked object${linkedCount === 1 ? '' : 's'} and move the timeline to ${many ? 'the earliest start' : 'its start'}`}
        >
          {many ? `4D (${targets.length})` : '4D'}
        </button>
        <button
          type="button"
          className="btn btn--small"
          style={{ ...DETAIL_BTN, margin: '6px 6px 6px 0', minWidth: 52 }}
          onClick={showIn3D}
          disabled={linkedCount === 0}
          title={linkedCount === 0 ? `${many ? 'These activities have' : 'This activity has'} no linked objects (Link Groups), so there is nothing to show` : `Go to the 3D models and isolate ${ofThem} ${linkedCount.toLocaleString()} linked object${linkedCount === 1 ? '' : 's'}: only the pours are shown`}
        >
          {many ? `3D (${targets.length})` : '3D'}
        </button>
        <button
          type="button"
          className="btn btn--small"
          style={{ ...DETAIL_BTN, margin: '6px 6px 6px 0' }}
          onClick={queueIdAndName}
          disabled={selectedCount === 0}
          title={selectedCount === 0 ? 'Select objects in the 3D model first' : `Add this activity's ID and Name to the Edit properties queue (Program › Activity ID, Activity Name) for the ${selectedCount.toLocaleString()} selected object${selectedCount === 1 ? '' : 's'}`}
        >
          {queued ? '✓ Queued' : 'Queue ID & Name'}
        </button>
      </CollapsibleSection>

      <CollapsibleSection title="Dates & constraints" flush open={sections.isOpen('dates')} onToggle={() => sections.toggle('dates')}>
        {grid([
          ['Planned Start', fmtDate(activity.targetStart)],
          ['Planned Finish', fmtDate(activity.targetFinish)],
          ['Actual Start', fmtDate(activity.actualStart)],
          ['Actual Finish', fmtDate(activity.actualFinish)],
          ['Remaining Start', fmtDate(activity.remainingStart ?? null)],
          ['Remaining Finish', fmtDate(activity.remainingFinish ?? null)],
          ['Expected Finish', fmtDate(activity.expectedFinish ?? null)],
          ['Suspend', fmtDate(activity.suspendDate ?? null)],
          ['Resume', fmtDate(activity.resumeDate ?? null)],
          ['Primary constraint', activity.constraintType ? `${constraintName(activity.constraintType)}${activity.constraintDate ? ` · ${fmtDate(activity.constraintDate)}` : ''}` : 'None'],
          ['Secondary constraint', activity.secondaryConstraintType ? `${constraintName(activity.secondaryConstraintType)}${activity.secondaryConstraintDate ? ` · ${fmtDate(activity.secondaryConstraintDate)}` : ''}` : 'None'],
        ])}
      </CollapsibleSection>

      <CollapsibleSection title="CPM dates" flush open={sections.isOpen('cpm')} onToggle={() => sections.toggle('cpm')}>
        {grid([
          ['Early Start', fmtDate(activity.earlyStart)],
          ['Early Finish', fmtDate(activity.earlyFinish)],
          ['Late Start', fmtDate(activity.lateStart)],
          ['Late Finish', fmtDate(activity.lateFinish)],
          ['Total Float (d)', activity.totalFloatHours !== null ? days(activity.totalFloatHours) : '—'],
          ['Free Float (d)', activity.freeFloatHours !== null ? days(activity.freeFloatHours) : '—'],
          ['Longest path', activity.longestPath ? 'Yes' : 'No'],
        ])}
      </CollapsibleSection>

      {missing.length > 0 && (
        <CollapsibleSection title={`Missing predecessors (${missing.length})`} flush open={sections.isOpen('suggested')} onToggle={() => sections.toggle('suggested')}>
          {missing.length > 0 && (
            <>
              <table className="ad-grid ad-grid--links">
                <thead>
                  <tr><th>ID</th><th>Name</th><th title="Why it is a predecessor: a pour below, a wall beside, or the previous pour in the Scenarios sequence">Why</th></tr>
                </thead>
                <tbody>
                  {missing.map(({ pred, succ, reason, relation }) => (
                    <tr key={`${pred.id}>${succ.id}`}>
                      <td><button type="button" className="link-btn" onClick={() => onSelect(pred)} title={`Go to ${pred.code}`}>{pred.code}</button></td>
                      <td><span className="report-clip" title={pred.name}>{pred.name}</span></td>
                      <td className="ad-grid__relation">
                        <span className="ad-relation-cell" title={relation ? relationDetail(relation, 'predecessor') : 'The pour before this one in the Scenarios sequence'}>
                          <span className={`ad-relation${relation ? ` ad-relation--${relation.dominant}` : ''}`}>{REASON_LABEL[reason]}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="scn-dim" style={{ padding: '4px 8px' }}>Slab: pours touching below, walls beside and the previous pour in the Scenarios sequence, with no link in the schedule. Generate them from the Generated schedules tab; they are added automatically when a programme is generated.</div>
            </>
          )}
        </CollapsibleSection>
      )}

      {resources.length > 0 && (
        <CollapsibleSection title={`Resources (${resources.length})`} flush open={sections.isOpen('resources')} onToggle={() => sections.toggle('resources')}>
          {grid(resources.map((r) => [r.virtual ? `◇ ${r.resourceName}` : r.resourceName, `${fmtQty(r.targetQty)}${unitOf(r)}`]))}
        </CollapsibleSection>
      )}

      {codes.length > 0 && (
        <CollapsibleSection title={`Activity codes (${codes.length})`} flush open={sections.isOpen('codes')} onToggle={() => sections.toggle('codes')}>
          {grid(codes)}
        </CollapsibleSection>
      )}

      {udfs.length > 0 && (
        <CollapsibleSection title={`User-defined fields (${udfs.length})`} flush open={sections.isOpen('udf')} onToggle={() => sections.toggle('udf')}>
          {grid(udfs.map(([k, v]) => [k, v instanceof Date ? v.toLocaleDateString() : String(v)]))}
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Notes" flush open={sections.isOpen('notes')} onToggle={() => sections.toggle('notes')}>
        <ActivityNote activity={activity} />
      </CollapsibleSection>
    </div>
  );
}
