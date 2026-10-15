import { IS_SATELLITE } from '../../state/satellite';
import { useModelsStore } from '../../state/modelsStore';
import { useSatelliteModelsStore } from '../../state/satelliteModels';

/** What a panel says when there is no model or no programme to work with. In a second window, which loads the 3D models only when asked,
    it offers to load them here. */
export function NeedsModels({ compact = false }: { /** Just the models (the panel works without a programme). */ compact?: boolean }) {
  const models = useModelsStore((s) => s.models);
  const wanted = useSatelliteModelsStore((s) => s.wanted);
  const want = useSatelliteModelsStore((s) => s.want);
  if (IS_SATELLITE && models.length === 0) {
    return (
      <div style={{ padding: 12, color: 'var(--text-dim)', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
        <span>{wanted ? 'Loading the models in this window…' : 'The 3D models are not loaded in this window: the counts, the views and the sequence need them.'}</span>
        {!wanted && <button type="button" className="btn btn--small primary" onClick={want}>Load the models here</button>}
      </div>
    );
  }
  return (
    <div style={{ padding: 12, color: 'var(--text-dim)' }}>
      {compact ? 'Load an IFC model in Inputs to use this.' : 'Load both an IFC model and a P6 programme in Inputs to start 4D sequencing — or generate one from the Scenarios tab.'}
    </div>
  );
}
