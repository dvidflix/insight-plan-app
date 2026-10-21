import { useEffect, useMemo, useState } from 'react';
import { useSequenceTimelineStore } from '../../state/sequenceTimelineStore';
import { useTagLabelStats } from '../../state/tagLabelStats';
import { useViewTagsStore } from '../../state/viewTagsStore';
import { useViewerEngine } from '../../viewer/ViewerEngineContext';
import { useModelsStore } from '../../state/modelsStore';
import { useSearchSetsStore } from '../../state/searchSetsStore';
import { useSelectionStore } from '../../state/selectionStore';
import { DEFAULT_SOURCE_MAX, isObjectSourced, setIdsOf, tagStyleOf, useTagsStore, type TagCallout } from '../../state/tagsStore';
import { runSearchSet } from '../../viewer/searchSets';
import { renderTag } from '../../schedule/tagTemplate';
import { TagCallouts } from './TagCallouts';

const COLOR = '#555';

/** Tags that label a search / selection set, or the objects selected now (Tag › "A set" / "Selection"), drawn next to each object
    from its own {Obj:…} tokens. Unlike the 4D tags they do not depend on a date: they show whenever their objects are in the view. */
export function ObjectSourceTags() {
  const engine = useViewerEngine();
  // The split's second view gets its own: what is visible differs between the views.
  const [hasSecond, setHasSecond] = useState(!!engine.secondary);
  useEffect(() => {
    const sync = () => setHasSecond(!!engine.secondary);
    engine.onSecondaryChange.add(sync);
    sync();
    return () => engine.onSecondaryChange.remove(sync);
  }, [engine]);
  return <>
    <ViewTags view="main" />
    {hasSecond && <ViewTags view="second" />}
  </>;
}

function ViewTags({ view }: { view: 'main' | 'second' }) {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const tags = useTagsStore((s) => s.tags);
  const sets = useSearchSetsStore((s) => s.sets);
  const selected = useSelectionStore((s) => s.byModel);
  const appliedDate = useSequenceTimelineStore((s) => s.appliedDate);

  // "Visible" tags: the first objects (up to each tag's limit) that have a label and are shown now, found again whenever what is shown changes.
  // Which tags label this view's visible objects: the ones its Tags menu chose, else every tag whose source is "Visible".
  const chosen = useViewTagsStore((s) => s.views[view].visible);
  const visibleTags = useMemo(() => tags.filter((t) => (chosen ? chosen.includes(t.id) : !t.hidden && t.source?.kind === 'visible')), [tags, chosen]);
  const [visible, setVisible] = useState<Record<string, Record<string, number[]>>>({});
  const [shownTick, setShownTick] = useState(0);
  useEffect(() => {
    if (!visibleTags.length) return;
    let timer: number | undefined;
    const bump = () => { window.clearTimeout(timer); timer = window.setTimeout(() => setShownTick((n) => n + 1), 150); };
    engine.onVisibilityChange.add(bump);
    engine.onExternalVisibilityChange.add(bump);
    return () => { window.clearTimeout(timer); engine.onVisibilityChange.remove(bump); engine.onExternalVisibilityChange.remove(bump); };
  }, [engine, visibleTags.length]);
  useEffect(() => {
    if (!visibleTags.length || !models.length) { setVisible((v) => (Object.keys(v).length ? {} : v)); return; }
    let live = true;
    void (async () => {
      const out: Record<string, Record<string, number[]>> = {};
      for (const tag of visibleTags) {
        let left = tag.maxLabels ?? DEFAULT_SOURCE_MAX;
        const found: Record<string, number[]> = {};
        let withLabel = 0;
        let error: string | undefined;
        try {
        for (const m of models) {
          // Cheap test first (the tag has some text for the object), then the visibility of those, a chunk at a time.
          const labelled = m.elements.filter((e) => renderTag(tag.template, { activeCount: 1, elements: [e], basis: 'planned' }).trim() !== '').map((e) => e.localId);
          withLabel += labelled.length;
          for (let i = 0; i < labelled.length && left > 0; i += 500) {
            const chunk = labelled.slice(i, i + 500);
            const shown = view === 'second' ? (await engine.secondary?.visibleOf(m.modelId, chunk)) ?? [] : await engine.visibleOf(m.modelId, chunk);
            if (!live) return;
            const take = shown.slice(0, left);
            if (take.length) (found[m.modelId] ??= []).push(...take);
            left -= take.length;
          }
          if (left <= 0) break;
        }
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        out[tag.id] = found;
        if (live) useTagLabelStats.getState().set(`${tag.id}:${view}`, { withLabel, shown: Object.values(found).reduce((n, l) => n + l.length, 0), models: models.length, error });
      }
      if (live) setVisible(out);
    })();
    return () => { live = false; };
  }, [engine, view, visibleTags, models, shownTick, appliedDate]);

  const callouts = useMemo(() => {
    const mine = tags.filter((t) => (!t.hidden && isObjectSourced(t) && t.source?.kind !== 'visible') || visibleTags.some((v) => v.id === t.id));
    if (!mine.length || !models.length) return [] as TagCallout[];
    const lookup = new Map(models.map((m) => [m.modelId, new Map(m.elements.map((e) => [e.localId, e]))]));
    const out: TagCallout[] = [];
    for (const tag of mine) {
      let ids: Record<string, number[]> = {};
      if (tag.source?.kind === 'selection') ids = selected;
      else if (visibleTags.some((v) => v.id === tag.id)) ids = visible[tag.id] ?? {};
      else if (tag.source?.kind === 'set') {
        for (const setId of setIdsOf(tag)) {
          const set = sets.find((x) => x.id === setId);
          if (!set) continue;
          for (const [modelId, list] of Object.entries(runSearchSet(engine.getIndexes(), set))) ids[modelId] = [...new Set([...(ids[modelId] ?? []), ...list])];
        }
      }
      let left = tag.maxLabels ?? DEFAULT_SOURCE_MAX;
      for (const [modelId, list] of Object.entries(ids)) {
        for (const id of list) {
          if (left <= 0) break;
          const el = lookup.get(modelId)?.get(id);
          if (!el) continue;
          const text = renderTag(tag.template, { activeCount: 1, elements: [el], basis: 'planned' }).trim();
          if (!text) continue;
          out.push({ key: `${tag.id}:${modelId}:${id}`, color: COLOR, plain: true, text, style: tagStyleOf(tag), targets: { [modelId]: [id] } });
          left--;
        }
      }
    }
    return out;
  }, [tags, sets, selected, visible, visibleTags, models, engine]);

  if (!callouts.length) return null;
  return <TagCallouts view={view} callouts={callouts} />;
}
