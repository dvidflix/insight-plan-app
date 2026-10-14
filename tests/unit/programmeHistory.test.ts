import { beforeEach, describe, expect, it } from 'vitest';
import { clearHistory, commit, redo, undo, useProgrammeHistory } from '../../src/state/programmeHistory';
import { useActivityOverridesStore } from '../../src/state/activityOverridesStore';
import { useScheduleStore } from '../../src/state/scheduleStore';
import { activity, model, rel } from './helpers';

const overrides = () => useActivityOverridesStore.getState();
const edit = (code: string, name: string) => overrides().set('P', new Map([[code, { name }]]));

beforeEach(() => {
  useActivityOverridesStore.setState({ byProgramme: {}, links: {} });
  useScheduleStore.setState({ schedules: [] });
  clearHistory();
});

describe('the programme edit history', () => {
  it('undoes and redoes an edit of the overrides', () => {
    commit('Edit A', () => edit('A', 'One'));
    expect(overrides().byProgramme.P?.A).toEqual({ name: 'One' });
    expect(undo()).toBe('Edit A');
    expect(overrides().byProgramme).toEqual({});
    expect(redo()).toBe('Edit A');
    expect(overrides().byProgramme.P?.A).toEqual({ name: 'One' });
  });

  it('undoes link edits and changes to a schedule made straight on the store', () => {
    const m = model([activity('A'), activity('B')], [rel('A', 'B')]);
    useScheduleStore.setState({ schedules: [m] });
    commit('Add links', () => useScheduleStore.getState().setRelationships(m.id, []));
    commit('Link', () => overrides().setLink('P', { op: 'add', pred: 'A', succ: 'B' }));
    expect(useScheduleStore.getState().schedules[0].relationships).toEqual([]);
    undo();
    expect(overrides().links).toEqual({});
    undo();
    expect(useScheduleStore.getState().schedules[0].relationships).toHaveLength(1);
  });

  it('records nothing when nothing changed, and a new edit clears the redo steps', () => {
    commit('Nothing', () => undefined);
    expect(useProgrammeHistory.getState().undos).toHaveLength(0);
    commit('One', () => edit('A', '1'));
    undo();
    expect(useProgrammeHistory.getState().redos).toHaveLength(1);
    commit('Two', () => edit('A', '2'));
    expect(useProgrammeHistory.getState().redos).toHaveLength(0);
  });

  it('makes edits with the same merge key one step', () => {
    commit('Edit', () => edit('A', 'a'), { merge: 'k' });
    commit('Edit', () => edit('A', 'ab'), { merge: 'k' });
    commit('Edit', () => edit('A', 'abc'), { merge: 'other' });
    expect(useProgrammeHistory.getState().undos).toHaveLength(2);
    undo();
    expect(overrides().byProgramme.P?.A).toEqual({ name: 'ab' });
    undo();
    expect(overrides().byProgramme).toEqual({});
  });

  it('leaves a programme loaded after the edit alone', () => {
    commit('Edit', () => edit('A', 'x'));
    const m = model([activity('A')], []);
    useScheduleStore.setState({ schedules: [m] });
    undo();
    expect(useScheduleStore.getState().schedules[0]).toBe(m);
  });
});
