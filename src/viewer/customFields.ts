import { useEffect } from 'react';
import { useViewerEngine } from './ViewerEngineContext';
import type { ViewerEngine } from './ViewerEngine';
import { customKey, useCustomFieldsStore } from '../state/customFieldsStore';
import { pullFields } from '../seatable/client';

/** Puts the custom fields (SeaTable columns) on the model elements as "Custom.<column>"
    properties: the elements of the viewer's indexes are the ones every panel reads, so the
    Properties table, the Data table, colour, filters, search sets and link groups all see them. */
let applying = false;

export function applyCustomFields(engine: ViewerEngine, only?: string[]) {
  const { values, fields } = useCustomFieldsStore.getState();
  applying = true;
  try {
    for (const [modelId, index] of engine.getIndexes()) {
      if (only && !only.includes(modelId)) continue;
      let changed = false;
      for (const el of index.elements.values()) {
        const mine = values[el.guid];
        const target: Record<string, string | number> = {};
        if (mine) for (const f of fields) if (mine[f] !== undefined) target[customKey(f)] = mine[f];
        for (const k of Object.keys(el.props)) {
          if (k.startsWith('Custom.') && !(k in target)) {
            delete el.props[k]; // a custom field that is gone, or this element no longer has a value for
            changed = true;
          }
        }
        for (const [k, v] of Object.entries(target)) {
          if (el.props[k] !== v) {
            el.props[k] = v;
            changed = true;
          }
        }
      }
      if (changed) engine.onSetsReady.trigger(modelId);
    }
  } finally {
    applying = false;
  }
}

/** Keeps the custom fields on the elements: the saved copy goes on as each model is indexed, and
    (when "pull automatically" is on) the fields are pulled from SeaTable a moment later. */
export function useCustomFieldsSync() {
  const engine = useViewerEngine();
  useEffect(() => {
    let timer: number | undefined;
    const onReady = (modelId: string) => {
      if (applying) return;
      applyCustomFields(engine, [modelId]);
      if (useCustomFieldsStore.getState().autoPull) {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => void pullFields(engine, { quiet: true }), 1500);
      }
    };
    engine.onSetsReady.add(onReady);
    applyCustomFields(engine);
    return () => {
      window.clearTimeout(timer);
      engine.onSetsReady.remove(onReady);
    };
  }, [engine]);
}
