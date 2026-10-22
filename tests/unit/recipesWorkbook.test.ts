import { describe, expect, it } from 'vitest';
import { compileRecipes, type Recipe } from '../../src/prs/recipes';
import { fromRecipeSheets, formulaProblem, previewDays, toRecipeSheets, STEPS_ID } from '../../src/prs/recipesWorkbook';
import { mergeRules, normalizeRules, NO_RULES, isEmptyRules } from '../../src/prs/rules';
import { formulaNames } from '../../src/schedule/durationFormula';

const WALL: Recipe = {
  id: 'EXT-WALL', group: 'External Wall', tasks: [
    { phase: 'Rebar', suffix: '-R', material: 'rebar', formula: 'Rebar_kg / Rebar_Rate', crew: 'REBAR' },
    { phase: 'Formwork', suffix: '-F', days: 5, x: 40, y: 20 },
    { phase: 'Concrete', suffix: '-C', material: 'concrete', formula: 'max(1, Concrete_m3 / Concrete_Rate)', cranes: [{ type: 'TC1', count: 1 }] },
  ],
  edges: [{ from: 'Rebar', to: 'Formwork', sharePct: 80 }, { from: 'Formwork', to: 'Concrete', type: 'SS', lagHours: 16 }],
};
const PARAMS = [{ id: 'Rebar_Rate', name: 'Rebar_Rate', value: 500, unit: 'kg/crew/day' }, { id: 'Concrete_Rate', name: 'Concrete_Rate', value: 40 }, { id: 'Formwork_Sets_Available', name: 'Formwork_Sets_Available', value: 4 }];
const SOURCE = {
  recipes: [WALL],
  pools: [{ id: 'TC1', kind: 'crane' as const, name: 'Tower crane 1', quantity: 2 }],
  parameters: PARAMS,
  limits: [{ id: 'Formwork', phase: 'Formwork', max: 'Formwork_Sets_Available' }],
  sequences: [{ id: STEPS_ID, name: 'Steps', steps: [{ group: 'Raft' }, { group: 'Walls L01', perLevel: true, type: 'SS' as const, lagHours: 16 }] }],
};

describe('a recipe task with a duration formula', () => {
  it('compiles into an assignment that carries the formula', () => {
    const { assignments } = compileRecipes({ version: 1, recipes: [WALL] });
    expect(assignments.find((a) => a.phase === 'Rebar')?.formula).toBe('Rebar_kg / Rebar_Rate');
    expect(assignments.find((a) => a.phase === 'Formwork')?.formula).toBeUndefined();
  });
  it('is checked against the quantities and the parameters', () => {
    expect(formulaProblem('Rebar_kg / Rebar_Rate', ['Rebar_Rate'])).toBe('');
    expect(formulaProblem('Rebar_kg / Rebar_Rate', [])).toMatch(/Rebar_Rate/);
    expect(formulaProblem('1 +', [])).not.toBe('');
    expect(formulaNames('max(1, Concrete_m3 / Concrete_Rate)')).toEqual(['Concrete_m3', 'Concrete_Rate']);
  });
  it('gives the days for a sample pour', () => {
    expect(previewDays('Rebar_kg / Rebar_Rate', PARAMS, { Rebar_kg: 3500 })).toEqual({ days: 7 });
    expect(previewDays('max(1, Concrete_m3 / Concrete_Rate)', PARAMS, { Concrete_m3: 150 })).toEqual({ days: 3.75 });
    expect(previewDays('Nope', PARAMS, {})).toHaveProperty('error');
  });
});

describe('the recipes workbook', () => {
  it('writes a row per activity with its group, order, follows and formula', () => {
    const s = toRecipeSheets(SOURCE);
    expect(s.recipes).toHaveLength(3);
    expect(s.recipes[0]).toMatchObject({ 'Recipe*': 'EXT-WALL', 'Logical Group': 'External Wall', Order: 1, 'Activity*': 'Rebar', 'Duration Formula': 'Rebar_kg / Rebar_Rate', 'Quantity driver (read only)': 'Rebar_kg' });
    expect(s.recipes[1]).toMatchObject({ Follows: 'Rebar@80', Days: 5 });
    expect(s.recipes[2].Follows).toBe('Formwork:SS+2d');
    expect(s.parameters[0]).toMatchObject({ 'Name*': 'Rebar_Rate', 'Value*': 500 });
    expect(s.limits[0]).toMatchObject({ 'Activity*': 'Formwork', 'Max at once': 'Formwork_Sets_Available' });
    expect(s.steps[1]).toMatchObject({ Step: 2, 'Search set / group*': 'Walls L01', 'Per level': 'yes', 'Link into it': 'SS', 'Lag (h)': 16 });
  });

  it('reads back what it wrote, keeping what a sheet cannot carry', () => {
    const sheets = toRecipeSheets(SOURCE);
    const applied = fromRecipeSheets(sheets, { recipes: [WALL], pools: SOURCE.pools, parameters: PARAMS, groupIds: ['Raft', 'Walls L01'] });
    expect(applied.warnings).toEqual([]);
    const wall = applied.recipes!.find((r) => r.id === 'EXT-WALL')!;
    expect(wall.tasks.map((t) => [t.phase, t.formula, t.days])).toEqual([['Rebar', 'Rebar_kg / Rebar_Rate', undefined], ['Formwork', undefined, 5], ['Concrete', 'max(1, Concrete_m3 / Concrete_Rate)', undefined]]);
    expect(wall.tasks[1]).toMatchObject({ x: 40, y: 20 }); // its place in the graph stays
    expect(wall.edges).toEqual(WALL.edges);
    expect(applied.parameters).toHaveLength(3);
    expect(applied.limits).toEqual([{ id: 'Formwork', phase: 'Formwork', max: 'Formwork_Sets_Available' }]);
    expect(applied.steps).toEqual([{ group: 'Raft' }, { group: 'Walls L01', perLevel: true, type: 'SS', lagHours: 16 }]);
  });

  it('makes a recipe from new rows, in the order given, and keeps a recipe the sheet does not name', () => {
    const applied = fromRecipeSheets({
      recipes: [
        { 'Recipe*': 'SLAB', 'Logical Group': 'Slab', Order: 2, 'Activity*': 'Concrete', 'Duration Formula': 'max(1, Concrete_m3 / Concrete_Rate)' },
        { 'Recipe*': 'SLAB', 'Logical Group': 'Slab', Order: 1, 'Activity*': 'Decking', Days: 1 },
      ],
    }, { recipes: [WALL], pools: [], parameters: PARAMS });
    expect(applied.recipes!.map((r) => r.id)).toEqual(['EXT-WALL', 'SLAB']);
    expect(applied.recipes![1].tasks.map((t) => t.phase)).toEqual(['Decking', 'Concrete']);
    expect(applied.recipes![1].group).toBe('Slab');
  });

  it('says what is wrong without stopping', () => {
    const applied = fromRecipeSheets({
      parameters: [{ 'Name*': 'Rebar Rate', 'Value*': 500 }, { 'Name*': 'Good_Name', 'Value*': 'abc' }, { 'Name*': 'Ok', 'Value*': 3 }],
      recipes: [{ 'Recipe*': 'R', 'Logical Group': '', 'Activity*': 'Rebar', 'Duration Formula': 'Rebar_kg / Missing_Rate', Follows: 'Ghost' }],
      limits: [{ 'Activity*': 'Formwork', 'Max at once': 'Not_A_Param' }],
      steps: [{ Step: 1, 'Search set / group*': 'Nowhere', 'Link into it': 'XX' }],
    }, { recipes: [], pools: [], parameters: [], groupIds: ['Raft'] });
    const text = applied.warnings.join('\n');
    expect(text).toMatch(/Rebar Rate.*not a name/);
    expect(text).toMatch(/Good_Name.*no number/);
    expect(text).toMatch(/Missing_Rate/);
    expect(text).toMatch(/Ghost/);
    expect(text).toMatch(/Not_A_Param/);
    expect(text).toMatch(/Nowhere/);
    expect(text).toMatch(/XX/);
    expect(applied.parameters!.map((p) => p.name)).toEqual(['Ok']);
  });

  it('refuses a sheet whose columns were renamed', () => {
    const applied = fromRecipeSheets({ recipes: [{ Wrong: 'x' }] }, { recipes: [], pools: [], parameters: [] });
    expect(applied.recipes).toBeUndefined();
    expect(applied.warnings[0]).toMatch(/no column/);
  });

  it('reads a formula typed in the Days column', () => {
    const applied = fromRecipeSheets({ recipes: [{ 'Recipe*': 'R', 'Activity*': 'Rebar', Days: 'Rebar_kg / Rebar_Rate' }] }, { recipes: [], pools: [], parameters: PARAMS });
    expect(applied.recipes![0].tasks[0]).toMatchObject({ formula: 'Rebar_kg / Rebar_Rate' });
    expect(applied.recipes![0].tasks[0].days).toBeUndefined();
  });

  it('reads the resources, adding or updating by kind and ID', () => {
    const applied = fromRecipeSheets({ resources: [{ Kind: 'crane', 'ID*': 'TC1', Name: 'Tower crane', Quantity: 3 }, { Kind: 'material', 'ID*': 'FW', Name: 'Slab formwork sets', Quantity: 4 }, { Kind: 'boat', 'ID*': 'X', Name: '', Quantity: 1 }] },
      { recipes: [], pools: SOURCE.pools, parameters: [] });
    expect(applied.pools!.map((p) => [p.kind, p.id, p.quantity])).toEqual([['crane', 'TC1', 3], ['material', 'FW', 4]]);
    expect(applied.warnings.join()).toMatch(/Kind must be/);
  });
});

describe('parameters and limits in the scenario rules', () => {
  it('are kept, cleaned and counted', () => {
    const r = normalizeRules({ parameters: [{ name: 'Rebar_Rate', value: '500' }, { name: '', value: 1 }], limits: [{ phase: 'Formwork', max: 4 }, { phase: '' }] });
    expect(r.parameters).toEqual([{ id: 'Rebar_Rate', name: 'Rebar_Rate', value: 500 }]);
    expect(r.limits).toEqual([{ id: 'Formwork', phase: 'Formwork', max: 4 }]);
    expect(isEmptyRules(r)).toBe(false);
    expect(normalizeRules({ parameters: [] })).toBe(NO_RULES);
  });
  it('a preset merged in replaces the same name and keeps the rest', () => {
    const base = normalizeRules({ parameters: [{ name: 'A', value: 1 }, { name: 'B', value: 2 }] });
    const merged = mergeRules(base, normalizeRules({ parameters: [{ name: 'B', value: 9 }] }));
    expect(merged.parameters.map((p) => [p.name, p.value])).toEqual([['A', 1], ['B', 9]]);
  });
});

describe('the Rates, Crews and Trades sheets', () => {
  it('read back what they wrote', () => {
    const rates = [
      { id: 'REBAR-0.25', type: 'rebar' as const, tonnesPerM3: 0.25 },
      { id: 'REBAR-SF-60', type: 'productivity' as const, basis: 'rebar' as const, manhoursPerUnit: 60, people: 12, shifts: 2, hoursPerShift: 9.17, rounding: 'ceil' as const, minDays: 1 },
      { id: 'CURE', type: 'days' as const, days: 3 },
    ];
    const crews = [{ id: 'CREW-A', trades: [{ trade: 'SF', size: 6 }, { trade: 'CP', size: 4 }], subcontractor: 'Concrete Sub', available: 2 }];
    const trades = [{ id: 'SF', name: 'Steel fixers', capacity: 20 }];
    const sheets = toRecipeSheets({ recipes: [], pools: [], parameters: [], limits: [], sequences: [], rates, crews, trades });
    const back = fromRecipeSheets(sheets, { recipes: [], pools: [], parameters: [] });
    expect(back.rates).toEqual(rates);
    expect(back.crews).toEqual(crews);
    expect(back.trades).toEqual(trades);
  });
});

describe('recipe folders in the workbook', () => {
  const inFolder = { ...WALL, folder: 'Walls' };
  const apply = (sheets: ReturnType<typeof toRecipeSheets>, recipes: Recipe[]) => fromRecipeSheets(sheets, { recipes, pools: SOURCE.pools, parameters: PARAMS, groupIds: [] }).recipes!.find((r) => r.id === 'EXT-WALL')!;
  it('writes the folder and reads it back', () => {
    const sheets = toRecipeSheets({ ...SOURCE, recipes: [inFolder] });
    expect(sheets.recipes!.every((r) => r.Folder === 'Walls')).toBe(true);
    expect(apply(sheets, [WALL]).folder).toBe('Walls');
  });
  it('an empty Folder cell takes the recipe out of its folder, and a sheet without the column leaves it', () => {
    const emptied = toRecipeSheets({ ...SOURCE, recipes: [WALL] });
    expect('folder' in apply(emptied, [inFolder])).toBe(false);
    const old = toRecipeSheets({ ...SOURCE, recipes: [WALL] });
    old.recipes = old.recipes!.map(({ Folder: _f, ...rest }) => rest);
    expect(apply(old, [inFolder]).folder).toBe('Walls');
  });
});
