import { useEffect, useMemo, useRef } from 'react';
import { useScenarioStore } from '../../state/scenarioStore';
import { useSearchSetsStore } from '../../state/searchSetsStore';
import { useSelectionStore } from '../../state/selectionStore';
import { useOrderPreview } from '../../state/orderPreviewStore';
import { useStepFocus } from '../../state/resourceFocusStore';
import { useViewerEngine } from '../../viewer/ViewerEngineContext';
import { runSearchSet } from '../../viewer/searchSets';
import { paletteColors } from '../../viewer/colorPalettes';
import { guidsOfSet, pourRowsOfGroup } from '../../scenarios/stepPours';
import { useIndexTick } from '../modelFields';
import { groupsOfItems, itemsOfGroup, useWorkItems } from './useWorkItems';
import { useRuleContext } from './rules/RuleParts';
import { STEPS_ID } from '../../prs/recipesWorkbook';

/** The 3D preview beside the Order list: the shared viewer shows through the right half of the page, with the objects of every step painted in that
    step's colour (the same colours as the swatches in the list). The current step alone keeps its colour and the rest go pale. Clicking an object in 3D
    makes its step the current one and opens it in the list. Nothing here is saved: the colours are put back when the preview closes. */

const PALE = '#d4d8d6';
const norm = (s: string) => s.trim().toUpperCase();

export const stepColors = (n: number): string[] => paletteColors('vivid', Math.max(n, 1), 0);

type Ids = Record<string, number[]>;

/** The objects of each step, by model: the search sets of the step's name, and the order table's pours in a rule group of that name. */
function useStepObjects(groups: string[]): Ids[] {
  const engine = useViewerEngine();
  const tick = useIndexTick();
  const sets = useSearchSetsStore((s) => s.sets);
  const rows = useScenarioStore((s) => s.rows);
  const ctx = useRuleContext();
  const built = useWorkItems();
  const key = groups.join('\u0001');
  return useMemo(() => {
    const indexes = engine.getIndexes();
    const idByGuid = new Map<string, [string, number]>();
    for (const [modelId, index] of indexes) for (const e of index.elements.values()) if (e.guid) idByGuid.set(e.guid, [modelId, e.localId]);
    return groups.map((group) => {
      const out = new Map<string, Set<number>>();
      const add = (modelId: string, id: number) => { let s = out.get(modelId); if (!s) out.set(modelId, (s = new Set())); s.add(id); };
      // Grouping levels with a work item: the objects of a group are those of its work items (keys are "<model id>:<local id>").
      if (built) {
        for (const leaf of itemsOfGroup(built, group)) for (const k of leaf.keys) { const at = k.lastIndexOf(':'); add(k.slice(0, at), Number(k.slice(at + 1))); }
        return Object.fromEntries([...out].map(([m, s]) => [m, [...s]]));
      }
      for (const set of sets) if (norm(set.name) === norm(group) && group.trim()) for (const [m, ids] of Object.entries(runSearchSet(indexes, set))) for (const id of ids) add(m, id);
      for (const r of pourRowsOfGroup(group, rows, ctx.membership, sets, (set) => guidsOfSet(indexes, set))) {
        const hit = idByGuid.get(r.key.split('#')[0]);
        if (hit) add(hit[0], hit[1]);
      }
      return Object.fromEntries([...out].map(([m, s]) => [m, [...s]]));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, tick, sets, rows, ctx.membership, key, built]);
}

/** Renders nothing: it paints the step colours, frames the camera on the visible half and turns a click in 3D into a step. `view` is that half. */
export function OrderPreviewEffects({ view }: { view: React.RefObject<HTMLElement> }) {
  const engine = useViewerEngine();
  const ctx = useRuleContext();
  const steps = ctx.rules.sequences.find((s) => s.id.toUpperCase() === STEPS_ID)?.steps ?? [];
  // With work items from the grouping levels, the colours are those of their groups, in the order the items are built.
  const built = useWorkItems();
  const groups = built ? groupsOfItems(built) : steps.map((s) => s.group);
  const objects = useStepObjects(groups);
  const current = useOrderPreview((s) => s.current);
  const setCurrent = useOrderPreview((s) => s.setCurrent);
  const focus = useStepFocus((s) => s.focus);
  const colors = stepColors(groups.length);
  const painted = useRef<Ids>({});

  // Colour by step. What was painted is taken off first, so a reorder, a rename or a new current step leaves nothing behind.
  const sig = `${current ?? ''}|${groups.join('\u0001')}`;
  useEffect(() => {
    let dead = false;
    void (async () => {
      for (const [m, ids] of Object.entries(painted.current)) await engine.setColor(m, ids, null, true);
      painted.current = {};
      if (dead) return;
      const next: Ids = {};
      const paint = async (m: string, ids: number[], color: string) => { await engine.setColor(m, ids, color, true); (next[m] ??= []).push(...ids); };
      const taken = new Set<string>();
      for (let i = 0; i < objects.length; i++) {
        const mine = current === null || norm(groups[i]) === current;
        for (const [m, ids] of Object.entries(objects[i])) {
          const fresh = ids.filter((id) => !taken.has(`${m}:${id}`));
          fresh.forEach((id) => taken.add(`${m}:${id}`));
          if (fresh.length) await paint(m, fresh, mine ? colors[i] : PALE);
        }
      }
      painted.current = next;
      await engine.forceUpdate();
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, objects, sig]);
  useEffect(() => () => {
    const old = painted.current;
    painted.current = {};
    void (async () => { for (const [m, ids] of Object.entries(old)) await engine.setColor(m, ids, null, true); await engine.forceUpdate(); })();
  }, [engine]);

  // A click on an object in 3D: its step is the current one, open in the list.
  const byModel = useSelectionStore((s) => s.byModel);
  useEffect(() => {
    const picked = Object.entries(byModel).flatMap(([m, ids]) => ids.map((id) => `${m}:${id}`));
    if (picked.length === 0) return;
    const at = objects.findIndex((o) => Object.entries(o).some(([m, ids]) => ids.some((id) => picked.includes(`${m}:${id}`))));
    if (at < 0) return;
    setCurrent(norm(groups[at]));
    focus(groups[at]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byModel]);

  // Framing: the camera draws the whole model inside the right half (a view offset: the picture is made smaller and moved over), then fits it.
  const models = Object.keys(engine.getIndexes()).length;
  useEffect(() => {
    const el = view.current;
    const dom = engine.world.renderer?.three.domElement;
    if (!el || !dom) return;
    const cams = [engine.world.camera.threePersp, engine.world.camera.threeOrtho];
    const apply = () => {
      const c = dom.getBoundingClientRect();
      const v = el.getBoundingClientRect();
      if (c.width < 2 || c.height < 2 || v.width < 2 || v.height < 2) return;
      const s = Math.min(v.width / c.width, v.height / c.height);
      const ox = v.left - c.left + (v.width - s * c.width) / 2;
      const oy = v.top - c.top + (v.height - s * c.height) / 2;
      for (const cam of cams) cam.setViewOffset(s * c.width, s * c.height, -ox, -oy, c.width, c.height);
      void engine.forceUpdate();
    };
    apply();
    void engine.fit(undefined, false).then(apply);
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    ro.observe(dom);
    return () => {
      ro.disconnect();
      for (const cam of cams) cam.clearViewOffset();
      void engine.forceUpdate();
    };
  }, [engine, view, models]);
  return null;
}
