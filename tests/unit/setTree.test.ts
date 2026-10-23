import { describe, expect, it } from 'vitest';
import { folderPaths, isInFolder, walkFolder } from '../../src/viewer/setTree';
import { folderStepSets } from '../../src/prs/folderSteps';
import { inheritRecipes, inheritingSetNames } from '../../src/prs/recipeInheritance';
import type { SearchSet } from '../../src/viewer/searchSets';
import type { Recipe } from '../../src/prs/recipes';

const set = (name: string, group: string, kind: SearchSet['kind'] = 'search'): SearchSet => ({ id: name, name, group, kind, match: 'all', conditions: [] });
const recipe = (id: string, group: string, extra: Partial<Recipe> = {}): Recipe => ({ id, group, tasks: [{ phase: 'Work' } as never], ...extra });

const sets = [
  set('B1', 'Build / 2 B'), set('A1', 'Build / 1 A'), set('A2', 'Build / 1 A'), set('Top', 'Build'),
  set('Picked', 'Build / 1 A', 'selection'), set('Other', 'Else'),
];

describe('set folder tree', () => {
  it('knows what is inside a folder', () => {
    expect(isInFolder('Build / 1 A', 'Build')).toBe(true);
    expect(isInFolder('Builder', 'Build')).toBe(false);
    expect(isInFolder('build/1 a', 'Build / 1 A')).toBe(true);
  });
  it('lists the folders with those between, in tree order', () => {
    expect(folderPaths(sets)).toEqual(['Build', 'Build / 1 A', 'Build / 2 B', 'Else']);
  });
  it('walks a folder\'s own sets first, then the folders inside it in order', () => {
    expect(walkFolder(sets, 'Build', (s) => s.kind !== 'selection').map((s) => s.name)).toEqual(['Top', 'A1', 'A2', 'B1']);
    expect(folderStepSets(sets, 'Build / 1 A').map((s) => s.name)).toEqual(['A1', 'A2']);
  });
});

describe('recipes for a folder', () => {
  it('give every set inside without a recipe of its own a copy, from the nearest folder', () => {
    const out = inheritRecipes([recipe('all', 'Build'), recipe('a', 'Build / 1 A'), recipe('own', 'A2')], sets);
    const by = Object.fromEntries(out.map((r) => [r.group, r.id]));
    expect(by['A1']).toBe('a @ A1');
    expect(by['A2']).toBe('own');
    expect(by['B1']).toBe('all @ B1');
    expect(by['Top']).toBe('all @ Top');
    expect(out.some((r) => r.group === 'Build' || r.group === 'Build / 1 A')).toBe(false);
    expect(by['Picked']).toBeUndefined();
    expect(by['Other']).toBeUndefined();
  });
  it('leaves recipes alone when none is for a folder', () => {
    const list = [recipe('a', 'A1')];
    expect(inheritRecipes(list, sets)).toBe(list);
    expect(inheritingSetNames(list, sets)).toEqual([]);
  });
  it('names the sets that inherit, so they become groups', () => {
    expect(inheritingSetNames([recipe('b', 'Build / 2 B')], sets)).toEqual(['B1']);
  });
});

import { moveFolder, isShown, setsInside } from '../../src/viewer/setTree';

describe('moving folders', () => {
  it('renames or moves a folder with everything inside it', () => {
    const moved = moveFolder(sets, 'Build / 1 A', 'Build / 3 C');
    expect(moved.map((s) => `${s.name}:${s.group}`).sort()).toEqual(['A1:Build / 3 C', 'A2:Build / 3 C', 'Picked:Build / 3 C']);
    expect(moveFolder(sets, 'Build', 'Else / Build').map((s) => s.group).sort()).toEqual(['Else / Build', 'Else / Build / 1 A', 'Else / Build / 1 A', 'Else / Build / 1 A', 'Else / Build / 2 B']);
  });
  it('refuses to put a folder inside itself, and leaves unchanged sets out', () => {
    expect(moveFolder(sets, 'Build', 'Build / 1 A / Deeper')).toEqual([]);
    expect(moveFolder(sets, 'Build', 'Build')).toEqual([]);
    expect(setsInside(sets, 'Build / 2 B').map((s) => s.name)).toEqual(['B1']);
  });
  it('hides what is under a shut folder', () => {
    expect(isShown('Build / 1 A', new Set(['Build']))).toBe(false);
    expect(isShown('Build', new Set(['Build']))).toBe(true);
    expect(isShown('Build / 1 A', new Set(['Build / 1 A']))).toBe(true);
  });
});
