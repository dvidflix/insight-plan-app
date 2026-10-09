import { beforeEach, describe, expect, it } from 'vitest';
import { useActivityOverridesStore, withOverrides } from '../../src/state/activityOverridesStore';
import { planBulkEdit } from '../../src/schedule/bulkEdit';
import { applyLinkShortcut } from '../../src/schedule/linkShortcuts';
import { activity, day, model, rel } from './helpers';

const none = () => '';
const st = { status: 'not-started' } as never;

describe('Bulk edit: original duration from a column', () => {
  const acts = [
    activity('A', { ...st, durationHours: 32, remainingDurationHours: 32 }),
    activity('B', { ...st, durationHours: 32, remainingDurationHours: 32 }),
    activity('C', { ...st, durationHours: 32, remainingDurationHours: 32 }),
  ];
  const days: Record<string, number | null> = { A: 5, B: null, C: 4 };
  const valueOf = (a: { id: string }) => days[a.id] ?? null;

  it('sets the duration from the column, leaving activities with no value alone', () => {
    const plan = planBulkEdit(acts, [], 'all', { kind: 'durationFrom', column: 'x' }, none, () => '', valueOf);
    expect(plan.changes.map((c) => c.id)).toEqual(['A']);
    expect(plan.changes[0].patch).toEqual({ durationHours: 40, remainingDurationHours: 40 });
  });

  it('applies to the selected activities only', () => {
    const plan = planBulkEdit(acts, [], 'all', { kind: 'durationFrom', column: 'x' }, none, () => '', () => 5, new Set(['C']));
    expect(plan.picked).toBe(1);
    expect(plan.changes.map((c) => c.id)).toEqual(['C']);
  });
});

describe('Activity overrides', () => {
  beforeEach(() => useActivityOverridesStore.setState({ byProgramme: {} }));

  it('survive a round trip through storage, dates included', () => {
    useActivityOverridesStore.getState().set('f.xml', new Map([['a', { durationHours: 24, earlyStart: day(2028, 2, 1) }]]));
    const stored = JSON.parse(JSON.stringify(useActivityOverridesStore.getState().byProgramme));
    const m = withOverrides(model([activity('A', { code: 'A' })]), stored['f.xml']);
    expect(m.activities[0].durationHours).toBe(24);
    expect(m.activities[0].earlyStart).toEqual(day(2028, 2, 1));
  });

  it('calculate the dates again when a duration changes, keeping unlinked activities where they are', () => {
    const base = model(
      [
        activity('A', { code: 'A', earlyStart: day(2028, 1, 3), earlyFinish: day(2028, 1, 4) }),
        activity('B', { code: 'B', earlyStart: day(2028, 1, 4), earlyFinish: day(2028, 1, 5) }),
        activity('Z', { code: 'Z', earlyStart: day(2028, 3, 6), earlyFinish: day(2028, 3, 7) }),
      ],
      [rel('A', 'B')],
    );
    useActivityOverridesStore.getState().set('test.xml', new Map([['A', { durationHours: 24, remainingDurationHours: 24 }]]));
    const out = withOverrides(base, useActivityOverridesStore.getState().byProgramme['test.xml']);
    const by = (id: string) => out.activities.find((a) => a.id === id)!;
    expect(by('A').earlyFinish).toEqual(day(2028, 1, 6)); // 3 working days from Mon 3 Jan
    expect(by('B').earlyStart).toEqual(day(2028, 1, 6)); // pushed back by the longer A
    expect(by('Z').earlyStart).toEqual(day(2028, 3, 6)); // no link: stays
  });

  it('reset puts the programme back', () => {
    const base = model([activity('A', { code: 'A', durationHours: 8 })]);
    useActivityOverridesStore.getState().set('test.xml', new Map([['A', { durationHours: 40 }]]));
    useActivityOverridesStore.getState().reset('test.xml', ['a']);
    expect(withOverrides(base, useActivityOverridesStore.getState().byProgramme['test.xml'])).toBe(base);
  });
});

describe('Link edits', () => {
  beforeEach(() => useActivityOverridesStore.setState({ byProgramme: {}, links: {} }));
  const base = () => model(
    [
      activity('A', { code: 'A', earlyStart: day(2028, 1, 3), earlyFinish: day(2028, 1, 4) }),
      activity('B', { code: 'B', earlyStart: day(2028, 1, 4), earlyFinish: day(2028, 1, 5) }),
      activity('C', { code: 'C', earlyStart: day(2028, 1, 3), earlyFinish: day(2028, 1, 4) }),
    ],
    [rel('A', 'B')],
  );

  it('add, change and take out links by Activity ID', () => {
    const st = useActivityOverridesStore.getState();
    st.setLink('test.xml', { op: 'add', pred: 'c', succ: 'b', type: 'SS', lagHours: 0 });
    st.setLink('test.xml', { op: 'set', pred: 'A', succ: 'B', type: 'SS', lagHours: 8 });
    const out = withOverrides(base(), undefined, useActivityOverridesStore.getState().links['test.xml']);
    expect(out.relationships.find((r) => r.predId === 'C' && r.succId === 'B')?.type).toBe('SS');
    expect(out.relationships.find((r) => r.predId === 'A' && r.succId === 'B')).toMatchObject({ type: 'SS', lagHours: 8 });
    useActivityOverridesStore.getState().setLink('test.xml', { op: 'remove', pred: 'A', succ: 'B' });
    const out2 = withOverrides(base(), undefined, useActivityOverridesStore.getState().links['test.xml']);
    expect(out2.relationships.some((r) => r.predId === 'A' && r.succId === 'B')).toBe(false);
  });

  it('taking out a link added here just forgets it', () => {
    const st = useActivityOverridesStore.getState();
    st.setLink('test.xml', { op: 'add', pred: 'C', succ: 'B', type: 'FS' });
    st.setLink('test.xml', { op: 'remove', pred: 'C', succ: 'B' });
    expect(useActivityOverridesStore.getState().links['test.xml']).toBeUndefined();
  });
});

describe('Gantt link shortcuts', () => {
  beforeEach(() => useActivityOverridesStore.setState({ byProgramme: {}, links: {} }));

  it('Alt+F chains the picked activities in start order; Alt+S starts them with the earliest', () => {
    const m = model([
      activity('A', { code: 'A', earlyStart: day(2028, 1, 3) }),
      activity('B', { code: 'B', earlyStart: day(2028, 1, 10) }),
      activity('C', { code: 'C', earlyStart: day(2028, 1, 5) }),
    ]);
    const fs = applyLinkShortcut('FS', m, new Set(['A', 'B', 'C']));
    expect(fs.added).toBe(2);
    expect(useActivityOverridesStore.getState().links['test.xml'].map((o) => `${o.pred}>${o.succ}:${o.type}`)).toEqual(['A>C:FS', 'C>B:FS']);
    useActivityOverridesStore.setState({ links: {} });
    const ss = applyLinkShortcut('SS', m, new Set(['A', 'B', 'C']));
    expect(ss.added).toBe(2);
    expect(useActivityOverridesStore.getState().links['test.xml'].map((o) => `${o.pred}>${o.succ}:${o.type}`)).toEqual(['A>C:SS', 'A>B:SS']);
  });

  it('leaves out a link that would close a loop', () => {
    const m = model(
      [activity('A', { code: 'A', earlyStart: day(2028, 1, 3) }), activity('B', { code: 'B', earlyStart: day(2028, 1, 4) })],
      [rel('B', 'A')],
    );
    expect(applyLinkShortcut('FS', m, new Set(['A', 'B'])).added).toBe(0);
  });
});
