import { describe, expect, it } from 'vitest';
import { foldersOf, moveRecipe, renameFolder } from '../../src/prs/recipeFolders';
import type { Recipe } from '../../src/prs/recipes';

const r = (id: string, folder?: string): Recipe => ({ id, group: id, tasks: [], ...(folder ? { folder } : {}) });
const list = [r('A', 'Walls'), r('B'), r('C', 'Slabs'), r('D', 'Walls')];

describe('recipe folders', () => {
  it('lists the folders in the order they are first met', () => {
    expect(foldersOf(list)).toEqual(['Walls', 'Slabs']);
    expect(foldersOf([r('X'), r('Y', ' walls '), r('Z', 'Walls')])).toEqual(['walls']);
  });
  it('dropping on a folder changes the folder and nothing else, keeping the order', () => {
    const out = moveRecipe(list, 1, 'Slabs');
    expect(out.map((x) => x.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(out[1].folder).toBe('Slabs');
    expect(list[1].folder).toBeUndefined();
  });
  it('dropping on "no folder" takes the folder away, and an empty name does too', () => {
    expect('folder' in moveRecipe(list, 0, '')[0]).toBe(false);
    expect('folder' in moveRecipe(list, 2, '  ')[2]).toBe(false);
  });
  it('dropping on another recipe puts it before that recipe, in that recipe\'s folder', () => {
    expect(moveRecipe(list, 3, 'Slabs', 2).map((x) => `${x.id}:${x.folder ?? ''}`)).toEqual(['A:Walls', 'B:', 'D:Slabs', 'C:Slabs']);
    expect(moveRecipe(list, 0, '', 3).map((x) => x.id)).toEqual(['B', 'C', 'A', 'D']);
  });
  it('does not reorder when dropped where it already is', () => {
    expect(moveRecipe(list, 1, '', 1).map((x) => x.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(moveRecipe(list, 1, '', 2).map((x) => x.id)).toEqual(['A', 'B', 'C', 'D']);
  });
  it('renames a folder, and an empty new name takes its recipes out of it', () => {
    expect(renameFolder(list, 'walls', 'External').map((x) => x.folder)).toEqual(['External', undefined, 'Slabs', 'External']);
    expect(renameFolder(list, 'Walls', '').map((x) => x.folder)).toEqual([undefined, undefined, 'Slabs', undefined]);
  });
});
