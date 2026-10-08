import type { GridAxisLine } from './ifcGrids';

/** The dimensions drawn between neighbouring gridlines: for every set of parallel axes, the distance between each
    axis and the next one across. Pure (the viewer only draws what this returns), after SGVue's gridDimRuns. */

type XYZ = [number, number, number];

export interface GridDimension {
  /** The two axes' tags, in order across. */
  from: string;
  to: string;
  /** Distance between the two parallel lines, in the IFC's length unit. */
  spacing: number;
  /** Midway between the two axes' first ends, in the IFC's axes. */
  at: XYZ;
  /** Unit direction beyond the first end (away from the axis), in plan. */
  outward: [number, number];
}

/** Axes whose directions differ by less than this (degrees) count as parallel. */
export const PARALLEL_DEG = 0.5;

const dirOf = (a: GridAxisLine): [number, number] | null => {
  const p = a.points[0];
  const q = a.points[a.points.length - 1];
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const len = Math.hypot(dx, dy);
  return len < 1e-9 ? null : [dx / len, dy / len];
};

/** The angle of a direction as a line (0 – 180 degrees): an axis drawn either way round is the same line. */
const lineAngle = ([x, y]: [number, number]) => ((Math.atan2(y, x) * 180) / Math.PI + 180) % 180;

/** Dimensions for the axes of one grid (axes with no length are left out; a set of one axis has none). */
export function gridDimensions(axes: GridAxisLine[]): GridDimension[] {
  const items = axes.flatMap((axis) => {
    const d = dirOf(axis);
    return d ? [{ axis, d, angle: lineAngle(d) }] : [];
  });
  // Group the parallel ones (also across the 0 / 180 degree seam).
  const sets: typeof items[] = [];
  for (const item of items) {
    const set = sets.find((s) => {
      const diff = Math.abs(s[0].angle - item.angle);
      return Math.min(diff, 180 - diff) < PARALLEL_DEG;
    });
    if (set) set.push(item);
    else sets.push([item]);
  }
  const out: GridDimension[] = [];
  for (const set of sets) {
    if (set.length < 2) continue;
    // One direction for the set whichever way its axes were drawn (0 - 180 degrees), and the normal to it
    // pointing towards +x (towards +y for axes running east), so the dimensions run left to right / bottom to top.
    const rad = (set[0].angle * Math.PI) / 180;
    const ux = Math.cos(rad);
    const uy = Math.sin(rad);
    let n: [number, number] = [-uy, ux];
    if (n[0] < -1e-9 || (Math.abs(n[0]) < 1e-9 && n[1] < 0)) n = [-n[0], -n[1]];
    const across = (a: GridAxisLine) => a.points[0][0] * n[0] + a.points[0][1] * n[1];
    const sorted = [...set].sort((p, q) => across(p.axis) - across(q.axis));
    // Dimensions stand beyond the end of the set that is lower along the direction, all in one row.
    const lowAlong = (a: GridAxisLine) => Math.min(...a.points.map((p) => p[0] * ux + p[1] * uy));
    const rowAt = Math.min(...set.map((item) => lowAlong(item.axis)));
    const outward: [number, number] = [-ux, -uy];
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i].axis;
      const b = sorted[i + 1].axis;
      const spacing = across(b) - across(a);
      if (spacing < 1e-6) continue; // the same line twice
      // Midway between the two axes, moved along the direction to the row.
      const mx = (a.points[0][0] + b.points[0][0]) / 2;
      const my = (a.points[0][1] + b.points[0][1]) / 2;
      const shift = rowAt - (mx * ux + my * uy);
      out.push({ from: a.tag, to: b.tag, spacing, at: [mx + ux * shift, my + uy * shift, (a.points[0][2] + b.points[0][2]) / 2], outward });
    }
  }
  return out;
}

/** "6000" for 6 m: millimetres, as drawings give gridline spacings (the file's unit is metres). */
export const spacingText = (spacing: number) => String(Math.round(spacing * 1000));
