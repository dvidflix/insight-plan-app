import { describe, expect, it } from 'vitest';
import { closestName } from '../../src/utils/closestName';

describe('closestName', () => {
  it('finds the same name whatever its case and spacing', () => {
    expect(closestName('group  a', ['Group A', 'Group B'])).toBe('Group A');
  });

  it('finds a folder or set that moved to another folder', () => {
    expect(closestName('Old / Part 2', ['New / Part 1', 'New / Part 2'])).toBe('New / Part 2');
    expect(closestName('Part 2', ['Top / Part 2'])).toBe('Top / Part 2');
  });

  it('finds a small change of spelling', () => {
    expect(closestName('Item 12', ['Item 13', 'Something else'])).toBe('Item 13');
    expect(closestName('Groups', ['Group', 'Other'])).toBe('Group');
  });

  it('suggests nothing when no name is close', () => {
    expect(closestName('Alpha', ['Omega', 'Zulu'])).toBeNull();
    expect(closestName('', ['A'])).toBeNull();
    expect(closestName('A', [])).toBeNull();
  });
});
