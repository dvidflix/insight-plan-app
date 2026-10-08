import { describe, expect, it } from 'vitest';
import { actualCoverage, activityFinishMs, activityStartMs, progressAt, scheduleRange, statusAt, statusInPeriod } from '../../src/schedule/linking';
import { activity, day, model } from './helpers';

// What a finished project's XER gives for completed work: actual dates only, no early or target ones.
const asBuilt = activity('A', { actualStart: day(2020, 1, 15), actualFinish: day(2022, 4, 4) });
const t = (d: Date) => d.getTime();

describe('4D dates for an as-built programme', () => {
  it('uses the actual dates on either basis when nothing else is there', () => {
    for (const basis of ['planned', 'actual'] as const) {
      expect(activityStartMs(asBuilt, basis)).toBe(t(day(2020, 1, 15)));
      expect(activityFinishMs(asBuilt, basis)).toBe(t(day(2022, 4, 4)));
    }
  });

  it('does not leave a completed activity running for ever on the planned basis', () => {
    const dec2026 = day(2026, 12, 1);
    expect(statusAt(asBuilt, dec2026, 'planned')).toBe('done');
    expect(statusInPeriod(asBuilt, t(dec2026), t(day(2026, 12, 2)), 'planned')).toBe('done');
  });

  it('prefers each basis own dates when it has them', () => {
    const a = activity('B', { earlyStart: day(2020, 2, 1), earlyFinish: day(2020, 3, 1), actualStart: day(2020, 2, 10), actualFinish: day(2020, 4, 1) });
    expect(activityStartMs(a, 'planned')).toBe(t(day(2020, 2, 1)));
    expect(activityFinishMs(a, 'planned')).toBe(t(day(2020, 3, 1)));
    expect(activityStartMs(a, 'actual')).toBe(t(day(2020, 2, 10)));
    expect(activityFinishMs(a, 'actual')).toBe(t(day(2020, 4, 1)));
  });

  it('fills a missing planned finish from the actual one', () => {
    const a = activity('C', { earlyStart: day(2020, 2, 1), actualFinish: day(2020, 4, 1) });
    expect(activityFinishMs(a, 'planned')).toBe(t(day(2020, 4, 1)));
  });

  it('starts the timeline at the earliest as-built start', () => {
    const m = model([asBuilt, activity('D', { actualStart: day(2021, 5, 1), actualFinish: day(2023, 1, 1) })]);
    expect(scheduleRange(m, 'planned')).toEqual({ min: t(day(2020, 1, 15)), max: t(day(2023, 1, 1)) });
    expect(scheduleRange(m, 'actual')).toEqual({ min: t(day(2020, 1, 15)), max: t(day(2023, 1, 1)) });
  });

  it('interpolates progress between the as-built dates', () => {
    const mid = new Date((t(day(2020, 1, 15)) + t(day(2022, 4, 4))) / 2);
    expect(progressAt(asBuilt, mid, 'planned')).toBeCloseTo(0.5, 5);
  });

  it('counts how much of a programme is as built', () => {
    expect(actualCoverage(null)).toBe(0);
    expect(actualCoverage(model([asBuilt, activity('E')]))).toBe(0.5);
    expect(actualCoverage(model([asBuilt, activity('F', { actualStart: day(2020, 2, 1) })]))).toBe(1);
  });
});
