import { describe, expect, it } from 'vitest';
import { applyLabourEdit, crewLabour, labourRows, type LabourData } from '../../src/prs/labourView';
import type { Recipe } from '../../src/prs/recipes';

const TRADES = [{ code: 'SF', name: 'Steel fixers', capacity: 12 }, { code: 'CP', name: 'Carpenters', capacity: 14 }, { code: 'GL', name: 'Labourers', capacity: 3 }];

const recipe = (id: string, tasks: Recipe['tasks']): Recipe => ({ id, group: id, tasks });
const base = (): LabourData => ({
  trades: [{ id: 'SF', name: 'Steel fixers', capacity: 12 }],
  crewTemplates: [{ id: 'SF-CREW', trades: [{ trade: 'SF', size: 6 }], available: 2 }, { id: 'CP-CREW', trades: [{ trade: 'CP', size: 7 }] }],
  rates: [{ id: 'REBAR-RATE', type: 'productivity', manhoursPerUnit: 75, basis: 'rebar' }, { id: 'FIXED', type: 'days', days: 3 }],
  recipes: [
    recipe('A', [{ phase: 'Fix', crew: 'SF-CREW', rate: 'REBAR-RATE' }, { phase: 'Pour', days: 1 }]),
    recipe('B', [{ phase: 'Fix', crew: 'SF-CREW', rate: 'REBAR-RATE' }, { phase: 'Cure', crew: 'CP-CREW' }]),
  ],
});
const rowOf = (data: LabourData, code: string) => labourRows(TRADES, data).find((r) => r.code === code)!;

describe('the Labour table reads what the scenario has', () => {
  it('takes a trade\'s numbers from its trade, crew, rate and recipe tasks', () => {
    expect(rowOf(base(), 'SF')).toMatchObject({ number: 12, gangs: 2, crewId: 'SF-CREW', rateId: 'REBAR-RATE', productivity: 75, basis: 'rebar', usedFor: 'Fix', alsoFor: [] });
  });
  it('shows a trade with a crew but no productivity, and a trade with nothing, as empty cells', () => {
    expect(rowOf(base(), 'CP')).toMatchObject({ number: 14, crewId: 'CP-CREW', rateId: undefined, productivity: undefined, usedFor: '' });
    expect(rowOf(base(), 'GL')).toMatchObject({ number: 3, crewId: undefined, gangs: undefined, usedFor: '' });
  });
  it('does not link a fixed-days rate, and says when the same rate is on other phases', () => {
    const data = base();
    data.recipes[1].tasks[1] = { phase: 'Cure', crew: 'SF-CREW', rate: 'FIXED' };
    expect(rowOf(data, 'SF').usedFor).toBe('Fix');
    data.recipes[0].tasks[1] = { phase: 'Pour', crew: 'SF-CREW', rate: 'REBAR-RATE' };
    expect(rowOf(data, 'SF').alsoFor).toEqual(['Pour']);
  });
});

describe('editing a Labour row writes to the rows it came from', () => {
  const sf = { code: 'SF', name: 'Steel fixers' };
  it('changes nothing it is not asked to', () => {
    const data = base();
    const out = applyLabourEdit(data, sf, {});
    expect(out).toEqual(data);
    expect(out.recipes).toBe(data.recipes);
  });
  it('writes the number to the trade, adding the trade row when it is the generator\'s own', () => {
    expect(applyLabourEdit(base(), sf, { number: 20 }).trades).toEqual([{ id: 'SF', name: 'Steel fixers', capacity: 20 }]);
    expect(applyLabourEdit(base(), { code: 'CP', name: 'Carpenters' }, { number: 9 }).trades).toContainEqual({ id: 'CP', name: 'Carpenters', capacity: 9 });
  });
  it('writes gangs to the crew, and takes the property off when it is emptied', () => {
    expect(applyLabourEdit(base(), sf, { gangs: 3 }).crewTemplates[0].available).toBe(3);
    expect('available' in applyLabourEdit(base(), sf, { gangs: undefined }).crewTemplates[0]).toBe(false);
  });
  it('makes a crew for a trade that has none, sized so the number is shared between the gangs', () => {
    const out = applyLabourEdit(base(), { code: 'GL', name: 'Labourers' }, { gangs: 3, number: 9 });
    expect(out.crewTemplates.at(-1)).toMatchObject({ trades: [{ trade: 'GL', size: 3 }], available: 3 });
  });
  it('writes productivity and unit to the rate', () => {
    const out = applyLabourEdit(base(), sf, { productivity: 60, basis: 'concrete' });
    expect(out.rates[0]).toMatchObject({ id: 'REBAR-RATE', manhoursPerUnit: 60, basis: 'concrete' });
    expect(out.rates[1]).toEqual(base().rates[1]);
  });
  it('moves the rate to the tasks of another phase when "Used for" changes, in every recipe', () => {
    const data = base();
    data.recipes[0].tasks.push({ phase: 'Pour2', days: 2 });
    const out = applyLabourEdit(data, sf, { usedFor: 'Pour' });
    expect(out.recipes[0].tasks[0].rate).toBeUndefined();
    expect(out.recipes[0].tasks[0].crew).toBe('SF-CREW');
    expect(out.recipes[0].tasks[1]).toMatchObject({ phase: 'Pour', rate: 'REBAR-RATE', crew: 'SF-CREW' });
    expect(out.recipes[1].tasks[0].rate).toBeUndefined();
    expect(rowOf(out, 'SF')).toMatchObject({ usedFor: 'Pour', productivity: 75 });
  });
  it('does not take over a task that another crew does', () => {
    const data = base();
    data.recipes[1].tasks[1] = { phase: 'Pour', crew: 'CP-CREW' };
    data.recipes[0].tasks[1] = { phase: 'Pour', days: 1 };
    const out = applyLabourEdit(data, sf, { usedFor: 'Pour' });
    expect(out.recipes[1].tasks[1]).toEqual({ phase: 'Pour', crew: 'CP-CREW' });
    expect(out.recipes[0].tasks[1]).toMatchObject({ rate: 'REBAR-RATE', crew: 'SF-CREW' });
  });
  it('takes the rate off the tasks when "Used for" is emptied, keeping the rate and the crew', () => {
    const out = applyLabourEdit(base(), sf, { usedFor: '' });
    expect(out.recipes.every((r) => r.tasks.every((t) => t.rate === undefined))).toBe(true);
    expect(out.rates).toEqual(base().rates);
    expect(out.crewTemplates).toEqual(base().crewTemplates);
  });
  it('makes a productivity rate and a crew for a trade that has none, and the row reads back', () => {
    const gl = { code: 'GL', name: 'Labourers' };
    const out = applyLabourEdit(base(), gl, { usedFor: 'Pour', productivity: 4, basis: 'concrete', number: 3 });
    expect(out.rates.at(-1)).toMatchObject({ type: 'productivity', manhoursPerUnit: 4, basis: 'concrete' });
    expect(rowOf(out, 'GL')).toMatchObject({ usedFor: 'Pour', productivity: 4, basis: 'concrete' });
  });
});

describe('the Labour columns of one crew rather than a trade', () => {
  it('reads the rate of the crew\'s own work, even when the trade is in another crew first', () => {
    const data = base();
    data.crewTemplates.unshift({ id: 'MIXED', trades: [{ trade: 'SF', size: 2 }, { trade: 'CP', size: 2 }] });
    expect(crewLabour('SF-CREW', data)).toMatchObject({ rateId: 'REBAR-RATE', productivity: 75, usedFor: 'Fix' });
    expect(crewLabour('MIXED', data)).toMatchObject({ rateId: undefined, usedFor: '' });
  });
  it('writes an edit to that crew, not to the first crew of the trade', () => {
    const data = base();
    data.crewTemplates.unshift({ id: 'MIXED', trades: [{ trade: 'SF', size: 2 }] });
    const next = applyLabourEdit(data, { code: 'SF', name: 'Steel fixers' }, { gangs: 4 }, 'SF-CREW');
    expect(next.crewTemplates.find((c) => c.id === 'SF-CREW')!.available).toBe(4);
    expect(next.crewTemplates.find((c) => c.id === 'MIXED')!.available).toBeUndefined();
  });
});

describe('a productivity typed before the crew is used for anything', () => {
  it('is kept on a rate of the crew\'s own, and put on the activities when Used for is chosen', () => {
    let data = base();
    const sf = { code: 'CP', name: 'Carpenters' };
    data = applyLabourEdit(data, sf, { productivity: 18, basis: 'concrete' }, 'CP-CREW');
    expect(data.rates.find((r) => r.id === 'CP-CREW-RATE')).toMatchObject({ type: 'productivity', manhoursPerUnit: 18, basis: 'concrete' });
    expect(crewLabour('CP-CREW', data)).toMatchObject({ rateId: 'CP-CREW-RATE', productivity: 18, usedFor: '' });
    data = applyLabourEdit(data, sf, { usedFor: 'Cure' }, 'CP-CREW');
    expect(data.recipes[1].tasks[1]).toMatchObject({ phase: 'Cure', rate: 'CP-CREW-RATE', crew: 'CP-CREW' });
    expect(data.rates.filter((r) => r.type === 'productivity' && r.id.startsWith('CP-'))).toHaveLength(1);
    expect(crewLabour('CP-CREW', data)).toMatchObject({ productivity: 18, usedFor: 'Cure' });
  });
  it('makes a crew for a trade that has none', () => {
    const data = applyLabourEdit(base(), { code: 'GL', name: 'Labourers' }, { productivity: 5 });
    expect(data.crewTemplates.some((c) => c.trades.some((t) => t.trade === 'GL'))).toBe(true);
    expect(data.rates.some((r) => r.id.endsWith('-RATE') && r.manhoursPerUnit === 5)).toBe(true);
  });
});
