import { beforeEach, describe, expect, it, vi } from 'vitest';

// The stores persist to localStorage; in Node there is none.
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });

const { useMarkersStore } = await import('../../src/state/markersStore');
const { useConstructionPlanesStore } = await import('../../src/state/constructionPlanesStore');

describe('duplicating decorators', () => {
  beforeEach(() => {
    useMarkersStore.setState({ markers: [] });
    useConstructionPlanesStore.setState({ planes: [] });
  });

  it('copies a marker right after the original, with a new id and no topic', () => {
    const { add, duplicate } = useMarkersStore.getState();
    const first = add({ name: 'U1', x: 1, y: 2, z: 3, topicId: 't1', note: '<b>n</b>' });
    add({ name: 'Other' });
    const copyId = duplicate(first)!;
    const list = useMarkersStore.getState().markers;
    expect(list.map((m) => m.name)).toEqual(['U1', 'U1 (copy)', 'Other']);
    expect(copyId).toBeTruthy();
    expect(copyId).not.toBe(first);
    expect(list[1]).toMatchObject({ id: copyId, x: 1, y: 2, z: 3, note: '<b>n</b>' });
    expect(list[1].topicId).toBeUndefined();
    expect(new Set(list.map((m) => m.id)).size).toBe(3);
  });

  it('copies a plane right after the original, with a new id', () => {
    const { add, duplicate } = useConstructionPlanesStore.getState();
    const first = add({ name: 'Plane', minX: 5, maxZ: 9, color: '#ff0000' });
    add({ name: 'Other' });
    const copyId = duplicate(first)!;
    const list = useConstructionPlanesStore.getState().planes;
    expect(list.map((p) => p.name)).toEqual(['Plane', 'Plane (copy)', 'Other']);
    expect(copyId).not.toBe(first);
    expect(list[1]).toMatchObject({ id: copyId, minX: 5, maxZ: 9, color: '#ff0000' });
    expect(new Set(list.map((p) => p.id)).size).toBe(3);
  });

  it('hides and shows all markers and all planes at once', () => {
    const markers = useMarkersStore.getState();
    markers.add({ name: 'A' });
    markers.add({ name: 'B', hidden: true });
    useMarkersStore.getState().setAllHidden(true);
    expect(useMarkersStore.getState().markers.every((m) => m.hidden)).toBe(true);
    useMarkersStore.getState().setAllHidden(false);
    expect(useMarkersStore.getState().markers.every((m) => !m.hidden)).toBe(true);

    const planes = useConstructionPlanesStore.getState();
    planes.add({ name: 'P' });
    planes.add({ name: 'Q', visible: false });
    useConstructionPlanesStore.getState().setAllVisible(false);
    expect(useConstructionPlanesStore.getState().planes.some((p) => p.visible)).toBe(false);
    useConstructionPlanesStore.getState().setAllVisible(true);
    expect(useConstructionPlanesStore.getState().planes.every((p) => p.visible)).toBe(true);
  });

  it('does nothing for an unknown id', () => {
    expect(useMarkersStore.getState().duplicate('nope')).toBeNull();
    expect(useConstructionPlanesStore.getState().duplicate('nope')).toBeNull();
  });
});
