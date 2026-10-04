import { useMemo } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useLinkGroupsStore } from '../state/linkGroupsStore';
import { useSelectedActivityStore } from '../state/selectedActivityStore';
import { sharedActivityObjects } from '../schedule/activityObjects';
import { drives } from '../schedule/drivingPath';
import type { IdsByModel } from '../viewer/relations';
import { CollapsibleSection, useOpenSections } from './CollapsibleSection';

/** The elements of a set of activities, per model. */
function idsOf(activityIds: string[], objectsOf: Map<string, Map<string, Set<number>>>): IdsByModel {
  const out: IdsByModel = {};
  for (const id of activityIds) {
    for (const [modelId, ids] of objectsOf.get(id) ?? []) {
      const list = (out[modelId] ??= []);
      for (const n of ids) if (!list.includes(n)) list.push(n);
    }
  }
  return out;
}
const count = (ids: IdsByModel) => Object.values(ids).reduce((n, l) => n + l.length, 0);

/** Models page > 3D & Related > the selected activity's links: selects the elements of the activity, its
    predecessors (all, or only the driving ones) and its successors, to check the links against the model. */
export function ActivityLinksSection() {
  const engine = useViewerEngine();
  const model = useSelectedActivityStore((s) => s.model);
  const activityId = useSelectedActivityStore((s) => s.activityId);
  const loadedModels = useModelsStore((s) => s.models);
  const groups = useLinkGroupsStore((s) => s.groups);
  const sections = useOpenSections<'links'>('related.activityLinksSections', ['links']);

  const info = useMemo(() => {
    const activity = model?.activities.find((a) => a.id === activityId);
    if (!model || !activity) return null;
    const { objectsOf } = sharedActivityObjects(model, loadedModels, groups);
    const byId = new Map(model.activities.map((a) => [a.id, a]));
    const preds = model.relationships.filter((r) => r.succId === activity.id);
    const succs = model.relationships.filter((r) => r.predId === activity.id);
    // An activity can be linked to the same one several times (SS and FF, say): counted once.
    const predIds = [...new Set(preds.map((r) => r.predId))];
    const drivingIds = [...new Set(preds.filter((r) => { const p = byId.get(r.predId); return !!p && drives(r, p, activity); }).map((r) => r.predId))];
    const succIds = [...new Set(succs.map((r) => r.succId))];
    const withObjects = (ids: string[]) => ids.filter((id) => objectsOf.has(id)).length;
    return {
      activity,
      sets: {
        activity: { ids: idsOf([activity.id], objectsOf), n: 1, linked: withObjects([activity.id]) },
        preds: { ids: idsOf(predIds, objectsOf), n: predIds.length, linked: withObjects(predIds) },
        driving: { ids: idsOf(drivingIds, objectsOf), n: drivingIds.length, linked: withObjects(drivingIds) },
        succs: { ids: idsOf(succIds, objectsOf), n: succIds.length, linked: withObjects(succIds) },
      },
    };
  }, [model, activityId, loadedModels, groups]);

  const button = (key: 'activity' | 'preds' | 'driving' | 'succs', label: string, title: string) => {
    const set = info?.sets[key];
    const objects = set ? count(set.ids) : 0;
    return (
      <button
        type="button"
        className="clash__kind"
        disabled={!objects}
        onClick={() => set && void engine.selectElements(set.ids, true)}
        title={set ? `${title}: ${set.linked} of ${set.n} ${set.n === 1 ? 'activity has' : 'activities have'} objects` : title}
      >
        <span>{label}</span>
        <b>{objects}</b>
      </button>
    );
  };

  return (
    <CollapsibleSection
      title="Schedule links"
      open={sections.isOpen('links')}
      onToggle={() => sections.toggle('links')}
      tip={
        <p>Selects, in the 3D view, the elements linked (Link Groups) to the activity selected on the Programmes page, to its <b>predecessors</b> (or only the <b>driving</b> ones) and to its <b>successors</b>. The number is the elements selected. Use it to check the programme's logic, or the links you generated, against the model.</p>
      }
    >
      <div className="clash">
        {info ? (
          <>
            <div className="flt__hint" title={info.activity.name}><b>{info.activity.code}</b> · {info.activity.name}</div>
            <div className="clash__kinds clash__kinds--four">
              {button('activity', 'Activity', 'The elements of this activity')}
              {button('preds', 'Predecessors', 'The elements of all its predecessors')}
              {button('driving', 'Driving', 'The elements of the predecessors that drive its start')}
              {button('succs', 'Successors', 'The elements of all its successors')}
            </div>
            {info.sets.preds.n > 0 && info.sets.preds.linked < info.sets.preds.n && (
              <div className="flt__hint">{info.sets.preds.n - info.sets.preds.linked} of {info.sets.preds.n} predecessors have no linked elements (Link Groups).</div>
            )}
          </>
        ) : (
          <div className="flt__hint">Select an activity on the Programmes page first.</div>
        )}
      </div>
    </CollapsibleSection>
  );
}
