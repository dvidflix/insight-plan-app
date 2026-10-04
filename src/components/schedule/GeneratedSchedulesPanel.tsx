import { useMemo, useState } from 'react';
import type { ScheduleModel } from '../../schedule/types';
import { sharedContactIndex } from '../../schedule/activityRelation';
import { sharedActivityObjects } from '../../schedule/activityObjects';
import { proposeLinks } from '../../schedule/generateLinks';
import { useClashStore } from '../../state/clashStore';
import { useLinkGroupsStore } from '../../state/linkGroupsStore';
import { useModelsStore } from '../../state/modelsStore';
import { useCreateLinks } from './useCreateLinks';
import { useAutoLinksStore } from '../../state/autoLinksStore';
import { usePourSequence } from './usePourSequence';

const LIST_ROWS = 200;

/** Side pane > Generated schedules: builds the programme's missing finish-to-start links from the
    3D model for every element at once. The links join the programme in the app (the Gantt stays
    as it is: same scroll, filters and groups) and the last batch can be undone. */
export function GeneratedSchedulesPanel({ model }: { model: ScheduleModel }) {
  const loadedModels = useModelsStore((s) => s.models);
  const groups = useLinkGroupsStore((s) => s.groups);
  const clashResults = useClashStore((s) => s.results);
  const contacts = useMemo(() => sharedContactIndex(clashResults), [clashResults]);
  const { create, revert, created } = useCreateLinks(model);
  const objects = useMemo(() => sharedActivityObjects(model, loadedModels, groups), [model, loadedModels, groups]);
  const sequence = usePourSequence(objects);
  const [working, setWorking] = useState(false);
  const auto = useAutoLinksStore((s) => s.enabled);
  const setAuto = useAutoLinksStore((s) => s.setEnabled);
  const autoStatus = useAutoLinksStore((s) => s.status);

  const blocked = groups.length === 0 ? 'Define Link Groups first: no activity is linked to any object yet.'
    : loadedModels.length === 0 ? 'Load the models first.'
    : contacts.size === 0 ? 'No Clashes & contacts results yet (load the models and let them run).'
    : null;

  const generate = () => {
    setWorking(true);
    // Let the button show "Working…" before the (synchronous) calculation starts.
    setTimeout(() => {
      try {
        create(proposeLinks(model, objects, contacts, { sequence }));
      } finally {
        setWorking(false);
      }
    }, 0);
  };

  return (
    <div className="panel-section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="scn-dim">
        Adds finish-to-start links to every slab, from the pours touching below it, the walls beside it and the previous pour in the Scenarios sequence. Links the programme already has, directly or through other activities, are left out.
      </div>
      <div className="disp__row">
        <span>Add them when a programme is generated</span>
        <button type="button" role="switch" aria-checked={auto} className={`switch${auto ? ' on' : ''}`} onClick={() => setAuto(!auto)}>
          <span className="switch__thumb" />
        </button>
      </div>
      {autoStatus && <div className="scn-dim">{autoStatus}</div>}
      <div>
        <button type="button" className="btn btn--small primary" disabled={!!blocked || working} onClick={generate}>
          {working ? 'Working…' : 'Generate links now'}
        </button>
      </div>
      {blocked && <div className="scn-dim">{blocked}</div>}
      {!blocked && sequence.length === 0 && <div className="scn-dim">No pour order from Scenarios is loaded, so the previous-pour links are skipped.</div>}

      {created && (
        <>
          <div>
            {created.count === 0
              ? 'Nothing to add: the programme already has every link the model implies.'
              : `Created ${created.count.toLocaleString()} ${created.count === 1 ? 'link' : 'links'}`}
            {' '}
            {created.count > 0 && <button type="button" className="link-btn" onClick={revert}>Undo</button>}
          </div>
          <div className="scn-dim">Kept in the app, not written back to the database.</div>
          {created.links.length > 0 && (
            <div className="report-table">
              <div className="report-table__scroll">
                <table>
                  <thead><tr><th>Predecessor</th><th>Successor</th></tr></thead>
                  <tbody>
                    {created.links.slice(0, LIST_ROWS).map((l, i) => <tr key={i}><td>{l.pred}</td><td>{l.succ}</td></tr>)}
                  </tbody>
                </table>
              </div>
              {created.links.length > LIST_ROWS && <div className="scn-dim">Showing the first {LIST_ROWS} of {created.links.length.toLocaleString()}.</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
