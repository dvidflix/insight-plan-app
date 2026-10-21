import { describe, expect, it } from 'vitest';
import { describeLoop, findLoops, newLoops } from '../../src/schedule/loops';
import { runChecks } from '../../src/schedule/checks';
import { activity, model, rel } from './helpers';

const acts = (...ids: string[]) => ids.map((id) => activity(id, { code: id }));

describe('finding loops', () => {
  it('finds none in a straight run or a diamond', () => {
    expect(findLoops(acts('A', 'B', 'C'), [rel('A', 'B'), rel('B', 'C')])).toEqual([]);
    expect(findLoops(acts('A', 'B', 'C', 'D'), [rel('A', 'B'), rel('A', 'C'), rel('B', 'D'), rel('C', 'D')])).toEqual([]);
  });

  it('finds a loop of two, of three, and an activity that follows itself', () => {
    expect(findLoops(acts('A', 'B'), [rel('A', 'B'), rel('B', 'A')]).map((l) => [...l].sort())).toEqual([['A', 'B']]);
    expect(findLoops(acts('A', 'B', 'C', 'D'), [rel('A', 'B'), rel('B', 'C'), rel('C', 'A'), rel('C', 'D')]).map((l) => [...l].sort())).toEqual([['A', 'B', 'C']]);
    expect(findLoops(acts('A'), [rel('A', 'A')])).toEqual([['A']]);
  });

  it('finds separate loops, and ignores links to level-of-effort activities', () => {
    const a = [...acts('A', 'B', 'C', 'D'), activity('L', { code: 'L', type: 'loe' })];
    const loops = findLoops(a, [rel('A', 'B'), rel('B', 'A'), rel('C', 'D'), rel('D', 'C'), rel('A', 'L'), rel('L', 'A')]);
    expect(loops).toHaveLength(2);
  });

  it('copes with a long chain (no recursion) and a long loop', () => {
    const n = 90000;
    const ids = Array.from({ length: n }, (_, i) => `T${i}`);
    const chain = ids.slice(1).map((id, i) => rel(ids[i], id));
    expect(findLoops(ids.map((id) => activity(id, { code: id })), chain)).toEqual([]);
    const closed = findLoops(ids.map((id) => activity(id, { code: id })), [...chain, rel(ids[n - 1], ids[0])]);
    expect(closed).toHaveLength(1);
    expect(closed[0]).toHaveLength(n);
  });

  it('describes a loop by the codes', () => {
    const m = model(acts('A', 'B', 'C'));
    expect(describeLoop(m, ['A', 'B', 'C'])).toBe('A → B → C → A');
  });
});

describe('what an edit must not do', () => {
  it('only counts a loop that the edit made', () => {
    const before = model(acts('A', 'B', 'C'), [rel('A', 'B'), rel('B', 'C')]);
    const closing = { ...before, relationships: [...before.relationships, rel('C', 'A')] };
    expect(newLoops(before, closing)).toHaveLength(1);
    // A programme that already had the loop is not blocked from other edits.
    const edited = { ...closing, activities: closing.activities.map((a) => (a.id === 'B' ? { ...a, name: 'x' } : a)) };
    expect(newLoops(closing, edited)).toEqual([]);
    expect(newLoops(before, before)).toEqual([]);
  });
});

describe('the Logic Loops check', () => {
  it('flags the activities in a loop', () => {
    const m = model(acts('A', 'B', 'C'), [rel('A', 'B'), rel('B', 'A'), rel('B', 'C')]);
    const r = runChecks(m).additional.find((c) => c.id === 'ADD11')!;
    expect(r.activities.map((a) => a.id).sort()).toEqual(['A', 'B']);
    const clean = runChecks(model(acts("A", "B"), [rel("A", "B")])).additional.find((c) => c.id === 'ADD11')!;
    expect(clean.activities).toEqual([]);
  });
});
