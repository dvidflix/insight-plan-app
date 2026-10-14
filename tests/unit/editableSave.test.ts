import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DbProgramme } from '../../src/db/api';
import type { ScheduleModel } from '../../src/schedule/types';
import { activity, model, rel } from './helpers';

/** An editable programme's edits are written to the project database a moment after they are made; undo and redo too. */

const apply = vi.fn(async (..._args: unknown[]) => ({ applied: 0, assigned: {} }));
let loaded: ScheduleModel;
vi.mock('../../src/db/api', async (orig) => ({
  ...(await orig<typeof import('../../src/db/api')>()),
  applyProgrammeOps: (...a: unknown[]) => apply(...a),
  fetchProgrammes: async () => [],
  programmeTablesUrl: () => 'url',
}));
vi.mock('../../src/schedule/importSchedule', () => ({ buildDbSchedule: async () => ({ ...loaded }) }));

const prog = (editable: boolean): DbProgramme => ({
  id: 7, name: 'Mine', sourceFile: null, sourceFormat: 'xer', sourcePath: null, projectIds: ['1'], kind: 'import', scenario: null, stem: null,
  hidden: false, activityCount: 2, editable, importedAt: '',
});

async function setup(editable: boolean) {
  const { useScheduleStore } = await import('../../src/state/scheduleStore');
  const store = await import('../../src/state/projectDbStore');
  loaded = model([activity('1'), activity('2')], [rel('1', '2')]);
  useScheduleStore.setState({ schedules: [], hiddenScheduleIds: new Set() });
  store.useProjectDbStore.setState({ db: { root: 'r', file: 'f' } });
  await store.loadProgramme(prog(editable));
  return { useScheduleStore, store };
}

beforeEach(() => {
  vi.useFakeTimers();
  apply.mockClear();
});
afterEach(() => vi.useRealTimers());

describe('saving a programme edited in place', () => {
  it('writes an edit after a moment, once, as the rows that changed', async () => {
    const { store } = await setup(true);
    const { setEdits } = await import('../../src/state/programmeEdits');
    setEdits('Mine', new Map([['1', { name: 'Renamed' }]]));
    setEdits('Mine', new Map([['2', { name: 'Also' }]]));
    expect(apply).not.toHaveBeenCalled();
    expect(store.useEditableSaveStore.getState().pending).toBe(true);
    await vi.advanceTimersByTimeAsync(900);
    expect(apply).toHaveBeenCalledTimes(1);
    const [root, id, ops] = apply.mock.calls[0] as [string, number, { table: string; set: Record<string, unknown> }[]];
    expect([root, id]).toEqual(['r', 7]);
    expect(ops.map((o) => [o.table, o.set.task_name])).toEqual([['TASK', 'Renamed'], ['TASK', 'Also']]);
    expect(store.useEditableSaveStore.getState()).toMatchObject({ pending: false, error: null });
  });

  it('writes an undo as the reverse change', async () => {
    await setup(true);
    const { setEdits } = await import('../../src/state/programmeEdits');
    const { commit, undo, clearHistory } = await import('../../src/state/programmeHistory');
    clearHistory();
    commit('Edit', () => setEdits('Mine', new Map([['1', { name: 'Renamed' }]])));
    await vi.advanceTimersByTimeAsync(900);
    undo();
    await vi.advanceTimersByTimeAsync(900);
    expect(apply).toHaveBeenCalledTimes(2);
    expect((apply.mock.calls[1][2] as { set: Record<string, unknown> }[])[0].set).toEqual({ task_name: '1' });
  });

  it('keeps the edit and reports it when the write fails, and writes it on the next try', async () => {
    const { store } = await setup(true);
    const { setEdits } = await import('../../src/state/programmeEdits');
    apply.mockRejectedValueOnce(new Error('disk full'));
    setEdits('Mine', new Map([['1', { name: 'Renamed' }]]));
    await vi.advanceTimersByTimeAsync(900);
    expect(store.useEditableSaveStore.getState().error).toMatch(/disk full/);
    await store.flushEditable();
    expect(apply).toHaveBeenCalledTimes(2);
    expect(store.useEditableSaveStore.getState().error).toBeNull();
  });

  it('writes nothing for a programme that is not edited in place; its edits stay on top of it', async () => {
    const { useScheduleStore } = await setup(false);
    const { setEdits } = await import('../../src/state/programmeEdits');
    const { useActivityOverridesStore } = await import('../../src/state/activityOverridesStore');
    useActivityOverridesStore.setState({ byProgramme: {}, links: {} });
    setEdits('Mine', new Map([['1', { name: 'Renamed' }]]));
    await vi.advanceTimersByTimeAsync(900);
    expect(apply).not.toHaveBeenCalled();
    expect(useActivityOverridesStore.getState().byProgramme.Mine?.['1']).toEqual({ name: 'Renamed' });
    expect(useScheduleStore.getState().schedules[0].activities[0].name).toBe('1');
  });
});
