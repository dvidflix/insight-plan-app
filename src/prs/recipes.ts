import type { Assignment, ChainRow, ScenarioRules } from './rules';

/** Lags are kept in hours (what the generator reads) and shown in days. */
export const HOURS_PER_DAY = 8;

/** Recipes: how a kind of object is built, in their own file, apart from the scenario's sequence (docs/design/recipes.md).
    A recipe belongs to a rule group and holds the tasks (the activities of the object, in order, with the links between them) and the
    days, rate, crew and calendar of each. Step 1: a recipe is compiled into the Chains and Assignments the generator already reads
    (scenario-engine/core/recipes.py does the same on the engine's side), so the generator has no second path. */

/** Equipment, a crane or a material a task uses: a type of the scenario's pools and how many (1 when empty), held for the whole task. */
export interface ResourceUse {
  type: string;
  count?: number;
}

/** A call of a task of another recipe: "after" the other recipe's task `phase` follows this task, "before" it precedes it, for the objects of the two
    recipes' groups that are in the same level (scope "level"), building or anywhere. The graph shows it as a green Recipe link node. */
export interface RecipeLink {
  /** The other recipe's id. */
  recipe: string;
  /** The task of that recipe. */
  phase: string;
  direction?: 'after' | 'before';
  type?: 'FS' | 'SS' | 'FF' | 'SF';
  lagHours?: number;
  scope?: 'level' | 'building' | 'all';
  enabled?: boolean;
}

/** A task of a recipe: one activity of the object. `phase` is its name inside the recipe and the name the generator knows it by. */
export interface RecipeTask {
  phase: string;
  /** The end of the activity's name ("Rebar", "E/P and Formwork"). */
  name?: string;
  /** The end of its id (-R). */
  suffix?: string;
  /** 'rebar' / 'concrete' puts the pour's rebar tonnes / concrete volume on the activity. */
  material?: '' | 'rebar' | 'concrete';
  /** Fixed days, or a named rate (Rates), or a rebar rate (density), a named crew (Crews) and a calendar (Calendars). */
  days?: number;
  /** The duration in working days as a formula of quantities and the scenario's parameters, such as `max(1, Concrete_m3 / Concrete_Rate)`
      (prs/durationFormula's language; names: Concrete_m3, Rebar_t, Rebar_kg, Footprint_m2, Sides_m2, crews, and the parameters). It beats a rate; it is
      worked out when the programme is generated. */
  formula?: string;
  rate?: string;
  density?: string;
  crew?: string;
  calendar?: string;
  /** Of these values: a higher one beats a lower one (0 when empty). */
  priority?: number;
  /** What the task uses besides its crew (cranes are equipment of their own kind: the one that is usually short). */
  /** Calls of tasks of other recipes. */
  links?: RecipeLink[];
  equipment?: ResourceUse[];
  cranes?: ResourceUse[];
  materials?: ResourceUse[];
  /** With a share below 100 %: the task also cannot finish before what it follows does. */
  finishAfter?: boolean;
  /** What follows the object waits for this task, not for its Concrete. */
  gates?: boolean;
  /** A task switched off is kept but not applied. */
  enabled?: boolean;
  note?: string;
  /** Where the task sits in the graph editor (not used by the generator); empty: where Auto Layout puts it. */
  x?: number;
  y?: number;
  /** The width of its card in the graph editor; empty: fitted to what it shows. */
  w?: number;
}

/** `to` starts when `from` is `sharePct` done (100 when empty: finished). A task with no edge into it follows the task before it, finished. */
export interface RecipeEdge {
  from: string;
  to: string;
  sharePct?: number;
  /** An explicit link type, with a lag in hours (negative: an overlap). Without them: finish-to-start, or start-to-start at `sharePct`. Several edges may join the same two tasks (SS and FS). */
  type?: 'FS' | 'SS' | 'FF' | 'SF';
  lagHours?: number;
  /** The lag as a share of a duration instead of hours (negative: an overlap): of the task it follows (`pred`, the usual) or of this task's own duration (`succ`). Replaces `lagHours`. */
  lagPct?: number;
  lagOf?: 'pred' | 'succ';
}

export interface Recipe {
  id: string;
  name?: string;
  /** The folder of the recipe list it is in (only the list uses it; empty: not in one). */
  folder?: string;
  /** The rule group whose objects the recipe applies to (empty: every object). */
  group: string;
  /** Of the recipe's activities, when several groups fit an object: the highest wins, a tie goes to the earlier recipe. */
  priority?: number;
  /** True (the usual): the tasks are the activities the object gets. False: it only sets the values of the tasks (days, rate, crew,
      calendar) for the objects of its group, and the activities come from another recipe. */
  chain?: boolean;
  tasks: RecipeTask[];
  edges?: RecipeEdge[];
  /** Where the "Previous Elements" and "Next Elements" boxes sit in the graph editor; empty: where Auto Layout puts them. */
  startAt?: { x: number; y: number };
  endAt?: { x: number; y: number };
  /** The widths of those two boxes. */
  startW?: number;
  endW?: number;
  enabled?: boolean;
  note?: string;
}

/** The recipes file of a project. */
export interface RecipesFile {
  version: 1;
  recipes: Recipe[];
}

export const NO_RECIPES: RecipesFile = Object.freeze({ version: 1, recipes: [] }) as RecipesFile;

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]).filter((x) => x && typeof x === 'object') : []);

/** A recipes file as saved (or edited by hand): every recipe has its tasks, nothing unknown is trusted. */
export function normalizeRecipes(raw: unknown): RecipesFile {
  if (!raw || typeof raw !== 'object') return NO_RECIPES;
  const recipes = arr<Recipe>((raw as Partial<RecipesFile>).recipes)
    .filter((r) => typeof r.id === 'string' && r.id.trim() !== '')
    .map((r) => ({
      ...r,
      group: typeof r.group === 'string' ? r.group : '',
      // (a values-only recipe may have a task with no phase: its values are for every phase of the group, a calendar for instance)
      tasks: arr<RecipeTask>(r.tasks).filter((t) => typeof t.phase === 'string' && (t.phase.trim() !== '' || r.chain === false)),
      edges: arr<RecipeEdge>(r.edges).filter((e) => typeof e.from === 'string' && typeof e.to === 'string'),
    }));
  return recipes.length ? { version: 1, recipes } : NO_RECIPES;
}

const upper = (s: string | undefined) => (s ?? '').trim().toUpperCase();
const rowId = (group: string, phase: string) => `${group}|${phase}`.toUpperCase();

/** The text the generator reads for what a task follows: "Decking@80, Under Slab". */
export function followsText(recipe: Pick<Recipe, 'edges'>, phase: string): string {
  return (recipe.edges ?? [])
    .filter((e) => upper(e.to) === upper(phase))
    .map((e) => {
      const lag = e.lagHours ?? 0;
      if (e.lagPct) return `${e.from}:${e.type ?? 'FS'}${e.lagPct < 0 ? '-' : '+'}${Math.abs(e.lagPct)}%${e.lagOf === 'succ' ? 's' : ''}`; // "Rebar:SS+30%": start-to-start, 30 % of Rebar's duration later
      if ((e.type && e.type !== 'FS') || lag) return `${e.from}:${e.type ?? 'FS'}${lag < 0 ? '-' : '+'}${lag ? `${Math.round((Math.abs(lag) / HOURS_PER_DAY) * 100) / 100}d` : '0'}`; // "Rebar:SS+2d": start-to-start, 2 days later (no unit: hours)
      return e.sharePct !== undefined && e.sharePct < 100 ? `${e.from}@${e.sharePct}` : e.from;
    })
    .join(', ');
}

/** "Decking@80, Under Slab" as edges into `to`. */
export function edgesFromFollows(follows: string | undefined, to: string): RecipeEdge[] {
  const out: RecipeEdge[] = [];
  for (const part of String(follows ?? '').replace(/;/g, ',').split(',')) {
    // "Rebar:SS@80": the type with a share of the task it follows (start-to-start, 80 % of Rebar's duration later), as "Rebar@80" is for finish-to-start.
    const shared = /^(.*?)\s*:\s*(FS|SS|FF|SF)\s*@\s*(\d+(?:\.\d+)?)\s*%?$/i.exec(part.trim());
    if (shared && shared[1].trim() && Number(shared[3]) > 0) {
      out.push({ from: shared[1].trim(), to, type: shared[2].toUpperCase() as RecipeEdge['type'], lagPct: Number(shared[3]), lagOf: 'pred' });
      continue;
    }
    const explicit = /^(.*?)\s*:\s*(FS|SS|FF|SF)\s*([+-]\s*\d+(?:\.\d+)?)?\s*(h|d|%\s*s?)?$/i.exec(part.trim());
    if (explicit && explicit[1].trim()) {
      const lag = Number((explicit[3] ?? '0').replace(/\s/g, ''));
      const unit = (explicit[4] ?? 'h').replace(/\s/g, '').toLowerCase();
      const share = unit === 'h' ? { lagHours: lag } : unit === 'd' ? { lagHours: lag * HOURS_PER_DAY } : { lagPct: lag, lagOf: unit.endsWith('s') ? 'succ' as const : 'pred' as const };
      out.push({ from: explicit[1].trim(), to, type: explicit[2].toUpperCase() as RecipeEdge['type'], ...(lag ? share : {}) });
      continue;
    }
    const [name, pct] = part.split('@');
    if (!name.trim()) continue;
    const n = pct === undefined ? NaN : Number(pct.trim().replace(/%$/, ''));
    out.push({ from: name.trim(), to, ...(Number.isFinite(n) && n < 100 ? { sharePct: Math.max(0, n) } : {}) });
  }
  return out;
}

/** A task's equipment, cranes or materials as text ("TC1, PUMP 2": the type, then how many when not one) and back. */
export const usesText = (list: ResourceUse[] | undefined) => (list ?? []).map((u) => (u.count !== undefined && u.count !== 1 ? `${u.type} ${u.count}` : u.type)).join(', ');
export function parseUses(text: string): ResourceUse[] {
  return text.split(',').map((p) => /^\s*(.*?)(?:\s+[x\u00d7]?\s*(\d+(?:[.,]\d+)?))?\s*$/.exec(p)).filter((m): m is RegExpExecArray => !!m && m[1].trim() !== '')
    .map((m) => ({ type: m[1].trim(), ...(m[2] && Number(m[2].replace(',', '.')) !== 1 ? { count: Number(m[2].replace(',', '.')) } : {}) }));
}

const hasValues = (t: RecipeTask) => t.days !== undefined || !!t.formula || !!t.rate || !!t.density || !!t.crew || !!t.calendar;

/** A recipe's values as the Assignment the generator reads. */
function assignmentOf(r: Recipe, t: RecipeTask): Assignment {
  return {
    id: rowId(r.group, t.phase),
    group: r.group,
    phase: t.phase,
    ...(t.rate ? { rate: t.rate } : {}),
    ...(t.days !== undefined ? { days: t.days } : {}),
    ...(t.formula ? { formula: t.formula } : {}),
    ...(t.density ? { density: t.density } : {}),
    ...(t.crew ? { crew: t.crew } : {}),
    ...(t.calendar ? { calendar: t.calendar } : {}),
    priority: t.priority ?? 0,
    ...(r.chain !== false || t.enabled === undefined ? {} : { enabled: t.enabled }),
    ...(r.chain !== false || !t.note ? {} : { note: t.note }),
  };
}

/** The Chains and Assignments a recipes file stands for. A switched-off recipe gives nothing. */
export function compileRecipes(file: RecipesFile): { chains: ChainRow[]; assignments: Assignment[] } {
  const chains: ChainRow[] = [];
  const assignments: Assignment[] = [];
  for (const r of file.recipes) {
    if (r.enabled === false) continue;
    if (r.chain !== false) {
      r.tasks.forEach((t, i) => {
        const follows = followsText(r, t.phase);
        chains.push({
          id: rowId(r.group, t.phase),
          group: r.group,
          order: i + 1,
          phase: t.phase,
          ...(t.suffix !== undefined ? { suffix: t.suffix } : {}),
          ...(t.name !== undefined ? { label: t.name } : {}),
          ...(t.material ? { material: t.material } : {}),
          ...(follows ? { follows } : {}),
          ...(t.finishAfter ? { finishAfter: true } : {}),
          ...(t.gates ? { gates: true } : {}),
          priority: r.priority ?? 0,
          ...(t.enabled === false ? { enabled: false } : {}),
          ...(t.note ? { note: t.note } : {}),
        });
      });
    }
    for (const t of r.tasks) if (hasValues(t)) assignments.push(assignmentOf(r, t));
  }
  return { chains, assignments };
}

/** The rules' Chains and Assignments as recipes (what compileRecipes turns back into the same rows). A group with a chain gets a recipe whose
    tasks are the chain's; the values of the same phases go on them. Values for a phase the chain does not have, and values that are switched off
    or carry a note, go in a second recipe of the group ("-VALUES", chain false), as do the groups that have no chain. */
export function recipesFromRules(rules: { chains: ChainRow[]; assignments: Assignment[] }): RecipesFile {
  const groupKeys: string[] = [];
  const names = new Map<string, string>();
  const note = (g: string) => {
    if (!names.has(upper(g))) {
      names.set(upper(g), g);
      groupKeys.push(upper(g));
    }
  };
  // The groups with a chain first, in the chain's order (it breaks a tie between two groups), then the groups that only have values.
  for (const c of rules.chains) note(c.group);
  for (const a of rules.assignments) note(a.group);

  const recipes: Recipe[] = [];
  for (const key of groupKeys) {
    const group = names.get(key)!.trim();
    const rows = rules.chains
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => upper(c.group) === key)
      .sort((a, b) => (a.c.order ?? 0) - (b.c.order ?? 0) || a.i - b.i)
      .map(({ c }) => c);
    const values = rules.assignments.filter((a) => upper(a.group) === key);
    const id = group || 'ALL';
    const phasesOfChain = new Set(rows.map((c) => upper(c.phase)));
    const inChain = (a: Assignment) => phasesOfChain.has(upper(a.phase)) && a.enabled !== false && !a.note;
    const task = (phase: string): RecipeTask => ({ phase });
    const addValues = (t: RecipeTask, a: Assignment, withState: boolean) => {
      if (a.days !== undefined) t.days = a.days;
      if (a.formula) t.formula = a.formula;
      if (a.rate) t.rate = a.rate;
      if (a.density) t.density = a.density;
      if (a.crew) t.crew = a.crew;
      if (a.calendar) t.calendar = a.calendar;
      t.priority = a.priority ?? 0;
      if (withState && a.enabled === false) t.enabled = false;
      if (withState && a.note) t.note = a.note;
    };

    if (rows.length) {
      const edges: RecipeEdge[] = [];
      const tasks = rows.map((c): RecipeTask => {
        const t = task(c.phase);
        if (c.label !== undefined) t.name = c.label;
        if (c.suffix !== undefined) t.suffix = c.suffix;
        if (c.material) t.material = c.material;
        if (c.finishAfter) t.finishAfter = true;
        if (c.gates) t.gates = true;
        if (c.enabled === false) t.enabled = false;
        if (c.note) t.note = c.note;
        edges.push(...edgesFromFollows(c.follows, c.phase));
        const a = values.find((v) => upper(v.phase) === upper(c.phase) && inChain(v));
        if (a) addValues(t, a, false);
        return t;
      });
      recipes.push({ id, group, priority: Math.max(...rows.map((c) => c.priority ?? 0)), tasks, ...(edges.length ? { edges } : {}) });
    }
    const rest = rows.length ? values.filter((a) => !inChain(a)) : values;
    if (rest.length) {
      recipes.push({
        id: rows.length ? `${id}-VALUES` : id,
        group,
        chain: false,
        tasks: rest.map((a) => {
          const t = task(a.phase);
          addValues(t, a, true);
          return t;
        }),
      });
    }
  }
  return recipes.length ? { version: 1, recipes } : NO_RECIPES;
}

// ---------------------------------------------------------------- a scenario's rules, split into rules and recipes and back

const clean = <T extends object>(rows: T[]) => rows.map((r) => JSON.stringify(r, Object.keys(r).sort()));

/** What compiling the recipes does not give back of the rows they were made from (empty: nothing is lost). Rows are compared as sets; the order
    of the chains matters (it breaks a tie between groups) and is checked too. */
export function recipeLosses(rules: Pick<ScenarioRules, 'chains' | 'assignments'>, file: RecipesFile): string[] {
  const back = compileRecipes(file);
  const out: string[] = [];
  const compare = (what: string, a: object[], b: object[], ordered: boolean) => {
    const x = clean(a);
    const y = clean(b);
    if (x.length !== y.length) out.push(`${what}: ${x.length} rows, ${y.length} after the recipes`);
    const left = ordered ? x : [...x].sort();
    const right = ordered ? y : [...y].sort();
    const at = left.findIndex((v, i) => v !== right[i]);
    if (at >= 0 && x.length === y.length) out.push(`${what}: ${left[at]} does not come back as written (${right[at]})`);
  };
  compare('Chains', rules.chains, back.chains, true);
  compare('Assignments', rules.assignments, back.assignments, false);
  return out;
}

// ---------------------------------------------------------------- the tasks of a recipe as text for a spreadsheet and back

export const TASK_HEAD = ['Phase', 'Name', 'Suffix', 'Material', 'Follows', 'Days', 'Rate', 'Rebar rate', 'Crew', 'Calendar', 'Equipment', 'Cranes', 'Materials', 'Priority', 'Finish after', 'Gates', 'Formula'];

const out = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const yes = (v: string) => /^(y|true|1|x)/i.test(v.trim());
const number = (v: string): number | undefined => {
  const t = v.trim().replace(',', '.');
  return t === '' || !Number.isFinite(Number(t)) ? undefined : Number(t);
};

/** The tasks of a recipe, one row each, with the columns of TASK_HEAD (what a task follows as text: "Decking@80, Under Slab"). */
export function tasksToTsv(recipe: Pick<Recipe, 'tasks' | 'edges'>): string {
  return [
    TASK_HEAD.join('\t'),
    ...recipe.tasks.map((t) =>
      [t.phase, out(t.name), out(t.suffix), out(t.material), followsText(recipe, t.phase), out(t.days), out(t.rate), out(t.density), out(t.crew), out(t.calendar), usesText(t.equipment), usesText(t.cranes), usesText(t.materials), out(t.priority), t.finishAfter ? 'yes' : '', t.gates ? 'yes' : '', out(t.formula)].join('\t'),
    ),
  ].join('\n');
}

/** Rows pasted from a spreadsheet (tab separated; ";" when a line has no tab; a first row of headings is skipped) as tasks and the links between them. */
export function parseTasksPaste(text: string): { tasks: RecipeTask[]; edges: RecipeEdge[] } {
  const tasks: RecipeTask[] = [];
  const edges: RecipeEdge[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    const c = (line.includes('\t') ? line.split('\t') : line.split(';')).map((x) => x.trim());
    if (!c[0] || /^phase$/i.test(c[0])) continue;
    const t: RecipeTask = { phase: c[0] };
    if (c[1]) t.name = c[1];
    if (c[2]) t.suffix = c[2];
    if (/^reb/i.test(c[3] ?? '')) t.material = 'rebar';
    else if (/^conc/i.test(c[3] ?? '')) t.material = 'concrete';
    if (number(c[5] ?? '') !== undefined) t.days = number(c[5]!);
    if (c[6]) t.rate = c[6];
    if (c[7]) t.density = c[7];
    if (c[8]) t.crew = c[8];
    if (c[9]) t.calendar = c[9];
    for (const [i, key] of [[10, 'equipment'], [11, 'cranes'], [12, 'materials']] as const) {
      const list = parseUses(c[i] ?? '');
      if (list.length) t[key] = list;
    }
    if (number(c[13] ?? '') !== undefined) t.priority = number(c[13]!);
    if (yes(c[14] ?? '')) t.finishAfter = true;
    if (yes(c[15] ?? '')) t.gates = true;
    if (c[16]) t.formula = c[16];
    tasks.push(t);
    edges.push(...edgesFromFollows(c[4], c[0]));
  }
  return { tasks, edges };
}

/** Pasted tasks put into a recipe: the same phase is replaced (keeping its place in the graph and its links to other recipes), the others are added;
    or, with `replaceAll`, the recipe has exactly the pasted tasks. The links into a pasted task are the pasted ones. */
export function applyTasksPaste(recipe: Recipe, pasted: { tasks: RecipeTask[]; edges: RecipeEdge[] }, replaceAll: boolean): Recipe {
  if (replaceAll) return { ...recipe, tasks: pasted.tasks, edges: pasted.edges.length ? pasted.edges : undefined };
  const phases = new Set(pasted.tasks.map((t) => t.phase.trim().toUpperCase()));
  const had = new Map(recipe.tasks.map((t) => [t.phase.trim().toUpperCase(), t]));
  const tasks = recipe.tasks.map((t) => {
    const p = pasted.tasks.find((x) => x.phase.trim().toUpperCase() === t.phase.trim().toUpperCase());
    return p ? { ...p, ...(t.x !== undefined ? { x: t.x, y: t.y } : {}), ...(t.w ? { w: t.w } : {}), ...(t.links ? { links: t.links } : {}), ...(t.enabled === false ? { enabled: false } : {}), ...(t.note ? { note: t.note } : {}) } : t;
  });
  for (const p of pasted.tasks) if (!had.has(p.phase.trim().toUpperCase())) tasks.push(p);
  const edges = [...(recipe.edges ?? []).filter((e) => !phases.has(e.to.trim().toUpperCase())), ...pasted.edges];
  return { ...recipe, tasks, edges: edges.length ? edges : undefined };
}
