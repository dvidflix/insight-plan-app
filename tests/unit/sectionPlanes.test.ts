import { describe, expect, it } from 'vitest';
import { NO_CUTS, cutLabel, gridCutPlane, levelCutPlane, planeToScene } from '../../src/viewer/sectionPlanes';

const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));

describe('gridline cut', () => {
  it('stands on the axis, its normal to the left of the axis direction', () => {
    const plane = gridCutPlane([0, 0, 0], [10, 0, 0], 0, false)!; // an axis running east
    near(plane.normal, [0, 1, 0]); // keeps the north side
    near(plane.point, [0, 0, 0]);
  });

  it('moves along the normal by the offset in millimetres', () => {
    const plane = gridCutPlane([2, 3, 0], [2, 13, 0], 1500, false)!; // an axis running north: normal is west
    near(plane.normal, [-1, 0, 0]);
    near(plane.point, [2 - 1.5, 3, 0]);
  });

  it('flips the side that is kept without moving the plane', () => {
    const a = gridCutPlane([0, 0, 0], [10, 0, 0], 500, false)!;
    const b = gridCutPlane([0, 0, 0], [10, 0, 0], 500, true)!;
    near(b.normal, a.normal.map((v) => -v));
    near(b.point, a.point);
  });

  it('follows a diagonal axis', () => {
    const plane = gridCutPlane([0, 0, 0], [10, 10, 0], 0, false)!;
    near(plane.normal, [-Math.SQRT1_2, Math.SQRT1_2, 0]);
  });

  it('is nothing for an axis with no length', () => {
    expect(gridCutPlane([1, 1, 0], [1, 1, 5], 0, false)).toBeNull();
  });
});

describe('level cut', () => {
  it('is horizontal, above the storey by the offset, keeping what is below', () => {
    const plane = levelCutPlane(6, 1200, false);
    expect(plane.normal).toEqual([0, 0, -1]);
    expect(plane.point[2]).toBeCloseTo(7.2, 9);
  });

  it('keeps what is above when flipped', () => {
    expect(levelCutPlane(6, 0, true).normal).toEqual([0, 0, 1]);
  });
});

describe('in the viewer scene', () => {
  it('turns Z up into Y up and north into -Z, less the models offset', () => {
    const scene = planeToScene({ normal: [0, 1, 0], point: [10, 20, 30] }, { x: 4, y: 5, z: 6 });
    expect(scene.normal).toEqual([0, 0, -1]);
    expect(scene.point).toEqual([6, 24, -15]);
    expect(planeToScene({ normal: [0, 0, -1], point: [0, 0, 0] }, { x: 0, y: 0, z: 0 }).normal).toEqual([0, -1, -0]);
  });
});

describe('label', () => {
  it('names the cuts that are set', () => {
    expect(cutLabel(NO_CUTS)).toBeNull();
    expect(cutLabel({ ...NO_CUTS, grid: { ...NO_CUTS.grid, name: 'C' } })).toBe('grid C');
    expect(cutLabel({ grid: { ...NO_CUTS.grid, name: 'C' }, level: { ...NO_CUTS.level, name: 'L2' } })).toBe('grid C + level L2');
  });
});
