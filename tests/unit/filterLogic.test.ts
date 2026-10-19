import { describe, expect, it } from 'vitest';
import { combineTests, compileLogic, defaultLogic } from '../../src/viewer/filterLogic';

const run = (text: string, rules: (boolean | null)[]) => {
  const c = compileLogic(text, rules.length);
  if (!c.ok) throw new Error(c.error);
  return c.run(rules);
};

describe('filter logic', () => {
  it('and binds tighter than or, with brackets', () => {
    // (1 and 2) or (3 and 4) and 5
    expect(run('(1 and 2) or (3 and 4) and 5', [true, true, false, false, false])).toBe(true);
    expect(run('(1 and 2) or (3 and 4) and 5', [false, true, true, true, false])).toBe(false);
    expect(run('(1 and 2) or (3 and 4) and 5', [false, true, true, true, true])).toBe(true);
    expect(run('1 or 2 and 3', [true, false, false])).toBe(true);
    expect(run('(1 or 2) and 3', [true, false, false])).toBe(false);
  });

  it('knows not and the symbol forms', () => {
    expect(run('not 1 and 2', [false, true])).toBe(true);
    expect(run('!(1 || 2)', [false, false])).toBe(true);
    expect(run('1 && 2 | 3', [true, false, true])).toBe(true);
    expect(run('1 AND 2 Or 3', [false, false, true])).toBe(true);
  });

  it('leaves an incomplete rule out of its and / or', () => {
    expect(run('1 or 2', [null, false])).toBe(false);
    expect(run('1 and 2', [true, null])).toBe(true);
    expect(run('(1 and 2) or 3', [null, null, null])).toBe(true);
  });

  it('says what is wrong', () => {
    const bad = (text: string, n = 3) => { const c = compileLogic(text, n); return c.ok ? '' : c.error; };
    expect(bad('1 and 4')).toMatch(/no rule 4/);
    expect(bad('(1 and 2')).toMatch(/bracket/);
    expect(bad('1 2')).toMatch(/join rules/);
    expect(bad('1 and')).toMatch(/ends too soon/);
    expect(bad('1 + 2')).toMatch(/Unexpected/);
    expect(bad('')).toMatch(/Write how/);
  });

  it('combines tests by the formula, or all / any when there is none or it is wrong', () => {
    const t = (f: (n: number) => boolean) => f;
    const tests = [t((n) => n > 1), t((n) => n < 10), t((n) => n === 5)];
    expect(combineTests(tests, 'all', '')!(5)).toBe(true);
    expect(combineTests(tests, 'all', '')!(20)).toBe(false);
    expect(combineTests(tests, 'any', '')!(20)).toBe(true);
    expect(combineTests(tests, 'all', '1 and 2 or 3')!(20)).toBe(false);
    expect(combineTests(tests, 'all', '1 and 2 or 3')!(5)).toBe(true);
    expect(combineTests(tests, 'all', '1 and (')!(0)).toBe(false);
    expect(combineTests([null, null], 'all', '')).toBeNull();
    expect(defaultLogic(3, 'all')).toBe('1 and 2 and 3');
    expect(defaultLogic(2, 'any')).toBe('1 or 2');
  });
});
