import { useState } from 'react';
import { useGettingStarted } from '../state/gettingStarted';
import { useProjectDbStore } from '../state/projectDbStore';
import { useModelsStore } from '../state/modelsStore';
import { useScheduleStore } from '../state/scheduleStore';
import { useLinkGroupsStore } from '../state/linkGroupsStore';
import { useDockStore } from '../state/dockStore';
import { IconClose } from './icons';

/** Home's "Getting started": the five steps from an empty app to a model building in programme order, each ticked from what the app holds now
    (a folder, a model, a programme, a Link Group, the timeline played once) and each with the one button that does it. The next step's button is
    the main one. Gone once every step is done, or when put away (Search › Show getting started brings it back). */

const goTo = (page: string) => () => window.dispatchEvent(new CustomEvent('ip-goto-page', { detail: page }));
const openPanel = (id: 'files' | 'settings') => () => useDockStore.getState().reveal(id);

export function GettingStarted() {
  const dismissed = useGettingStarted((s) => s.dismissed);
  const played = useGettingStarted((s) => s.played);
  const folder = useProjectDbStore((s) => !!s.root);
  const models = useModelsStore((s) => s.models.length);
  const programmes = useScheduleStore((s) => s.schedules.length);
  const groups = useLinkGroupsStore((s) => s.groups.length);
  const steps = [
    { id: 'folder', done: folder, label: 'Choose a folder', why: 'The project database (programmes, scenarios, settings) is kept in it. It is under Settings › Project database.', action: 'Open Settings', run: openPanel('settings') },
    { id: 'model', done: models > 0, label: 'Load a model', why: 'Add an IFC file in Files (or drop it on this page) and tick it to load it.', action: 'Open Files', run: openPanel('files') },
    { id: 'programme', done: programmes > 0, label: 'Load a programme', why: 'Add a P6 programme (XER or XML) in Files and tick it.', action: 'Open Files', run: openPanel('files') },
    { id: 'link', done: groups > 0, label: 'Link activities', why: 'A Link Group says which objects each activity stands for. On 4D Sequencing, pick activities and objects and press Link selection, or make a group by rules.', action: 'Go to 4D Sequencing', run: goTo('sequence') },
    { id: 'play', done: played, label: 'Play the timeline', why: 'Watch the model build in programme order on 4D Sequencing.', action: 'Go to 4D Sequencing', run: goTo('sequence') },
  ];
  const done = steps.filter((s) => s.done).length;
  // The step whose explanation and button show under the row: the one clicked, else the next one to do.
  const [picked, setPicked] = useState<string | null>(null);
  if (dismissed || done === steps.length) return null;
  const next = steps.find((s) => !s.done);
  const shown = steps.find((s) => s.id === picked) ?? next!;
  return (
    <section className="home-start" aria-label="Getting started">
      <div className="home-start__head">
        <b>Getting started</b>
        <span className="home-start__count">{done} of {steps.length} done</span>
        <ol className="home-start__steps">
          {steps.map((s, i) => (
            <li key={s.id}>
              <button type="button" className={`home-start__step${s.done ? ' is-done' : ''}${s === next ? ' is-next' : ''}${s === shown ? ' is-shown' : ''}`} aria-pressed={s === shown} onClick={() => setPicked(s.id)} title={s.done ? `${s.label}: done` : `${s.label}: show what to do`}>
                <span className="home-start__num" aria-hidden>{s.done ? '✓' : i + 1}</span>
                {s.label}
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="icon-btn home-start__close" onClick={() => useGettingStarted.getState().setDismissed(true)} aria-label="Put the getting-started steps away" title="Put the getting-started steps away. Search (Ctrl+K) › Show getting started brings them back">
          <IconClose width={16} height={16} />
        </button>
      </div>
      <div className="home-start__detail">
        <span className="scn-dim hint">{shown.done ? `Done. ${shown.why}` : shown.why}</span>
        <button type="button" className={`btn btn--small${shown === next ? ' primary' : ''}`} onClick={shown.run}>{shown.action}</button>
      </div>
    </section>
  );
}
