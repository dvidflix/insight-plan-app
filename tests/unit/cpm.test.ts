import { describe, expect, it } from 'vitest';
import { recomputeCpm } from '../../src/schedule/cpm';
import { activity, day, model, rel } from './helpers';

const byId = (m: ReturnType<typeof recomputeCpm>, id: string) => m.activities.find((a) => a.id === id)!;

describe('recomputeCpm', () => {
  it('chains finish-to-start activities on working days', () => {
    const out = recomputeCpm(model(
      [activity('A', { durationHours: 16, remainingDurationHours: 16 }), activity('B')],
      [rel('A', 'B')],
    ));
    expect(byId(out, 'A').earlyStart).toEqual(day(2028, 1, 3));
    expect(byId(out, 'A').earlyFinish).toEqual(day(2028, 1, 5));
    expect(byId(out, 'B').earlyStart).toEqual(day(2028, 1, 5));
    expect(out.computedFloat).toBe(true);
  });

  it('marks the longest path critical and gives the short branch float', () => {
    // A -> B (long) -> D, and A -> C (short) -> D
    const out = recomputeCpm(model(
      [
        activity('A'),
        activity('B', { durationHours: 40, remainingDurationHours: 40 }),
        activity('C', { durationHours: 8, remainingDurationHours: 8 }),
        activity('D'),
      ],
      [rel('A', 'B'), rel('A', 'C'), rel('B', 'D'), rel('C', 'D')],
    ));
    expect(byId(out, 'B').isCritical).toBe(true);
    expect(byId(out, 'D').isCritical).toBe(true);
    expect(byId(out, 'C').isCritical).toBe(false);
    expect(byId(out, 'C').totalFloatHours).toBe(4 * 8); // four working days of slack
  });

  it('honours a start-to-start link with lag', () => {
    const out = recomputeCpm(model(
      [activity('A', { durationHours: 40, remainingDurationHours: 40 }), activity('B')],
      [rel('A', 'B', 'SS', 16)], // two days after A starts
    ));
    expect(byId(out, 'B').earlyStart).toEqual(day(2028, 1, 5));
  });

  it('ignores links to activities that are not in the model', () => {
    const out = recomputeCpm(model([activity('A')], [rel('X', 'A')]));
    expect(byId(out, 'A').earlyStart).toEqual(day(2028, 1, 3));
  });

  it('terminates on a cycle instead of hanging', () => {
    const out = recomputeCpm(model([activity('A'), activity('B')], [rel('A', 'B'), rel('B', 'A')]));
    expect(out.activities).toHaveLength(2);
  });
});
