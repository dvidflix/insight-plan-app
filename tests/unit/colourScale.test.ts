import { describe, expect, it } from 'vitest';
import { colourAt, gradeColorOf, parseNumber, SCALE_PRESETS } from '../../src/viewer/colourScale';

describe('colourScale', () => {
  it('reads numbers out of property values', () => {
    expect(parseNumber('12.5')).toBe(12.5);
    expect(parseNumber('1,250 m')).toBe(1250);
    expect(parseNumber('-3')).toBe(-3);
    expect(parseNumber('Concrete')).toBeNull();
  });

  it('blends between stops', () => {
    const stops = [{ at: 0, color: '#000000' }, { at: 1, color: '#ffffff' }];
    expect(colourAt(stops, 0)).toBe('#000000');
    expect(colourAt(stops, 1)).toBe('#ffffff');
    expect(colourAt(stops, 0.5)).toBe('#808080');
  });

  it('grades values between the lowest and highest found', () => {
    const scale = { stops: SCALE_PRESETS[0].stops, min: null, max: null };
    const of = gradeColorOf(scale, ['0', '5', '10', 'n/a']);
    expect(of('0')).toBe(scale.stops[0].color);
    expect(of('10')).toBe(scale.stops[2].color);
    expect(of('n/a')).toBeNull();
  });

  it('honours fixed ends', () => {
    const scale = { stops: [{ at: 0, color: '#000000' }, { at: 1, color: '#ffffff' }], min: 0, max: 100 };
    const of = gradeColorOf(scale, ['0', '10']);
    expect(of('100')).toBe('#ffffff');
    expect(of('500')).toBe('#ffffff');
  });
});
