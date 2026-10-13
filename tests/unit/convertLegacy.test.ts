import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { convertLegacyRules, legacyCount } from '../../src/prs/convert';
import { PRESET_1HDAB_TOC } from '../../src/prs/presets';
import { validateRules } from '../../src/prs/match';
import { normalizeRules, type When } from '../../src/prs/rules';

/** The rules of the old preset as they were saved in scenarios: rows with conditions of their own. */
const wall = (external: boolean, doubleHeight: boolean): When => ({ family: 'wall', external: String(external), doubleHeight: String(doubleHeight) });
const days = (rebar: number, embedments: number, formwork: number, concrete: number) => ({ Rebar: rebar, Embedments: embedments, Formwork: formwork, Concrete: concrete });
const crew = (id: string, phase: string, trades: [string, number][], type?: string) => ({ id, phase, when: type ? { type } : {}, trades: trades.map(([trade, size]) => ({ trade, size })) });
const prod = (id: string, when: When, manhoursPerUnit: number) => ({ id, enabled: false, when, phase: 'Rebar', basis: 'rebar', manhoursPerUnit, crew: 12, shifts: 2, hoursPerShift: 9.17, rounding: 'ceil', minDays: 1 });

const preset = PRESET_1HDAB_TOC.content.rules;
const LEGACY = normalizeRules({
  version: 1,
  // what the chains need: their groups and chains, and the structure groups the rows below name
  groups: preset.groups.filter((g) => /^(C-|WALLS|SLABS|RAFTS|NOT-SCHEDULED|SMALL|STAIR-STEPS)/.test(g.id)),
  chains: preset.chains,
  trades: preset.trades,
  calendars: preset.calendars,
  durations: [
    { id: 'DUR-OTHER', when: {}, phases: days(5, 2, 4, 1) },
    { id: 'DUR-EXT-WALL', when: wall(true, false), phases: days(7, 2, 3, 1) },
    { id: 'DUR-EXT-WALL-DH', when: wall(true, true), phases: days(12, 4, 5, 1) },
    { id: 'DUR-INT-WALL', when: wall(false, false), phases: days(4, 6, 3, 1) },
    { id: 'DUR-INT-WALL-DH', when: wall(false, true), phases: days(9, 8, 3, 1) },
    { id: 'DUR-SLAB', when: { type: 'SLAB|MAIN_SLAB|PITS_&_RAFT|PIT' }, phases: days(18, 18, 2, 1) },
    { id: 'DUR-RAFT', when: { family: 'raft' }, phases: days(18, 18, 2, 1) },
    { id: 'DUR-SLAB-PHASES', when: { family: 'slab' }, phases: { Decking: 1, 'Under Slab': 1, 'EOP on Slab': 1, FWK: 1 } },
    { id: 'DUR-RAFT-PHASES', when: { family: 'raft' }, phases: { 'EOP on Slab': 1, FWK: 1 } },
    { id: 'DUR-PRECAST', when: { family: 'precast' }, phases: { Installation: 1, Stitching: 2 } },
    { id: 'DUR-HEAVY-PRECAST', when: { family: 'heavyPrecast' }, phases: { Propping: 1, Installation: 1, Stitching: 2, Curing: 28, 'Propping Removal': 1 } },
    { id: 'DUR-CURING', when: { group: 'C-SLAB' }, phases: { Curing: 7 } },
    { id: 'DUR-PEDESTAL-2', when: { group: 'C-PEDESTAL-2' }, phases: { 'Rebar, Formwork and Concrete': 12 } },
  ],
  rebar: [{ id: 'REBAR-DEFAULT', when: {}, tonnesPerM3: 0.25 }],
  crews: [
    crew('CREW-REBAR', 'Rebar', [['SF', 6]]),
    crew('CREW-REBAR-SLAB', 'Rebar', [['SF', 8]], 'SLAB'),
    crew('CREW-REBAR-MAIN-SLAB', 'Rebar', [['SF', 8]], 'MAIN_SLAB'),
    crew('CREW-REBAR-RAFT', 'Rebar', [['SF', 10]], 'RAFT'),
    crew('CREW-FORMWORK', 'Formwork', [['CP', 6]]),
    crew('CREW-DECKING', 'Decking', [['CP', 6]]),
    crew('CREW-UNDER-SLAB', 'Under Slab', [['GO', 4]]),
    crew('CREW-EOP-ON-SLAB', 'EOP on Slab', [['EM', 3]]),
    crew('CREW-FWK', 'FWK', [['CP', 4]]),
    crew('CREW-CONCRETE', 'Concrete', [['CG', 6]]),
    crew('CREW-RFC', 'Rebar, Formwork and Concrete', [['SF', 3], ['CP', 3], ['CG', 3]]),
    crew('CREW-PROPPING', 'Propping', [['PE', 4]]),
    crew('CREW-INSTALLATION', 'Installation', [['PE', 6]]),
    crew('CREW-STITCHING', 'Stitching', [['SF', 2], ['CG', 3]]),
    crew('CREW-CURING', 'Curing', []),
    crew('CREW-PROPPING-REMOVAL', 'Propping Removal', [['PE', 4]]),
    // a crew that names a group and a rate that names levels and a building (more conditions, higher priority)
    { id: 'CREW-SLOW-L1', phase: 'Concrete', when: { group: 'SLABS' }, trades: [{ trade: 'CG', size: 4 }] },
  ],
  productivity: [
    prod('PROD-REBAR-LOW-LEVELS', { family: 'wall', levelFrom: 'L0', levelTo: 'L2' }, 85),
    prod('PROD-REBAR-WALLS', { family: 'wall' }, 75),
    prod('PROD-REBAR-DEFAULT', {}, 75),
  ],
  calendarRules: [{ id: 'CURING', when: {}, phase: 'Curing', calendar: '7D' }],
});

describe('converting the old rules to the tables', () => {
  const done = convertLegacyRules(LEGACY);

  it('turns every old row into groups, rates, crews and assignments, and takes the old rows out', () => {
    expect(legacyCount(LEGACY)).toBe(13 + 1 + 17 + 3 + 1);
    expect(done.kept).toBe(0);
    expect(done.converted).toBe(legacyCount(LEGACY));
    expect(legacyCount(done.rules)).toBe(0);
    expect(done.rules.assignments.length).toBeGreaterThan(40);
    expect(done.rules.crewTemplates.map((c) => c.id)).toContain('SF-6');
    expect(done.rules.rates.filter((r) => r.type === 'productivity')).toHaveLength(2); // 85 and 75 mh/t (the two 75s share one rate)
  });

  it('gives a group its conditions once, however many rows used them', () => {
    const g = done.rules.groups.find((x) => x.name === 'wall · external · standard height');
    expect(g?.filters.map((f) => [f.field, f.op, f.value])).toEqual([['family', 'equals', 'wall'], ['external', 'equals', 'true'], ['doubleHeight', 'equals', 'false']]);
    const rows = done.rules.assignments.filter((a) => a.group === g!.id);
    expect(rows.map((a) => [a.phase, a.days])).toEqual([['Rebar', 7], ['Embedments', 2], ['Formwork', 3], ['Concrete', 1]]);
    expect(new Set(rows.map((a) => a.priority))).toEqual(new Set([30]));
  });

  it('keeps one row per group and phase, joins days, rate and crew of the same group, and the priority is how specific the old rule was', () => {
    const key = done.rules.assignments.map((a) => `${a.group}|${a.phase}|${a.enabled === false ? 'off' : 'on'}`);
    expect(new Set(key).size).toBe(key.length);
    const everyRebar = done.rules.assignments.find((a) => a.group === '' && a.phase === 'Rebar' && a.enabled !== false)!;
    expect(everyRebar).toMatchObject({ days: 5, crew: 'SF-6', priority: 0 });
    expect(done.rules.rates.find((r) => r.id === everyRebar.density)?.tonnesPerM3).toBe(0.25);
    const low = done.rules.assignments.find((a) => a.phase === 'Rebar' && a.enabled === false && a.priority === 20)!;
    expect(done.rules.groups.find((g) => g.id === low.group)?.filters.map((f) => [f.field, f.op, f.value])).toEqual([['family', 'equals', 'wall'], ['levelNumber', 'atLeast', '0'], ['levelNumber', 'atMost', '2']]);
  });

  it('is valid, and a row with a group and other conditions stays as it was', () => {
    expect(validateRules(done.rules, []).filter((p) => !/not defined/.test(p.text))).toEqual([]);
    const odd = normalizeRules({ version: 1, groups: [{ id: 'G', forEach: [], filters: [{ id: 'c1', field: 'family', op: 'equals', value: 'wall', conj: 'and' }, { id: 'c2', field: 'type', op: 'equals', value: 'A', conj: 'or' }] }], durations: [{ id: 'X', when: { group: 'G', family: 'wall' }, phases: { Rebar: 3 } }] });
    const r = convertLegacyRules(odd);
    expect(r.kept).toBe(1);
    expect(r.rules.durations).toHaveLength(1);
  });

  it('writes a group and other conditions as one group: the group own conditions, then the others', () => {
    const rules = normalizeRules({
      version: 1,
      groups: [{ id: 'SLABS', forEach: ['building', 'level'], filters: [{ id: 'c1', field: 'family', op: 'equals', value: 'slab', conj: 'and' }] }],
      productivity: [{ id: 'P', enabled: false, when: { group: 'SLABS', building: '1HDAB', level: 'L1' }, phase: 'Rebar', basis: 'rebar', manhoursPerUnit: 95, crew: 12, shifts: 2, hoursPerShift: 9.17, rounding: 'ceil', minDays: 1 }],
    });
    const r = convertLegacyRules(rules);
    expect(r.kept).toBe(0);
    const made = r.rules.groups.find((g) => g.id !== 'SLABS')!;
    expect(made.filters.map((f) => [f.field, f.op, f.value, f.conj])).toEqual([['family', 'equals', 'slab', 'and'], ['building', 'equals', '1HDAB', 'and'], ['level', 'equals', 'L1', 'and']]);
    expect(r.rules.assignments[0]).toMatchObject({ group: made.id, phase: 'Rebar', priority: 30, enabled: false });
  });

  it('writes the fixture the engine test compares (UPDATE_PRESET_FIXTURE=1)', () => {
    const file = path.join(__dirname, '../../scenario-engine/tests/fixtures/legacy_and_converted.json');
    const current = JSON.stringify({ legacy: LEGACY, converted: done.rules }, null, 1) + '\n';
    if (process.env.UPDATE_PRESET_FIXTURE) fs.writeFileSync(file, current);
    expect(fs.readFileSync(file, 'utf8')).toBe(current);
  });
});
