import { beforeEach, describe, expect, it } from 'vitest';
import { useActivitySelectionStore } from '../../src/state/activitySelectionStore';

const order = ['a', 'b', 'c', 'd', 'e'];
const click = (id: string, mod: { ctrl?: boolean; shift?: boolean } = {}) => useActivitySelectionStore.getState().click(id, mod, order);
const picked = () => [...useActivitySelectionStore.getState().ids].sort();

describe('picking several activities', () => {
  beforeEach(() => useActivitySelectionStore.getState().clear());

  it('a plain click picks just that one', () => {
    click('b');
    click('d');
    expect(picked()).toEqual(['d']);
  });

  it('Ctrl+click adds and removes one', () => {
    click('a');
    click('c', { ctrl: true });
    expect(picked()).toEqual(['a', 'c']);
    click('a', { ctrl: true });
    expect(picked()).toEqual(['c']);
  });

  it('Shift+click picks the range from the last click, either way', () => {
    click('b');
    click('d', { shift: true });
    expect(picked()).toEqual(['b', 'c', 'd']);
    click('d');
    click('a', { shift: true });
    expect(picked()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('Ctrl+Shift adds the range to what is already picked', () => {
    click('a');
    click('c', { ctrl: true });
    click('e', { shift: true, ctrl: true });
    expect(picked()).toEqual(['a', 'c', 'd', 'e']);
  });

  it('Shift+click with nothing picked before is a plain click', () => {
    click('c', { shift: true });
    expect(picked()).toEqual(['c']);
  });
});
