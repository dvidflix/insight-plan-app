import { describe, expect, it } from 'vitest';
import { gridDimensions, spacingText } from '../../src/viewer/gridDimensions';
import type { GridAxisLine } from '../../src/viewer/ifcGrids';

const axis = (tag: string, a: [number, number], b: [number, number], family: 'U' | 'V' = 'U'): GridAxisLine => ({ tag, family, points: [[a[0], a[1], 0], [b[0], b[1], 0]] });

describe('gridline dimensions', () => {
  it('measures between neighbouring parallel axes, in order across', () => {
    // Three axes running north, 6 m and 4.5 m apart, listed out of order.
    const dims = gridDimensions([axis('2', [6, 0], [6, 20]), axis('1', [0, 0], [0, 20]), axis('3', [10.5, 0], [10.5, 20])]);
    expect(dims.map((d) => [d.from, d.to])).toEqual([['1', '2'], ['2', '3']]);
    expect(dims.map((d) => d.spacing)).toEqual([expect.closeTo(6, 9), expect.closeTo(4.5, 9)]);
  });

  it('keeps the two directions of a grid apart', () => {
    const dims = gridDimensions([
      axis('1', [0, 0], [0, 20]), axis('2', [6, 0], [6, 20]),
      axis('A', [0, 0], [30, 0], 'V'), axis('B', [0, 8], [30, 8], 'V'),
    ]);
    expect(dims.map((d) => `${d.from}-${d.to}:${spacingText(d.spacing)}`).sort()).toEqual(['1-2:6000', 'A-B:8000']);
  });

  it('treats an axis drawn the other way round as the same direction', () => {
    const dims = gridDimensions([axis('1', [0, 0], [0, 20]), axis('2', [5, 20], [5, 0])]);
    expect(dims).toHaveLength(1);
    expect(dims[0].spacing).toBeCloseTo(5, 9);
  });

  it('puts every label of a set in one row beyond the lower end', () => {
    const dims = gridDimensions([axis('1', [0, 0], [0, 20]), axis('2', [6, 2], [6, 20]), axis('3', [9, -1], [9, 20])]);
    for (const d of dims) expect(d.at[1]).toBeCloseTo(-1, 9); // the lowest end of the set
    expect(dims[0].at[0]).toBeCloseTo(3, 9);
    expect(dims[0].outward[0]).toBeCloseTo(0, 9);
    expect(dims[0].outward[1]).toBeCloseTo(-1, 9);
  });

  it('has nothing for a single axis, a coincident pair or an axis with no length', () => {
    expect(gridDimensions([axis('1', [0, 0], [0, 20])])).toEqual([]);
    expect(gridDimensions([axis('1', [0, 0], [0, 20]), axis('1b', [0, 0], [0, 20])])).toEqual([]);
    expect(gridDimensions([axis('1', [0, 0], [0, 0]), axis('2', [5, 0], [5, 0])])).toEqual([]);
  });

  it('prints millimetres', () => {
    expect(spacingText(6)).toBe('6000');
    expect(spacingText(4.5)).toBe('4500');
    expect(spacingText(7.2504)).toBe('7250');
  });
});
