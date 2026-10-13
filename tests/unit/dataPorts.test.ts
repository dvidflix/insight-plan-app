import { describe, expect, it } from 'vitest';
import { DATA_PORTS } from '../../src/state/dataPorts';
import { useLinkGroupsStore } from '../../src/state/linkGroupsStore';
import { useAppearanceStore } from '../../src/state/appearanceStore';
import { useTagsStore } from '../../src/state/tagsStore';

const port = (id: string) => DATA_PORTS.find((p) => p.id === id)!;

describe('Link Groups and Appearance Profiles in Import / Export', () => {
  it('export and import link groups by id: the same id is replaced, new ones added, none removed', () => {
    useLinkGroupsStore.getState().replaceAll([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] as never);
    const file = JSON.parse(JSON.stringify(port('linkgroups').collect()));
    expect(file).toHaveLength(2);
    const r = port('linkgroups').apply([{ id: 'b', name: 'B2' }, { id: 'c', name: 'C' }]);
    expect(r).toEqual({ added: 1, updated: 1 });
    expect(useLinkGroupsStore.getState().groups.map((g) => [g.id, g.name])).toEqual([['a', 'A'], ['b', 'B2'], ['c', 'C']]);
    expect(port('linkgroups').count()).toBe(3);
    expect(() => port('linkgroups').apply({})).toThrow(/no link groups/);
  });

  it('the same for appearance profiles', () => {
    useAppearanceStore.getState().replaceAll([{ id: 'p', name: 'P' }] as never);
    expect(port('appearance').apply([{ id: 'p', name: 'P2' }, { id: 'q', name: 'Q' }])).toEqual({ added: 1, updated: 1 });
    expect(useAppearanceStore.getState().profiles.map((p) => p.name)).toEqual(['P2', 'Q']);
  });

  it('and for tags, which Export all writes with the others', () => {
    useTagsStore.setState({ tags: [{ id: 't1', name: 'Pour', template: '{Task:Name}' }] as never });
    expect(port('tags').apply([{ id: 't1', name: 'Pour 2', template: 'x' }, { id: 't2', name: 'New', template: 'y' }])).toEqual({ added: 1, updated: 1 });
    expect(useTagsStore.getState().tags.map((t) => t.name)).toEqual(['Pour 2', 'New']);
    expect(DATA_PORTS.map((p) => p.id)).toContain('tags');
  });
});
