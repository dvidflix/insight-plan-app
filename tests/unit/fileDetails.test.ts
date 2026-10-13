import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInputDetailsStore } from '../../src/state/inputDetailsStore';
import { useAppPrefsStore } from '../../src/state/appPrefsStore';

const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 500, text: async () => JSON.stringify(body) }) as Response;

const flag = (on: boolean) => useAppPrefsStore.setState((s) => ({ experimental: { ...s.experimental, seatableFiles: on } }));
beforeEach(() => flag(true));

afterEach(() => {
  flag(false);
  vi.unstubAllGlobals();
  useInputDetailsStore.setState({ values: {}, pending: [], fields: [] });
});

describe('editing a file\'s details', () => {
  it('sets the field of every file at once, and clears pending once SeaTable has it', async () => {
    const fetchMock = vi.fn(async () => reply({ updated: 2, missing: [] }));
    vi.stubGlobal('fetch', fetchMock);
    useInputDetailsStore.setState({ values: { 'a.ifc': { Building: ['OLD'] } }, fields: ['Building'] });
    const r = await useInputDetailsStore.getState().saveDetails(['a.ifc', 'b.ifc'], 'Building', [' 1HDAB ', '', '1HDCD']);
    expect(r.ok).toBe(true);
    const s = useInputDetailsStore.getState();
    expect(s.values['a.ifc'].Building).toEqual(['1HDAB', '1HDCD']);
    expect(s.values['b.ifc'].Building).toEqual(['1HDAB', '1HDCD']);
    expect(s.pending).toEqual([]);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.updates).toEqual([{ name: 'a.ifc', field: 'Building', values: ['1HDAB', '1HDCD'] }, { name: 'b.ifc', field: 'Building', values: ['1HDAB', '1HDCD'] }]);
  });

  it('keeps an edit that SeaTable did not take, and a read does not overwrite it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: 'down' }, false)));
    useInputDetailsStore.setState({ values: {}, fields: ['Status'] });
    const r = await useInputDetailsStore.getState().saveDetails(['a.ifc'], 'Status', ['Shared']);
    expect(r.ok).toBe(false);
    expect(useInputDetailsStore.getState().pending).toEqual(['a.ifc\u0001Status']);
    vi.stubGlobal('fetch', vi.fn(async () => reply({ fields: [{ name: 'Status', type: 'single-select' }], files: [{ name: 'a.ifc', values: { Status: ['WIP'] } }] })));
    await useInputDetailsStore.getState().read();
    expect(useInputDetailsStore.getState().values['a.ifc'].Status).toEqual(['Shared']);
  });

  it('stays in the app when the experimental SeaTable file details are off', async () => {
    flag(false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await useInputDetailsStore.getState().saveDetails(['a.ifc'], 'Status', ['WIP']);
    expect(r.ok).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useInputDetailsStore.getState().values['a.ifc'].Status).toEqual(['WIP']);
  });

  it('removes the field when it is emptied', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ updated: 1, missing: [] })));
    useInputDetailsStore.setState({ values: { 'a.ifc': { Revision: ['P01'], Status: ['WIP'] } }, fields: ['Revision', 'Status'] });
    await useInputDetailsStore.getState().saveDetails(['a.ifc'], 'Revision', ['  ']);
    expect(useInputDetailsStore.getState().values['a.ifc']).toEqual({ Status: ['WIP'] });
  });
});
