import { useEffect, useMemo, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { ATTRIBUTES, elementValue } from '../viewer/bimTables';
import { usePropertyVisibilityStore } from '../state/propertyVisibilityStore';
import type { PickField } from './schedule/FieldRules';

/** Bumps when the viewer's per-model indexes are (re)built. */
export function useIndexTick() {
  const engine = useViewerEngine();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    engine.onSetsReady.add(bump);
    return () => { engine.onSetsReady.remove(bump); };
  }, [engine]);
  return tick;
}

/** Every property of the loaded models, for the field pickers: the
    attributes first, then "Pset.Prop" grouped by property set. */
const NO_KEEP: string[] = [];

export function useModelFields(keep: string[] = NO_KEEP): PickField[] {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const tick = useIndexTick();
  // The properties left out in Models > Properties > Show / hide are left out here too (unless switched off there); ones in use stay.
  const apply = usePropertyVisibilityStore((s) => s.applyToFields);
  const hiddenPsets = usePropertyVisibilityStore((s) => s.hiddenPsets);
  const hiddenProps = usePropertyVisibilityStore((s) => s.hiddenProps);
  const keepKey = keep.join('\u0001');
  return useMemo(() => {
    const keys = new Set<string>();
    for (const index of engine.getIndexes().values()) for (const e of index.elements.values()) for (const k of Object.keys(e.props)) keys.add(k);
    const attrs: PickField[] = ['Class', 'Name', 'GlobalId', 'Model'].map((a) => ({ id: `${ATTRIBUTES}.${a}`, label: a === 'Model' ? 'Model (file)' : a, group: ATTRIBUTES }));
    const props = [...keys].sort((a, b) => a.localeCompare(b)).map((k) => {
      const dot = k.indexOf('.');
      return { id: k, label: dot === -1 ? k : k.slice(dot + 1), group: dot === -1 ? 'Other' : k.slice(0, dot) };
    });
    const all = [...attrs, ...props];
    if (!apply || (!hiddenPsets.length && !hiddenProps.length)) return all;
    const used = new Set(keepKey ? keepKey.split('\u0001') : []);
    const setOff = new Set(hiddenPsets);
    const propOff = new Set(hiddenProps);
    return all.filter((f) => used.has(f.id) || !(setOff.has(f.group ?? '') || propOff.has(f.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, models, tick, apply, hiddenPsets, hiddenProps, keepKey]);
}

/** Distinct values of `field` over the loaded models, most common first. */
export function useFieldValues(field: string, skipHidden = false) {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const hiddenModels = useModelsStore((s) => s.hiddenModelIds);
  const tick = useIndexTick();
  return useMemo(() => {
    const counts = new Map<string, number>();
    if (field) for (const [modelId, index] of engine.getIndexes()) for (const e of skipHidden && hiddenModels.has(modelId) ? [] : index.elements.values()) {
      const v = elementValue(e, field);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, field, models, tick, skipHidden, hiddenModels]);
}
