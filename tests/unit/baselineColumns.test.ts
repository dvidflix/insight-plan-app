import { describe, expect, it } from 'vitest';
import { buildColumnContext, buildColumns } from '../../src/schedule/columns';
import { recomputeCpm } from '../../src/schedule/cpm';
import { activity, day, model, rel } from './helpers';

/** A saved baseline is the programme as it was: its dates are shown beside the programme's, and the days between. */

const task = (id: string, days: number) => activity(id, { code: `C${id}`, status: 'not-started', durationHours: days * 8, remainingDurationHours: days * 8 });

describe('the saved baseline columns', () => {
  const was = recomputeCpm(model([task('A', 5), task('B', 3)], [rel('A', 'B')]));
  // A runs two days longer: B moves two working days later, and there is an activity the baseline never had.
  const now = recomputeCpm(model([task('A', 7), task('B', 3), task('N', 1)], [rel('A', 'B')]));
  const columns = buildColumns(now);
  const col = (id: string) => columns.find((c) => c.id === id)!;
  const ctx = buildColumnContext(now, { ...was, sourceFileName: 'Baseline 1' });
  const a = now.activities[0];
  const b = now.activities[1];

  it('has the columns, in their own group', () => {
    expect(['blStart', 'blFinish', 'blDuration', 'blStartVariance', 'blFinishVariance'].map((id) => col(id)?.group)).toEqual(Array(5).fill('Baseline'));
  });

  it('shows the dates the baseline had and the working days between', () => {
    expect(col('blStart').text(b, ctx)).toBe(col('start').text(was.activities[1], ctx));
    expect(col('blFinish').text(a, ctx)).not.toBe(col('finish').text(a, ctx));
    expect(col('blDuration').text(a, ctx)).toBe('5');
    expect(col('blStartVariance').value!(a, ctx)).toBe(0);
    expect(col('blFinishVariance').value!(a, ctx)).toBe(2);
    expect(col('blStartVariance').value!(b, ctx)).toBe(2);
    expect(col('blFinishVariance').value!(b, ctx)).toBe(2);
    expect(day(2028, 1, 3)).toBeTruthy();
  });

  it('is blank for an activity the baseline did not have, and for a programme with no baseline chosen', () => {
    const added = now.activities[2];
    expect(col('blStart').text(added, ctx)).toBe('');
    expect(col('blStartVariance').value!(added, ctx)).toBeNull();
    const none = buildColumnContext(now);
    expect(col('blStart').text(a, none)).toBe('');
    expect(col('blFinishVariance').value!(a, none)).toBeNull();
  });

  it('finds an activity by its code when its id is not the same', () => {
    const renumbered = { ...was, activities: was.activities.map((x) => ({ ...x, id: `old-${x.id}` })) };
    const byCode = buildColumnContext(now, renumbered);
    expect(col('blFinishVariance').value!(a, byCode)).toBe(2);
    expect(byCode.baseline?.name).toBe(renumbered.sourceFileName);
  });
});
