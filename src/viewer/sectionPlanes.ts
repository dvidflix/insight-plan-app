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

/** A section of the Sections panel: a plane that can be added several at a time. Horizontal faces up (z), Vertical
    faces east / west (x), Cross faces north / south (y); the offset is metres along that axis in project coordinates. */
export type SectionOrient = 'horizontal' | 'vertical' | 'cross';

export interface Section {
  id: string;
  orient: SectionOrient;
  offset: number;
  /** Degrees about the vertical axis (Vertical and Cross only). */
  rotate: number;
  /** false (default): keeps the lower / west / south side. */
  flip: boolean;
  hidden: boolean;
}

export const SECTION_ORIENT_LABEL: Record<SectionOrient, string> = { horizontal: 'Horizontal', vertical: 'Vertical', cross: 'Cross' };

const AXIS: Record<SectionOrient, Vec3> = { horizontal: [0, 0, 1], vertical: [1, 0, 0], cross: [0, 1, 0] };

/** The section's axis in project coordinates, turned by its rotation. */
function sectionAxis(orient: SectionOrient, rotateDeg: number): Vec3 {
  const [x, y, z] = AXIS[orient];
  if (orient === 'horizontal') return [x, y, z];
  const r = (rotateDeg * Math.PI) / 180;
  return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r), 0];
}

export function sectionPlane(s: Pick<Section, 'orient' | 'offset' | 'rotate' | 'flip'>): CutPlane {
  const a = sectionAxis(s.orient, s.rotate);
  const sign = s.flip ? 1 : -1;
  return { normal: [a[0] * sign, a[1] * sign, a[2] * sign], point: [a[0] * s.offset, a[1] * s.offset, a[2] * s.offset] };
}

/** Reads a dragged plane back into offset and rotation (the inverse of sectionPlane). */
export function sectionFromPlane(orient: SectionOrient, plane: CutPlane, flip: boolean): { offset: number; rotate: number } {
  const sign = flip ? 1 : -1;
  const a: Vec3 = [plane.normal[0] * sign, plane.normal[1] * sign, plane.normal[2] * sign];
  const offset = plane.point[0] * a[0] + plane.point[1] * a[1] + plane.point[2] * a[2];
  if (orient === 'horizontal') return { offset: plane.point[2], rotate: 0 };
  const base = AXIS[orient];
  let rotate = ((Math.atan2(a[1], a[0]) - Math.atan2(base[1], base[0])) * 180) / Math.PI;
  rotate = ((((rotate + 180) % 360) + 360) % 360) - 180;
  return { offset, rotate: Math.round(rotate * 10) / 10 };
}

export const cutLabel =(s: SectionCuts): string | null => {
  const parts = [s.grid.name && `grid ${s.grid.name}`, s.level.name && `level ${s.level.name}`].filter(Boolean);
  return parts.length ? parts.join(' + ') : null;
};
