import { useEffect, useState } from 'react';
import { FileDetails, type FileSummary } from './FileDetails';
import { SceneDetails } from './SceneDetails';
import { scenes } from '../state/scenes';
import { useHomeSelection } from '../state/homeSelection';
import { usePersistedState } from '../utils/persistedState';

/** The Files panel's details pane: two tabs, the chosen scene's details and the selected files' details. A chevron hides it. */
export function DetailsPane({ files }: { files: FileSummary[]; onClose?: () => void }) {
  const [tab, setTab] = usePersistedState<'scene' | 'file'>('inputs.detailsTab', 'scene');
  const [store, setStore] = useState(scenes.get);
  const chosenId = useHomeSelection((s) => s.sceneId);
  useEffect(() => {
    const refresh = () => setStore(scenes.get());
    window.addEventListener('ip-scenes', refresh);
    return () => window.removeEventListener('ip-scenes', refresh);
  }, []);
  const scene = store.scenes.find((s) => s.id === chosenId) ?? store.scenes.find((s) => s.id === store.activeId) ?? null;
  const bar = (
    <div className="side-pane__bar scn-dock__bar details-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === 'scene'} className={`details-tabs__tab${tab === 'scene' ? ' is-on' : ''}`} onClick={() => setTab('scene')}>Scene</button>
      <button type="button" role="tab" aria-selected={tab === 'file'} className={`details-tabs__tab${tab === 'file' ? ' is-on' : ''}`} onClick={() => setTab('file')}>
        File{files.length > 1 ? ` (${files.length})` : ''}
      </button>
    </div>
  );
  return tab === 'scene' ? <SceneDetails scene={scene} active={scene?.id === store.activeId} bar={bar} /> : <FileDetails files={files} bar={bar} />;
}
