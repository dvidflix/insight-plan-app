import { useMemo } from 'react';
import type { Activity, ResourceAssignment, ScheduleModel } from '../../schedule/types';
import { CollapsibleSection, useOpenSections } from '../CollapsibleSection';
import { IconClose, IconList } from '../icons';
import { applyVirtualResources } from '../../schedule/virtualResources';
import { ActivityNote } from './ActivityNote';
import { relationDetail, sharedContactIndex } from '../../schedule/activityRelation';
import { sharedActivityObjects } from '../../schedule/activityObjects';
import { REASON_LABEL, proposeLinks } from '../../schedule/generateLinks';
import { usePourSequence } from './usePourSequence';
import { useModelsStore } from '../../state/modelsStore';
import { useLinkGroupsStore } from '../../state/linkGroupsStore';
import { useClashStore } from '../../state/clashStore';

type SectionId = 'details' | 'notes' | 'suggested' | 'codes' | 'udf' | 'resources';
const DEFAULT_OPEN: SectionId[] = ['details', 'notes', 'suggested', 'codes', 'udf', 'resources'];

/** What a resource's quantity is counted in: a unit in its name ("Concrete (m3)", "Rebar (t)"), else hours for labour and equipment, nothing for other materials. */
function unitOf(r: ResourceAssignment): string {
  const named = /\(([^()]+)\)\s*$/.exec(r.resourceName)?.[1].trim();
  if (named) return ` ${named}`;
  return r.resourceType === 'material' || r.resourceType === 'other' ? '' : ' h';
}
const fmtQty = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

const days = (hours: number) => Math.round((hours / 8) * 10) / 10;

/** The Activity pane of the Table and Gantt: the activity's fields in collapsible
    sections (remembered); its predecessors and successors are in the pane under the Gantt / table. */
export function ActivityDetails({ activity, model, drivingTarget, onDrivingTarget, onSelect, onClose }: {
  activity: Activity;
  model: ScheduleModel;
  drivingTarget: string | null;
  onDrivingTarget: (id: string | null) => void;
  onSelect: (activity: Activity) => void;
  onClose: () => void;
}) {
  const sections = useOpenSections<SectionId>('schedule.detailSections', DEFAULT_OPEN);
  // The objects each activity is linked to (Link Groups), and the contacts found between objects (Clashes & contacts).
  const loadedModels = useModelsStore((s) => s.models);
  const groups = useLinkGroupsStore((s) => s.groups);
  const clashResults = useClashStore((s) => s.results);
  const objects = useMemo(() => sharedActivityObjects(model, loadedModels, groups), [model, loadedModels, groups]);
  const contacts = useMemo(() => sharedContactIndex(clashResults), [clashResults]);
  const hasContacts = contacts.size > 0;


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


  const codes = Object.entries(activity.activityCodes);
  const udfs = Object.entries(activity.udf);


  const grid = (rows: [string, string | number][]) => (
    <table className="ad-grid">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row" title={k}>{k}</th>
            <td title={String(v)}>{v}</td>
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
        <button type="button" className="side-pane__hide layouts-dock__close" title="Close activity details" aria-label="Close activity details" onClick={onClose}>
          <IconClose />
        </button>
      </div>

      <CollapsibleSection title="Details" flush open={sections.isOpen('details')} onToggle={() => sections.toggle('details')}>
        {grid([
          ['Code', activity.code],
          ['Name', activity.name],
          ['Status', activity.status],
          ['Float (d)', activity.totalFloatHours !== null ? days(activity.totalFloatHours) : '—'],
          ['% Complete', `${activity.percentComplete}%`],
        ])}
        <button
          type="button"
          className={`btn btn--small${drivingTarget === activity.id ? ' primary' : ''}`}
          style={{ margin: 6 }}
          onClick={() => onDrivingTarget(drivingTarget === activity.id ? null : activity.id)}
          title="Pick out the chain of predecessors that drives this activity's start"
        >
          {drivingTarget === activity.id ? 'Hide driving path' : 'Show driving path'}
        </button>
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
