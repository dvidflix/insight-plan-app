import { useMemo, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useSelectionStore } from '../state/selectionStore';

type Ref = { modelId: string; localId: number; name: string };

const key = (r: { modelId: string; localId: number }) => `${r.modelId}:${r.localId}`;

/** Models > Properties: steps through a multi-selection one element at a
    time (◀ / ▶), so each one's properties can be read and it is framed in
    the view; All puts the whole set back. The set is remembered while the
    selection is one of its elements or all of them; any other selection
    (a new pick) starts over from that. */
export function SelectionStepper() {
  const engine = useViewerEngine();
  const byModel = useSelectionStore((s) => s.byModel);
  const [set, setSet] = useState<Ref[] | null>(null);

  const current = useMemo(() => Object.entries(byModel).flatMap(([modelId, ids]) => ids.map((localId) => ({ modelId, localId }))), [byModel]);
  // Still stepping through the remembered set?
  const active = useMemo(() => {
    if (!set) return null;
    const inSet = new Set(set.map(key));
    if (current.length === 1 && inSet.has(key(current[0]))) return set;
    if (current.length === set.length && current.every((c) => inSet.has(key(c)))) return set;
    return null;
  }, [set, current]);

  const list: Ref[] = useMemo(() => {
    if (active) return active;
    const indexes = engine.getIndexes();
    return current
      .map((c) => ({ ...c, name: indexes.get(c.modelId)?.elements.get(c.localId)?.name || `#${c.localId}` }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [active, current, engine]);

  if (list.length < 2) {
    return <div className="stepper stepper--empty">Select several objects to step through them one by one.</div>;
  }

  const onOne = active && current.length === 1;
  const shownIndex = onOne ? list.findIndex((r) => key(r) === key(current[0])) : -1;

  const go = (i: number) => {
    const k = (i + list.length) % list.length;
    if (!active) setSet(list);
    void engine.selectElements({ [list[k].modelId]: [list[k].localId] }, true);
  };
  const all = () => {
    const ids: Record<string, number[]> = {};
    for (const r of list) (ids[r.modelId] ??= []).push(r.localId);
    void engine.selectElements(ids, false);
  };

  return (
    <div className="stepper">
      <button type="button" className="btn btn--small" onClick={() => go(onOne ? shownIndex - 1 : -1)} aria-label="Previous object">◀</button>
      <span className="stepper__pos">
        {onOne ? (
          <>
            <b>{shownIndex + 1}</b> of {list.length} · <span className="stepper__name" title={list[shownIndex]?.name}>{list[shownIndex]?.name}</span>
          </>
        ) : (
          <>{list.length} objects selected</>
        )}
      </span>
      <button type="button" className="btn btn--small" onClick={() => go(onOne ? shownIndex + 1 : 0)} aria-label="Next object">▶</button>
      <button type="button" className="btn btn--small" disabled={!onOne} onClick={all} title="Select the whole set again">All</button>
    </div>
  );
}
