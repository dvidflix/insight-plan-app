import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useViewerEngine } from '../../viewer/ViewerEngineContext';
import { tagCss, useActiveTagsStore, type TagCallout, type TagStyle } from '../../state/tagsStore';

interface Placed {
  key: string;
  color: string;
  text: string;
  style?: TagStyle;
  ax: number;
  ay: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const GAP = 6;
const MAX_POINTS = 20000;

/** World-space vertices of the objects (sampled when there are many). */
async function topPoints(model: { getItemsGeometry: (ids: number[]) => Promise<{ transform: THREE.Matrix4; positions?: Float32Array | Float64Array }[][]>; object: THREE.Object3D }, ids: number[]) {
  const meshes = (await model.getItemsGeometry(ids)).flat();
  const total = meshes.reduce((n, m) => n + (m.positions?.length ?? 0) / 3, 0);
  const stride = Math.max(1, Math.ceil(total / MAX_POINTS));
  model.object.updateMatrixWorld();
  const out: THREE.Vector3[] = [];
  for (const m of meshes) {
    const pos = m.positions;
    if (!pos) continue;
    // Comes back from the fragments worker as a plain object (structured
    // clone), not a THREE.Matrix4 — rebuild it from its elements.
    const raw = m.transform as unknown as { elements?: ArrayLike<number> } | ArrayLike<number>;
    const elements = 'elements' in raw && raw.elements ? raw.elements : (raw as ArrayLike<number>);
    const world = new THREE.Matrix4().fromArray(Array.from(elements)).premultiply(model.object.matrixWorld);
    for (let i = 0; i < pos.length; i += 3 * stride) out.push(new THREE.Vector3(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(world));
  }
  return out;
}

/** A point on the objects' top: among the highest vertices, the one nearest
    their middle — so an L-shaped wall is labelled on the wall itself, not in
    the empty corner its bounding box centres on. */
function anchorOnTop(points: THREE.Vector3[]) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const band = Math.max(0.05, (maxY - minY) * 0.05);
  const top = points.filter((p) => p.y >= maxY - band);
  const cx = top.reduce((s, p) => s + p.x, 0) / top.length;
  const cz = top.reduce((s, p) => s + p.z, 0) / top.length;
  let best = top[0];
  let bestD = Infinity;
  for (const p of top) {
    const d = (p.x - cx) ** 2 + (p.z - cz) ** 2;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best.clone();
}
const LINE_H = 15;

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Width of a text line in the label's own font (canvas measuring, so the box hugs the text). */
function textWidth(line: string, style: TagStyle | undefined): number | null {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return null;
  const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
  measureCtx.font = `${style?.italic ? 'italic ' : ''}${style?.bold ? 700 : 400} ${style?.fontSize ?? 11}px ${family}`;
  return measureCtx.measureText(line).width;
}

/** Label size from its text: the measured width plus the box's padding and borders
    (8 + 8 + 4 + 1), else a rough estimate. */
function sizeOf(text: string, style?: TagStyle) {
  const lines = text.split('\n');
  const font = style?.fontSize ?? 11;
  const widest = Math.max(...lines.map((l) => textWidth(l, style) ?? l.length * 6.2 * (font / 11) * (style?.bold ? 1.08 : 1)));
  return { w: Math.min(260 * Math.max(1, font / 11), Math.ceil(widest) + 22), h: lines.length * (style?.fontSize ? Math.round(font * 1.3) : LINE_H) + 10 };
}

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

/** Greedy placement: each callout tries the corners around its anchor, then
    steps further out, and takes the first spot that clashes with no label
    already placed (nearest anchors first, so crowded areas fan out). */
function layout(items: { key: string; color: string; text: string; style?: TagStyle; ax: number; ay: number }[], width: number, height: number): Placed[] {
  const placed: Placed[] = [];
  const sorted = [...items].sort((a, b) => a.ay - b.ay || a.ax - b.ax);
  for (const it of sorted) {
    const { w, h } = sizeOf(it.text, it.style);
    let best: Placed | null = null;
    for (let ring = 0; ring < 12 && !best; ring++) {
      const d = 18 + ring * (h + GAP);
      const candidates = [
        { x: it.ax + 14, y: it.ay - d - h },
        { x: it.ax - 14 - w, y: it.ay - d - h },
        { x: it.ax + 14, y: it.ay + d },
        { x: it.ax - 14 - w, y: it.ay + d },
      ];
      for (const c of candidates) {
        const r = { ...it, x: Math.max(4, Math.min(width - w - 4, c.x)), y: Math.max(4, Math.min(height - h - 4, c.y)), w, h };
        if (!placed.some((p) => overlaps(p, r))) {
          best = r;
          break;
        }
      }
    }
    placed.push(best ?? { ...it, x: Math.max(4, Math.min(width - w - 4, it.ax + 14)), y: Math.max(4, it.ay - 18 - h), w, h });
  }
  return placed;
}

/** Tags drawn next to the objects they label (Label tab > Tags placement),
    over the main 3D view: each callout sits by the middle of its objects
    with a leader line, kept clear of the others, following the camera. */
export function TagCallouts() {
  const engine = useViewerEngine();
  const callouts = useActiveTagsStore((s) => s.callouts);
  const rootRef = useRef<HTMLDivElement>(null);
  const [placed, setPlaced] = useState<Placed[]>([]);
  // World-space anchor of each callout (a point on its objects' top), keyed by callout + targets.
  const centres = useRef(new Map<string, THREE.Vector3 | null>());
  const [tick, setTick] = useState(0);

  const sig = (c: TagCallout) => `${c.key}|${Object.entries(c.targets).map(([m, ids]) => `${m}:${ids.length}:${ids[0]}`).join(',')}`;

  // Resolve object centres (async, cached).
  useEffect(() => {
    let cancelled = false;
    const source = engine.getSecondaryViewSource();
    void (async () => {
      let added = false;
      for (const c of callouts) {
        const k = sig(c);
        if (centres.current.has(k)) continue;
        const box = new THREE.Box3();
        const points: THREE.Vector3[] = [];
        for (const [modelId, ids] of Object.entries(c.targets)) {
          const model = source.getModel(modelId);
          if (!model || ids.length === 0) continue;
          try {
            box.union(await model.getMergedBox(ids));
            points.push(...(await topPoints(model, ids)));
          } catch {
            // Model gone or not ready — the callout just isn't drawn.
          }
        }
        centres.current.set(k, points.length ? anchorOnTop(points) : box.isEmpty() ? null : box.getCenter(new THREE.Vector3()));
        added = true;
      }
      if (added && !cancelled) setTick((t) => t + 1);
    })();
    return () => {
      cancelled = true;
    };
    // sig only reads the callout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callouts, engine]);

  // Project + lay out on every camera move / resize.
  useEffect(() => {
    const world = engine.world;
    const canvas = world.renderer?.three.domElement;
    const root = rootRef.current;
    if (!canvas || !root) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rootRect = root.getBoundingClientRect();
      const rect = canvas.getBoundingClientRect();
      const ox = rect.left - rootRect.left;
      const oy = rect.top - rootRect.top;
      const camera = world.camera.three;
      const items: { key: string; color: string; text: string; style?: TagStyle; ax: number; ay: number }[] = [];
      for (const c of callouts) {
        const centre = centres.current.get(sig(c));
        if (!centre) continue;
        const v = centre.clone().project(camera);
        if (v.z > 1 || v.x < -1.2 || v.x > 1.2 || v.y < -1.2 || v.y > 1.2) continue;
        items.push({ key: c.key, color: c.color, text: c.text, style: c.style, ax: ox + ((v.x + 1) / 2) * rect.width, ay: oy + ((1 - v.y) / 2) * rect.height });
      }
      setPlaced(layout(items, ox + rect.width, oy + rect.height));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    world.camera.controls.addEventListener('update', schedule);
    world.renderer?.onResize.add(schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      world.camera.controls.removeEventListener('update', schedule);
      world.renderer?.onResize.remove(schedule);
    };
    // sig only reads the callout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callouts, engine, tick]);

  return (
    <div ref={rootRef} className="tag-callouts">
      <svg className="tag-callouts__lines">
        {placed.map((p) => {
          const tx = Math.max(p.x, Math.min(p.x + p.w, p.ax));
          const ty = p.ay < p.y ? p.y : p.y + p.h;
          return (
            <g key={p.key}>
              <line x1={p.ax} y1={p.ay} x2={tx} y2={ty} stroke={p.color} strokeWidth={1.5} />
              <circle cx={p.ax} cy={p.ay} r={3} fill={p.color} stroke="#fff" strokeWidth={1} />
            </g>
          );
        })}
      </svg>
      {placed.map((p) => (
        <div key={p.key} className="tag-callouts__label" style={{ ...tagCss(p.style), left: p.x, top: p.y, width: p.w, borderLeftColor: p.color }}>
          {p.text}
        </div>
      ))}
    </div>
  );
}
