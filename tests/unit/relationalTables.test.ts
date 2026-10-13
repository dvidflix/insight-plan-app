import { describe, expect, it } from 'vitest';
import {
  assignmentProblems, assignmentsToTsv, crewText, crewsToTsv, parseAssignmentsPaste, parseCrewText, parseCrewsPaste, parseRatesPaste, ratesToTsv,
} from '../../src/prs/relational';
import { PRESET_1HDAB_TOC } from '../../src/prs/presets';
import { validateRules } from '../../src/prs/match';
import { mergeRules, normalizeRules } from '../../src/prs/rules';

const rules = PRESET_1HDAB_TOC.content.rules;

describe('the relational tables go to Excel and back', () => {
  it('crews: "SF 6, CP 4" in both directions', () => {
    expect(parseCrewText('SF 6, cp=4 ; GO')).toEqual([{ trade: 'SF', size: 6 }, { trade: 'CP', size: 4 }, { trade: 'GO', size: 1 }]);
    expect(crewText({ trades: [{ trade: 'SF', size: 6 }, { trade: 'CP', size: 4 }] })).toBe('SF 6, CP 4');
    const back = parseCrewsPaste(crewsToTsv(rules.crewTemplates));
    expect(back).toEqual(rules.crewTemplates.map((c) => ({ id: c.id, trades: c.trades })));
  });

  it('rates: every type survives the round trip', () => {
    const back = parseRatesPaste(ratesToTsv(rules.rates));
    expect(back).toEqual(rules.rates.map((r) => ({ ...r })));
    const typed = parseRatesPaste('ID\tType\tDays\nD3\tdays\t3,5\nR\trebar\t\t0.3');
    expect(typed).toEqual([{ id: 'D3', type: 'days', days: 3.5 }, { id: 'R', type: 'rebar', tonnesPerM3: 0.3 }]);
  });

  it('assignments: the preset\'s rows come back as they were', () => {
    const back = parseAssignmentsPaste(assignmentsToTsv(rules.assignments));
    const clean = (a: unknown) => JSON.parse(JSON.stringify(a));
    expect(clean(back.map(({ enabled: _e, note: _n, ...a }) => a))).toEqual(clean(rules.assignments.map(({ enabled: _e, note: _n, ...a }) => a)));
  });

  it('a pasted row replaces the row of the same group and phase', () => {
    const pasted = normalizeRules({ version: 1, assignments: parseAssignmentsPaste('Group\tPhase\tRate\tDays\tCrew\tCalendar\tPriority\nT-WALL-EXT\tRebar\t\t11\t\t\t10') });
    const merged = mergeRules(rules, pasted);
    expect(merged.assignments.filter((a) => a.group === 'T-WALL-EXT' && a.phase === 'Rebar')).toHaveLength(1);
    expect(merged.assignments.find((a) => a.group === 'T-WALL-EXT' && a.phase === 'Rebar')?.days).toBe(11);
    expect(merged.assignments.length).toBe(rules.assignments.length);
  });
});

describe('problems in the tables', () => {
  const known = { groups: new Set(['WALLS']), rates: new Set(['R1']), crews: new Set(['C1']), calendars: new Set(['6D']) };
  it('names what an assignment points at that is not there', () => {
    expect(assignmentProblems({ id: '', group: 'WALLS', phase: 'Rebar', rate: 'R1', crew: 'C1', calendar: '6D' }, known)).toEqual([]);
    const p = assignmentProblems({ id: '', group: 'NOPE', phase: '', rate: 'X', crew: 'Y', calendar: 'Z' }, known).join('\n');
    for (const w of ['A phase is needed', 'group "NOPE"', 'rate "X"', 'crew "Y"', 'calendar "Z"']) expect(p).toContain(w);
    expect(assignmentProblems({ id: '', group: 'WALLS', phase: 'Rebar' }, known)).toEqual(['Gives nothing: set a rate, days, a crew or a calendar']);
  });

  it('the preset has none, and a bad table is reported by validateRules', () => {
    expect(validateRules(rules, [])).toEqual([]);
    const bad = normalizeRules({
      version: 1,
      rates: [{ id: 'P', type: 'productivity' }, { id: 'D', type: 'days' }],
      crewTemplates: [{ id: 'C', trades: [] }],
      assignments: [{ id: 'a', group: '', phase: 'Rebar', days: 1 }, { id: 'b', group: '', phase: 'rebar', days: 2 }],
    });
    const text = validateRules(bad, []).map((x) => `${x.section}: ${x.text}`).join('\n');
    expect(text).toContain('rates: A productivity rate needs man-hours per unit');
    expect(text).toContain('rates: A days rate needs its days');
    expect(text).toContain('assignments: The same group and phase is assigned twice');
  });
});

describe('chains', () => {
  it('the preset\'s chains go to Excel and back, and a group\'s pasted chain replaces its own', async () => {
    const { chainsToTsv, parseChainsPaste } = await import('../../src/prs/relational');
    const back = parseChainsPaste(chainsToTsv(rules.chains));
    expect(back.map((c) => [c.group, c.order, c.phase, c.suffix, c.label ?? '', c.material ?? '', c.priority ?? ''])).toEqual(rules.chains.map((c) => [c.group, c.order, c.phase, c.suffix, c.label ?? '', c.material ?? '', c.priority ?? '']));
    const merged = mergeRules(rules, normalizeRules({ version: 1, chains: parseChainsPaste('Group\tOrder\tPhase\tSuffix\tName\tMaterial\tPriority\nC-LANDING\t1\tConcrete\t-C\tConcrete\tconcrete\t30') }));
    expect(merged.chains.filter((c) => c.group === 'C-LANDING').map((c) => c.phase)).toEqual(['Concrete']);
    expect(merged.chains.filter((c) => c.group === 'C-SLAB').length).toBe(rules.chains.filter((c) => c.group === 'C-SLAB').length);
  });

  it('reports a chain of a missing group, a repeated phase and a chain with no anchor phase', () => {
    const bad = normalizeRules({ version: 1, chains: [
      { id: 'a', group: 'NOPE', order: 1, phase: 'Pour' }, { id: 'b', group: 'NOPE', order: 2, phase: 'Pour' },
    ] });
    const text = validateRules(bad, []).map((x) => `${x.section}: ${x.text}`).join('\n');
    expect(text).toContain('chains: The group "NOPE" does not exist');
    expect(text).toContain('twice');
    expect(text).toContain('none of Concrete, Stitching or Installation');
  });
});

describe('productivity from rebar tonnes needs a rebar rate', () => {
  it('is reported when no rebar rate gives tonnes per m³, and not when one does', () => {
    const base = { version: 1, groups: [], rates: [{ id: 'P', type: 'productivity', basis: 'rebar', manhoursPerUnit: 75, people: 12, shifts: 2, hoursPerShift: 9.17, rounding: 'ceil', minDays: 1 }], assignments: [{ id: '|REBAR', group: '', phase: 'Rebar', rate: 'P' }] };
    const without = validateRules(normalizeRules(base), []).map((p) => p.text).join('\n');
    expect(without).toContain('no Rebar rate gives tonnes per m³');
    const withDensity = normalizeRules({ ...base, rates: [...base.rates, { id: 'D', type: 'rebar', tonnesPerM3: 0.25 }], assignments: [...base.assignments, { id: 'x', group: '', phase: 'Rebar', rate: 'D' }] });
    expect(validateRules(withDensity, []).map((p) => p.text).join('\n')).not.toContain('no Rebar rate gives');
  });
});

describe('the fix for a missing rebar rate', () => {
  it('adds the rate once and puts it in the Rebar rate column, beside a productivity rate on the same phase', async () => {
    const { addRebarRate } = await import('../../src/prs/convert');
    const base = normalizeRules({ version: 1, rates: [{ id: 'P', type: 'productivity', basis: 'rebar', manhoursPerUnit: 75, people: 12, shifts: 2, hoursPerShift: 9.17, rounding: 'ceil', minDays: 1 }], assignments: [{ id: '|REBAR', group: '', phase: 'Rebar', rate: 'P', crew: 'X' }] });
    expect(validateRules(base, []).some((p) => p.fix === 'rebarRate')).toBe(true);
    const fixed = addRebarRate(base);
    expect(fixed.rates.find((r) => r.id === 'REBAR-0.25')?.tonnesPerM3).toBe(0.25);
    expect(fixed.assignments).toHaveLength(1);
    expect(fixed.assignments[0]).toMatchObject({ rate: 'P', density: 'REBAR-0.25', crew: 'X' });
    expect(validateRules(fixed, []).some((p) => p.fix === 'rebarRate')).toBe(false);
    expect(addRebarRate(fixed).rates).toHaveLength(2); // (no second copy of the rate)
    const none = addRebarRate(normalizeRules({ version: 1 }), 0.3);
    expect(none.assignments[0]).toMatchObject({ group: '', phase: 'Rebar', density: 'REBAR-0.3' });
  });

  it('the Rebar rate column goes to Excel and back', async () => {
    const { assignmentsToTsv, parseAssignmentsPaste } = await import('../../src/prs/relational');
    const back = parseAssignmentsPaste(assignmentsToTsv([{ id: '|REBAR', group: '', phase: 'Rebar', rate: 'P', density: 'D' }]));
    expect(back[0]).toMatchObject({ phase: 'Rebar', rate: 'P', density: 'D' });
  });
});
