import { useMemo } from 'react';
import { useScenarioStore } from '../../state/scenarioStore';
import { useSearchSetsStore } from '../../state/searchSetsStore';
import { useViewerEngine } from '../../viewer/ViewerEngineContext';
import { computeBreakdown } from '../../scenarios/breakdownSource';
import { makesItems, type BreakdownResult } from '../../prs/workBreakdown';
import { useIndexTick } from '../modelFields';

/** The work items the grouping levels make of the loaded models, or null when the levels do not make any (the programme is then made from the pours).
    Every view of the work (the list, the 3D preview, the objects of an item) reads this, so they agree with what Update 4D generates. */
export function useWorkItems(): BreakdownResult | null {
  const engine = useViewerEngine();
  const tick = useIndexTick();
  const sets = useSearchSetsStore((s) => s.sets);
  const def = useScenarioStore((s) => s.rules.breakdown);
  return useMemo(() => (def && makesItems(def) ? computeBreakdown(def, engine.getIndexes(), sets) : null), [def, engine, sets, tick]); // eslint-disable-line react-hooks/exhaustive-deps
}

const norm = (s: string) => s.trim().toUpperCase();

/** The work items of one group (a recipe's group), in the order they are built. */
export const itemsOfGroup = (built: BreakdownResult, group: string) => built.leaves.filter((l) => norm(l.item.group) === norm(group));

/** The groups of the work items, each once, in the order they first come. */
export const groupsOfItems = (built: BreakdownResult): string[] => [...new Map(built.leaves.map((l) => [norm(l.item.group), l.item.group])).values()];
