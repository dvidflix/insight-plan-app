import { useEffect, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { useDataTableStore } from '../state/dataTableStore';
import { matchTwins, type TwinMap } from '../viewer/twinMatch';
import { useIndexTick } from './modelFields';

/** The data table's twin setup, resolved: the two models (when both are
    loaded) and the pairing of their objects by geometry. */
export function useTwin() {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const { primary, twin, tolerance } = useDataTableStore((s) => s.twin);
  const tick = useIndexTick();
  const a = models.find((m) => m.name === primary) ?? null;
  const b = models.find((m) => m.name === twin) ?? null;
  const active = !!a && !!b && a.modelId !== b.modelId;
  const [state, setState] = useState<{ map: TwinMap | null; busy: boolean }>({ map: null, busy: false });

  useEffect(() => {
    if (!active) { setState({ map: null, busy: false }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, busy: true }));
    void engine.ready.then(() => matchTwins(engine, a!.modelId, b!.modelId, tolerance)).then(
      (map) => { if (!cancelled) setState({ map, busy: false }); },
      () => { if (!cancelled) setState({ map: null, busy: false }); },
    );
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, active, a?.modelId, b?.modelId, tolerance, tick]);

  return { active, a, b, map: state.map, busy: state.busy };
}
