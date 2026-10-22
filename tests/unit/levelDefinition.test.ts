import { describe, expect, it } from 'vitest';
import { levelDefinition, naturalLevelCompare, orderLevels, withLevelDefinition } from '../../src/prs/levelDefinition';

describe('the level definition of a scenario', () => {
  it('is the property Level and no order until it is set', () => {
    expect(levelDefinition(undefined)).toEqual({ property: 'Level', order: [] });
    expect(levelDefinition({})).toEqual({ property: 'Level', order: [] });
    expect(levelDefinition({ levelProperty: '  ', levelOrder: [] })).toEqual({ property: 'Level', order: [] });
  });
  it('reads a property and an order', () => {
    expect(levelDefinition({ levelProperty: 'Floor', levelOrder: ['Podium', ' L1 ', ''] })).toEqual({ property: 'Floor', order: ['Podium', 'L1'] });
  });
  it('leaves no key behind when the definition is the default, and keeps the other settings', () => {
    const settings = { minPourVolumeM3: 1, levelProperty: 'Floor', levelOrder: ['A'] };
    expect(withLevelDefinition(settings, { property: 'Level', order: [] })).toEqual({ minPourVolumeM3: 1 });
    expect(withLevelDefinition(settings, { property: 'Floor', order: ['B', 'A'] })).toEqual({ minPourVolumeM3: 1, levelProperty: 'Floor', levelOrder: ['B', 'A'] });
    expect(withLevelDefinition({}, { property: 'Level', order: ['Roof', 'L1'] })).toEqual({ levelOrder: ['Roof', 'L1'] });
  });
});

describe('the order of the levels', () => {
  it('is the first whole number, then the text, until the user orders them (as the generator reads them)', () => {
    expect(['L10', 'L2', 'Roof', 'Podium', 'L1'].sort(naturalLevelCompare)).toEqual(['Podium', 'Roof', 'L1', 'L2', 'L10']);
  });
  it('puts the levels the user ordered first, case and spaces aside, then the new ones', () => {
    expect(orderLevels(['L1', 'L2', 'Roof', 'Podium', 'L3'], ['roof', ' L2 ', 'Gone'])).toEqual(['Roof', 'L2', 'Podium', 'L1', 'L3']);
  });
  it('shows each level once', () => {
    expect(orderLevels(['A', 'B'], ['B', 'b', 'A'])).toEqual(['B', 'A']);
  });
});
