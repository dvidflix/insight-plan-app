/** The planes of Views > Section cuts: a cut along a gridline and a cut at a level, in the model's own
    axes (X east, Y north, Z up). Pure arithmetic, so it can be tested; the viewer turns them into clipping planes.
    A plane keeps the side its normal points to. */

export type Vec3 = [number, number, number];

export interface CutPlane {
  normal: Vec3;
  point: Vec3;
}

/** One cut as the panel keeps it. `name: ''` is no cut; the offset is millimetres along the unflipped normal. */
export interface CutSetting {
  name: string;
  offset: number;
  flip: boolean;
  /** false: the plane is shown as a sheet without cutting. */
  cut: boolean;
}

export interface SectionCuts {
  grid: CutSetting;
  level: CutSetting;
}

export const NO_CUT: CutSetting = { name: '', offset: 0, flip: false, cut: true };
export const NO_CUTS: SectionCuts = { grid: NO_CUT, level: NO_CUT };
/** A level cut opens 1.2 m above the slab: a plan view at about the height of a person's chest. */
export const LEVEL_DEFAULT_OFFSET_MM = 1200;

/** The cut along an axis: a vertical plane through the axis' line, moved `offsetMm` to its left (looking from its
    first point to its last); flipping keeps the other side without moving the plane. Null for an axis with no length. */
export function gridCutPlane(p0: Vec3, p1: Vec3, offsetMm: number, flip: boolean): CutPlane | null {
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return null;
  const n: Vec3 = [-dy / len, dx / len, 0];
  const d = offsetMm / 1000;
  const point: Vec3 = [p0[0] + n[0] * d, p0[1] + n[1] * d, p0[2]];
  return { normal: flip ? [-n[0], -n[1], 0] : n, point };
}

/** The cut at a level: a horizontal plane `offsetMm` above the storey; by default it keeps what is below (a plan
    view looking down), flipped what is above. */
export function levelCutPlane(elevation: number, offsetMm: number, flip: boolean): CutPlane {
  return { normal: [0, 0, flip ? 1 : -1], point: [0, 0, elevation + offsetMm / 1000] };
}

/** A plane in the viewer's Y-up scene: IFC (x, y, z) -> (x, z, -y), less the models' shared offset. */
export function planeToScene(plane: CutPlane, offset: { x: number; y: number; z: number }): CutPlane {
  const [nx, ny, nz] = plane.normal;
  const [x, y, z] = plane.point;
  return { normal: [nx, nz, -ny], point: [x - offset.x, z - offset.z, -(y - offset.y)] };
}

export const cutLabel = (s: SectionCuts): string | null => {
  const parts = [s.grid.name && `grid ${s.grid.name}`, s.level.name && `level ${s.level.name}`].filter(Boolean);
  return parts.length ? parts.join(' + ') : null;
};
