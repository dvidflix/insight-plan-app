import { describe, expect, it } from 'vitest';
import { nextChoice } from '../../src/state/programmeChoiceStore';

describe('remembering which programme to use', () => {
  it('records the selected programme and the ones switched off', () => {
    expect(nextChoice({ selected: null, hidden: [] }, ['A.xer', 'B.xer'], 'B.xer', ['A.xer'])).toEqual({ selected: 'B.xer', hidden: ['A.xer'] });
  });

  it('forgets a programme that is switched on again', () => {
    expect(nextChoice({ selected: 'B.xer', hidden: ['A.xer'] }, ['A.xer', 'B.xer'], 'B.xer', [])).toEqual({ selected: 'B.xer', hidden: [] });
  });

  it('keeps what it knew of programmes that are not loaded yet', () => {
    // Only A has loaded; C was switched off earlier and is still on its way.
    expect(nextChoice({ selected: 'C.xer', hidden: ['C.xer'] }, ['A.xer'], 'A.xer', [])).toEqual({ selected: 'A.xer', hidden: ['C.xer'] });
  });

  it('keeps the selection when nothing is selected now', () => {
    expect(nextChoice({ selected: 'B.xer', hidden: [] }, [], null, [])).toEqual({ selected: 'B.xer', hidden: [] });
  });

  it('lists each hidden programme once', () => {
    expect(nextChoice({ selected: null, hidden: ['A.xer'] }, ['B.xer'], null, ['B.xer', 'B.xer']).hidden).toEqual(['A.xer', 'B.xer']);
  });
});
