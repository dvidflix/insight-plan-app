import { normalizeRecipes, type Recipe } from './recipes';

/** A scenario's programme rules, as the Rules panel edits them and the generator reads them
    (scenario-engine/core/rules.py, core/rule_logic.py; the format is described in docs/programme-rules).

    Empty rules change nothing: every lookup in the generator falls back to its own constants (config.py), so a scenario
    with no rules generates what it always did. A row is only written to the file when it has been added. */

/** The conditions of a row. Every term that is set must hold; the row with the most terms fits a object best, and a tie
    goes to the earlier row. A value may list alternatives with "|" (WALL|SLAB). */
export interface When {
  building?: string;
  level?: string;
  /** A range of levels, by number: L0 to L2. */
  levelFrom?: string;
  levelTo?: string;
  type?: string;
  /** wall, slab, raft, heavyPrecast, precast, pedestal, landing, stair, column, beam, insitu */
  family?: string;
  general?: string;
  stage?: string;
  zone?: string;
  external?: string;
  /** Walls taller than 6 m ("true" / "false"). */
  doubleHeight?: string;
  /** A group (not a 4D Link Group). */
  group?: string;
  /** The object's concrete volume in m³: at least `volumeFrom`, and less than `volumeBelow`. */
  volumeFrom?: string;
  volumeBelow?: string;
  /** The type is none of these (A|B). */
  typeNot?: string;
}

export const WHEN_KEYS = ['group', 'family', 'type', 'building', 'level', 'levelFrom', 'levelTo', 'stage', 'zone', 'external', 'doubleHeight', 'general', 'volumeFrom', 'volumeBelow', 'typeNot'] as const;
export type WhenKey = (typeof WHEN_KEYS)[number];

export const FAMILIES = ['wall', 'slab', 'raft', 'landing', 'stair', 'column', 'beam', 'pedestal', 'heavyPrecast', 'precast', 'insitu'] as const;

interface Row {
  id: string;
  /** A row switched off is kept but not applied. */
  enabled?: boolean;
  note?: string;
}

/** Days per phase for the objects the row fits. Rebar, Embedments, Formwork and Concrete are the components of the duration
    table; any other phase (Decking, Under Slab, Curing, Installation ...) sets that activity's days. */
export interface DurationRow extends Row {
  when: When;
  phases: Record<string, number>;
}

/** Where a productivity row takes its quantity from: tonnes of rebar (the object's concrete volume x the rebar rate), m3 of concrete, or a
    number the model carries (a property or quantity set and a name, times a factor). */
export type QuantityBasis = 'rebar' | 'concrete' | 'footprint' | 'sides' | 'property';
/** What to use for a object that lacks the model property: the rebar tonnes, the concrete volume, or nothing (the row then does not apply). */
export type QuantityFallback = 'rebar' | 'concrete' | 'none';

/** A duration worked out from a quantity: quantity x man-hours per unit / (crew x shifts x hours per shift). */
export interface ProductivityRow extends Row {
  when: When;
  phase: string;
  basis: QuantityBasis;
  /** basis "property": the property set or quantity set ("CWA Pour", "Qto_SlabBaseQuantities"; empty = any set) and the property's name. */
  pset?: string;
  property?: string;
  /** basis "property": multiplied into the value to get the row's unit (0.001 turns kg into t). Empty = 1. */
  factor?: number;
  fallback?: QuantityFallback;
  manhoursPerUnit: number;
  crew: number;
  shifts: number;
  hoursPerShift: number;
  rounding: 'ceil' | 'round' | 'none';
  minDays: number;
}

/** A labour trade the crews are made of: its code (SF), name and the site's capacity in people per day (written to P6 as the resource's max units;
    the levelling limit). The generator has built-in trades; a row here with the same code replaces one, a new code adds one, and a row switched off
    takes the trade out. */
export interface TradeRow extends Row {
  name: string;
  capacity: number;
}

/** A working calendar: the same window on every working day. workDays: 0 = Monday ... 6 = Sunday. */
export interface CalendarRow extends Row {
  name: string;
  workDays: number[];
  /** "09:00" */
  start: string;
  hoursPerDay: number;
  /** The calendar of every activity no calendar rule fits (the first one when none is marked). */
  default?: boolean;
}

/** The calendar of the activities its conditions fit (a group, a family, a level range ...); `phase` narrows it to one activity of the pour
    (Curing on a 7-day calendar, say). The rule with the most terms wins, a tie goes to the earlier row. */
export interface CalendarRule extends Row {
  when: When;
  phase?: string;
  calendar: string;
}

/** A named rate, defined once and linked to many groups by Assignments. One type each: fixed `days`, `productivity` (a duration worked out from a
    quantity: quantity x man-hours per unit / (people x shifts x hours per shift); people 0 = the crew assigned with it), or a `rebar` density. */
export interface RateRow extends Row {
  type: 'days' | 'productivity' | 'rebar';
  days?: number;
  tonnesPerM3?: number;
  basis?: QuantityBasis;
  pset?: string;
  property?: string;
  factor?: number;
  fallback?: QuantityFallback;
  manhoursPerUnit?: number;
  people?: number;
  shifts?: number;
  hoursPerShift?: number;
  rounding?: 'ceil' | 'round' | 'none';
  minDays?: number;
}

/** A named crew: trades and people per day, defined once and linked to many groups by Assignments. */
export interface CrewTemplate extends Row {
  trades: { trade: string; size: number }[];
  /** The company the crew belongs to (shown with it: "Concrete Sub · CARP"). */
  subcontractor?: string;
  /** How many crews of this kind there are: the most that can work at once. Empty or 0: not limited, and no resource. Written to P6 as a resource. */
  available?: number;
}

/** The link table: one row per group and phase. Its rate, crew and calendar (any may be empty) apply to the objects of the group; `days` is a fixed
    number of days without a named rate. A higher priority beats a lower one; a tie goes to the earlier row. Empty group = every object. */
export interface Assignment extends Row {
  group: string;
  phase: string;
  rate?: string;
  days?: number;
  /** A rebar rate (tonnes per m³ of concrete) for the objects of the group: separate from `rate`, so a phase can have both a density and a productivity. */
  density?: string;
  crew?: string;
  calendar?: string;
  priority?: number;
  /** A duration formula in working days (prs/recipes RecipeTask.formula): quantities and parameters by name. */
  formula?: string;
}

/** One activity of a pour's chain: the activities of the pours of a group, in order. The group of the highest priority that fits a pour decides its
    chain (empty group = every pour; none fits: the generator's Rebar, Formwork and Concrete, or Installation for precast). The days, crew and
    calendar of each phase are Assignments. Suffix is the end of the activity id (-R), label the end of its name; material 'rebar' / 'concrete' puts
    the pour's rebar tonnes / concrete volume on the activity. The links the generator builds look for the phases it knows by name (Concrete,
    Stitching, Installation, Decking, Rebar), so a chain should keep one of them. */
export interface ChainRow extends Row {
  group: string;
  order: number;
  phase: string;
  suffix?: string;
  label?: string;
  material?: '' | 'rebar' | 'concrete';
  /** What the activity follows: "Decking@80, Under Slab" is 80 % of Decking done (it starts that far into it) and Under Slab finished. Empty: the
      activity before it in the chain, finished. */
  follows?: string;
  /** With a share below 100 %: the activity also cannot finish before what it follows does. */
  finishAfter?: boolean;
  /** What follows the pour (the objects standing on it, the slab above) waits for this activity: a raft's Curing, say. Empty: its Concrete. */
  gates?: boolean;
  priority?: number;
}

export interface RebarRow extends Row {
  when: When;
  tonnesPerM3: number;
}

export interface CrewRule extends Row {
  when: When;
  phase: string;
  trades: { trade: string; size: number }[];
}

/** A named selection of pours: the objects that meet `select`, or are in any group in `include`. forEach makes one group per
    value of those terms (per building and level, say). Not the 4D Link Groups: these live in the rules only. */
/** What the generator does with the objects of a group besides what other rules say: "exclude" leaves them out of the schedule, "stairStep" makes
    them steps cast with the stair flight they touch. */
export type GroupTreatAs = 'exclude' | 'stairStep';

/** A group's conditions are rows like a 4D Link Group's: a field, an operator and a value, joined by And / Or (read left to right). The
    value of Equals / Not equals may list alternatives with "|" (BOSS|SCREED). Fields are the object's own (see FILTER_FIELDS) or a model property,
    written prop:<property set>/<name>. */
export type FilterOp = 'equals' | 'notEquals' | 'contains' | 'notContains' | 'startsWith' | 'endsWith' | 'lessThan' | 'atMost' | 'greaterThan' | 'atLeast';

export interface GroupFilter {
  id: string;
  field: string;
  op: FilterOp;
  value: string;
  conj: 'and' | 'or';
  caseSensitive?: boolean;
  /** Switched off: the condition is kept but not applied. */
  ignore?: boolean;
}

export const FILTER_OPS: { value: FilterOp; label: string; numeric?: boolean }[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Not equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'notContains', label: 'Does not contain' },
  { value: 'startsWith', label: 'Starts with' },
  { value: 'endsWith', label: 'Ends with' },
  { value: 'lessThan', label: 'Less than', numeric: true },
  { value: 'atMost', label: 'At most', numeric: true },
  { value: 'greaterThan', label: 'Greater than', numeric: true },
  { value: 'atLeast', label: 'At least', numeric: true },
];

/** The object's own fields a condition can read. */
export const FILTER_FIELDS: { value: string; label: string }[] = [
  { value: 'building', label: 'Building' },
  { value: 'level', label: 'Level' },
  { value: 'levelNumber', label: 'Level number' },
  { value: 'type', label: 'Type' },
  { value: 'family', label: 'Family' },
  { value: 'stage', label: 'Stage' },
  { value: 'zone', label: 'Zone' },
  { value: 'external', label: 'External' },
  { value: 'doubleHeight', label: 'Double height' },
  { value: 'general', label: 'General type' },
  { value: 'volume', label: 'Volume (m³)' },
];

/** Conditions written as key = value terms (how groups were saved before they had rows) as rows. */
export function selectToFilters(select: When | undefined): GroupFilter[] {
  const w = select ?? {};
  const out: GroupFilter[] = [];
  const add = (field: string, op: FilterOp, value: string | undefined) => {
    if (value !== undefined && String(value).trim() !== '') out.push({ id: `c${out.length + 1}`, field, op, value: String(value).trim(), conj: 'and' });
  };
  for (const k of ['building', 'level', 'type', 'family', 'stage', 'zone', 'external', 'doubleHeight', 'general'] as const) add(k, 'equals', w[k]);
  add('type', 'notEquals', w.typeNot);
  add('levelNumber', 'atLeast', w.levelFrom ? String(/-?\d+/.exec(w.levelFrom)?.[0] ?? '') : undefined);
  add('levelNumber', 'atMost', w.levelTo ? String(/-?\d+/.exec(w.levelTo)?.[0] ?? '') : undefined);
  add('volume', 'atLeast', w.volumeFrom);
  add('volume', 'lessThan', w.volumeBelow);
  return out;
}

export interface RuleGroup extends Row {
  name?: string;
  treatAs?: GroupTreatAs;
  forEach: ('building' | 'level' | 'zone' | 'type' | 'family' | 'stage')[];
  /** The conditions: rows of field, operator and value. A group with none (and no `include`) holds nothing. */
  filters: GroupFilter[];
  include?: string[];
}

/** Per building and level, a task (a level of effort) that starts with the earliest object of its group and finishes with the latest. */
export interface LevelTask extends Row {
  name: string;
  group: string;
}

export interface SequenceStep {
  group: string;
  /** Repeated for every level in turn (the steps marked this way are interleaved level by level). */
  perLevel?: boolean;
  /** The link into this step from the one before (default: the sequence's, finish to start), with a lag in hours. */
  type?: RelType;
  lagHours?: number;
  note?: string;
}

/** Groups put in order: the next step starts when the previous one is done. */
export interface RuleSequence extends Row {
  name?: string;
  steps: SequenceStep[];
  /** A folder of search sets whose sets are the steps, in the folder's order (the steps are then made from it, each set a group). */
  stepsFolder?: string;
  type?: RelType;
  lagHours?: number;
}

export type RelType = 'FS' | 'SS' | 'FF' | 'SF';

/** Links from what the clash detection found in contact with each object of `subject`. */
export interface ContactRule extends Row {
  name?: string;
  /** The objects that get the links (the slabs, say). */
  subject: When;
  /** Where the other object sits: below the subject, above, beside, or anywhere. */
  contact: 'below' | 'above' | 'side' | 'any';
  /** Only "definitely below" (clear vertical separation), not "majority below" as well. */
  position?: 'any' | 'definite';
  /** What the other object must be (empty: any object in contact). */
  with: When;
  /** Which activity of the other object / of the subject the link joins. */
  predEnd: 'final' | 'start' | 'last';
  succEnd: 'start' | 'final' | 'last';
  direction?: 'subjectIsSuccessor' | 'subjectIsPredecessor';
  type?: RelType;
  lagHours?: number;
  /** Levels apart at most (0 = same level only). */
  maxLevelGap?: number | '';
  ignoreStage2?: boolean;
  /** The engine's own links into the subjects are left out: this rule takes their place. */
  replaceBuiltIn?: ('slabSupport' | 'levelGate')[];
}

/** Activities tied to the level tasks of their own building and level. */
export interface LevelLink extends Row {
  name?: string;
  /** The extra activities (tagged with a building and level), the open-ended ones, or a select:{...} of the programme. */
  activities: 'extras' | 'open' | 'select';
  select?: string;
  /** The level tasks to link to (their ids). */
  tasks: string[];
  type?: RelType;
  lagHours?: number;
  /** toTask: the activity precedes the task (FF: the task finishes with it). fromTask: the task precedes the activity. */
  direction?: 'toTask' | 'fromTask';
  /** Extras only: a select:{...} of the pours' activities (such as `type=SLAB; phase=Concrete`). When set, an extra is linked to those of its own building and
      level instead of to the level tasks (a tag's level task still limits it to that kind: Slabs, Walls). */
  pours?: string;
}

export type SettingValue = number | boolean | string[] | undefined;

/** wbs: empty = the Extra activities folder; "level" = on the building's level (beside the External / Internal Walls and Slabs groups);
    "slabs" = in the level's Slabs group; "path:A / B" = a folder of its own under the building's Construction node. task: the id of the one
    level task a level link ties it to (empty = every task the link names). */
export interface ExtraTag {
  building?: string;
  level?: string;
  wbs?: string;
  task?: string;
  /** What the extra is: task, start / finish milestone, WBS summary, level of effort (empty: a task, or a finish milestone with no days). */
  kind?: string;
}

/** Objects joined into one: they get the activities of the main object only (the first picked), as if they were a single object. Made in the
    3D view with Alt+J; the objects themselves are not merged. GlobalIds of the model's objects. */
export interface ObjectJoin extends Row {
  main: string;
  members: string[];
}

/** A pool of the scenario: a type of equipment, crane or material and how many of it there are (0: not limited). Recipes name the type; the
    count is the scenario's (so one recipes file serves scenarios with different fleets). Written to P6 as a resource, the count its max units. */
export type PoolKind = 'equipment' | 'crane' | 'material';
export const POOL_KINDS: { value: PoolKind; label: string }[] = [
  { value: 'equipment', label: 'Equipment' },
  { value: 'crane', label: 'Crane' },
  { value: 'material', label: 'Material' },
];
export interface PoolRow extends Row {
  kind: PoolKind;
  name: string;
  quantity: number;
}

/** A named value the duration formulas read (Rebar_Rate = 500, Curing_Days = 3, Formwork_Sets_Available = 4). The scenario's own: change one and update 4D. */
export interface ParameterRow extends Row {
  /** The name, as formulas write it (letters, digits, _; not case sensitive). */
  name: string;
  value: number;
  unit?: string;
}

/** At most `max` activities of one phase run at once (formwork sets, a specialist crew ...): the generator chains them in lanes, in the order of the
    steps. `max` is a number or the name of a parameter; empty or 0: no limit. `group` limits it to the pours of a group. */
export interface LimitRow extends Row {
  phase: string;
  group?: string;
  max: number | string;
}

export interface ScenarioRules {
  version: 1;
  settings: Record<string, SettingValue>;
  durations: DurationRow[];
  productivity: ProductivityRow[];
  rebar: RebarRow[];
  crews: CrewRule[];
  trades: TradeRow[];
  rates: RateRow[];
  crewTemplates: CrewTemplate[];
  assignments: Assignment[];
  chains: ChainRow[];
  calendars: CalendarRow[];
  calendarRules: CalendarRule[];
  groups: RuleGroup[];
  levelTasks: LevelTask[];
  sequences: RuleSequence[];
  contacts: ContactRule[];
  levelLinks: LevelLink[];
  joins: ObjectJoin[];
  /** How each kind of object is built (docs/design/recipes.md, prs/recipes.ts): compiled into chains and assignments for the generator. The scenario's own, like its joins. */
  recipes: Recipe[];
  /** How many of each equipment, crane and material type the scenario has (the recipes' resources). The scenario's own, like its recipes. */
  resourcePools: PoolRow[];
  /** Named values for the duration formulas, and the limits on activities running at once (the scenario's own, saved with its rules). */
  parameters: ParameterRow[];
  limits: LimitRow[];
  /** Where an extra activity belongs, by its ID: its building and level (for the level links and the WBS), where it goes in the WBS, and
      which level task it is tied to. */
  extraTags: Record<string, ExtraTag>;
}

/** The one empty set of rules (same object each time, so "unchanged" is a plain comparison). */
export const NO_RULES: ScenarioRules = Object.freeze({
  version: 1,
  settings: Object.freeze({}) as Record<string, SettingValue>,
  durations: [], productivity: [], rebar: [], crews: [], trades: [], rates: [], crewTemplates: [], assignments: [], chains: [], calendars: [], calendarRules: [], groups: [], levelTasks: [], sequences: [], contacts: [], levelLinks: [], joins: [], recipes: [], resourcePools: [], parameters: [], limits: [],
  extraTags: Object.freeze({}) as ScenarioRules['extraTags'],
}) as ScenarioRules;

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]).filter((x) => x && typeof x === 'object') : []);

/** Rules as saved (or as an older version of the panel saved them): every section present, nothing unknown trusted. */
export function normalizeRules(raw: unknown): ScenarioRules {
  if (!raw || typeof raw !== 'object') return NO_RULES;
  const r = raw as Partial<ScenarioRules>;
  const out: ScenarioRules = {
    version: 1,
    settings: r.settings && typeof r.settings === 'object' && !Array.isArray(r.settings) ? { ...r.settings } : {},
    durations: arr<DurationRow>(r.durations).map((d) => ({ ...d, when: d.when ?? {}, phases: d.phases ?? {} })),
    productivity: arr<ProductivityRow>(r.productivity).map((d) => ({ ...d, when: d.when ?? {} })),
    rebar: arr<RebarRow>(r.rebar).map((d) => ({ ...d, when: d.when ?? {} })),
    crews: arr<CrewRule>(r.crews).map((d) => ({ ...d, when: d.when ?? {}, trades: arr<{ trade: string; size: number }>(d.trades) })),
    trades: arr<TradeRow>(r.trades),
    rates: arr<RateRow>(r.rates).map((d) => ({ ...d, type: d.type === 'productivity' || d.type === 'rebar' ? d.type : 'days' })),
    crewTemplates: arr<CrewTemplate>(r.crewTemplates).map((d) => ({ ...d, trades: arr<{ trade: string; size: number }>(d.trades) })),
    assignments: arr<Assignment>(r.assignments),
    chains: arr<ChainRow>(r.chains),
    calendars: arr<CalendarRow>(r.calendars).map((c) => ({ ...c, workDays: Array.isArray(c.workDays) ? c.workDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [0, 1, 2, 3, 4] })),
    calendarRules: arr<CalendarRule>(r.calendarRules).map((c) => ({ ...c, when: c.when ?? {} })),
    groups: arr<RuleGroup & { select?: When }>(r.groups).map(({ select, ...g }) => ({ ...g, forEach: Array.isArray(g.forEach) ? g.forEach : [], filters: Array.isArray(g.filters) && g.filters.length ? g.filters : selectToFilters(select) })),
    levelTasks: arr<LevelTask>(r.levelTasks),
    sequences: arr<RuleSequence>(r.sequences).map((s) => ({ ...s, steps: arr<SequenceStep>(s.steps) })),
    contacts: arr<ContactRule>(r.contacts).map((c) => ({ ...c, subject: c.subject ?? {}, with: c.with ?? {} })),
    levelLinks: arr<LevelLink>(r.levelLinks).map((l) => ({ ...l, tasks: Array.isArray(l.tasks) ? l.tasks : [] })),
    joins: arr<ObjectJoin>(r.joins).filter((j) => typeof j.main === 'string' && j.main).map((j) => ({ ...j, members: Array.isArray(j.members) ? j.members.filter((m) => typeof m === 'string' && m && m !== j.main) : [] })),
    recipes: normalizeRecipes({ recipes: r.recipes }).recipes,
    resourcePools: arr<PoolRow>(r.resourcePools).filter((p) => typeof p.id === 'string' && p.id.trim() !== '').map((p) => ({ ...p, kind: p.kind === 'crane' || p.kind === 'material' ? p.kind : 'equipment', name: p.name ?? '', quantity: Number.isFinite(Number(p.quantity)) ? Number(p.quantity) : 0 })),
    parameters: arr<ParameterRow>(r.parameters).filter((p) => typeof p.name === 'string' && p.name.trim() !== '').map((p) => ({ ...p, id: p.id || p.name, value: Number.isFinite(Number(p.value)) ? Number(p.value) : 0 })),
    limits: arr<LimitRow>(r.limits).filter((l) => typeof l.phase === 'string' && l.phase.trim() !== '').map((l) => ({ ...l, id: l.id || `${l.group ? `${l.group}|` : ''}${l.phase}` })),
    extraTags: r.extraTags && typeof r.extraTags === 'object' && !Array.isArray(r.extraTags) ? { ...r.extraTags } : {},
  };
  return isEmptyRules(out) ? NO_RULES : out;
}

export type RuleSection = 'settings' | 'groups' | 'durations' | 'productivity' | 'rebar' | 'crews' | 'trades' | 'rates' | 'crewTemplates' | 'assignments' | 'chains' | 'calendars' | 'calendarRules' | 'levelTasks' | 'sequences' | 'contacts' | 'levelLinks';

const SECTIONS: RuleSection[] = ['settings', 'groups', 'durations', 'productivity', 'rebar', 'crews', 'trades', 'rates', 'crewTemplates', 'assignments', 'chains', 'calendars', 'calendarRules', 'levelTasks', 'sequences', 'contacts', 'levelLinks'];

export const sectionCount = (r: ScenarioRules, section: RuleSection): number =>
  section === 'settings' ? Object.values(r.settings).filter((v) => v !== undefined).length : (r[section] as unknown[]).length;

export const isEmptyRules = (r: ScenarioRules): boolean =>
  SECTIONS.every((s) => sectionCount(r, s) === 0) &&
  (r.joins ?? []).length === 0 &&
  (r.recipes ?? []).length === 0 &&
  (r.resourcePools ?? []).length === 0 &&
  (r.parameters ?? []).length === 0 &&
  (r.limits ?? []).length === 0 &&
  Object.keys(r.extraTags).length === 0;

export const totalRules = (r: ScenarioRules): number =>
  SECTIONS.reduce((n, s) => n + sectionCount(r, s), 0) + (r.joins ?? []).length + (r.recipes ?? []).length + (r.resourcePools ?? []).length + (r.parameters ?? []).length + (r.limits ?? []).length;

/** A new row id that no row of the section has: "WALLS", "WALLS-2", ... (or prefix-1, prefix-2 ...). */
export function freshId(prefix: string, existing: string[]): string {
  const taken = new Set(existing.map((e) => e.toUpperCase()));
  if (!taken.has(prefix.toUpperCase())) return prefix;
  let n = 2;
  while (taken.has(`${prefix}-${n}`.toUpperCase())) n++;
  return `${prefix}-${n}`;
}

/** The terms a row has, in the order they read: "slab · level L1 to L3 · group SLOW". */
export function whenText(when: When | undefined): string {
  if (!when) return 'every pour';
  const parts: string[] = [];
  if (when.group) parts.push(`group ${when.group}`);
  if (when.family) parts.push(when.family);
  if (when.type) parts.push(when.type);
  if (when.typeNot) parts.push(`not ${when.typeNot}`);
  if (when.building) parts.push(`building ${when.building}`);
  if (when.level) parts.push(`level ${when.level}`);
  if (when.levelFrom || when.levelTo) parts.push(`levels ${when.levelFrom || '…'} to ${when.levelTo || '…'}`);
  if (when.stage) parts.push(`stage ${when.stage}`);
  if (when.zone) parts.push(when.zone);
  if (when.external) parts.push(when.external === 'true' ? 'external' : 'internal');
  if (when.doubleHeight) parts.push(when.doubleHeight === 'true' ? 'double height' : 'standard height');
  if (when.general) parts.push(when.general);
  if (when.volumeFrom) parts.push(`at least ${when.volumeFrom} m³`);
  if (when.volumeBelow) parts.push(`under ${when.volumeBelow} m³`);
  return parts.length ? parts.join(' · ') : 'every pour';
}

/** How many conditions a `when` has: the specificity the generator ranks rows by (a level range counts once). */
export function whenTerms(when: When | undefined): number {
  const w = when ?? {};
  const has = (k: WhenKey) => String(w[k] ?? '').trim() !== '';
  const single = (['group', 'family', 'type', 'building', 'level', 'stage', 'zone', 'external', 'doubleHeight', 'general', 'volumeFrom', 'volumeBelow', 'typeNot'] as const).filter(has).length;
  return single + (has('levelFrom') || has('levelTo') ? 1 : 0);
}

/** Drops empty terms (so the saved rules stay small). */
export function cleanWhen(when: When): When {
  const out: When = {};
  for (const k of WHEN_KEYS) {
    const v = String(when[k] ?? '').trim();
    if (v) out[k] = v;
  }
  return out;
}

/** The engine's switches, in the order the panel lists them. `unit` shows after a number. */
export interface SettingMeta {
  key: string;
  label: string;
  help: string;
  kind: 'bool' | 'number' | 'list';
  unit?: string;
  group: 'Sequence' | 'Level gate' | 'Open ends & close-out' | 'Slab curing & phases' | 'Clash positions' | 'Resources';
}

export const SETTINGS_META: SettingMeta[] = [
  { key: 'sequenceFlow', label: 'Steps overlap (flow)', kind: 'bool', group: 'Sequence', help: "Off: each step of the scenario's order starts when the one before it has finished (a relay: a long programme). On: the order is the order the work starts and the concrete is poured: a step starts a few days after the previous step starts, its concrete follows the previous step's, and each pour's own rebar, formwork and concrete run as they can." },
  { key: 'sequenceLeadDays', label: 'A step starts this long after the previous one', kind: 'number', unit: 'working days', group: 'Sequence', help: 'Only with Steps overlap. 0: every step starts with the one before (the concrete order alone sets the pace). More days: a slower build, with each step later. The default is 3.' },
  { key: 'sequenceConcreteFollows', label: "A step's concrete follows the previous step's", kind: 'bool', group: 'Sequence', help: "Only with Steps overlap. On (the default): the pours are cast in exactly the order of the steps, so a pour that is not ready yet (a slab waiting for its rebar, say) holds up every pour after it. Off: the order sets when each step starts, and a pour is cast when it is ready; the programme is shorter." },
  { key: 'levelGate', label: 'Level gate', kind: 'bool', group: 'Level gate', help: "A slab's first task waits for the concrete of the objects on the level below that touch it." },
  { key: 'levelGateSlabsOnly', label: 'Slabs only', kind: 'bool', group: 'Level gate', help: 'Only slabs are tied back to the level below; walls and columns follow their own slab.' },
  { key: 'levelGateDeckingConcreteOnly', label: 'Concrete of the level below only', kind: 'bool', group: 'Level gate', help: "Only the lower level's Concrete tasks (not Stitching or Installation) and no stage-2 objects feed a slab's first task." },
  { key: 'levelGateMaxDistanceM', label: 'Reach', kind: 'number', unit: 'm', group: 'Level gate', help: 'A slab waits only for lower-level objects within this gap of it (plan gap and vertical gap). 0 = no limit: every object of the level below.' },
  { key: 'completionCloseout', label: 'Completion milestone per building', kind: 'bool', group: 'Open ends & close-out', help: 'Every activity left with no successor feeds a building completion milestone, so the programme has no open ends.' },
  { key: 'openEndSequencing', label: 'Open-ended objects precede the slab above', kind: 'bool', group: 'Open ends & close-out', help: 'A column, wall or landing with no successor precedes the start of the slab sitting on it.' },
  { key: 'openEndMaxDistanceM', label: 'Reach', kind: 'number', unit: 'm', group: 'Open ends & close-out', help: 'A slab counts as "on it" within this gap.' },
  { key: 'openEndNearestSlabFallback', label: 'Nearest slab above when none is in reach', kind: 'bool', group: 'Open ends & close-out', help: 'Only objects with no slab above them at all (the roof) then end on the completion milestone.' },
  { key: 'slabCuringGatesSuccessors', label: 'Curing holds back what follows', kind: 'bool', group: 'Slab curing & phases', help: "Off: what follows a slab waits for its Concrete only and Curing runs alongside. On: it waits for the Curing to finish." },
  { key: 'maximizeResources', label: 'Maximize resource availability', kind: 'bool', group: 'Resources', help: 'No labour trade, equipment, crane or material pool has a limit: the programme the logic alone allows, to see the shortest build when resources are not the constraint. Switch it off to go back to the capacities and counts of the scenario (they are kept).' },
  { key: 'sideOverlapThreshold', label: 'Beside = overlap of at least', kind: 'number', group: 'Clash positions', help: "How much of the smaller object's height must overlap the other for the pair to count as beside (rather than below or above): 0 to 1." },
];

/** The trades a crew can name: the generator's own with the rules' trades over them (by code); a trade switched off is left out. */
export function mergeTrades(engine: { code: string; name: string; capacity?: number | null }[], rows: TradeRow[]): { code: string; name: string; capacity?: number | null }[] {
  const out = new Map(engine.map((t) => [t.code.toUpperCase(), t]));
  for (const r of rows) {
    const code = r.id.trim().toUpperCase();
    if (!code) continue;
    if (r.enabled === false) out.delete(code);
    else out.set(code, { code, name: r.name || code, capacity: r.capacity || 0 });
  }
  return [...out.values()];
}

/** What the generator reports it does without rules (scenario-engine/core/rules.py engine_defaults). */
export interface EngineDefaults {
  settings: Record<string, number | boolean | string[] | null>;
  pourTypes: string[];
}

/** The activities (phases) a duration row can set, with the days each has without rules for a given duration key. */
/** The days of the week, Monday first (CalendarRow.workDays indexes it). */
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const COMPONENT_PHASES = ['Rebar', 'Embedments', 'Formwork', 'Concrete'] as const;
export const ACTIVITY_PHASES = ['Decking', 'Under Slab', 'EOP on Slab', 'FWK', 'Works before slab', 'Curing', 'Propping', 'Installation', 'Stitching', 'Propping Removal'] as const;
export const PRODUCTIVITY_PHASES = ['Rebar', 'Formwork', 'Concrete', 'Decking', 'Under Slab', 'EOP on Slab', 'FWK'] as const;

/** The key of an assignment: its group and phase (one row each). */
export const assignmentKey = (a: Pick<Assignment, 'group' | 'phase'>) => `${a.group.trim().toUpperCase()}|${a.phase.trim().toUpperCase()}`;

/** The key of a chain row: its group and phase. */
export const chainKey = (c: Pick<ChainRow, 'group' | 'phase'>) => `${c.group.trim().toUpperCase()}|${c.phase.trim().toUpperCase()}`;

/** A group's chain in a file replaces the chain that group has (a group's rows are one chain: the others stay). */
function mergeChains(base: ChainRow[], incoming: ChainRow[]): ChainRow[] {
  const groups = new Set(incoming.map((c) => c.group.trim().toUpperCase()));
  return [...base.filter((c) => !groups.has(c.group.trim().toUpperCase())), ...incoming];
}

function mergeAssignments(base: Assignment[], incoming: Assignment[]): Assignment[] {
  const keys = new Set(incoming.map(assignmentKey));
  return [...base.filter((a) => !keys.has(assignmentKey(a))), ...incoming];
}

/** A file's rules added to the scenario's: a row with the same id (in its section) is replaced, the others are added; a setting is replaced. */
export function mergeRules(base: ScenarioRules, incoming: ScenarioRules): ScenarioRules {
  const byId = <T extends { id: string }>(a: T[], b: T[]): T[] => {
    const ids = new Set(b.map((x) => x.id.toUpperCase()));
    return [...a.filter((x) => !ids.has(x.id.toUpperCase())), ...b];
  };
  const next: ScenarioRules = {
    version: 1,
    settings: { ...base.settings, ...incoming.settings },
    durations: byId(base.durations, incoming.durations),
    productivity: byId(base.productivity, incoming.productivity),
    rebar: byId(base.rebar, incoming.rebar),
    crews: byId(base.crews, incoming.crews),
    trades: byId(base.trades, incoming.trades),
    rates: byId(base.rates, incoming.rates),
    crewTemplates: byId(base.crewTemplates, incoming.crewTemplates),
    assignments: mergeAssignments(base.assignments, incoming.assignments),
    chains: mergeChains(base.chains, incoming.chains),
    calendars: byId(base.calendars, incoming.calendars),
    calendarRules: byId(base.calendarRules, incoming.calendarRules),
    groups: byId(base.groups, incoming.groups),
    levelTasks: byId(base.levelTasks, incoming.levelTasks),
    sequences: byId(base.sequences, incoming.sequences),
    contacts: byId(base.contacts, incoming.contacts),
    levelLinks: byId(base.levelLinks, incoming.levelLinks),
    joins: base.joins ?? [], // (the objects joined in this scenario stay; joins belong to the scenario's order, not to a file or preset)
    recipes: base.recipes ?? [], // (so do its recipes: their own file, not a preset's)
    resourcePools: base.resourcePools ?? [], // (and its pools of equipment, cranes and materials)
    parameters: byId(base.parameters ?? [], incoming.parameters ?? []),
    limits: byId(base.limits ?? [], incoming.limits ?? []),
    extraTags: { ...base.extraTags, ...incoming.extraTags },
  };
  return isEmptyRules(next) ? NO_RULES : next;
}
