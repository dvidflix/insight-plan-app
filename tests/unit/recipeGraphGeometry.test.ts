import { describe, expect, it } from 'vitest';
import { borderPoint, edgeChip, graphEdges } from '../../src/prs/recipeGraph';
import { compileRecipes, edgesFromFollows, followsText, type Recipe } from '../../src/prs/recipes';

describe('the box on an arrow', () => {
  const base = { sharePct: 100, lagHours: 0 };
  it('says the type and the lag, like ALICE: FS | 0', () => {
    expect(edgeChip(base)).toEqual(['FS', '0']);
    expect(edgeChip({ ...base, type: 'SS', lagHours: 16 })).toEqual(['SS', '16h']);
    expect(edgeChip({ ...base, type: 'FS', lagHours: -8 })).toEqual(['FS', '-8h']);
    expect(edgeChip({ ...base, type: 'FF' })).toEqual(['FF', '0']);
    expect(edgeChip({ ...base, sharePct: 80 })).toEqual(['SS', '80%']);
  });
});

describe('links with a type and a lag', () => {
  const recipe: Recipe = {
    id: 'SLAB', group: '', tasks: [{ phase: 'Rebar' }, { phase: 'Formwork' }, { phase: 'Concrete' }],
    edges: [{ from: 'Rebar', to: 'Formwork', type: 'SS', lagHours: 32 }, { from: 'Rebar', to: 'Formwork', type: 'FF' }, { from: 'Formwork', to: 'Concrete', type: 'FS', lagHours: -8 }],
  };

  it('can join the same two tasks twice, each with its own place in the recipe', () => {
    const between = graphEdges(recipe).filter((e) => e.to === 'Formwork');
    expect(between.map((e) => [e.type, e.lagHours, e.index])).toEqual([['SS', 32, 0], ['FF', 0, 1]]);
  });

  it('are written for the generator as "Rebar:SS+32, Rebar:FF+0" and read back', () => {
    expect(followsText(recipe, 'Formwork')).toBe('Rebar:SS+32, Rebar:FF+0');
    expect(followsText(recipe, 'Concrete')).toBe('Formwork:FS-8');
    expect(edgesFromFollows('Rebar:SS+32, Rebar:FF+0', 'Formwork')).toEqual([{ from: 'Rebar', to: 'Formwork', type: 'SS', lagHours: 32 }, { from: 'Rebar', to: 'Formwork', type: 'FF' }]);
    expect(edgesFromFollows('Decking@80, Under Slab', 'Rebar')).toEqual([{ from: 'Decking', to: 'Rebar', sharePct: 80 }, { from: 'Under Slab', to: 'Rebar' }]);
    expect(compileRecipes({ version: 1, recipes: [recipe] }).chains.find((c) => c.phase === 'Concrete')!.follows).toBe('Formwork:FS-8');
  });

  it('an FS with no lag is the plain link', () => {
    expect(followsText({ edges: [{ from: 'A', to: 'B', type: 'FS' }] }, 'B')).toBe('A');
  });
});

describe('where an arrow leaves a card', () => {
  const a = { x: 0, y: 0, w: 100, h: 50 };
  it('is on its border, toward the other card', () => {
    expect(borderPoint(a, { x: 300, y: 0, w: 100, h: 50 })).toEqual({ x: 100, y: 25 });
    expect(borderPoint(a, { x: 0, y: 200, w: 100, h: 50 })).toEqual({ x: 50, y: 50 });
    const diagonal = borderPoint(a, { x: 300, y: 300, w: 100, h: 50 });
    expect(diagonal.y).toBeCloseTo(50);
    expect(diagonal.x).toBeGreaterThan(50);
  });
});
