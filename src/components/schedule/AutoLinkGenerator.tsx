import { useEffect } from 'react';
import { useAutoLinksStore } from '../../state/autoLinksStore';
import { useClashStore } from '../../state/clashStore';
import { useGeneratedLinksStore } from '../../state/generatedLinksStore';
import { useLinkGroupsStore } from '../../state/linkGroupsStore';
import { useModelsStore } from '../../state/modelsStore';
import { useScenarioStore } from '../../state/scenarioStore';
import { useScheduleStore } from '../../state/scheduleStore';
import { sharedContactIndex } from '../../schedule/activityRelation';
import { sharedActivityObjects } from '../../schedule/activityObjects';
import { proposeLinks, toRelationships } from '../../schedule/generateLinks';
import { buildPourSequence } from '../../schedule/pourSequence';

/** Mounted once for the whole app: when a programme has just been generated (see loadIntoInputs), waits until
    the Link Groups, the models and the Clashes & contacts results are ready, then adds the slabs' missing
    links to it, so nobody has to create them by hand. The batch can be undone from Generated schedules. */
export function AutoLinkGenerator() {
  const pending = useAutoLinksStore((s) => s.pending);
  const enabled = useAutoLinksStore((s) => s.enabled);
  const schedules = useScheduleStore((s) => s.schedules);
  const loadedModels = useModelsStore((s) => s.models);
  const groups = useLinkGroupsStore((s) => s.groups);
  const clashResults = useClashStore((s) => s.results);
  const clashBusy = useClashStore((s) => !!s.running || s.pending > 0);
  const rows = useScenarioStore((s) => s.rows);
  const headers = useScenarioStore((s) => s.loaded?.headers);

  useEffect(() => {
    if (!pending) return;
    const { clear, setStatus } = useAutoLinksStore.getState();
    if (!enabled) {
      clear();
      return;
    }
    const schedule = schedules.find((s) => s.id === pending);
    if (!schedule) return;
    const waiting = groups.length === 0 ? 'Link Groups are not defined'
      : loadedModels.length === 0 ? 'the models are not loaded'
      : clashBusy || Object.keys(clashResults).length === 0 ? 'Clashes & contacts are not ready'
      : null;
    if (waiting) {
      setStatus(`Waiting to add the links: ${waiting}.`);
      return;
    }
    const objects = sharedActivityObjects(schedule, loadedModels, groups);
    const sequence = headers ? buildPourSequence(rows, headers, loadedModels, objects.ownersOf) : [];
    const links = proposeLinks(schedule, objects, sharedContactIndex(clashResults), { sequence });
    if (links.length) useScheduleStore.getState().setRelationships(schedule.id, [...schedule.relationships, ...toRelationships(links)]);
    useGeneratedLinksStore.getState().setLast({
      count: links.length,
      undo: new Map([[schedule.id, schedule.relationships]]),
      links: links.map((l) => ({ pred: l.pred.code, succ: l.succ.code })),
    });
    setStatus(links.length ? `Added ${links.length.toLocaleString()} links to the generated programme.` : 'The generated programme already has every link.');
    clear();
  }, [pending, enabled, schedules, loadedModels, groups, clashResults, clashBusy, rows, headers]);

  return null;
}
