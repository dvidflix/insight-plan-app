import type { Assignment, ChainRow, ScenarioRules } from './rules';

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
}

/** `to` starts when `from` is `sharePct` done (100 when empty: finished). A task with no edge into it follows the task before it, finished. */
export interface RecipeEdge {
  from: string;
  to: string;
  sharePct?: number;
}

export interface Recipe {
  id: string;
  name?: string;
  /** The rule group whose objects the recipe applies to (empty: every object). */
  group: string;
  /** Of the recipe's activities, when several groups fit an object: the highest wins, a tie goes to the earlier recipe. */
  priority?: number;
  /** True (the usual): the tasks are the activities the object gets. False: it only sets the values of the tasks (days, rate, crew,
      calendar) for the objects of its group, and the activities come from another recipe. */
  chain?: boolean;
  tasks: RecipeTask[];
  edges?: RecipeEdge[];
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
    .map((e) => (e.sharePct !== undefined && e.sharePct < 100 ? `${e.from}@${e.sharePct}` : e.from))
    .join(', ');
}

/** "Decking@80, Under Slab" as edges into `to`. */
export function edgesFromFollows(follows: string | undefined, to: string): RecipeEdge[] {
  const out: RecipeEdge[] = [];
  for (const part of String(follows ?? '').replace(/;/g, ',').split(',')) {
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

const hasValues = (t: RecipeTask) => t.days !== undefined || !!t.rate || !!t.density || !!t.crew || !!t.calendar;

/** A recipe's values as the Assignment the generator reads. */
function assignmentOf(r: Recipe, t: RecipeTask): Assignment {
  return {
    id: rowId(r.group, t.phase),
    group: r.group,
    phase: t.phase,
    ...(t.rate ? { rate: t.rate } : {}),
    ...(t.days !== undefined ? { days: t.days } : {}),
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
