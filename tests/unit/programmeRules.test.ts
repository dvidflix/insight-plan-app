import { describe, expect, it } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProjectDb } from '../../vite-plugins/db/projectDb';
import { parseOverlay, serializeOverlay } from '../../src/prs/overlay';
import { factsOf, matchesFilters, groupCounts, groupInstances, groupMembership, matchesWhen, previewSequence, validateRules } from '../../src/prs/match';
import { extrasToTsv, parseDate, parseExtrasPaste, patchTags } from '../../src/prs/extrasTable';
import { ENGINE_RULES, PRESET_1HDAB_TOC, addPreset, countPreset, normalizePresets, presetId } from '../../src/prs/presets';
import { NO_RULES, mergeRules, mergeTrades, normalizeRules, totalRules, whenTerms, type ScenarioRules } from '../../src/prs/rules';
import type { PourRow } from '../../src/scenarios/pourOrder';

// The tests run in node, which has no DOMParser: a small stand-in over fast-xml-parser with the parts parseOverlay uses.
class FakeElement {
  children: FakeElement[] = [];
  constructor(public localName: string, private attrs: Record<string, string>) {}
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  hasAttribute(name: string) { return name in this.attrs; }
  getElementsByTagName(name: string): FakeElement[] {
    return this.children.flatMap((c) => [...(c.localName === name ? [c] : []), ...c.getElementsByTagName(name)]);
  }
}
function toElement(node: Record<string, unknown>): FakeElement | null {
  const tag = Object.keys(node).find((k) => k !== ':@' && !k.startsWith('#') && !k.startsWith('?'));
  if (!tag) return null;
  const raw = (node[':@'] ?? {}) as Record<string, string>;
  const el = new FakeElement(tag, Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.replace(/^@_/, ''), String(v)])));
  el.children = (node[tag] as Record<string, unknown>[]).map(toElement).filter((c): c is FakeElement => !!c);
  return el;
}
class FakeDocument {
  constructor(private root: FakeElement | null) {}
  get documentElement() { return this.root!; }
  getElementsByTagName(name: string): FakeElement[] {
    if (!this.root) return name === 'parsererror' ? [new FakeElement('parsererror', {})] : [];
    return [...(this.root.localName === name ? [this.root] : []), ...this.root.getElementsByTagName(name)];
  }
}
(globalThis as unknown as { DOMParser: unknown }).DOMParser = class {
  parseFromString(xml: string) {
    try {
      const nodes = new XMLParser({ ignoreAttributes: false, preserveOrder: true }).parse(xml) as Record<string, unknown>[];
      return new FakeDocument(nodes.map(toElement).find(Boolean) ?? null);
    } catch {
      return new FakeDocument(null);
    }
  }
};

const headers = ['Index', 'Pour ID', 'Level', 'Pour Type', 'Concrete Stage', 'Pour Volume m3', 'GUID', 'Building', 'Building Zone'];
const object = (guid: string, level: string, type: string, extra: Partial<Record<string, string>> = {}): PourRow => ({
  key: guid,
  step: null,
  cells: ['', guid, level, type, extra.stage ?? '1', extra.volume ?? '10', guid, extra.building ?? '1HDAB', extra.zone ?? ''],
});
const rows = [object('R0', 'L0', 'RAFT'), object('W1', 'L1', 'WALL'), object('S1', 'L1', 'SLAB'), object('W2', 'L2', 'WALL'), object('S2', 'L2', 'MAIN SLAB'), object('P2', 'L2', 'HEAVY_PRECAST', { stage: 'PRECAST' })];

const rules: ScenarioRules = normalizeRules({
  version: 1,
  settings: { openEndMaxDistanceM: 0.9, levelGate: false, excludedPourTypes: ['BOSS', 'PLINTH'] },
  groups: [
    { id: 'WALLS', forEach: ['building', 'level'], select: { family: 'wall' } },
    { id: 'SLABS', forEach: ['building', 'level'], select: { family: 'slab' } },
    { id: 'RAFTS', forEach: ['building'], select: { family: 'raft' } },
    { id: 'STRUCT', forEach: ['building'], select: {}, include: ['WALLS', 'SLABS'] },
  ],
  durations: [{ id: 'D1', when: { family: 'wall', levelFrom: 'L0', levelTo: 'L2' }, phases: { Rebar: 9, Decking: 2 } }],
  productivity: [{ id: 'P1', when: { group: 'SLABS' }, phase: 'Rebar', basis: 'rebar', manhoursPerUnit: 85, crew: 8, shifts: 2, hoursPerShift: 9.17, rounding: 'ceil', minDays: 1 }],
  rebar: [{ id: 'B1', when: { family: 'raft' }, tonnesPerM3: 0.4 }],
  crews: [{ id: 'C1', when: { group: 'SLABS', building: '1HDAB' }, phase: 'Rebar', trades: [{ trade: 'SF', size: 12 }] }],
  trades: [{ id: 'SF', name: 'Steel fixers', capacity: 30 }, { id: 'XX', enabled: false, name: 'Left out', capacity: 0 }],
  calendars: [
    { id: '6D', name: 'Six day week', workDays: [0, 1, 2, 3, 4, 5], start: '07:30', hoursPerDay: 9.5, default: true },
    { id: '7D', name: 'Every day', workDays: [0, 1, 2, 3, 4, 5, 6], start: '09:00', hoursPerDay: 8 },
  ],
  calendarRules: [{ id: 'CURING', note: 'weekends too', when: { group: 'SLABS', building: '1HDAB' }, phase: 'Curing', calendar: '7D' }],
  levelTasks: [{ id: 'WALLS', name: 'Walls', group: 'WALLS' }, { id: 'SLABS', name: 'Slabs', group: 'SLABS' }],
  sequences: [{ id: 'UP', name: 'Build up', type: 'FS', lagHours: 8, steps: [{ group: 'RAFTS' }, { group: 'WALLS', perLevel: true }, { group: 'SLABS', perLevel: true }] }],
  contacts: [{ id: 'K1', name: 'Slabs on what is below', subject: { family: 'slab' }, contact: 'below', position: 'any', with: { family: 'wall|column' }, predEnd: 'final', succEnd: 'start', direction: 'subjectIsSuccessor', type: 'FS', lagHours: 0, maxLevelGap: 1, ignoreStage2: true, replaceBuiltIn: ['slabSupport', 'levelGate'] }],
  levelLinks: [{ id: 'LL', activities: 'extras', tasks: ['WALLS', 'SLABS'], type: 'FF', direction: 'toTask' }, { id: 'LO', activities: 'open', select: 'select:{family=column}', tasks: ['WALLS'], type: 'FF', direction: 'toTask' }],
  extraTags: { 'HLP-1': { building: '1HDAB', level: 'L2' } },
});

describe('the rules', () => {
  it('start empty and stay the one empty object', () => {
    expect(normalizeRules(undefined)).toBe(NO_RULES);
    expect(normalizeRules({ version: 1, groups: [] })).toBe(NO_RULES);
    expect(totalRules(NO_RULES)).toBe(0);
    expect(totalRules(rules)).toBe(3 + 1 + 1 + 1 + 1 + 4 + 2 + 1 + 1 + 2 + 2 + 2 + 1);
  });

  it('count a level range as one condition', () => {
    expect(whenTerms({ family: 'wall', levelFrom: 'L0', levelTo: 'L2' })).toBe(2);
    expect(whenTerms({})).toBe(0);
    expect(whenTerms({ group: 'A', family: 'slab', building: 'B' })).toBe(3);
  });

  it('merge by id and setting', () => {
    const merged = mergeRules(rules, normalizeRules({ version: 1, settings: { openEndMaxDistanceM: 14 }, rebar: [{ id: 'b1', when: {}, tonnesPerM3: 0.3 }, { id: 'B2', when: {}, tonnesPerM3: 0.2 }] }));
    expect(merged.settings.openEndMaxDistanceM).toBe(14);
    expect(merged.settings.levelGate).toBe(false);
    expect(merged.rebar.map((r) => [r.id, r.tonnesPerM3])).toEqual([['b1', 0.3], ['B2', 0.2]]);
    expect(merged.groups).toHaveLength(4);
  });

  it('merge the trades and calendars by id, and list the trades a crew can name', () => {
    const merged = mergeRules(rules, normalizeRules({ version: 1, trades: [{ id: 'sf', name: 'Fixers', capacity: 5 }, { id: 'NEW', name: 'New', capacity: 1 }], calendars: [{ id: '6d', name: 'Replaced', workDays: [0], start: '08:00', hoursPerDay: 8 }] }));
    expect(merged.trades.map((t) => [t.id, t.name])).toEqual([['XX', 'Left out'], ['sf', 'Fixers'], ['NEW', 'New']]);
    expect(merged.calendars.map((c) => c.name)).toEqual(['Every day', 'Replaced']);
    const engine = [{ code: 'SF', name: 'Steel fixers', capacity: 24 }, { code: 'CP', name: 'Carpenters', capacity: 24 }, { code: 'XX', name: 'Gone soon', capacity: 1 }];
    expect(mergeTrades(engine, rules.trades)).toEqual([{ code: 'SF', name: 'Steel fixers', capacity: 30 }, { code: 'CP', name: 'Carpenters', capacity: 24 }, { code: 'XX', name: 'Gone soon', capacity: 1 }].slice(0, 2));
  });
});

describe('what the rules fit', () => {
  const facts = factsOf(headers, rows);
  const membership = groupMembership(rules.groups, facts);

  it('reads the object table the way the generator reads a pour', () => {
    expect(facts.map((f) => f.family)).toEqual(['raft', 'wall', 'slab', 'wall', 'slab', 'heavyPrecast']);
    expect(facts[4].type).toBe('MAIN_SLAB');
    expect(facts[3].levelNumber).toBe(2);
  });

  it('knows each object\'s groups, including groups made of groups', () => {
    expect([...membership.get('W1')!].sort()).toEqual(['STRUCT', 'WALLS']);
    expect([...membership.get('R0')!]).toEqual(['RAFTS']);
    expect([...membership.get('P2')!]).toEqual([]);
  });

  it('counts the objects and instances of a group', () => {
    const counts = groupCounts(rules, facts);
    expect(counts.get('WALLS')).toEqual({ pours: 2, instances: 2 });
    expect(counts.get('STRUCT')).toEqual({ pours: 4, instances: 1 });
    expect(groupInstances(rules.groups[1], facts, membership).map((x) => `${x.label}:${x.pours}`)).toEqual(['1HDAB · L1:1', '1HDAB · L2:1']);
  });

  it('tests a when', () => {
    const hit = (when: Parameters<typeof matchesWhen>[0]) => facts.filter((f) => matchesWhen(when, f, membership)).map((f) => f.key);
    expect(hit({ family: 'wall', levelFrom: 'L2' })).toEqual(['W2']);
    expect(hit({ group: 'SLABS' })).toEqual(['S1', 'S2']);
    expect(hit({ type: 'WALL|RAFT' })).toEqual(['R0', 'W1', 'W2']);
    expect(hit({ stage: 'precast' })).toEqual(['P2']);
    expect(hit({})).toHaveLength(6);
  });

  it('shows the order a sequence will put the steps in', () => {
    expect(previewSequence(rules, 'UP', facts, membership)).toEqual(['RAFTS', 'WALLS L1', 'SLABS L1', 'WALLS L2', 'SLABS L2']);
  });
});

describe('problems', () => {
  it('names what a rule uses that is not there', () => {
    const bad = normalizeRules({
      version: 1,
      durations: [{ id: 'D', when: { group: 'GONE' }, phases: { Rebar: 3 } }],
      levelTasks: [{ id: 'T', name: 'T', group: 'GONE' }],
      sequences: [{ id: 'S', steps: [{ group: 'GONE' }] }],
      levelLinks: [{ id: 'L', activities: 'extras', tasks: ['NOPE'] }],
      groups: [{ id: 'G', forEach: [], select: {} }],
    });
    const text = validateRules(bad).map((p) => p.text).join('|');
    expect(text).toContain('group "GONE", which does not exist');
    expect(text).toContain('needs at least two steps');
    expect(text).toContain('level task "NOPE" does not exist');
    expect(text).toContain('no conditions');
    expect(validateRules(rules, ['HLP-1'])).toEqual([]);
  });
});

describe('the rules file', () => {
  it('writes and reads every section back', () => {
    const xml = serializeOverlay(
      {
        extras: [{ TaskID: 'HLP-1', Name: 'Podium & "ready"', DurationDays: 0, BaselineStart: '', BaselineFinish: '2029-06-29' }],
        links: [{ ActivityID1: 'HLP-1', ActivityID2: 'select:{group=SLABS; last}', Relation: 'FS', Lag: 8 }],
        crews: [{ Phase: 'Rebar', PourType: 'SLAB', Trade: 'SF', Crew: '8' }],
        rules,
      },
      'S1 rules',
    );
    expect(xml).toContain('<ruleGroup id="WALLS" forEach="building level">');
    expect(xml).toContain('<activity id="HLP-1" name="Podium &amp; &quot;ready&quot;" duration="0" baselineFinish="2029-06-29" building="1HDAB" level="L2"/>');
    const back = parseOverlay(xml);
    expect(back.extras[0].Name).toBe('Podium & "ready"');
    expect(back.links[0].ActivityID2).toBe('select:{group=SLABS; last}');
    expect(back.crews[0].Trade).toBe('SF');
    expect(back.rules).toEqual(rules);
  });

  it('still reads a file written before there were programme rules', () => {
    const xml = serializeOverlay({ extras: [], links: [{ ActivityID1: 'A', ActivityID2: 'B', Relation: 'SS', Lag: 0 }], crews: [] }, 'old');
    const back = parseOverlay(xml);
    expect(back.links).toHaveLength(1);
    expect(back.rules).toBe(NO_RULES);
  });

  it('refuses a file with nothing in it', () => {
    expect(() => parseOverlay('<prs xmlns="x" version="1.0"><info/></prs>')).toThrow(/no extra activities/);
    expect(() => parseOverlay('<other/>')).toThrow(/Programme Rules file/);
  });
});

describe('a scenario keeps its rules', () => {
  it('saves and reads them back, and clears them when saved empty', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ip-rules-'));
    const db = new ProjectDb(dir, path.join(dir, 'insight-plan.db'));
    try {
      db.writeScenario('S1', 'Model', { sequence: [], relations: [], crews: [], rules: rules as unknown as Record<string, unknown> });
      expect(normalizeRules(db.readScenario('S1', 'Model')!.rules)).toEqual(rules);
      db.writeScenario('S1', 'Model', { sequence: [], relations: [], crews: [] });
      expect(db.readScenario('S1', 'Model')!.rules).toBeUndefined();
    } finally {
      db.close?.();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the engine defaults file', () => {
  const file = path.join(__dirname, '../../docs/programme-rules/cwa-engine-defaults.prs.xml');
  const parsed = parseOverlay(fs.readFileSync(file, 'utf8')).rules!;

  it('imports, with every setting of the engine at its config.py value', () => {
    expect(parsed.settings).toMatchObject({ levelGate: true, levelGateMaxDistanceM: 0.05, openEndMaxDistanceM: 0.3, slabCuringGatesSuccessors: false, sideOverlapThreshold: 0.5 });
    expect(parsed.settings).not.toHaveProperty('minPourVolumeM3'); // groups leave objects out now
    expect(parsed.groups.filter((g) => g.treatAs === 'exclude').map((g) => g.id)).toEqual(['NOT-SCHEDULED', 'SMALL']);
    expect(parsed.groups.map((g) => g.id)).toEqual(['WALLS', 'SLABS', 'RAFTS', 'NOT-SCHEDULED', 'SMALL', 'STAIR-STEPS']);
  });

  it('gives every object the crew and rebar rate the engine gives it, and no productivity or extra links', () => {
    expect(parsed.rebar).toHaveLength(1);
    expect(parsed.crews.find((c) => c.phase === 'Rebar' && c.when.type === 'RAFT')!.trades).toEqual([{ trade: 'SF', size: 10 }]);
    expect(parsed.crews.find((c) => c.phase === 'Curing')!.trades).toEqual([]);
    expect(parsed.productivity).toHaveLength(0);
    expect(parsed.levelTasks.length + parsed.sequences.length + parsed.contacts.length + parsed.levelLinks.length).toBe(0);
  });

  it('sets the duration table of config.py by kind of wall', () => {
    const days = (id: string) => parsed.durations.find((d) => d.id === id)!.phases;
    expect(days('DUR-EXT-WALL-DH')).toEqual({ Rebar: 12, Embedments: 4, Formwork: 5, Concrete: 1 });
    expect(days('DUR-INT-WALL')).toEqual({ Rebar: 4, Embedments: 6, Formwork: 3, Concrete: 1 });
    expect(days('DUR-SLAB')).toEqual({ Rebar: 18, Embedments: 18, Formwork: 2, Concrete: 1 });
    expect(parsed.durations.find((d) => d.id === 'DUR-SLAB')!.when.type).toBe('SLAB|MAIN_SLAB|PITS_&_RAFT|PIT');
  });
});

describe('the 1HDAB_TOC preset', () => {
  const strip = <T extends { note?: string }>(rows: T[]) => rows.map(({ note: _note, ...r }) => r);
  const xml = parseOverlay(fs.readFileSync(path.join(__dirname, '../../docs/programme-rules/cwa-engine-defaults.prs.xml'), 'utf8')).rules!;

  it('holds the engine defaults file exactly: settings, durations and crews', () => {
    const { minPourVolumeM3: _x, excludedPourTypes: _y, stairStepMaxVolumeM3: _z, ...engineSettings } = ENGINE_RULES.settings;
    expect(engineSettings).toEqual(xml.settings);
    // in the preset the smallest object, the excluded types and the stair step volume are groups instead
    // (and the preset makes the scenario's steps overlap, which the engine's own logic does not)
    expect(PRESET_1HDAB_TOC.content.rules.settings).toEqual({ ...xml.settings, sequenceFlow: true, sequenceLeadDays: 1 });
    // the durations, crews and rebar rate are in the relational form (groups, rates, crews, assignments): the file's rows are the same numbers
    const r = PRESET_1HDAB_TOC.content.rules;
    const days = (group: string, phase: string) => r.assignments.find((a) => a.group === group && a.phase === phase)?.days;
    for (const row of xml.durations) {
      const group = ({ 'DUR-OTHER': '', 'DUR-EXT-WALL': 'T-WALL-EXT', 'DUR-EXT-WALL-DH': 'T-WALL-EXT-DH', 'DUR-INT-WALL': 'T-WALL-INT', 'DUR-INT-WALL-DH': 'T-WALL-INT-DH', 'DUR-SLAB': 'T-SLAB-TABLE', 'DUR-RAFT': 'T-RAFT', 'DUR-SLAB-PHASES': 'T-SLAB', 'DUR-RAFT-PHASES': 'T-RAFT', 'DUR-PRECAST': 'T-PRECAST', 'DUR-HEAVY-PRECAST': 'T-HEAVY-PRECAST' } as Record<string, string>)[row.id];
      expect(group, row.id).not.toBeUndefined();
      for (const [phase, d] of Object.entries(row.phases)) expect(days(group, phase), `${row.id} ${phase}`).toBe(d);
    }
    expect(r.durations).toEqual([]);
    expect(r.assignments.find((a) => a.group === '' && a.phase === 'Rebar' && a.density === 'REBAR-0.25')).toBeTruthy();
    expect(r.rates.find((x) => x.id === 'REBAR-0.25')?.tonnesPerM3).toBe(0.25);
    const crewOfAssignment = (group: string, phase: string) => r.crewTemplates.find((c) => c.id === r.assignments.find((a) => a.group === group && a.phase === phase && a.crew)?.crew)?.trades.map((t) => `${t.trade} ${t.size}`).join(', ');
    expect(crewOfAssignment('T-TYPE-RAFT', 'Rebar')).toBe('SF 10');
    expect(crewOfAssignment('', 'Rebar, Formwork and Concrete')).toBe('SF 3, CP 3, CG 3');
  });

  it('adds the structure: groups, level tasks, the build-up sequence, level links, and the computed rebar durations switched off', () => {
    const r = PRESET_1HDAB_TOC.content.rules;
    expect(r.groups.map((g) => g.id).slice(0, 6)).toEqual(['WALLS', 'SLABS', 'RAFTS', 'NOT-SCHEDULED', 'SMALL', 'STAIR-STEPS']);
    const treat = (id: string) => r.groups.find((g) => g.id === id)!.treatAs;
    expect([treat('NOT-SCHEDULED'), treat('SMALL'), treat('STAIR-STEPS')]).toEqual(['exclude', 'exclude', 'stairStep']);
    expect(r.groups.find((g) => g.id === 'STAIR-STEPS')!.filters.map((c) => [c.field, c.op, c.value])).toEqual([['type', 'equals', 'STAIR'], ['volume', 'lessThan', '0.09']]);
    expect(r.groups.find((g) => g.id === 'SMALL')!.filters.map((c) => [c.field, c.op, c.value])).toEqual([['volume', 'lessThan', '0.25'], ['type', 'notEquals', 'STAIR']]);
    expect(r.levelTasks.map((t) => t.id)).toEqual(['WALLS', 'SLABS']);
    expect(r.sequences[0].steps.map((s) => s.group)).toEqual(['RAFTS', 'WALLS', 'SLABS']);
    expect(r.sequences[0].enabled).toBe(false); // it would reshape the programme
    expect(r.levelLinks[0].tasks).toEqual(['WALLS', 'SLABS']);
    const computed = r.assignments.filter((a) => r.rates.find((x) => x.id === a.rate)?.type === 'productivity');
    expect(computed.length).toBeGreaterThan(0);
    expect(computed.every((a) => a.enabled === false)).toBe(true);
    expect(validateRules(r, [])).toEqual([]);
  });

  it('is loaded or added into a scenario, and survives being saved', () => {
    const mine = { rules: normalizeRules({ version: 1, settings: { openEndMaxDistanceM: 0.9 }, durations: [{ id: 'MINE', when: {}, phases: { Rebar: 3 } }] }), extras: [], relations: [], crews: [] };
    const added = addPreset(mine, PRESET_1HDAB_TOC.content);
    expect(added.rules.durations.map((d) => d.id)).toContain('MINE');
    expect(added.rules.assignments.map((a) => a.id)).toContain('T-SLAB-TABLE|REBAR');
    expect(added.rules.settings.openEndMaxDistanceM).toBe(0.3); // the preset's value replaces it
    const saved = normalizePresets(JSON.parse(JSON.stringify([PRESET_1HDAB_TOC])));
    expect(saved[0].content.rules).toEqual(PRESET_1HDAB_TOC.content.rules);
    expect(countPreset(saved[0].content)).toBe(countPreset(PRESET_1HDAB_TOC.content));
    expect(presetId('1HDAB TOC', [])).toBe('1HDAB_TOC');
    // nothing ships with the app any more: a saved copy, old or not, is the project's own and is kept as it is
    const old = { ...JSON.parse(JSON.stringify(PRESET_1HDAB_TOC)), revision: undefined, content: { ...PRESET_1HDAB_TOC.content, rules: { version: 1, groups: [{ id: 'OLD', forEach: [], select: {} }] } } };
    expect(normalizePresets([old])[0].content.rules.groups.map((g) => g.id)).toEqual(['OLD']);
    expect(normalizePresets([{ ...old, userEdited: true }])[0].content.rules.groups.map((g) => g.id)).toEqual(['OLD']);
    expect(presetId('1HDAB_TOC', ['1HDAB_TOC'])).toBe('1HDAB_TOC-2');
  });
});

describe('a productivity row that takes its quantity from the model', () => {
  const row = { id: 'PROD-KG', when: { family: 'slab' }, phase: 'Rebar', basis: 'property', pset: 'Qto_SlabBaseQuantities', property: 'RebarWeightKg', factor: 0.001, fallback: 'concrete', manhoursPerUnit: 85, crew: 8, shifts: 2, hoursPerShift: 9.17, rounding: 'ceil', minDays: 1 };
  const withRow = normalizeRules({ version: 1, productivity: [row] });

  it('is written to the rules file and read back with where its quantity comes from', () => {
    const xml = serializeOverlay({ extras: [], links: [], crews: [], rules: withRow }, 'T');
    expect(xml).toContain('basis="property"');
    const back = parseOverlay(xml).rules!.productivity[0];
    expect(back).toMatchObject({ basis: 'property', pset: 'Qto_SlabBaseQuantities', property: 'RebarWeightKg', factor: 0.001, fallback: 'concrete' });
  });

  it('leaves the property fields out of a row that works from the rebar tonnes', () => {
    const plain = normalizeRules({ version: 1, productivity: [{ ...row, basis: 'rebar' }] });
    expect(serializeOverlay({ extras: [], links: [], crews: [], rules: plain }, 'T')).not.toContain('property=');
  });

  it('is a problem when it names no property', () => {
    expect(validateRules(normalizeRules({ version: 1, productivity: [{ ...row, property: '' }] }))).toEqual([{ section: 'productivity', id: 'PROD-KG', text: expect.stringContaining('names none') }]);
    expect(validateRules(withRow)).toEqual([]);
  });
});


describe('groups that leave objects out of the schedule', () => {
  const rules = normalizeRules({
    version: 1,
    groups: [
      { id: 'NOT-SCHEDULED', treatAs: 'exclude', forEach: [], select: { type: 'BOSS|SCREED' } },
      { id: 'SMALL', treatAs: 'exclude', forEach: [], select: { volumeBelow: '0.25', typeNot: 'STAIR' } },
    ],
  });
  const small = object('A', 'L1', 'SLAB', { volume: '0.1' });
  const big = object('B', 'L1', 'SLAB', { volume: '0.25' });
  const boss = object('C', 'L1', 'BOSS', { volume: '5' });
  const stair = object('D', 'L1', 'STAIR', { volume: '0.1' });
  const facts = factsOf(headers, [small, big, boss, stair]);

  it('a group can be made of a volume limit, of types, and of a type it is not', () => {
    const membership = groupMembership(rules.groups, facts);
    expect([...(membership.get('A') ?? [])]).toEqual(['SMALL']);
    expect([...(membership.get('B') ?? [])]).toEqual([]); // 0.25 is not under 0.25
    expect([...(membership.get('C') ?? [])]).toEqual(['NOT-SCHEDULED']);
    expect([...(membership.get('D') ?? [])]).toEqual([]); // a small stair is not "small"
    expect(whenTerms({ volumeBelow: '0.25', typeNot: 'STAIR' })).toBe(2);
  });

  it('keeps what the group is treated as in the rules file, and is checked', () => {
    const back = parseOverlay(serializeOverlay({ extras: [], links: [], crews: [], rules }, 'T')).rules!;
    expect(back.groups.map((g) => g.treatAs)).toEqual(['exclude', 'exclude']);
    expect(back.groups[1].filters.map((c) => [c.field, c.op, c.value, c.conj])).toEqual([['type', 'notEquals', 'STAIR', 'and'], ['volume', 'lessThan', '0.25', 'and']]);
    expect(validateRules(rules)).toEqual([]);
  });
});

describe('the high-level programme extras of 1HDAB_TOC', () => {
  const { extras, rules } = PRESET_1HDAB_TOC.content;

  it('has the raft and the walls and slabs of levels 1 to 8, with the baseline dates of the high-level programme', () => {
    expect(extras).toHaveLength(17);
    expect(extras[0]).toEqual({ TaskID: 'SZC-1HDAB-C-NR-40', Name: '1HDAB - raft', DurationDays: 97.5, BaselineStart: '2029-04-06', BaselineFinish: '2029-07-13' });
    expect(extras.find((e) => e.TaskID === 'SZC-1HDAB-C-L3-S50')).toMatchObject({ Name: '1HDAB - L3 - Slabs', BaselineStart: '2030-09-13', BaselineFinish: '2031-01-10' });
    expect(extras.find((e) => e.TaskID === 'SZC-1HDAB-C-L1-W50')!.Name).toBe('1HDAB - L1 - Walls'); // the double space of the source is gone
  });

  it('puts walls on their level, slabs in the level\'s Slabs group, and ties each to its level task', () => {
    const tag = (id: string) => rules.extraTags[id];
    expect(tag('SZC-1HDAB-C-L2-W60')).toEqual({ building: '1HDAB', level: 'L2', wbs: 'level', task: 'WALLS' });
    expect(tag('SZC-1HDAB-C-L8-S70')).toEqual({ building: '1HDAB', level: 'L8', wbs: 'slabs', task: 'SLABS' });
    expect(tag('SZC-1HDAB-C-NR-40')).toEqual({ building: '1HDAB', level: 'L0', wbs: 'level' });
    expect(Object.keys(rules.extraTags)).toHaveLength(17);
  });

  it('keeps the WBS place and level task in the rules file', () => {
    const xml = serializeOverlay({ extras, links: [], crews: [], rules }, 'T');
    const back = parseOverlay(xml);
    expect(back.extras).toHaveLength(17);
    expect(back.rules!.extraTags['SZC-1HDAB-C-L2-W60']).toEqual({ building: '1HDAB', level: 'L2', wbs: 'level', task: 'WALLS' });
    expect(back.rules!.extraTags['SZC-1HDAB-C-L1-S40']).toMatchObject({ wbs: 'slabs', task: 'SLABS' });
    const own = normalizeRules({ version: 1, extraTags: { X: { wbs: 'path:High level / Facade' } } });
    expect(parseOverlay(serializeOverlay({ extras: [{ TaskID: 'X', Name: 'x', DurationDays: 0, BaselineStart: '', BaselineFinish: '' }], links: [], crews: [], rules: own }, 'T')).rules!.extraTags.X.wbs).toBe('path:High level / Facade');
  });
});


describe('a group is a list of conditions, like a 4D group', () => {
  const group = (filters: object[]) => normalizeRules({ version: 1, groups: [{ id: 'G', forEach: [], filters }] }).groups[0];
  const cond = (field: string, op: string, value: string, conj = 'and', more = {}) => ({ id: `${field}${op}${value}`, field, op, value, conj, ...more });
  const f = factsOf(headers, [object('A', 'L1', 'SLAB', { volume: '10' }), object('B', 'L1', 'WALL', { volume: '0.1' }), object('C', 'L2', 'SLAB', { volume: '0.1' })]);
  const inside = (g: ReturnType<typeof group>) => f.filter((x) => matchesFilters(g.filters, x)).map((x) => x.key);

  it('reads Equals (with A|B alternatives), the text operators, and the numeric ones', () => {
    expect(inside(group([cond('type', 'equals', 'WALL|SLAB')]))).toEqual(['A', 'B', 'C']);
    expect(inside(group([cond('type', 'notEquals', 'SLAB')]))).toEqual(['B']);
    expect(inside(group([cond('type', 'startsWith', 'SL')]))).toEqual(['A', 'C']);
    expect(inside(group([cond('volume', 'lessThan', '1')]))).toEqual(['B', 'C']);
    expect(inside(group([cond('levelNumber', 'atLeast', '2')]))).toEqual(['C']);
  });

  it('joins conditions left to right by And / Or, and leaves out the ignored and the empty ones', () => {
    const two = [cond('type', 'equals', 'SLAB'), cond('volume', 'lessThan', '1')];
    expect(inside(group(two))).toEqual(['C']);
    expect(inside(group([two[0], { ...two[1], conj: 'or' }]))).toEqual(['A', 'B', 'C']);
    expect(inside(group([two[0], { ...two[1], ignore: true }]))).toEqual(['A', 'C']);
    expect(inside(group([two[0], cond('volume', 'lessThan', '')]))).toEqual(['A', 'C']);
  });

  it('reads a model property of the object table', () => {
    expect(inside(group([cond('prop:CWA Pour/Pour ID', 'equals', 'B')]))).toEqual(['B']);
  });

  it('turns a group saved as key = value terms into conditions, and keeps them in the rules file', () => {
    const old = normalizeRules({ version: 1, groups: [{ id: 'OLD', forEach: [], select: { family: 'slab', volumeBelow: '1', levelFrom: 'L2' } }] }).groups[0];
    expect(old.filters.map((c) => [c.field, c.op, c.value])).toEqual([['family', 'equals', 'slab'], ['levelNumber', 'atLeast', '2'], ['volume', 'lessThan', '1']]);
    expect('select' in old).toBe(false);
    const back = parseOverlay(serializeOverlay({ extras: [], links: [], crews: [], rules: normalizeRules({ version: 1, groups: [old] }) }, 'T')).rules!.groups[0];
    expect(back.filters.map((c) => [c.field, c.op, c.value, c.conj])).toEqual(old.filters.map((c) => [c.field, c.op, c.value, c.conj]));
    const ign = parseOverlay(serializeOverlay({ extras: [], links: [], crews: [], rules: normalizeRules({ version: 1, groups: [{ id: 'X', forEach: [], filters: [cond('type', 'equals', 'A', 'and', { ignore: true, caseSensitive: true })] }] }) }, 'T')).rules!.groups[0];
    expect(ign.filters[0]).toMatchObject({ ignore: true, caseSensitive: true });
  });
});

describe('the extra activities table', () => {
  it('reads the high-level programme as it was pasted (dates like 13 Sept 2030, a row of headings)', () => {
    const pasted = 'Activity ID\tActivity Name\tDays\tStart\tFinish\nSZC-1HDAB-C-NR-40\t1HDAB - raft\t97.5\t6 Apr 2029\t13 Jul 2029\nSZC-1HDAB-C-L3-S50\t1HDAB - L3 - Slabs\t97.5\t13 Sept 2030\t10 Jan 2031';
    const { extras, tags } = parseExtrasPaste(pasted);
    expect(extras).toHaveLength(2);
    expect(extras[1]).toEqual({ TaskID: 'SZC-1HDAB-C-L3-S50', Name: '1HDAB - L3 - Slabs', DurationDays: 97.5, BaselineStart: '2030-09-13', BaselineFinish: '2031-01-10' });
    expect(tags).toEqual({});
    expect(parseDate('29/06/2029')).toBe('2029-06-29');
    expect(parseDate('2029-06-29')).toBe('2029-06-29');
  });

  it('reads the optional columns: type, building, level, WBS and level task', () => {
    const { tags } = parseExtrasPaste('A1\tL1 walls\t10\t\t\tWBS summary\t1HDAB\tl1\ton its level\twalls\nA2\tL1 slabs\t5\t\t\tFinish milestone\t1HDAB\tL1\tslabs\t\nA3\tOwn\t0\t\t\t\t\t\tHigh level / Facade\t');
    expect(tags.A1).toEqual({ kind: 'summary', building: '1HDAB', level: 'L1', wbs: 'level', task: 'WALLS' });
    expect(tags.A2).toEqual({ kind: 'finish', building: '1HDAB', level: 'L1', wbs: 'slabs' });
    expect(tags.A3).toEqual({ wbs: 'path:High level / Facade' });
  });

  it('copies out as the same columns it reads in, and many rows change at once', () => {
    const { extras, tags } = parseExtrasPaste('A1\tL1 walls\t10\t2029-01-01\t2029-02-01\tTask\t1HDAB\tL1\tlevel\tWALLS');
    const back = parseExtrasPaste(extrasToTsv(extras, tags));
    expect(back.extras).toEqual(extras);
    expect(back.tags).toEqual({ A1: { kind: 'task', building: '1HDAB', level: 'L1', wbs: 'level', task: 'WALLS' } });
    const all = patchTags(back.tags, ['A1', 'A2', 'A3'], { kind: 'summary' });
    expect(Object.keys(all).sort()).toEqual(['A1', 'A2', 'A3']);
    expect(all.A1.kind).toBe('summary');
    expect(patchTags(all, ['A2', 'A3'], { kind: '' })).toEqual({ A1: all.A1 }); // no field left: no tag
  });
});
