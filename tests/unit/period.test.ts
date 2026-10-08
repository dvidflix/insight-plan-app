import { describe, expect, it } from 'vitest';
import { addUnit, alignDown, nextBoundary, prevBoundary } from '../../src/schedule/period';
import { day } from './helpers';

const t = (d: Date) => d.getTime();

describe('period boundaries', () => {
  it('aligns a week down to Monday, also from a Sunday', () => {
    expect(alignDown(t(day(2028, 3, 15)), 'week')).toBe(t(day(2028, 3, 13))); // Wednesday
    expect(alignDown(t(day(2028, 3, 19)), 'week')).toBe(t(day(2028, 3, 13))); // Sunday belongs to the week before
  });

  it('aligns month, quarter and year to their first day', () => {
    expect(alignDown(t(day(2028, 5, 20)), 'month')).toBe(t(day(2028, 5, 1)));
    expect(alignDown(t(day(2028, 5, 20)), 'quarter')).toBe(t(day(2028, 4, 1)));
    expect(alignDown(t(day(2028, 11, 2)), 'year')).toBe(t(day(2028, 1, 1)));
  });

  it('steps strictly forward and back', () => {
    const monday = t(day(2028, 3, 13));
    expect(nextBoundary(monday, 'week')).toBe(t(day(2028, 3, 20)));
    expect(nextBoundary(t(day(2028, 3, 15)), 'week')).toBe(t(day(2028, 3, 20)));
    expect(prevBoundary(monday, 'week')).toBe(t(day(2028, 3, 6)));
    expect(prevBoundary(t(day(2028, 3, 15)), 'week')).toBe(monday);
  });

  it('rolls months and quarters over the year end', () => {
    expect(nextBoundary(t(day(2028, 12, 10)), 'month')).toBe(t(day(2029, 1, 1)));
    expect(nextBoundary(t(day(2028, 11, 10)), 'quarter')).toBe(t(day(2029, 1, 1)));
    expect(addUnit(t(day(2028, 1, 31)), 'month', 1)).toBe(t(day(2028, 2, 1)));
  });

  it('works in whole hours for hour units', () => {
    const afternoon = new Date(2028, 2, 15, 13, 30).getTime();
    expect(alignDown(afternoon, '4h')).toBe(new Date(2028, 2, 15, 12).getTime());
    expect(nextBoundary(afternoon, '4h')).toBe(new Date(2028, 2, 15, 16).getTime());
  });
});
