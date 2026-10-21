import { describe, expect, it } from 'vitest';
import { evaluateFormula } from '../../src/schedule/durationFormula';
import { crewOf, daysFromFormula, setDurationFormula, setProductivity } from '../../src/schedule/planResources';
import { activity, model } from './helpers';

const val = (src: string, vars: Record<string, number> = {}) => { const r = evaluateFormula(src, vars); if ('error' in r) throw new Error(r.error); return r.value; };

describe('the formula reader', () => {
  it('does arithmetic with the usual order, brackets, powers and functions', () => {
    expect(val('1 + 2 * 3')).toBe(7);
    expect(val('(1 + 2) * 3')).toBe(9);
    expect(val('2 ^ 3 ^ 2')).toBe(512);
    expect(val('-4 + 10')).toBe(6);
    expect(val('ceil(7 / 2)')).toBe(4);
    expect(val('max(2, 5, 3) + min(4, 1)')).toBe(6);
  });

  it('uses the names given, in any case', () => {
    expect(val('QTY / (rate * crews)', { qty: 120, rate: 15, crews: 2 })).toBe(4);
  });

  it('says what is wrong instead of guessing', () => {
    const err = (src: string, vars: Record<string, number> = {}) => { const r = evaluateFormula(src, vars); return 'error' in r ? r.error : ''; };
    expect(err('qty / 0', { qty: 1 })).toMatch(/zero/);
    expect(err('foo + 1', { qty: 1 })).toMatch(/not known/);
    expect(err('1 +')).toMatch(/too soon/);
    expect(err('(1 + 2')).toMatch(/bracket/);
    expect(err('1 $ 2')).toMatch(/not allowed/);
    expect(err('qty - 100', { qty: 1 })).toMatch(/negative/);
    expect(err('')).toMatch(/empty/);
  });

  it('runs no code', () => {
    const r = evaluateFormula('constructor.constructor("return 1")()', {});
    expect('error' in r).toBe(true);
  });
});

describe('a formula on activities', () => {
  const base = () => {
    const a = activity('1', { type: 'task', durationHours: 8, remainingDurationHours: 8 });
    return model([a]);
  };
  const ok = <T extends object>(r: { error: string } | ({ model: ReturnType<typeof base> } & T)) => { if ('error' in r) throw new Error(r.error); return r; };

  it('sets the duration from quantity, productivity and the crew', () => {
    let m = ok(setProductivity(base(), '1', { quantity: 120, perDay: 15 })).model;
    m = ok(setDurationFormula(m, ['1'], 'ceil(qty / (rate * crews))')).model;
    const a = m.activities[0];
    expect(a.durationHours).toBe(64); // 8 days of 8 hours, one crew
    expect(a.udf['Duration formula']).toBe('ceil(qty / (rate * crews))');
    expect(daysFromFormula(m, a)).toEqual({ value: 8 });
  });

  it('follows a change of the crew: only the primary crew counts', () => {
    let m = ok(setProductivity(base(), '1', { quantity: 120, perDay: 15 })).model;
    m = ok(setDurationFormula(m, ['1'], 'qty / (rate * crews)')).model;
    const res = (id: string, type: 'labor' | 'equipment', units: number, primary?: boolean) => ({ resourceId: id, resourceName: id, resourceType: type, targetQty: 0, remainQty: 0, targetCost: 0, actualCost: 0, unitsPerTime: units, ...(primary ? { primary } : {}) });
    const a = { ...m.activities[0], resources: [res('r1', 'labor', 4, true), res('r2', 'equipment', 1)] };
    expect(crewOf(a)).toBe(4);
    expect(daysFromFormula(m, a)).toEqual({ value: 2 });
  });

  it('refuses a formula that does not read, and can be taken off', () => {
    expect('error' in setDurationFormula(base(), ['1'], 'qty +')).toBe(true);
    expect('error' in setDurationFormula(base(), ['1'], 'nonsense * 2')).toBe(true);
    let m = ok(setProductivity(base(), '1', { quantity: 10, perDay: 5 })).model;
    m = ok(setDurationFormula(m, ['1'], 'qty / rate')).model;
    m = ok(setDurationFormula(m, ['1'], '')).model;
    expect(m.activities[0].udf['Duration formula']).toBeUndefined();
  });
});
