import { describe, expect, it } from 'vitest';
import { recomputeCpm } from '../../src/schedule/cpm';
import { constraintKind } from '../../src/schedule/constraints';
import type { Activity } from '../../src/schedule/types';
import { activity, day, model, rel } from './helpers';

const out = (m: ReturnType<typeof recomputeCpm>, id: string) => m.activities.find((a) => a.id === id)!;
const task = (id: string, days: number, over: Partial<Activity> = {}) => activity(id, { status: 'not-started', durationHours: days * 8, remainingDurationHours: days * 8, ...over });

describe('constraint kinds', () => {
  it('reads P6 codes and the words other tools use', () => {
    expect(['CS_MSOA', 'CS_MSOB', 'CS_MSO', 'CS_MEOA', 'CS_MEOB', 'CS_MEO', 'CS_MANDSTART', 'CS_MANDFIN', 'CS_ALAP'].map(constraintKind)).toEqual(
      ['snet', 'snlt', 'on-start', 'fnet', 'fnlt', 'on-finish', 'mandatory-start', 'mandatory-finish', 'alap'],
    );
    expect(['Start On or After', 'Finish On or Before', 'Mandatory Start', 'As Late As Possible', 'Finish On'].map(constraintKind)).toEqual(['snet', 'fnlt', 'mandatory-start', 'alap', 'on-finish']);
    expect([null, '', 'nonsense'].map(constraintKind)).toEqual([null, null, null]);
  });
});

describe('constraints in the calculation', () => {
  // A is 5 days from Monday 3 January and ends Monday 10th; B (3 days) follows it.
  const withB = (over: Partial<Activity>) => recomputeCpm(model([task('A', 5), task('B', 3, over)], [rel('A', 'B')]));

  it('start on or after holds an activity back', () => {
    const r = withB({ constraintType: 'CS_MSOA', constraintDate: day(2028, 1, 24) });
    expect(out(r, 'B').earlyStart).toEqual(day(2028, 1, 24));
    expect(out(r, 'B').earlyFinish).toEqual(day(2028, 1, 27));
  });

  it('finish on or after moves the start so the finish is no earlier', () => {
    const r = withB({ constraintType: 'CS_MEOA', constraintDate: day(2028, 1, 31) });
    expect(out(r, 'B').earlyFinish).toEqual(day(2028, 1, 31));
    expect(out(r, 'B').earlyStart).toEqual(day(2028, 1, 26));
  });

  it('mandatory start puts an activity on its date whatever the links say', () => {
    const r = withB({ constraintType: 'CS_MANDSTART', constraintDate: day(2028, 1, 5) });
    expect(out(r, 'B').earlyStart).toEqual(day(2028, 1, 5));
    expect(out(r, 'B').totalFloatHours).toBe(0);
  });

  it('mandatory finish puts the finish on its date', () => {
    const r = withB({ constraintType: 'CS_MANDFIN', constraintDate: day(2028, 1, 20) });
    expect(out(r, 'B').earlyFinish).toEqual(day(2028, 1, 20));
    expect(out(r, 'B').earlyStart).toEqual(day(2028, 1, 17));
  });

  it('finish on or before that the logic cannot meet gives negative float and a critical activity', () => {
    const r = withB({ constraintType: 'CS_MEOB', constraintDate: day(2028, 1, 12) });
    expect(out(r, 'B').earlyFinish).toEqual(day(2028, 1, 13));
    expect(out(r, 'B').totalFloatHours).toBe(-8); // the finish is one working day after the 12th
    expect(out(r, 'B').isCritical).toBe(true);
    // A constraint with room in it changes nothing: the last activity ends the programme, so it has no float either.
    expect(out(withB({ constraintType: 'CS_MEOB', constraintDate: day(2028, 2, 1) }), 'B').totalFloatHours).toBe(0);
  });

  it('applies a second constraint too', () => {
    const r = withB({ constraintType: 'CS_MSOA', constraintDate: day(2028, 1, 12), secondaryConstraintType: 'CS_MSOA', secondaryConstraintDate: day(2028, 1, 24) });
    expect(out(r, 'B').earlyStart).toEqual(day(2028, 1, 24));
  });

  it('does not apply as late as possible (the activity stays as soon as possible)', () => {
    expect(out(withB({ constraintType: 'CS_ALAP', constraintDate: null }), 'B').earlyStart).toEqual(day(2028, 1, 10));
  });
});

describe('progress and the data date', () => {
  // The data date is Monday 10 January.
  const at = (activities: Activity[], links: ReturnType<typeof rel>[] = [], logic?: 'override') =>
    recomputeCpm(model(activities, links, day(2028, 1, 10)), logic ? { logic } : {});

  it('keeps the actual dates of a completed activity, which drive what follows', () => {
    const r = at(
      [task('A', 3, { status: 'completed', actualStart: day(2028, 1, 3), actualFinish: day(2028, 1, 5), remainingDurationHours: 0 }), task('B', 2)],
      [rel('A', 'B')],
    );
    expect(out(r, 'A')).toMatchObject({ earlyStart: day(2028, 1, 3), earlyFinish: day(2028, 1, 5), totalFloatHours: null, isCritical: false });
    // B cannot start before the data date, though A finished on the 5th.
    expect(out(r, 'B').earlyStart).toEqual(day(2028, 1, 10));
  });

  it('runs what is left of a started activity from the data date, keeping its actual start', () => {
    const r = at([task('A', 5, { status: 'in-progress', actualStart: day(2028, 1, 3), remainingDurationHours: 16 })]);
    expect(out(r, 'A')).toMatchObject({ earlyStart: day(2028, 1, 3), remainingStart: day(2028, 1, 10), earlyFinish: day(2028, 1, 12), remainingFinish: day(2028, 1, 12) });
  });

  it('waits for the predecessors with retained logic, and ignores them with progress override', () => {
    const acts = [task('P', 5), task('A', 5, { status: 'in-progress', actualStart: day(2028, 1, 3), remainingDurationHours: 16 })];
    const retained = at(acts, [rel('P', 'A')]);
    expect(out(retained, 'A').earlyFinish).toEqual(day(2028, 1, 19)); // P ends 17th, then 2 days
    expect(out(retained, 'A').earlyStart).toEqual(day(2028, 1, 3));
    const override = at(acts, [rel('P', 'A')], 'override');
    expect(out(override, 'A').earlyFinish).toEqual(day(2028, 1, 12));
  });

  it('does not start an activity before the data date, even one that kept its old start', () => {
    const m = model([task('A', 2, { earlyStart: day(2028, 1, 3) })], [], day(2028, 1, 10));
    expect(out(recomputeCpm(m, { keepOwnStarts: true }), 'A').earlyStart).toEqual(day(2028, 1, 10));
  });

  it('gives a started activity its float from its finish, not from the start it made in the past', () => {
    // A long branch L and a started short branch S meet at E: S finishes on the 12th with L running to the 24th.
    const r = at(
      [task('L', 10), task('S', 5, { status: 'in-progress', actualStart: day(2028, 1, 3), remainingDurationHours: 16 }), task('E', 1)],
      [rel('L', 'E'), rel('S', 'E')],
    );
    expect(out(r, 'S').totalFloatHours).toBe(8 * 8); // 12th -> 24th: eight working days
    expect(out(r, 'L').isCritical).toBe(true);
  });
});
