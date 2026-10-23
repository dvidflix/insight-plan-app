import { describe, expect, it } from 'vitest';
import { NO_RULES, type ScenarioRules } from '../../src/prs/rules';
import type { PourFact } from '../../src/prs/match';
import type { Recipe } from '../../src/prs/recipes';
import { daysText, planWorkItem, sourceText, withItemOverrides, type PlanInput } from '../../src/prs/activityPlan';

// Neutral names: nothing here is a real trade or element.
const fact = (key: string, type: string, volume: number): PourFact => ({ key, building: 'B', level: 'L1', levelNumber: 1, type, stage: '', zone: '', family: '', volume, values: {} });

const recipes: Recipe[] = [
  { id: 'R-SET', group: 'Set A', tasks: [{ phase: 'P1', name: 'First', crew: 'C1', formula: 'Concrete_m3 / 10' }, { phase: 'P2', rate: 'PROD' }, { phase: 'P3', days: 4 }] },
  { id: 'R-OTHER', group: 'Other', tasks: [{ phase: 'Q1', days: 2 }] },
  { id: 'R-ALL', group: '', tasks: [{ phase: 'P1' }] },
];

const rules = (over: Partial<ScenarioRules> = {}): ScenarioRules => ({
  ...NO_RULES,
  crewTemplates: [{ id: 'C1', trades: [{ trade: 'T1', size: 4 }] }, { id: 'C2', subcontractor: 'Sub', trades: [{ trade: 'T2', size: 6 }] }],
  rates: [{ id: 'PROD', type: 'productivity', basis: 'concrete', manhoursPerUnit: 8, people: 2, shifts: 1, hoursPerShift: 8 }],
  ...over,
});

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  group: 'Set A', recipes, rules: rules(), crewSheet: [], facts: [fact('a', 'KIND_X', 20), fact('b', 'KIND_X', 50)], membership: new Map(), ...over,
});

describe('a work item’s plan', () => {
  it('takes the set’s own recipe over one for every object, and says where each value comes from', () => {
    const p = planWorkItem(input());
    expect(p.recipe).toEqual({ id: 'R-SET', source: { kind: 'recipe', recipe: 'R-SET' } });
    expect(p.objects).toBe(2);
    expect(p.volume).toBe(70);
    const [a, b, c] = p.activities;
    expect(a).toMatchObject({ phase: 'P1', name: 'First', crewId: 'C1', crew: { label: 'C1', people: 4 } });
    // Formula per object: 20/10 and 50/10.
    expect(a.days).toMatchObject({ min: 2, max: 5 });
    expect(daysText(a.days!)).toBe('2–5 d');
    // Productivity: volume x 8 man-hours / (2 people x 8 h), rounded up: 10 and 25.
    expect(b.days).toMatchObject({ min: 10, max: 25 });
    expect(c.days).toMatchObject({ min: 4, max: 4, how: 'fixed' });
    expect(sourceText(a.crew!.source)).toBe('recipe R-SET');
  });

  it('gives a tie of priority to the earlier recipe, as the generator does', () => {
    const first = [recipes[2], ...recipes.slice(0, 2)];
    expect(planWorkItem(input({ recipes: first })).recipe).toEqual({ id: 'R-ALL', source: { kind: 'recipe', recipe: 'R-ALL', forAll: true } });
    const raised = first.map((r) => (r.id === 'R-SET' ? { ...r, priority: 1 } : r));
    expect(planWorkItem(input({ recipes: raised })).recipe?.id).toBe('R-SET');
  });

  it('falls back to the Crews sheet by type and activity, then by activity, then none', () => {
    const sheet = [{ Phase: 'P2', PourType: 'KIND X', Trade: 'T9', Crew: '3' }, { Phase: 'P3', PourType: '', Trade: 'T8', Crew: '2' }];
    const p = planWorkItem(input({ crewSheet: sheet }));
    expect(p.activities[1].crew).toMatchObject({ label: 'T9 3', source: { kind: 'sheetType', type: 'KIND_X' } });
    expect(p.activities[2].crew).toMatchObject({ label: 'T8 2', source: { kind: 'sheetPhase' } });
    expect(planWorkItem(input()).activities[1].crew).toBeNull();
  });

  it('lets a crew rule with more conditions win over a recipe crew of the same priority', () => {
    const p = planWorkItem(input({ rules: rules({ crews: [{ id: 'CR1', when: { type: 'KIND_X' }, phase: 'P1', trades: [{ trade: 'T5', size: 9 }] }] }) }));
    // Both have one condition: the rule is earlier in the generator's list and keeps the tie.
    expect(p.activities[0].crew).toMatchObject({ label: 'T5 9', source: { kind: 'crewRule', id: 'CR1' } });
  });

  it('uses the overrides: another recipe, a crew and days', () => {
    let p = planWorkItem(input({ override: { recipe: 'R-OTHER' } }));
    expect(p.recipe).toEqual({ id: 'R-OTHER', source: { kind: 'override' } });
    expect(p.activities.map((x) => x.phase)).toEqual(['Q1']);
    p = planWorkItem(input({ override: { tasks: { P1: { crew: 'C2', days: 7 } } } }));
    expect(p.activities[0]).toMatchObject({ crewId: 'C2', crew: { label: 'Sub · C2', source: { kind: 'override' } }, days: { min: 7, max: 7, source: { kind: 'override' } } });
  });

  it('says when the days need the model’s geometry', () => {
    const geo: Recipe[] = [{ id: 'G', group: 'Set A', tasks: [{ phase: 'P1', formula: 'Footprint_m2 / 5' }] }];
    const p = planWorkItem(input({ recipes: geo }));
    expect(p.activities[0].days).toBeNull();
    expect(p.activities[0].daysNote).toMatch(/geometry/);
  });

  it('shows no activities when no recipe fits (the generator’s own are used)', () => {
    const p = planWorkItem(input({ recipes: [] }));
    expect(p.recipe).toBeNull();
    expect(p.activities).toEqual([]);
  });
});

describe('overrides for the generator', () => {
  it('sends a chosen recipe as a copy for the set, and crews and days as a values-only recipe that beats the others', () => {
    const out = withItemOverrides(recipes, { 'Set A': { recipe: 'R-OTHER', tasks: { Q1: { crew: 'C2', days: 3 } } } });
    expect(out[0]).toMatchObject({ id: 'R-OTHER for Set A', group: 'Set A', priority: 1000 });
    expect(out[out.length - 1]).toEqual({ id: 'Overrides for Set A', group: 'Set A', chain: false, tasks: [{ phase: 'Q1', crew: 'C2', formula: '3', priority: 1000 }] });
    expect(withItemOverrides(recipes, undefined)).toBe(recipes);
    // The set's own chain recipe is left out: the generator would join it into the chosen one's activities.
    expect(out.map((r) => r.id)).not.toContain('R-SET');
    expect(out.map((r) => r.id)).toContain('R-OTHER');
  });

});
