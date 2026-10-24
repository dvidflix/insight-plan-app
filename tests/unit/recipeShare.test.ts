import { describe, expect, it } from 'vitest';
import { clashes, mergeRecipes, readShareFile, toShareFile } from '../../src/prs/recipeShare';
import type { Recipe } from '../../src/prs/recipes';

const recipe = (id: string, days = 1, name = id): Recipe => ({ id, name, group: '', tasks: [{ phase: 'A', name: 'A', days }, { phase: 'B', name: 'B', days: 2 }] });

describe('sharing recipes', () => {
  it('reads back what it wrote', () => {
    const text = JSON.stringify(toShareFile([recipe('One'), recipe('Two', 3)], new Date('2026-10-23T00:00:00Z')));
    const back = readShareFile(text);
    expect(back.map((r) => [r.id, r.tasks.map((t) => t.days)])).toEqual([['One', [1, 2]], ['Two', [3, 2]]]);
  });

  it('says plainly when a file is not a recipes file', () => {
    expect(() => readShareFile('not json')).toThrow(/not JSON/);
    expect(() => readShareFile('{"kind":"other","recipes":[]}')).toThrow(/not a recipes file/);
    expect(() => readShareFile('{"kind":"insight-plan.recipes","version":1,"recipes":[]}')).toThrow(/no recipes/);
  });

  it('adds new recipes, leaves equal ones, and replaces or copies the ones whose ID is taken', () => {
    const current = [recipe('One'), recipe('Two')];
    const incoming = [recipe('one', 1, 'One'), recipe('Two', 5), recipe('Three')];
    expect(clashes(current, incoming)).toEqual(['Two']);
    const replaced = mergeRecipes(current, incoming, true);
    expect(replaced).toMatchObject({ added: ['Three'], replaced: ['Two'], copied: [], same: ['one'] });
    expect(replaced.recipes.find((r) => r.id === 'Two')!.tasks[0].days).toBe(5);
    const copied = mergeRecipes(current, incoming, false);
    expect(copied.copied).toEqual(['Two (imported)']);
    expect(copied.recipes.map((r) => r.id)).toEqual(['One', 'Two', 'Two (imported)', 'Three']);
    expect(copied.recipes.find((r) => r.id === 'Two')!.tasks[0].days).toBe(1);
  });
});
