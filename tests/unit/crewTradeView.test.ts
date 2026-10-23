import { describe, expect, it } from 'vitest';
import { mergeTrades } from '../../src/prs/rules';
import { addCrew, addTradeLine, applyCrewTradeEdit, crewTradeLines, removeCrewTradeLine, type CrewTradeData } from '../../src/prs/crewTradeView';

const KNOWN = [{ code: 'SF', name: 'Steel fixers', capacity: 24 }, { code: 'CP', name: 'Carpenters', capacity: 24 }, { code: 'GO', name: 'General operatives', capacity: 12 }];
const base = (): CrewTradeData => ({
  trades: [{ id: 'SF', name: 'Steel fixers', capacity: 24 }],
  crewTemplates: [{ id: 'SF-6', trades: [{ trade: 'SF', size: 6 }], subcontractor: 'Concrete Sub', available: 2 }, { id: 'RFC', trades: [{ trade: 'SF', size: 3 }, { trade: 'CP', size: 3 }] }],
});
const lines = (d: CrewTradeData) => crewTradeLines(d.crewTemplates, mergeTrades(KNOWN, d.trades));

describe('the crews and trades table', () => {
  it('has a line for each trade of each crew, repeating a trade that is in several crews', () => {
    const l = lines(base());
    expect(l.filter((x) => x.trade === 'SF').map((x) => [x.crewId, x.size, x.name, x.capacity])).toEqual([['SF-6', 6, 'Steel fixers', 24], ['RFC', 3, 'Steel fixers', 24]]);
    expect(l.filter((x) => x.crewId === 'RFC').map((x) => x.first)).toEqual([true, false]);
  });
  it('adds a line for a trade that no crew uses', () => {
    expect(lines(base()).at(-1)).toMatchObject({ crew: null, trade: 'GO', name: 'General operatives', capacity: 12 });
  });
  it('writes a crew\'s own values to the crew and a trade\'s to the trade', () => {
    const d = base();
    const l = lines(d);
    const next = applyCrewTradeEdit(applyCrewTradeEdit(d, l[0], { available: 3 }), l[1], { capacity: 30 });
    expect(next.crewTemplates[0].available).toBe(3);
    expect(next.trades[0].capacity).toBe(30);
    expect(lines(next).filter((x) => x.trade === 'SF').map((x) => x.capacity)).toEqual([30, 30]);
  });
  it('makes the trade when a name is typed for one the rules do not have yet, and takes a crew count off when it is emptied', () => {
    const d = base();
    const cp = lines(d).find((x) => x.trade === 'CP')!;
    expect(applyCrewTradeEdit(d, cp, { name: 'Formwork' }).trades).toContainEqual({ id: 'CP', name: 'Formwork', capacity: 24 });
    expect('available' in applyCrewTradeEdit(d, lines(d)[0], { available: undefined }).crewTemplates[0]).toBe(false);
  });
  it('changes one trade of a crew, and the people of it, without touching the others', () => {
    const d = base();
    const cp = lines(d).find((x) => x.crewId === 'RFC' && x.trade === 'CP')!;
    const next = applyCrewTradeEdit(applyCrewTradeEdit(d, cp, { size: 4 }), cp, { trade: 'GO' });
    expect(next.crewTemplates[1].trades).toEqual([{ trade: 'SF', size: 3 }, { trade: 'GO', size: 4 }]);
    expect(next.crewTemplates[0]).toBe(d.crewTemplates[0]);
  });
  it('adds a crew and a trade line, and removes a line, then the crew with its last one', () => {
    const d = addTradeLine(addCrew(base()), 2);
    expect(d.crewTemplates[2]).toEqual({ id: 'CREW', trades: [{ trade: '', size: 1 }] });
    const l = lines(base());
    expect(removeCrewTradeLine(base(), l[2]).crewTemplates[1].trades).toEqual([{ trade: 'SF', size: 3 }]);
    expect(removeCrewTradeLine(base(), l[0]).crewTemplates.map((c) => c.id)).toEqual(['RFC']);
  });
  it('switches a trade off rather than losing it when its line is removed', () => {
    const go = lines(base()).find((x) => x.crew === null)!;
    expect(removeCrewTradeLine(base(), go).trades).toContainEqual({ id: 'GO', name: 'General operatives', capacity: 12, enabled: false });
  });
  it('does not rename a crew to the ID of another', () => {
    const d = base();
    expect(applyCrewTradeEdit(d, lines(d)[0], { crewId: 'rfc' }).crewTemplates[0].id).toBe('SF-6');
  });
});
