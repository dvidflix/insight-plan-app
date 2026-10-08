import { describe, expect, it } from 'vitest';
import { queryMatcher, searchTokens } from '../../src/schedule/search';

describe('search terms', () => {
  it('splits on commas, semicolons, new lines and ||', () => {
    expect(searchTokens('Wall, slab;Stair\nbeam || Column ')).toEqual(['wall', 'slab', 'stair', 'beam', 'column']);
    expect(searchTokens('  ')).toEqual([]);
  });

  it('matches any term, ignoring case; an empty query matches all', () => {
    const hit = queryMatcher('wall, stair');
    expect(hit('Internal WALL 0732')).toBe(true);
    expect(hit('Main Slab')).toBe(false);
    expect(queryMatcher('')('anything')).toBe(true);
    expect(queryMatcher('x')(undefined)).toBe(false);
  });
});
