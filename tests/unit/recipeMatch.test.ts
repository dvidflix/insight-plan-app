import { describe, expect, it } from 'vitest';
import { suffixOf, templateFor } from '../../src/prs/recipeMatch';
import type { Recipe } from '../../src/prs/recipes';

const r = (id: string, tasks = [{ phase: 'Rebar' }]): Recipe => ({ id, group: id, tasks } as Recipe);
const book = [r('Main Slab'), r('External Wall'), r('Internal Wall'), r('Raft'), r('Empty', [])];

describe('the recipe a new one looks most like', () => {
  it('takes the exact name, ignoring a "(stage 2)" ending', () => {
    expect(templateFor('Main Slab', book)?.id).toBe('Main Slab');
    expect(templateFor('Main Slab (stage 2)', book)?.id).toBe('Main Slab');
  });
  it('takes the longest name that is inside it', () => {
    expect(templateFor('Double Height External Wall', book)?.id).toBe('External Wall');
    expect(templateFor('Double Height Internal Wall', book)?.id).toBe('Internal Wall');
  });
  it('falls back to the most words in common, and to nothing', () => {
    expect(templateFor('Wall Parapet Lower', book)?.id).toBeDefined();
    expect(templateFor('Stair', book)).toBeNull();
    expect(templateFor('', book)).toBeNull();
  });
  it('never takes a recipe with no tasks', () => {
    expect(templateFor('Empty', book)).toBeNull();
  });
});

describe('the end of an activity ID', () => {
  it('is the suffix, else the initials of the phase', () => {
    expect(suffixOf({ phase: 'Rebar', suffix: '-R' })).toBe('-R');
    expect(suffixOf({ phase: 'Under Slab' })).toBe('-US');
  });
});
