import { describe, expect, it } from 'vitest';
import { formatCoord, parseCoord } from '../../src/viewer/coordText';

describe('coordinate text', () => {
  it('reads the Point coordinates tool text', () => {
    expect(parseCoord('1930.800, 5997.350, -5.180')).toEqual([1930.8, 5997.35, -5.18]);
  });

  it('accepts commas without spaces, semicolons, tabs and spaces', () => {
    expect(parseCoord('1,2,3')).toEqual([1, 2, 3]);
    expect(parseCoord('1.5; 2.5; 3.5')).toEqual([1.5, 2.5, 3.5]);
    expect(parseCoord('1.5\t2.5\t3.5')).toEqual([1.5, 2.5, 3.5]);
    expect(parseCoord('  1.5   2.5   3.5 ')).toEqual([1.5, 2.5, 3.5]);
  });

  it('reads a decimal comma where commas are not separators', () => {
    expect(parseCoord('1930,8; 5997,35; -5,18')).toEqual([1930.8, 5997.35, -5.18]);
    expect(parseCoord('1930,8  5997,35  -5,18')).toEqual([1930.8, 5997.35, -5.18]);
  });

  it('is null unless there are exactly three numbers', () => {
    expect(parseCoord('')).toBeNull();
    expect(parseCoord('1, 2')).toBeNull();
    expect(parseCoord('1, 2, 3, 4')).toBeNull();
    expect(parseCoord('1, two, 3')).toBeNull();
  });

  it('prints three decimals and reads back what it printed', () => {
    const text = formatCoord([1930.8, 5997.35, -5.18]);
    expect(text).toBe('1930.800, 5997.350, -5.180');
    expect(parseCoord(text)).toEqual([1930.8, 5997.35, -5.18]);
  });
});
