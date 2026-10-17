import { useMemo } from 'react';
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
  const models = useModelsStore((s) => s.models);
  const tags = useTagsStore((s) => s.tags);
  const sets = useSearchSetsStore((s) => s.sets);
  const selected = useSelectionStore((s) => s.byModel);

  const callouts = useMemo(() => {
    const mine = tags.filter((t) => isObjectSourced(t) && !t.hidden);
    if (!mine.length || !models.length) return [] as TagCallout[];
    const lookup = new Map(models.map((m) => [m.modelId, new Map(m.elements.map((e) => [e.localId, e]))]));
    const out: TagCallout[] = [];
    for (const tag of mine) {
      let ids: Record<string, number[]> = {};
      if (tag.source?.kind === 'selection') ids = selected;
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
  }, [tags, sets, selected, models, engine]);

  if (!callouts.length) return null;
  return <TagCallouts view="main" callouts={callouts} />;
}
