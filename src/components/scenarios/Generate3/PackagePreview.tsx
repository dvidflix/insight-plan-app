import { useEffect, useMemo, useRef } from 'react';
import { useViewerEngine } from '../../../viewer/ViewerEngineContext';
import { useSelectionStore } from '../../../state/selectionStore';
import type { PackageContents, WorkPackage } from '../../../prs/workPackages';
import { subtreeIds } from '../../../prs/packageTree';
import { useG3 } from './useWorkPackages';

/** Renders nothing: paints Generate 3's packages in their colours on the shared 3D view (the picked package alone, the others pale), turns a click on
    an object into a pick of its package (picking a package that holds others shows all of them), and frames the camera on the page's 3D window `view`. The colours are put back when it closes. */

export const PALE = '#d4d8d6';
type Ids = Record<string, number[]>;

export function PackagePreview({ view, packages, contents }: { view: React.RefObject<HTMLElement>; packages: WorkPackage[]; contents: PackageContents }) {
  const engine = useViewerEngine();
  const picked = useG3((s) => s.picked);
  const pick = useG3((s) => s.pick);
  const byPackage = useMemo(() => packages.map((p) => {
    const out: Ids = {};
    for (const o of contents.objects.get(p.id) ?? []) { const at = o.key.lastIndexOf(':'); (out[o.key.slice(0, at)] ??= []).push(Number(o.key.slice(at + 1))); }
    return out;
  }), [packages, contents]);
  const painted = useRef<Ids>({});
  const sig = `${picked ?? ''}|${packages.map((p) => `${p.id}:${p.color}`).join(',')}`;
  useEffect(() => {
    let dead = false;
    void (async () => {
      for (const [m, ids] of Object.entries(painted.current)) await engine.setColor(m, ids, null, true);
      painted.current = {};
      if (dead) return;
      const next: Ids = {};
      const shown = picked === null ? null : new Set(subtreeIds(packages, picked));
      for (let i = 0; i < packages.length; i++) {
        const color = !shown || shown.has(packages[i].id) ? packages[i].color : PALE;
        for (const [m, ids] of Object.entries(byPackage[i])) { if (!ids.length) continue; await engine.setColor(m, ids, color, true); (next[m] ??= []).push(...ids); }
      }
      painted.current = next;
      await engine.forceUpdate();
    })();
    return () => { dead = true; };
  }, [engine, byPackage, sig]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    const old = painted.current;
    painted.current = {};
    void (async () => { for (const [m, ids] of Object.entries(old)) await engine.setColor(m, ids, null, true); await engine.forceUpdate(); })();
  }, [engine]);

  // A click on an object in 3D picks its package.
  const byModel = useSelectionStore((s) => s.byModel);
  useEffect(() => {
    const hit = Object.entries(byModel).flatMap(([m, ids]) => ids.map((id) => `${m}:${id}`));
    if (!hit.length) return;
    const at = byPackage.findIndex((ids) => Object.entries(ids).some(([m, list]) => list.some((id) => hit.includes(`${m}:${id}`))));
    if (at >= 0) pick(packages[at].id);
  }, [byModel]); // eslint-disable-line react-hooks/exhaustive-deps

  // The camera draws the whole model inside the 3D window (a view offset), then fits it.
  const models = engine.getIndexes().size;
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
    return () => { ro.disconnect(); for (const cam of cams) cam.clearViewOffset(); void engine.forceUpdate(); };
  }, [engine, view, models]);
  return null;
}
