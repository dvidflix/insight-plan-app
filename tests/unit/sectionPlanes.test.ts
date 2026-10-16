import { describe, expect, it } from 'vitest';
import { sectionFromPlane, sectionPlane, type SectionOrient } from '../../src/viewer/sectionPlanes';

describe('sectionPlane', () => {
  it('a horizontal section keeps what is below, a flipped one what is above', () => {
    const p = sectionPlane({ orient: 'horizontal', offset: 3, rotate: 0, flip: false });
    expect(p.normal[2]).toBe(-1);
    expect(p.point[2]).toBe(3);
    expect(sectionPlane({ orient: 'horizontal', offset: 3, rotate: 0, flip: true }).normal[2]).toBe(1);
  });

  it('a vertical section turns about the vertical axis', () => {
    const p = sectionPlane({ orient: 'vertical', offset: 2, rotate: 90, flip: false });
    expect(p.normal[0]).toBeCloseTo(0);
    expect(p.normal[1]).toBeCloseTo(-1);
    expect(p.point[1]).toBeCloseTo(2);
  });

  it.each<[SectionOrient, number, number, boolean]>([
    ['horizontal', 4.5, 0, false],
    ['vertical', -7.25, 35, false],
    ['cross', 12, -120, true],
  ])('reads a dragged plane back (%s)', (orient, offset, rotate, flip) => {
    const back = sectionFromPlane(orient, sectionPlane({ orient, offset, rotate, flip }), flip);
    expect(back.offset).toBeCloseTo(offset, 5);
    expect(back.rotate).toBeCloseTo(rotate, 1);
  });
});
