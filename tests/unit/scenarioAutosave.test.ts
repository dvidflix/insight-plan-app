import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saves: { scenario: string; rules?: { joins?: unknown[] } }[] = [];
let failNext = false;

vi.mock('../../src/scenarios/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/scenarios/api')>();
  return {
    ...real,
    saveScenario: async (req: { scenario: string; rules?: { joins?: unknown[] } }) => {
      if (failNext) {
        failNext = false;
        throw new Error('disk full');
      }
      saves.push({ scenario: req.scenario, rules: req.rules });
      return { ok: true };
    },
    fetchProject: async (root: string) => ({ root, models: [], scenarios: [{ name: 'S1', models: [{ stem: 'M', saved: 1, generated: null, rules: 1, joins: 0 }] }] }),
  };
});

const store = await import('../../src/state/scenarioStore');
const { joinObjects } = await import('../../src/prs/joins');
const { NO_RULES } = await import('../../src/prs/rules');
const { useScenarioStore } = store;

const loaded = { root: 'r', scenario: 'S1', stem: 'M', headers: ['Index', 'GUID'], baseStep: new Map() };
const project = (saved: boolean) => ({ root: 'r', models: [], scenarios: saved ? [{ name: 'S1', models: [{ stem: 'M', saved: 1, generated: null }] }] : [] });
const NO_ROWS: never[] = [];
const open = (saved: boolean, extra: object = {}) =>
  useScenarioStore.setState({ project: project(saved) as never, scenario: 'S1', loaded: loaded as never, rows: NO_ROWS, savedRows: NO_ROWS, rules: NO_RULES, savedRules: NO_RULES, autoSave: true, busy: null, message: null, ...extra });

beforeEach(() => {
  vi.useFakeTimers();
  saves.length = 0;
  failNext = false;
});
afterEach(() => vi.useRealTimers());

describe('scenario autosave', () => {
  it('saves a saved scenario once, a moment after the last of several changes, joins included', async () => {
    open(true);
    store.setRules(joinObjects(NO_RULES, ['A', 'B']));
    store.setRules(joinObjects(useScenarioStore.getState().rules, ['C', 'D']));
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves).toHaveLength(0); // still waiting for the last change
    await vi.advanceTimersByTimeAsync(1000);
    expect(saves).toHaveLength(1);
    expect(saves[0].rules?.joins).toHaveLength(2);
    const s = useScenarioStore.getState();
    expect(s.savedRules).toBe(s.rules); // saved: no longer unsaved
    expect(s.message?.text).toContain('Autosaved "S1"');
  });

  it('leaves a scenario that was never saved for its first Save', async () => {
    open(false);
    store.setRules(joinObjects(NO_RULES, ['A', 'B']));
    await vi.advanceTimersByTimeAsync(5000);
    expect(saves).toHaveLength(0);
  });

  it('does nothing when switched off, or when nothing changed', async () => {
    open(true, { autoSave: false });
    store.setRules(joinObjects(NO_RULES, ['A', 'B']));
    await vi.advanceTimersByTimeAsync(5000);
    expect(saves).toHaveLength(0);
    open(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(saves).toHaveLength(0);
  });

  it('keeps a change made while saving for the next save', async () => {
    open(true);
    store.setRules(joinObjects(NO_RULES, ['A', 'B']));
    await vi.advanceTimersByTimeAsync(1500); // the save starts and finishes
    store.setRules(joinObjects(useScenarioStore.getState().rules, ['C', 'D']));
    await vi.advanceTimersByTimeAsync(1500);
    expect(saves).toHaveLength(2);
    expect(saves[1].rules?.joins).toHaveLength(2);
  });

  it('reports a failed save and keeps the change unsaved', async () => {
    open(true);
    failNext = true;
    store.setRules(joinObjects(NO_RULES, ['A', 'B']));
    await vi.advanceTimersByTimeAsync(1500);
    const s = useScenarioStore.getState();
    expect(s.message).toMatchObject({ kind: 'error' });
    expect(s.message?.text).toContain('disk full');
    expect(s.savedRules).toBe(NO_RULES);
    // the next change tries again
    store.setRules(joinObjects(s.rules, ['C', 'D']));
    await vi.advanceTimersByTimeAsync(1500);
    expect(saves).toHaveLength(1);
  });
});
