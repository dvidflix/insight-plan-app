import type { ScenarioCrew, ScenarioExtra, ScenarioRelation } from '../scenarios/api';
import { mergeRules, normalizeRules, totalRules, type Assignment, type ChainRow, type CrewTemplate, type FilterOp, type GroupFilter, type RateRow, type ScenarioRules } from './rules';

/** Rule presets: a named copy of everything the Rules list holds (the programme rules, extra activities, manual links and crew
    overrides), to load into any scenario. Saved as a project setting (so they follow the project), the first one ships with the app. */

export interface PresetContent {
  rules: ScenarioRules;
  extras: ScenarioExtra[];
  relations: ScenarioRelation[];
  crews: ScenarioCrew[];
}

export interface RulePreset {
  id: string;
  name: string;
  note?: string;
  /** ISO date the preset was saved. */
  savedAt: string;
  /** A preset that ships with the app has a revision; a saved copy that has not been changed here is replaced when the app's is newer. */
  revision?: number;
  /** Set when the preset was overwritten from a scenario (Update): it is the user's now and is never replaced. */
  userEdited?: boolean;
  content: PresetContent;
}

export const countPreset = (c: PresetContent): number => totalRules(c.rules) + c.extras.length + c.relations.length + c.crews.length;

// ---------------------------------------------------------------- what the engine does today (scenario-engine/config.py)

const c = (field: string, op: FilterOp, value: string, n = 1): GroupFilter => ({ id: `c${n}`, field, op, value, conj: 'and' });

/** The generator's own logic, written as rules: every switch at its config.py value, the duration table (DURATIONS), the slab, precast and
    heavy precast phase days, the rebar rate (REBAR_TONNES_PER_M3) and the crew table (CREW_TABLE). Loaded into a scenario it changes
    nothing in the generated programme. */
export const ENGINE_RULES = {
  settings: {
    levelGate: true, levelGateSlabsOnly: true, levelGateDeckingConcreteOnly: true, levelGateMaxDistanceM: 0.05,
    completionCloseout: true, openEndSequencing: true, openEndMaxDistanceM: 0.3, openEndNearestSlabFallback: true,
    slabCuringGatesSuccessors: false,
    minPourVolumeM3: 0.25, excludedPourTypes: ['BOSS', 'SCREED', 'GROUT', 'SPECIAL'], stairStepMaxVolumeM3: 0.09,
    sideOverlapThreshold: 0.5, groupMilestones: false, buildingCompletion: false,
  },
  // The trades (LABOUR_TRADES: the capacities are placeholders until the site's gangs are set) and the two calendars (CWA 6d, and the 7-day one Curing runs on).
  trades: [
    { id: 'SF', name: 'Steel fixers', capacity: 24 },
    { id: 'CP', name: 'Carpenters / formwork', capacity: 24 },
    { id: 'CG', name: 'Concrete gang', capacity: 12 },
    { id: 'GO', name: 'General operatives', capacity: 12 },
    { id: 'EM', name: 'Embedments fixers', capacity: 8 },
    { id: 'PE', name: 'Precast erection crew', capacity: 8 },
  ],
  calendars: [
    { id: '6D', name: 'CWA 6d Calendar', workDays: [0, 1, 2, 3, 4], start: '09:00', hoursPerDay: 8, default: true },
    { id: '7D', name: 'CWA 7d Curing Calendar', workDays: [0, 1, 2, 3, 4, 5, 6], start: '09:00', hoursPerDay: 8 },
  ],
};

// ---------------------------------------------------------------- the generator's numbers as relational rules

/** What was the duration table, the crew table, the rebar rate and the 7-day Curing calendar, as Groups (what the objects are), Rates, Crews and
    Assignments (which group gets which rate, crew and calendar in which phase). A group says what; the priority says which wins (10: a kind of
    object, 0: every object). Nothing here has conditions of its own. */
const assign = (group: string, phase: string, extra: { rate?: string; density?: string; days?: number; crew?: string; calendar?: string; priority?: number; enabled?: false; note?: string }): Assignment => ({
  id: `${group}|${phase}`.toUpperCase(), group, phase, ...extra,
});
/** The four components of the duration table for a group (Embedments and Formwork are the one Formwork activity). */
const components = (group: string, [rebar, embedments, formwork, concrete]: [number, number, number, number], priority: number): Assignment[] => [
  assign(group, 'Rebar', { days: rebar, priority }), assign(group, 'Embedments', { days: embedments, priority }),
  assign(group, 'Formwork', { days: formwork, priority }), assign(group, 'Concrete', { days: concrete, priority }),
];
const phasesOf = (group: string, phases: Record<string, number>, priority = 10): Assignment[] => Object.entries(phases).map(([phase, d]) => assign(group, phase, { days: d, priority }));
const group = (id: string, name: string, ...filters: GroupFilter[]) => ({ id, name, forEach: [] as never[], filters });
const productivity = (id: string, manhoursPerUnit: number): RateRow => ({ id, type: 'productivity', basis: 'rebar', manhoursPerUnit, people: 12, shifts: 2, hoursPerShift: 9.17, rounding: 'ceil', minDays: 1 });
/** One row per group and phase: the rows of the same group and phase (days, rate, crew, calendar written apart above) are joined. */
function joinRows(rows: Assignment[]): Assignment[] {
  const by = new Map<string, Assignment>();
  for (const r of rows) {
    const had = by.get(r.id);
    by.set(r.id, had ? { ...had, ...r, priority: r.priority ?? had.priority } : r);
  }
  return [...by.values()];
}
/** A chain: the activities of a group in order, each [phase, suffix, name, material]. */
const chain = (group: string, priority: number, phases: [string, string, string, ChainRow['material']?, string?, boolean?, boolean?][]): ChainRow[] =>
  phases.map(([phase, suffix, label, material, follows, finishAfter, gates], i) => ({ id: `${group}|${phase}`.toUpperCase(), group, order: i + 1, phase, suffix, label, ...(material ? { material } : {}), ...(follows ? { follows } : {}), ...(finishAfter ? { finishAfter } : {}), ...(gates ? { gates } : {}), priority }));
const crewOf = (id: string, ...trades: [string, number][]): CrewTemplate => ({ id, trades: trades.map(([trade, size]) => ({ trade, size })) });

export const RELATIONAL_RULES = {
  groups: [
    group('T-WALL-EXT', 'External walls, standard height', c('family', 'equals', 'wall'), c('external', 'equals', 'true', 2), c('doubleHeight', 'equals', 'false', 3)),
    group('T-WALL-EXT-DH', 'External walls, double height', c('family', 'equals', 'wall'), c('external', 'equals', 'true', 2), c('doubleHeight', 'equals', 'true', 3)),
    group('T-WALL-INT', 'Internal walls, standard height', c('family', 'equals', 'wall'), c('external', 'equals', 'false', 2), c('doubleHeight', 'equals', 'false', 3)),
    group('T-WALL-INT-DH', 'Internal walls, double height', c('family', 'equals', 'wall'), c('external', 'equals', 'false', 2), c('doubleHeight', 'equals', 'true', 3)),
    // The engine names these types exactly for the slab row; a FLOOR or other slab-like type is "Other".
    group('T-SLAB-TABLE', 'Slab, main slab, pits and rafts, pit', c('type', 'equals', 'SLAB|MAIN_SLAB|PITS_&_RAFT|PIT')),
    group('T-RAFT', 'Rafts', c('family', 'equals', 'raft')),
    group('T-SLAB', 'Slabs (the Decking, Under Slab, EOP and FWK activities)', c('family', 'equals', 'slab')),
    group('T-PRECAST', 'Precast', c('family', 'equals', 'precast')),
    group('T-HEAVY-PRECAST', 'Heavy precast', c('family', 'equals', 'heavyPrecast')),
    group('T-TYPE-SLAB', 'Pour type SLAB', c('type', 'equals', 'SLAB')),
    group('T-TYPE-MAIN-SLAB', 'Pour type MAIN_SLAB', c('type', 'equals', 'MAIN_SLAB')),
    group('T-TYPE-RAFT', 'Pour type RAFT', c('type', 'equals', 'RAFT')),
    group('T-ANY', 'Every object', c('volume', 'atLeast', '0')),
    // The groups the activity chains are given to (see `chains` below).
    group('C-LANDING', 'Landings', c('type', 'contains', 'LANDING')),
    {
      id: 'C-SLAB', name: 'Slab-like pours: slabs, pits, floors, rafts', forEach: [] as never[],
      filters: [c('type', 'contains', 'SLAB'), { ...c('type', 'contains', 'PIT', 2), conj: 'or' as const }, { ...c('type', 'contains', 'FLOOR', 3), conj: 'or' as const }, { ...c('type', 'contains', 'RAFT', 4), conj: 'or' as const }],
    },
    group('C-RAFT', 'Rafts', c('type', 'equals', 'RAFT')),
    group('C-PRECAST', 'Precast', c('family', 'equals', 'precast')),
    group('C-HEAVY-PRECAST', 'Heavy precast (concrete stage PRECAST)', c('family', 'equals', 'heavyPrecast'), c('stage', 'equals', 'PRECAST', 2)),
    group('C-PEDESTAL-2', 'Pedestals, stage 2: one combined activity', c('type', 'equals', 'PEDESTAL'), c('stage', 'equals', '2', 2)),
    // Raft pours of stage 2 get no activities.
    { ...group('C-RAFT-STAGE-2', 'Rafts, stage 2: no activities', c('type', 'equals', 'RAFT'), c('stage', 'equals', '2', 2)), treatAs: 'exclude' as const },
    group('T-WALLS-LOW', 'Walls on levels 0 to 2', c('family', 'equals', 'wall'), c('levelNumber', 'atMost', '2', 2)),
    group('T-1HDAB-L1-SLABS', 'The L1 slabs of 1HDAB', c('family', 'equals', 'slab'), c('building', 'equals', '1HDAB', 2), c('level', 'equals', 'L1', 3)),
  ],
  chains: [
    // Every in-situ pour: Rebar, Formwork, Concrete, then Curing (the concrete maturing: it does not hold back what follows).
    // Overlaps: the formwork starts when the rebar is 80 % done (and does not finish before it).
    ...chain('', 0, [['Rebar', '-R', 'Rebar', 'rebar'], ['Formwork', '-F', 'E/P and Formwork', undefined, 'Rebar@80', true], ['Concrete', '-C', 'Concrete', 'concrete'], ['Curing', '-CU', 'Curing', undefined, 'Concrete']]),
    // The rebar starts when the decking is 80 % done, the formwork when the rebar is; the concrete waits for the formwork and the embedded parts.
    ...chain('C-SLAB', 10, [['Decking', '-DK', 'Mills and Decking'], ['Under Slab', '-D', 'E/P under Slab', undefined, 'Decking@80'], ['Rebar', '-R', 'Rebar', 'rebar', 'Decking@80, Under Slab@80', true], ['EOP on Slab', '-E2', 'E/P on Slab', undefined, 'Rebar'], ['FWK', '-F', 'Formwork', undefined, 'Rebar@80', true], ['Concrete', '-C', 'Concrete', 'concrete', 'FWK, EOP on Slab'], ['Curing', '-CU', 'Curing', undefined, 'Concrete']]),
    ...chain('C-RAFT', 20, [['Rebar', '-R', 'Rebar', 'rebar'], ['EOP on Slab', '-E2', 'E/P on Slab', undefined, 'Rebar'], ['FWK', '-F', 'Formwork', undefined, 'Rebar@80', true], ['Concrete', '-C', 'Concrete', 'concrete', 'FWK, EOP on Slab'], ['Curing', '-CU', 'Curing', undefined, 'Concrete', false, true]]),
    ...chain('C-LANDING', 30, [['Decking', '-DK', 'Decking'], ['Rebar', '-R', 'Rebar and EP/AP', 'rebar'], ['Concrete', '-C', 'Concrete', 'concrete'], ['Curing', '-CU', 'Curing', undefined, 'Concrete']]),
    ...chain('C-PEDESTAL-2', 40, [['Rebar, Formwork and Concrete', '-RFC', 'Rebar, Formwork and Concrete'], ['Curing', '-CU', 'Curing', undefined, 'Rebar, Formwork and Concrete']]),
    ...chain('C-PRECAST', 50, [['Installation', '-I', 'Installation'], ['Stitching', '-S', 'Stitching']]),
    ...chain('C-HEAVY-PRECAST', 50, [['Propping', '-PR', 'Propping'], ['Installation', '-I', 'Installation'], ['Stitching', '-S', 'Stitching'], ['Curing', '-CU', 'Curing (walls under)'], ['Propping Removal', '-RP', 'Propping Removal']]),
  ] as ChainRow[],
  rates: [
    { id: 'REBAR-0.25', type: 'rebar', tonnesPerM3: 0.25 },
    productivity('REBAR-SF-60', 60), productivity('REBAR-SF-75', 75), productivity('REBAR-SF-85', 85), productivity('REBAR-SF-95', 95),
  ] as RateRow[],
  crewTemplates: [
    crewOf('SF-6', ['SF', 6]), crewOf('SF-8', ['SF', 8]), crewOf('SF-10', ['SF', 10]), crewOf('CP-6', ['CP', 6]), crewOf('CP-4', ['CP', 4]),
    crewOf('GO-4', ['GO', 4]), crewOf('EM-3', ['EM', 3]), crewOf('CG-6', ['CG', 6]), crewOf('RFC', ['SF', 3], ['CP', 3], ['CG', 3]),
    crewOf('PE-4', ['PE', 4]), crewOf('PE-6', ['PE', 6]), crewOf('STITCHING', ['SF', 2], ['CG', 3]),
  ] as CrewTemplate[],
  assignments: joinRows([
    // Days: the duration table by kind of object, "Other" for every object (the table's last row), and the other activities.
    ...components('', [5, 2, 4, 1], 0),
    ...components('T-WALL-EXT', [7, 2, 3, 1], 10),
    ...components('T-WALL-EXT-DH', [12, 4, 5, 1], 10),
    ...components('T-WALL-INT', [4, 6, 3, 1], 10),
    ...components('T-WALL-INT-DH', [9, 8, 3, 1], 10),
    ...components('T-SLAB-TABLE', [18, 18, 2, 1], 10),
    ...components('T-RAFT', [18, 18, 2, 1], 10),
    ...phasesOf('T-SLAB', { Decking: 1, 'Under Slab': 1, 'EOP on Slab': 1, FWK: 1 }),
    ...phasesOf('T-RAFT', { 'EOP on Slab': 1, FWK: 1 }),
    ...phasesOf('T-PRECAST', { Installation: 1, Stitching: 2 }),
    ...phasesOf('T-HEAVY-PRECAST', { Propping: 1, Installation: 1, Stitching: 2, Curing: 28, 'Propping Removal': 1 }),
    // Rebar: 0.25 t per m³ of concrete for every object.
    assign('', 'Rebar', { density: 'REBAR-0.25', priority: 0 }),
    // Crews: by phase for every object, and the rebar gangs of slabs and rafts by pour type.
    assign('', 'Rebar', { crew: 'SF-6', priority: 0 }), assign('', 'Formwork', { crew: 'CP-6', priority: 0 }), assign('', 'Works before slab', { crew: 'GO-4', priority: 0 }),
    assign('', 'Decking', { crew: 'CP-6', priority: 0 }), assign('', 'Under Slab', { crew: 'GO-4', priority: 0 }), assign('', 'EOP on Slab', { crew: 'EM-3', priority: 0 }),
    assign('', 'FWK', { crew: 'CP-4', priority: 0 }), assign('', 'Concrete', { crew: 'CG-6', priority: 0 }), assign('', 'Rebar, Formwork and Concrete', { crew: 'RFC', priority: 0 }),
    assign('', 'Propping', { crew: 'PE-4', priority: 0 }), assign('', 'Installation', { crew: 'PE-6', priority: 0 }), assign('', 'Stitching', { crew: 'STITCHING', priority: 0 }),
    assign('', 'Propping Removal', { crew: 'PE-4', priority: 0 }),
    assign('T-TYPE-SLAB', 'Rebar', { crew: 'SF-8', priority: 10 }), assign('T-TYPE-MAIN-SLAB', 'Rebar', { crew: 'SF-8', priority: 10 }), assign('T-TYPE-RAFT', 'Rebar', { crew: 'SF-10', priority: 10 }),
    // Curing: 7 days for every in-situ pour, 20 for slabs and rafts (for now: to be set from the specification), 28 for heavy precast (above); the combined activity of
    // a stage 2 pedestal: the days of the "Other" row added up.
    ...phasesOf('', { Curing: 7 }, 0), ...phasesOf('C-SLAB', { Curing: 20 }), ...phasesOf('C-RAFT', { Curing: 20 }), ...phasesOf('C-PEDESTAL-2', { 'Rebar, Formwork and Concrete': 12 }),
    // Calendar: Curing is concrete maturing: it runs on weekends too, so 28 days elapse as 28 calendar days.
    assign('', 'Curing', { calendar: '7D', priority: 0 }),
    // The computed rebar durations (SF-003: 12 steel fixers, two shifts of 9.17 h), switched off until they are wanted.
    assign('T-ANY', 'Rebar', { rate: 'REBAR-SF-75', priority: 0, enabled: false, note: 'Every other pour' }),
    assign('T-WALLS-LOW', 'Rebar', { rate: 'REBAR-SF-85', priority: 20, enabled: false, note: 'Walls on levels 0 to 2 are slower' }),
    assign('T-1HDAB-L1-SLABS', 'Rebar', { rate: 'REBAR-SF-95', priority: 30, enabled: false, note: 'The L1 slabs of 1HDAB are the slowest' }),
    assign('RAFTS', 'Rebar', { rate: 'REBAR-SF-60', priority: 10, enabled: false, note: 'Rafts' }),
    assign('WALLS', 'Rebar', { rate: 'REBAR-SF-75', priority: 10, enabled: false, note: 'Walls' }),
  ]),
};

// ---------------------------------------------------------------- the programme structure of the project (docs/programme-rules)

/** Groups (including the three that leave objects out of the schedule and mark the stair steps), level tasks, the build-up sequence, the level links, and the computed rebar durations (SF-003: 12 steel fixers, two
    shifts of 9.17 h) switched off until they are wanted. */
export const STRUCTURE_RULES = {
  groups: [
    { id: 'WALLS', name: 'Walls', forEach: ['building', 'level'], filters: [c('family', 'equals', 'wall')] },
    { id: 'SLABS', name: 'Slabs', forEach: ['building', 'level'], filters: [c('family', 'equals', 'slab')] },
    { id: 'RAFTS', name: 'Rafts', forEach: ['building'], filters: [c('family', 'equals', 'raft')] },
    // What the generator leaves out of the schedule, and the stair steps, by group: not settings of types and volumes.
    { id: 'NOT-SCHEDULED', name: 'Types not scheduled', treatAs: 'exclude', forEach: [], filters: [c('type', 'equals', 'BOSS|SCREED|GROUT|SPECIAL')] },
    { id: 'SMALL', name: 'Objects under 0.25 m³ (a stair is never small)', treatAs: 'exclude', forEach: [], filters: [c('volume', 'lessThan', '0.25'), c('type', 'notEquals', 'STAIR', 2)] },
    { id: 'STAIR-STEPS', name: 'Stair steps: small in-situ stair objects, cast with their flight', treatAs: 'stairStep', forEach: [], filters: [c('type', 'equals', 'STAIR'), c('volume', 'lessThan', '0.09', 2)] },
  ],
  levelTasks: [
    { id: 'WALLS', name: 'Walls', group: 'WALLS' },
    { id: 'SLABS', name: 'Slabs', group: 'SLABS' },
  ],
  sequences: [
    { id: 'BUILD-UP', enabled: false, note: 'Off: it makes all the walls of a level finish before its slabs start, and a level finish before the next, which neither the engine logic nor the high-level programme does (its slabs start before the walls are done)', name: 'Build up: rafts, then walls and slabs level by level', type: 'FS', lagHours: 0, steps: [{ group: 'RAFTS' }, { group: 'WALLS', perLevel: true }, { group: 'SLABS', perLevel: true }] },
  ],
  levelLinks: [
    { id: 'LEVEL-EXTRAS', name: 'Extra activities finish with their level tasks', activities: 'extras', tasks: ['WALLS', 'SLABS'], type: 'FF', direction: 'toTask', lagHours: 0 },
  ],
};

// ---------------------------------------------------------------- the high-level programme (1HDAB): extra activities

/** [Activity ID, name, days, baseline start, baseline finish] of the high-level programme's raft, walls and slabs of each level of 1HDAB. */
const HIGH_LEVEL_1HDAB: [string, string, number, string, string][] = [
  ['SZC-1HDAB-C-NR-40', '1HDAB - raft', 97.5, '2029-04-06', '2029-07-13'],
  ['SZC-1HDAB-C-L1-W50', '1HDAB - L1 - Walls', 152.5, '2029-07-13', '2029-12-19'],
  ['SZC-1HDAB-C-L1-S40', '1HDAB - L1 - Slabs', 91.3, '2029-11-05', '2030-02-26'],
  ['SZC-1HDAB-C-L2-W60', '1HDAB - L2 - Walls', 122.5, '2030-02-02', '2030-06-17'],
  ['SZC-1HDAB-C-L2-S50', '1HDAB - L2 - Slabs', 71.3, '2030-05-16', '2030-07-26'],
  ['SZC-1HDAB-C-L3-W60', '1HDAB - L3 - Walls', 122.5, '2030-07-05', '2030-11-07'],
  ['SZC-1HDAB-C-L3-S50', '1HDAB - L3 - Slabs', 97.5, '2030-09-13', '2031-01-10'],
  ['SZC-1HDAB-C-L4-W60', '1HDAB - L4 - Walls', 122.5, '2030-12-04', '2031-05-02'],
  ['SZC-1HDAB-C-L4-S50', '1HDAB - L4 - Slabs', 81.3, '2031-03-08', '2031-06-04'],
  ['SZC-1HDAB-C-L5-W70', '1HDAB - L5 - Walls', 91.3, '2031-05-02', '2031-08-02'],
  ['SZC-1HDAB-C-L5-S60', '1HDAB - L5 - Slabs', 71.3, '2031-06-25', '2031-09-03'],
  ['SZC-1HDAB-C-L6-W70', '1HDAB - L6 - Walls', 132.5, '2031-08-14', '2032-01-15'],
  ['SZC-1HDAB-C-L6-S60', '1HDAB - L6 - Slabs', 81.3, '2031-11-17', '2032-03-01'],
  ['SZC-1HDAB-C-L7-W70', '1HDAB - L7 - Walls', 132.5, '2032-02-07', '2032-06-29'],
  ['SZC-1HDAB-C-L7-S60', '1HDAB - L7 - Slabs', 81.3, '2032-05-19', '2032-08-07'],
  ['SZC-1HDAB-C-L8-W80', '1HDAB - L8 - Walls', 132.5, '2032-07-19', '2032-12-03'],
  ['SZC-1HDAB-C-L8-S70', '1HDAB - L8 - Slabs', 81.3, '2032-10-21', '2033-02-01'],
];

/** The extras, and where each belongs: the raft on level 0; walls on their level (beside its External and Internal Walls groups) and tied to
    the level's Walls task; slabs in the level's Slabs group and tied to the Slabs task. */
const HIGH_LEVEL_EXTRAS: ScenarioExtra[] = HIGH_LEVEL_1HDAB.map(([TaskID, Name, DurationDays, BaselineStart, BaselineFinish]) => ({ TaskID, Name, DurationDays, BaselineStart, BaselineFinish }));
const HIGH_LEVEL_TAGS: ScenarioRules['extraTags'] = Object.fromEntries(
  HIGH_LEVEL_1HDAB.map(([id]) => {
    const m = /-(NR|L(\d+))-([WS])?/.exec(id);
    const level = !m || m[1] === 'NR' ? 'L0' : `L${m[2]}`;
    const walls = m?.[3] === 'W';
    const slabs = m?.[3] === 'S';
    return [id, { building: '1HDAB', level, wbs: slabs ? 'slabs' : 'level', ...(walls ? { task: 'WALLS' } : slabs ? { task: 'SLABS' } : {}) }];
  }),
);

const BASE = { version: 1, extraTags: HIGH_LEVEL_TAGS };

/** Everything above as the rules a scenario holds. */
// The smallest object, the excluded types and the stair step volume are done by groups here (the three settings are not used once they exist).
const { minPourVolumeM3: _min, excludedPourTypes: _types, stairStepMaxVolumeM3: _step, ...SCOPE_FREE_SETTINGS } = ENGINE_RULES.settings;
// The scenario's order is the order the work starts and the concrete is poured: each step starts a working day after the one before starts (Steps
// overlap), instead of waiting for it to finish, which turned a long order into a relay of many years (on the 1HDAB order: 17 years against 4.7).
const SEQUENCE_SETTINGS = { sequenceFlow: true, sequenceLeadDays: 1 };
export const ENGINE_AND_STRUCTURE: ScenarioRules = normalizeRules({ ...BASE, ...ENGINE_RULES, settings: { ...SCOPE_FREE_SETTINGS, ...SEQUENCE_SETTINGS }, ...STRUCTURE_RULES, ...RELATIONAL_RULES, groups: [...STRUCTURE_RULES.groups, ...RELATIONAL_RULES.groups] });

const empty = { relations: [], crews: [] };

/** The first preset: the project's logic, which was hard-coded in the generator or spread over other features. */
export const PRESET_1HDAB_TOC: RulePreset = {
  id: '1HDAB_TOC',
  name: '1HDAB_TOC',
  note: 'The generator\'s own logic as rules (switches, durations, rebar, crews), the Walls / Slabs / Rafts groups, three groups that leave out the types not scheduled and the objects under 0.25 m³, and mark the stair steps, the level tasks, the build-up sequence (switched off) and the level links, and the 17 extra activities of the high-level programme (raft, and walls and slabs of levels 1 to 8) with their WBS place and level task. The computed rebar durations are in it, switched off. The scenario\'s order is followed as the order the work starts and the concrete is poured (Steps overlap, one working day apart), so the 1HDAB order builds in under 5 years. Every in-situ pour has a Curing activity: 7 days, slabs and rafts 20, heavy precast 28.',
  savedAt: '2026-10-13',
  revision: 11,
  content: { rules: ENGINE_AND_STRUCTURE, extras: HIGH_LEVEL_EXTRAS, ...empty },
};

export const DEFAULT_PRESETS: RulePreset[] = [PRESET_1HDAB_TOC];

// ---------------------------------------------------------------- applying a preset

/** A preset is rules only: the objects a scenario joins are its own (they are ids of one model's objects). */
export const withoutJoins = (rules: ScenarioRules): ScenarioRules => ((rules.joins ?? []).length ? { ...rules, joins: [] } : rules);

/** What the scenario holds after a preset is added: rules with the same id are replaced, the others kept, and so for extras and links. */
export function addPreset(current: PresetContent, preset: PresetContent): PresetContent {
  const extraIds = new Set(preset.extras.map((e) => e.TaskID.toUpperCase()));
  const linkKey = (l: ScenarioRelation) => `${l.ActivityID1}>${l.ActivityID2}:${l.Relation}`;
  const linkKeys = new Set(preset.relations.map(linkKey));
  const crewKey = (c: ScenarioCrew) => `${c.Phase}|${c.PourType}|${c.Trade}`;
  const crewKeys = new Set(preset.crews.map(crewKey));
  return {
    rules: mergeRules(current.rules, preset.rules),
    extras: [...current.extras.filter((e) => !extraIds.has(e.TaskID.toUpperCase())), ...preset.extras],
    relations: [...current.relations.filter((l) => !linkKeys.has(linkKey(l))), ...preset.relations],
    crews: [...current.crews.filter((c) => !crewKeys.has(crewKey(c))), ...preset.crews],
  };
}

/** A fresh id for a preset name. */
export function presetId(name: string, taken: string[]): string {
  const base = name.trim().replace(/[^\w.-]+/g, '_') || 'PRESET';
  const used = new Set(taken.map((t) => t.toUpperCase()));
  let id = base;
  for (let n = 2; used.has(id.toUpperCase()); n++) id = `${base}-${n}`;
  return id;
}

/** Presets as saved (or as a file edited by hand): only well-formed ones, with their rules normalised. The presets that ship with the app
    replace an older, untouched saved copy of themselves, so a change to them (new groups, fixed rules) reaches projects that already hold one. */
export function normalizePresets(raw: unknown): RulePreset[] {
  if (!Array.isArray(raw)) return DEFAULT_PRESETS;
  const out: RulePreset[] = [];
  for (const p of raw as Partial<RulePreset>[]) {
    if (!p || typeof p !== 'object' || !p.id || !p.name || !p.content) continue;
    const c = p.content as Partial<PresetContent>;
    out.push({
      id: String(p.id),
      name: String(p.name),
      ...(p.note ? { note: String(p.note) } : {}),
      savedAt: String(p.savedAt ?? ''),
      ...(typeof p.revision === 'number' ? { revision: p.revision } : {}),
      ...(p.userEdited ? { userEdited: true } : {}),
      content: {
        rules: withoutJoins(normalizeRules(c.rules)),
        extras: Array.isArray(c.extras) ? c.extras : [],
        relations: Array.isArray(c.relations) ? c.relations : [],
        crews: Array.isArray(c.crews) ? c.crews : [],
      },
    });
  }
  return out.map((p) => {
    const shipped = DEFAULT_PRESETS.find((d) => d.id === p.id);
    return shipped && !p.userEdited && (p.revision ?? 0) < (shipped.revision ?? 0) ? shipped : p;
  });
}
