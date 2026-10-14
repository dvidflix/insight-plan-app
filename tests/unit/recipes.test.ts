import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE_AND_STRUCTURE } from '../../src/prs/presets';
import { applyTasksPaste, compileRecipes, edgesFromFollows, parseTasksPaste, tasksToTsv, followsText, normalizeRecipes, parseUses, recipeLosses, recipesFromRules, usesText } from '../../src/prs/recipes';
import { splitRecipes, withOwn, withRecipes } from '../../src/prs/recipeRules';
import { normalizeRules } from '../../src/prs/rules';

const rules = ENGINE_AND_STRUCTURE;
const byId = <T extends { id: string }>(rows: T[]) => [...rows].sort((a, b) => a.id.localeCompare(b.id));

describe('recipes', () => {
  const file = recipesFromRules(rules);
  const back = compileRecipes(file);

  it('make a recipe of every group that has a chain, and of every group that only has values', () => {
    const ids = file.recipes.map((r) => r.id);
    expect(ids).toContain('C-SLAB');
    expect(ids).toContain('C-RAFT');
    expect(ids).toContain('ALL');
    expect(ids).toContain('T-WALL-EXT');
    expect(file.recipes.find((r) => r.id === 'C-SLAB')!.tasks.map((t) => t.phase)).toEqual(['Decking', 'Under Slab', 'Rebar', 'EOP on Slab', 'FWK', 'Concrete', 'Curing']);
    expect(file.recipes.find((r) => r.id === 'T-WALL-EXT')!.chain).toBe(false);
  });

  it('turn back into the same chains', () => {
    expect(byId(back.chains)).toEqual(byId(rules.chains));
  });

  it('turn back into the same assignments', () => {
    expect(byId(back.assignments)).toEqual(byId(rules.assignments));
  });

  it('keep the order of the rows, which breaks a tie between two groups', () => {
    expect(back.chains.map((c) => c.id)).toEqual(rules.chains.map((c) => c.id));
    expect(back.assignments.map((a) => a.id).sort()).toEqual(rules.assignments.map((a) => a.id).sort());
  });

  it('keep what is switched off apart from the activities', () => {
    const off = file.recipes.filter((r) => r.chain === false).flatMap((r) => r.tasks.filter((t) => t.enabled === false));
    expect(off.length).toBeGreaterThan(0);
    expect(back.chains.some((c) => c.enabled === false)).toBe(false);
  });

  it('write what a task follows as the generator reads it', () => {
    const slab = file.recipes.find((r) => r.id === 'C-SLAB')!;
    expect(followsText(slab, 'Rebar')).toBe('Decking@80, Under Slab@80');
    expect(followsText(slab, 'Concrete')).toBe('FWK, EOP on Slab');
    expect(edgesFromFollows('Decking@80, Under Slab', 'Rebar')).toEqual([{ from: 'Decking', to: 'Rebar', sharePct: 80 }, { from: 'Under Slab', to: 'Rebar' }]);
  });

  it('give nothing for a recipe that is switched off', () => {
    const off = { ...file, recipes: file.recipes.map((r) => ({ ...r, enabled: false })) };
    expect(compileRecipes(off)).toEqual({ chains: [], assignments: [] });
  });

  it('normalise a file edited by hand', () => {
    expect(normalizeRecipes(null).recipes).toEqual([]);
    const n = normalizeRecipes({ recipes: [{ id: 'A', tasks: [{ phase: 'Rebar' }, { phase: '' }, 7] }, { tasks: [] }] });
    expect(n.recipes).toHaveLength(1);
    expect(n.recipes[0].group).toBe('');
    expect(n.recipes[0].tasks).toEqual([{ phase: 'Rebar' }]);
  });
});

describe('the tasks of a recipe as text for a spreadsheet', () => {
  const slab = recipesFromRules(rules).recipes.find((r) => r.id === 'C-SLAB')!;
  const wall = recipesFromRules(rules).recipes.find((r) => r.id === 'T-WALL-EXT')!;

  it('come back as the same tasks and links', () => {
    const back = parseTasksPaste(tasksToTsv(slab));
    expect(back.tasks.map((t) => ({ ...t }))).toEqual(slab.tasks.map(({ x: _x, y: _y, ...t }) => t));
    expect(back.edges).toEqual(slab.edges);
    expect(parseTasksPaste(tasksToTsv(wall)).tasks).toEqual(wall.tasks);
  });

  it('are added or updated by phase, keeping where a task sits and its links to other recipes', () => {
    const base = { ...slab, tasks: slab.tasks.map((t) => (t.phase === 'Rebar' ? { ...t, x: 40, y: 50, links: [{ recipe: 'B', phase: 'Rebar' }] } : t)) };
    const text = ['Phase', 'Rebar', 'Lifting'].map((phase, i) => (i === 0 ? `${phase}\tName` : `${phase}\t${phase === 'Rebar' ? 'Steel' : 'Crane lift'}`)).join('\n');
    const next = applyTasksPaste(base, parseTasksPaste(text), false);
    const rebar = next.tasks.find((t) => t.phase === 'Rebar')!;
    expect(rebar).toMatchObject({ name: 'Steel', x: 40, y: 50, links: [{ recipe: 'B', phase: 'Rebar' }] });
    expect(next.tasks.map((t) => t.phase)).toEqual([...slab.tasks.map((t) => t.phase), 'Lifting']);
    expect((next.edges ?? []).some((e) => e.to === 'Rebar')).toBe(false); // its links are the pasted ones (none)
    expect((next.edges ?? []).some((e) => e.to === 'Concrete')).toBe(true);
  });

  it('can replace every task, and read semicolons when there is no tab', () => {
    const text = ['Rebar;Rebar;-R;rebar;;3', 'Concrete;Concrete;-C;concrete;Rebar@50;1'].join('\n');
    const next = applyTasksPaste(slab, parseTasksPaste(text), true);
    expect(next.tasks.map((t) => t.phase)).toEqual(['Rebar', 'Concrete']);
    expect(next.tasks[0]).toMatchObject({ material: 'rebar', days: 3 });
    expect(next.edges).toEqual([{ from: 'Rebar', to: 'Concrete', sharePct: 50 }]);
  });
});

describe('equipment, cranes and materials', () => {
  it('are written as text and read back', () => {
    expect(parseUses('TC1, PUMP 2, FWSET x3')).toEqual([{ type: 'TC1' }, { type: 'PUMP', count: 2 }, { type: 'FWSET', count: 3 }]);
    expect(usesText(parseUses('TC1, PUMP 2'))).toBe('TC1, PUMP 2');
    expect(parseUses('  ,  ')).toEqual([]);
    expect(parseUses('Tower crane 2')).toEqual([{ type: 'Tower crane', count: 2 }]);
  });

  it('keep the scenario pools through normalising, and stay with the scenario when a preset is loaded', () => {
    const mine = normalizeRules({ version: 1, resourcePools: [{ id: 'TC1', kind: 'crane', name: 'Tower crane', quantity: 2 }, { id: '', kind: 'crane' }, { id: 'X', kind: 'nonsense', quantity: 'many' }] });
    expect(mine.resourcePools).toEqual([{ id: 'TC1', kind: 'crane', name: 'Tower crane', quantity: 2 }, { id: 'X', kind: 'equipment', name: '', quantity: 0 }]);
    expect(withOwn(rules, mine).resourcePools).toHaveLength(2);
    expect(splitRecipes(withOwn(rules, mine)).rules.resourcePools).toHaveLength(2);
  });

  it('keep the links to other recipes through the recipes file', () => {
    const file = normalizeRecipes({ recipes: [{ id: 'A', group: '', tasks: [{ phase: 'Install', links: [{ recipe: 'B', phase: 'Dismantle', direction: 'after', scope: 'building' }] }] }] });
    expect(file.recipes[0].tasks[0].links).toEqual([{ recipe: 'B', phase: 'Dismantle', direction: 'after', scope: 'building' }]);
  });

  it('keep the subcontractor and the number of crews of a named crew', () => {
    const r = normalizeRules({ version: 1, crewTemplates: [{ id: 'CARP', subcontractor: 'Concrete Sub', available: 3, trades: [{ trade: 'CP', size: 4 }] }] });
    expect(r.crewTemplates[0]).toMatchObject({ id: 'CARP', subcontractor: 'Concrete Sub', available: 3 });
  });

  it('survive the recipes file', () => {
    const file = normalizeRecipes({ recipes: [{ id: 'A', group: '', tasks: [{ phase: 'Rebar', cranes: [{ type: 'TC1' }], materials: [{ type: 'FWSET', count: 2 }] }] }] });
    expect(file.recipes[0].tasks[0].cranes).toEqual([{ type: 'TC1' }]);
    expect(file.recipes[0].tasks[0].materials).toEqual([{ type: 'FWSET', count: 2 }]);
  });
});

describe('a scenario split into rules and recipes', () => {
  it('loses nothing for the preset, and joins back to the same rules', () => {
    const split = splitRecipes(rules);
    expect(split.losses).toEqual([]);
    expect(split.rules.chains).toEqual([]);
    expect(split.rules.assignments).toEqual([]);
    const joined = withRecipes(split.rules, split.recipes);
    expect(joined.chains).toEqual(rules.chains);
    expect(byId(joined.assignments)).toEqual(byId(rules.assignments));
    expect(joined.groups).toEqual(rules.groups);
    expect(joined.settings).toEqual(rules.settings);
  });

  it('holds a calendar given to every phase of a group', () => {
    const r = normalizeRules({ version: 1, groups: [{ id: 'G', forEach: [], filters: [] }], assignments: [{ id: 'G|', group: 'G', phase: '', calendar: '7D', priority: 5 }] });
    const split = splitRecipes(r);
    expect(split.losses).toEqual([]);
    expect(split.recipes.recipes).toHaveLength(1);
    expect(normalizeRecipes(JSON.parse(JSON.stringify(split.recipes))).recipes[0].tasks).toHaveLength(1);
    expect(compileRecipes(split.recipes).assignments[0]).toMatchObject({ group: 'G', phase: '', calendar: '7D', priority: 5 });
  });

  it('says what a recipe cannot hold: chain rows of one group with different priorities', () => {
    const r = normalizeRules({
      version: 1,
      chains: [
        { id: 'G|A', group: 'G', order: 1, phase: 'A', priority: 1 },
        { id: 'G|B', group: 'G', order: 2, phase: 'B', priority: 2 },
      ],
    });
    const split = splitRecipes(r);
    expect(split.losses.length).toBeGreaterThan(0);
    expect(recipeLosses(r, split.recipes)).toEqual(split.losses);
  });

  it('keeps the scenarios own recipes when a preset is loaded over its rules', () => {
    const mine = normalizeRules({ version: 1, recipes: [{ id: 'A', group: 'G', tasks: [{ phase: 'Rebar' }] }] });
    const next = withOwn(rules, mine);
    expect(next.recipes).toHaveLength(1);
    expect(next.chains).toEqual(rules.chains);
    expect(withOwn(mine, normalizeRules({}))).toBe(normalizeRules({}));
  });

  it('is the scenario itself when there are no recipes', () => {
    expect(withRecipes(rules, { version: 1, recipes: [] })).toBe(rules);
    expect(splitRecipes(normalizeRules({})).recipes.recipes).toEqual([]);
  });
});

/** scenario-engine/tests/test_recipes.py reads the preset's rules without chains and assignments, and the recipes made from them: the generator
    must give the same programme either way. Run with UPDATE_PRESET_FIXTURE=1 to rewrite the file after changing the preset. */
describe('the preset as recipes, the file the engine parity test reads', () => {
  const target = path.join(__dirname, '../../scenario-engine/tests/fixtures/preset_recipes.json');
  const current = JSON.stringify({ rules: { ...rules, chains: [], assignments: [] }, recipes: recipesFromRules(rules) }, null, 1) + '\n';
  it('is the preset', () => {
    if (process.env.UPDATE_PRESET_FIXTURE) fs.writeFileSync(target, current);
    expect(fs.readFileSync(target, 'utf8')).toBe(current);
  });
});

describe('an extra moved into a recipe', () => {
  it('starts and finishes with the Concrete: two edges, written as SS and FF', () => {
    const recipe: Recipe = {
      id: 'SLAB', group: 'SLABS',
      tasks: [{ phase: 'Concrete', material: 'concrete' }, { phase: 'Survey', name: 'Survey', suffix: '-0001', days: 1 }],
      edges: [{ from: 'Concrete', to: 'Survey', type: 'SS', lagHours: 0 }, { from: 'Concrete', to: 'Survey', type: 'FF', lagHours: 0 }],
    };
    expect(followsText(recipe, 'Survey')).toBe('Concrete:SS+0, Concrete:FF+0');
  });
});
