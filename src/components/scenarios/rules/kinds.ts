/** The types of rule the Rules list holds. One list, one row per rule, each with its type; the type decides what its editor shows
    (like the rule templates of a Solibri ruleset). The order here is the order the list shows them in. */

export type RuleKind =
  | 'extra' | 'link' | 'crewOverride'
  | 'rateTable' | 'crewTable' | 'assignmentTable' | 'chainTable'
  | 'duration' | 'productivity' | 'rebar' | 'crew' | 'trade'
  | 'calendar' | 'calendarRule'
  | 'setting'
  | 'group' | 'levelTask' | 'sequence' | 'levelLink' | 'contact';

/** Colour family of the badge and the row's edge. */
export type KindFamily = 'programme' | 'rates' | 'engine' | 'structure' | 'logic';

export interface KindMeta {
  id: RuleKind;
  label: string;
  family: KindFamily;
  /** One line: what the rule does (shown in the Add rule picker and on the badge). */
  tip: string;
  /** Needs something else first (groups, level tasks, ...) and the word for it. */
  needs?: 'groups' | 'levelTasks' | 'calendars';
  /** The old form: still read and shown, but no longer offered in Add rule (the tables replace it). */
  legacy?: boolean;
}

export const KINDS: KindMeta[] = [
  { id: 'extra', label: 'Extra activities', family: 'programme', tip: 'Activities from a high-level programme that the generated one has to include, as one table: tasks, milestones or summaries, with their WBS place' },
  { id: 'link', label: 'Manual link', family: 'programme', tip: 'A link between two activities, or selections of them; it replaces the generated links into its successor' },
  { id: 'crewOverride', label: 'Crew override', family: 'programme', tip: 'People per day of one trade on a phase (and type); replaces the default crew of that phase' },
  { id: 'chainTable', label: 'Chains', family: 'rates', tip: 'The activities of the pours of a group, in order (Rebar, Formwork, Concrete; Decking ... Curing; Installation, Stitching ...). A table you can copy to Excel', needs: 'groups' },
  { id: 'assignmentTable', label: 'Assignments', family: 'rates', tip: 'The link table: for each group and phase, the rate, crew and calendar its objects get, with a priority. Copy it to Excel and paste it back', needs: 'groups' },
  { id: 'rateTable', label: 'Rates', family: 'rates', tip: 'Named rates, defined once and linked to many groups: fixed days, productivity (man-hours per unit) or a rebar density. A table you can copy to Excel' },
  { id: 'crewTable', label: 'Crews', family: 'rates', tip: 'Named crews (trades and people per day), defined once and linked to many groups. A table you can copy to Excel' },
  { id: 'duration', label: 'Duration', family: 'rates', legacy: true, tip: 'Days of each phase for the objects its conditions fit' },
  { id: 'productivity', label: 'Productivity', family: 'rates', legacy: true, tip: 'A duration worked out from the quantity: tonnes or m³ × man-hours ÷ (people × shifts × hours)' },
  { id: 'rebar', label: 'Rebar rate', family: 'rates', legacy: true, tip: 'Tonnes of rebar per m³ of concrete' },
  { id: 'crew', label: 'Crew rule', family: 'rates', legacy: true, tip: 'The crew of a phase for the objects its conditions fit (a group, levels, a type ...)' },
  { id: 'trade', label: 'Trade', family: 'rates', tip: 'A labour trade the crews are made of: its code, name and the people per day the site has' },
  { id: 'calendar', label: 'Calendar', family: 'engine', tip: 'A working week: the days, the start and the hours a day (add one by hand or import them from a P6 schedule)' },
  { id: 'calendarRule', label: 'Calendar rule', family: 'engine', legacy: true, tip: 'Which activities run on which calendar: a group, a type, a level range ..., or one phase of them (Curing)', needs: 'calendars' },
  { id: 'setting', label: 'Setting', family: 'engine', tip: "One of the engine's switches or distances (level gate, curing, smallest object ...)" },
  { id: 'group', label: 'Group', family: 'structure', tip: 'A named selection of objects, used by name in other rules, and the way to leave objects out of the schedule (not the 4D Link Groups)' },
  { id: 'levelTask', label: 'Level task', family: 'structure', tip: 'Per building and level, a task dated from the objects of a group', needs: 'groups' },
  { id: 'sequence', label: 'Sequence', family: 'logic', tip: 'Groups put in order, level by level', needs: 'groups' },
  { id: 'levelLink', label: 'Level link', family: 'logic', tip: 'Activities tied to the level tasks of their own building and level', needs: 'levelTasks' },
  { id: 'contact', label: 'Contact link', family: 'logic', tip: 'Links built from the objects the clash detection found in contact' },
];

export const KIND_BY_ID = Object.fromEntries(KINDS.map((k) => [k.id, k])) as Record<RuleKind, KindMeta>;
export const KIND_ORDER = KINDS.map((k) => k.id);

/** Where each section of the validation (prs/match validateRules) lives in the list. */
export const SECTION_KIND: Record<string, RuleKind> = {
  rates: 'rateTable', chains: 'chainTable', crewTemplates: 'crewTable', assignments: 'assignmentTable', durations: 'duration', productivity: 'productivity', rebar: 'rebar', crews: 'crew', trades: 'trade', calendars: 'calendar', calendarRules: 'calendarRule', settings: 'setting',
  groups: 'group', levelTasks: 'levelTask', sequences: 'sequence', levelLinks: 'levelLink', contacts: 'contact', extras: 'extra', links: 'link',
};
