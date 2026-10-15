import { useEffect, useMemo, useRef } from 'react';
import type { Activity, ScheduleModel } from './types';
import { sharedActivityObjects } from './activityObjects';
import { activityStartMs } from './linking';
import { useActivitySelectionStore } from '../state/activitySelectionStore';
import { useLinkGroupsStore } from '../state/linkGroupsStore';
import { useModelsStore } from '../state/modelsStore';
import { useSelectionStore } from '../state/selectionStore';
import { useViewerEngine } from '../viewer/ViewerEngineContext';

/** Programmes: the activity picked and the objects picked in the 3D model follow each other, as in Synchro. Pick an activity (or
    several, Ctrl / Shift) and the objects its Link Groups link it to are selected in the 3D model; pick objects in the 3D model
    (Models, 4D Sequencing, or the Selection tree) and the activities linked to them are picked here, the earliest as the current one.
    The camera does not move (the 3D view is not on screen here). Which activity an object belongs to is the same as in 4D:
    the Link Groups, and for activities with none of their own the activities with the same Element ID. */
export function useSelectionSync({ model, selectedId, onPick, active, enabled }: {
  /** The programme(s) shown, as the page has them (null: none). */
  model: ScheduleModel | null;
  selectedId: string | null;
  /** Makes this activity the current one. */
  onPick: (activity: Activity) => void;
  /** The Programmes page is the one on screen. */
  active: boolean;
  enabled: boolean;
}) {
  const engine = useViewerEngine();
  const loadedModels = useModelsStore((s) => s.models);
  const groups = useLinkGroupsStore((s) => s.groups);
  const byModel = useSelectionStore((s) => s.byModel);
  const picked = useActivitySelectionStore((s) => s.ids);

  const objects = useMemo(() => (model && enabled && loadedModels.length && groups.length ? sharedActivityObjects(model, loadedModels, groups) : null), [model, enabled, loadedModels, groups]);
  /** "modelId:localId" -> the activities linked to that object. */
  const activitiesOf = useMemo(() => {
    const out = new Map<string, string[]>();
    if (!objects) return out;
    for (const [activityId, perModel] of objects.objectsOf) {
      for (const [modelId, ids] of perModel) for (const id of ids) (out.get(`${modelId}:${id}`) ?? out.set(`${modelId}:${id}`, []).get(`${modelId}:${id}`)!).push(activityId);
    }
    return out;
  }, [objects]);

  const keyOf = (ids: Record<string, number[]>) => Object.keys(ids).sort().map((m) => `${m}=${[...ids[m]].sort((a, b) => a - b).join(',')}`).join(';');
  /** The selection this page made in the 3D model last, and the one it picked activities for last: neither is answered again. */
  const pushed = useRef('');
  const pulled = useRef('');
  /** Until when the activities picked from the 3D selection are not answered by pushing their objects back. */
  const quietUntil = useRef(0);

  // Activity -> objects.
  useEffect(() => {
    if (!enabled || !active || !objects || !model) return;
    if (Date.now() < quietUntil.current) return;
    const ids = new Set<string>(picked);
    if (selectedId) ids.add(selectedId);
    const out: Record<string, number[]> = {};
    for (const id of ids) {
      for (const [modelId, set] of objects.objectsOf.get(id) ?? []) out[modelId] = [...new Set([...(out[modelId] ?? []), ...set])];
    }
    const key = keyOf(out);
    if (!key || key === pushed.current) return;
    pushed.current = key;
    pulled.current = key; // the viewer's answer to this is not a new pick
    void engine.selectElements(out, false);
  }, [selectedId, picked, objects, model, active, enabled, engine]);

  // Objects -> activities.
  useEffect(() => {
    if (!enabled || !active || !model || activitiesOf.size === 0) return;
    const sel: Record<string, number[]> = {};
    for (const [modelId, ids] of Object.entries(byModel)) if (ids.length) sel[modelId] = ids;
    const key = keyOf(sel);
    if (!key || key === pulled.current) return;
    pulled.current = key;
    const found = new Set<string>();
    for (const [modelId, ids] of Object.entries(sel)) for (const id of ids) for (const a of activitiesOf.get(`${modelId}:${id}`) ?? []) found.add(a);
    const list = model.activities.filter((a) => found.has(a.id)).sort((a, b) => (activityStartMs(a, 'planned') ?? 0) - (activityStartMs(b, 'planned') ?? 0));
    if (!list.length) return;
    const order = list.map((a) => a.id);
    const store = useActivitySelectionStore.getState();
    store.click(order[0], {}, order);
    for (const id of order.slice(1)) store.click(id, { ctrl: true }, order);
    // The picked objects stay as the user chose them: the activity's own objects are not pushed back over them.
    pushed.current = key;
    quietUntil.current = Date.now() + 400;
    onPick(list[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byModel, activitiesOf, model, active, enabled]);
}
