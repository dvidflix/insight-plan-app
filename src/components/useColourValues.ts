import { useMemo } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useSearchSetsStore } from '../state/searchSetsStore';
import { isSetFolderField, makeValueOf } from '../viewer/setFolderValues';
import { useModelsStore } from '../state/modelsStore';
import { useFieldValues, useIndexTick } from './modelFields';

/** The values of a colouring field over the loaded models, most objects first: a property's values, or
    (for a set folder) the names of its sets. Shared by Models > Colour and its legend on the viewer. */
export function useColourValues(field: string) {
  const engine = useViewerEngine();
  const sets = useSearchSetsStore((s) => s.sets);
  const tick = useIndexTick();
  const hiddenModels = useModelsStore((s) => s.hiddenModelIds);
  const setFolder = isSetFolderField(field);
  const propertyValues = useFieldValues(setFolder ? '' : field, true);
  return useMemo(() => {
    if (!setFolder) return propertyValues;
    const valueOf = makeValueOf(field, engine.getIndexes(), sets);
    const counts = new Map<string, number>();
    for (const [modelId, index] of engine.getIndexes()) for (const e of hiddenModels.has(modelId) ? [] : index.elements.values()) counts.set(valueOf(e), (counts.get(valueOf(e)) ?? 0) + 1);
    return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setFolder, propertyValues, field, sets, tick, engine, hiddenModels]);
}
