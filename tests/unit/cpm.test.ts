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

  it('spans a level-of-effort task over its pours instead of adding its own duration after the latest start', () => {
    // LOE ties to two pours (SS from each one's start, FF from each one's finish): it covers the earliest start to the latest finish, and does not push the end out.
    const out = recomputeCpm(model(
      [
        activity('A', { durationHours: 16, remainingDurationHours: 16 }),
        activity('B', { durationHours: 16, remainingDurationHours: 16 }),
        activity('LOE', { type: 'loe', durationHours: 8000, remainingDurationHours: 8000 }),
      ],
      [rel('A', 'B'), rel('A', 'LOE', 'SS'), rel('B', 'LOE', 'SS'), rel('A', 'LOE', 'FF'), rel('B', 'LOE', 'FF')],
    ));
    expect(byId(out, 'LOE').earlyStart).toEqual(byId(out, 'A').earlyStart);
    expect(byId(out, 'LOE').earlyFinish).toEqual(byId(out, 'B').earlyFinish);
    expect(byId(out, 'LOE').durationHours).toBeLessThan(8000);
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

describe('recomputeCpm on calendars with working days of different lengths', () => {
  const calendars = [{ id: 'c10', name: '10 h days', hoursPerDay: 10, days: {} }, { id: 'c8', name: '8 h days', hoursPerDay: 8, days: {} }];
  const withCalendars = (m: ReturnType<typeof model>) => ({ ...m, calendars });
  const on = (id: string, calendarId: string, hours: number, over = {}) => activity(id, { calendarId, durationHours: hours, remainingDurationHours: hours, ...over });

  it('counts a duration in the days of its own calendar, not always 8 hours', () => {
    const out = recomputeCpm(withCalendars(model([on('A', 'c10', 100)])));
    // 100 h on 10 h days is 10 working days from Monday 3 January: finishes Monday 17th. (At 8 h a day it would be 12.5 days.)
    expect(byId(out, 'A').earlyFinish).toEqual(day(2028, 1, 17));
    const same = recomputeCpm(withCalendars(model([on('A', 'c8', 80)])));
    expect(byId(same, 'A').earlyFinish).toEqual(day(2028, 1, 17));
  });

  it('counts a lag in the days of the calendar, and float in its hours', () => {
    // A is one 10 h day; B follows 20 h (two days) after it.
    const out = recomputeCpm(withCalendars(model([on('A', 'c10', 10), on('B', 'c10', 10)], [rel('A', 'B', 'FS', 20)])));
    expect(byId(out, 'B').earlyStart).toEqual(day(2028, 1, 6));
    // A parallel short branch has float, in hours of its 10 h days.
    const floaty = recomputeCpm(withCalendars(model(
      [on('A', 'c10', 10), on('L', 'c10', 100), on('S', 'c10', 20), on('E', 'c10', 10)],
      [rel('A', 'L'), rel('A', 'S'), rel('L', 'E'), rel('S', 'E')],
    )));
    expect(byId(floaty, 'S').totalFloatHours).toBe(80);
    expect(byId(floaty, 'L').totalFloatHours).toBe(0);
    expect(byId(floaty, 'L').isCritical).toBe(true);
  });

  it('keeps the 8-hour day where a calendar does not say, and mixes calendars', () => {
    const none = recomputeCpm(model([activity('A', { durationHours: 80, remainingDurationHours: 80 })]));
    expect(byId(none, 'A').earlyFinish).toEqual(day(2028, 1, 17));
    const mixed = recomputeCpm(withCalendars(model([on('A', 'c10', 50), on('B', 'c8', 40)], [rel('A', 'B')])));
    expect(byId(mixed, 'A').earlyFinish).toEqual(day(2028, 1, 10)); // 5 days
    expect(byId(mixed, 'B').earlyFinish).toEqual(day(2028, 1, 17)); // 5 more
  });
});
