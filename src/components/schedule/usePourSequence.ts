import { useMemo } from 'react';
import { useModelsStore } from '../../state/modelsStore';
import { useScenarioStore } from '../../state/scenarioStore';
import { buildPourSequence } from '../../schedule/pourSequence';
import type { ActivityObjects } from '../../schedule/activityObjects';

/** The pour order on screen in Scenarios, as steps of activity ids (empty until a scenario is loaded). */
export function usePourSequence(objects: ActivityObjects): string[][] {
  const rows = useScenarioStore((s) => s.rows);
  const headers = useScenarioStore((s) => s.loaded?.headers);
  const loadedModels = useModelsStore((s) => s.models);
  return useMemo(() => (headers ? buildPourSequence(rows, headers, loadedModels, objects.ownersOf) : []), [rows, headers, loadedModels, objects]);
}
