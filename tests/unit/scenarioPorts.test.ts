import { beforeEach, describe, expect, it, vi } from 'vitest';

// The scenarios service (the project database behind the dev server) is replaced by a small in-memory one.
const saved = new Map<string, { headers: string[]; rows: string[][]; relations: unknown[]; crews: unknown[]; extras: unknown[]; flags: unknown[]; rules?: Record<string, unknown> }>();
const calls: string[] = [];

vi.mock('../../src/scenarios/api', () => ({
  fetchSequence: async (_root: string, stem: string, scenario: string | null) => {
    const s = saved.get(`${scenario}|${stem}`);
    // The pour table: every pour, Index from the scenario
    const pours = ['G1', 'G2', 'G3'];
    const index = new Map((s?.rows ?? []).map((r) => [r[1], r[0]]));
    return {
      headers: ['Index', 'GUID', 'Pour Type'],
      rows: pours.map((g) => [index.get(g) ?? '', g, 'WALL']),
      source: s ? 'scenario' : 'auto',
      relations: s?.relations ?? [], crews: s?.crews ?? [], extras: s?.extras ?? [], flags: s?.flags ?? [], rules: s?.rules ?? {},
      trades: [], phases: [], defaultCrews: [],
    };
  },
  saveScenario: async (req: { scenario: string; stem: string; headers: string[]; rows: string[][]; relations: unknown[]; crews: unknown[]; extras: unknown[]; flags: unknown[]; rules?: Record<string, unknown> }) => {
    calls.push(`${req.scenario}|${req.stem}`);
    saved.set(`${req.scenario}|${req.stem}`, { headers: req.headers, rows: req.rows, relations: req.relations, crews: req.crews, extras: req.extras, flags: req.flags, rules: req.rules });
    return { ok: true };
  },
}));
vi.mock('../../src/state/scenarioStore', async () => {
  const { create } = await import('zustand');
  const useScenarioStore = create(() => ({ project: null as unknown, scenario: null as string | null, loaded: null as { stem: string } | null, dirty: false }));
  return {
    useScenarioStore,
    isDirty: (s: { dirty: boolean }) => s.dirty,
    setExtras: () => undefined,
    setCrews: () => undefined,
    setRelations: () => undefined,
    setRules: () => undefined,
    refreshProject: async (root: string) => {
      const scenarios = new Map<string, { name: string; models: { stem: string; saved: number; generated: null; rules: number; joins: number }[] }>();
      for (const [key, v] of saved) {
        const [name, stem] = key.split('|');
        const entry = scenarios.get(name) ?? { name, models: [] };
        scenarios.set(name, entry);
        entry.models.push({ stem, saved: 1, generated: null, rules: Object.keys(v.rules ?? {}).length ? 1 : 0, joins: 0 });
      }
      useScenarioStore.setState({ project: { root, models: [], scenarios: [...scenarios.values()] } });
    },
  };
});
vi.mock('../../src/db/api', () => ({ writeExportFiles: async () => ({ folder: '', written: [] }) }));

const { DATA_PORTS, importPortFile } = await import('../../src/state/dataPorts');
const { useScenarioStore, refreshProject } = await import('../../src/state/scenarioStore');
const port = (id: string) => DATA_PORTS.find((p) => p.id === id)!;
const STEM = 'MODEL';

beforeEach(async () => {
  saved.clear();
  calls.length = 0;
  saved.set(`A|${STEM}`, { headers: ['Index', 'GUID'], rows: [['1', 'G1'], ['2', 'G2']], relations: [], crews: [], extras: [], flags: [], rules: { version: 1, settings: { sequenceFlow: true }, joins: [{ id: 'JOIN', main: 'G1', members: ['G2'] }] } });
  saved.set(`B|${STEM}`, { headers: ['Index', 'GUID'], rows: [['1', 'G3']], relations: [], crews: [], extras: [], flags: [], rules: {} });
  await refreshProject('root');
  useScenarioStore.setState({ scenario: null, loaded: null, dirty: false } as never);
});

describe('Scenarios and Rules in Import / Export', () => {
  it('count the saved scenarios, and the ones that hold rules', () => {
    expect(port('scenarios').count()).toBe(2);
    expect(port('rules').count()).toBe(1);
  });

  it('export a scenario with its order, joins and rules', async () => {
    const out = (await port('scenarios').collect()) as { scenario: string; sequence: { GUID: string; Index: number }[]; rules: { joins: unknown[] } }[];
    expect(out.map((s) => s.scenario)).toEqual(['A', 'B']);
    expect(out[0].sequence).toEqual([{ GUID: 'G1', Index: 1, Phase: '' }, { GUID: 'G2', Index: 2, Phase: '' }]);
    expect(out[0].rules.joins).toHaveLength(1);
  });

  it('export only the rules, without the joined objects', async () => {
    const out = (await port('rules').collect()) as { scenario: string; rules: { settings: Record<string, unknown>; joins: unknown[] } }[];
    expect(out).toHaveLength(1);
    expect(out[0].scenario).toBe('A');
    expect(out[0].rules.settings.sequenceFlow).toBe(true);
    expect(out[0].rules.joins).toEqual([]);
  });

  it('import adds a new scenario and replaces one of the same name', async () => {
    const file = [
      { scenario: 'A', stem: STEM, sequence: [{ GUID: 'G3', Index: 1 }], rules: { version: 1, settings: { sequenceFlow: false } } },
      { scenario: 'C', stem: STEM, sequence: [{ GUID: 'G1', Index: 1 }], rules: { version: 1, settings: { sequenceLeadDays: 2 } } },
    ];
    const r = await port('scenarios').apply(file);
    expect(r).toMatchObject({ added: 1, updated: 1 });
    expect(saved.get(`A|${STEM}`)!.rows).toEqual([['1', 'G3', '']]);
    // the replaced scenario keeps its own joins when the file brings none
    expect((saved.get(`A|${STEM}`)!.rules as { joins: unknown[] }).joins).toHaveLength(1);
    expect(port('scenarios').count()).toBe(3);
  });

  it('import rules into scenarios of the same name only, and keep their order and joins', async () => {
    const r = await port('rules').apply([
      { scenario: 'A', stem: STEM, rules: { version: 1, settings: { sequenceLeadDays: 5 }, joins: [{ id: 'X', main: 'Z', members: ['Y'] }] } },
      { scenario: 'NOPE', stem: STEM, rules: { version: 1, settings: {} } },
    ]);
    expect(r).toMatchObject({ added: 0, updated: 1 });
    expect(r.note).toContain('NOPE (not in the project)');
    const a = saved.get(`A|${STEM}`)!;
    expect(a.rows).toEqual([['1', 'G1', ''], ['2', 'G2', '']]); // the order is untouched
    const rules = a.rules as { settings: Record<string, unknown>; joins: { main: string }[] };
    expect(rules.settings.sequenceLeadDays).toBe(5);
    expect(rules.joins.map((j) => j.main)).toEqual(['G1']); // its own joins, not the file's
  });

  it('never overwrite the scenario that is open with unsaved changes', async () => {
    useScenarioStore.setState({ scenario: 'A', loaded: { stem: STEM }, dirty: true } as never);
    const r = await port('scenarios').apply([{ scenario: 'A', stem: STEM, sequence: [{ GUID: 'G3', Index: 1 }] }]);
    expect(r.updated).toBe(0);
    expect(r.note).toContain('open with unsaved changes');
    expect(calls).toEqual([]);
  });

  it('refuse a file that is not a list', async () => {
    await expect(Promise.resolve().then(() => port('scenarios').apply({ nope: 1 }))).rejects.toThrow('The file has no scenarios.');
  });

  it('take a Programme Rules file (XML) for the open scenario, and say so when none is open', async () => {
    const xml = new File(['<?xml version="1.0"?><prs/>'], 'x.rules.prs.xml', { type: 'application/xml' });
    await expect(importPortFile(xml)).rejects.toThrow('Open a scenario first');
    // asked for on another row, it is refused
    await expect(importPortFile(xml, 'scenarios')).rejects.toThrow('Programme Rules file');
  });
});
