import type { PourFact } from './match';
import { matchesWhen } from './match';
import type { Recipe, RecipeTask } from './recipes';
import type { CrewTemplate, ParameterRow, RateRow, ScenarioRules, When } from './rules';
import type { ScenarioCrew } from '../scenarios/api';
import { evaluateFormula } from '../schedule/durationFormula';

/** What a work item (a search set) will be generated with, activity by activity, and why: Generate 2 shows it next to the work item, so a planner sees
    the crew and the days each activity gets without opening Recipes, Labour or Parameters. It follows the generator's own order
    (scenario-engine/core/rules.py, resources.py, activity_generator.py):

    - the activities: the chain recipe that fits the objects best (highest priority, then the earlier recipe); none: the generator's own;
    - the crew: an override, else the best crew row (a crew rule or a recipe task's crew; highest priority, then most conditions, then the earlier
      row), else the Crews sheet's row for the activity and the object's type, else its row for the activity, else none;
    - the days: an override, else a duration formula, else a productivity rate (quantity x man-hours per unit / people x shifts x hours), else fixed
      days (a recipe task, a days rate, a duration row), else the generator's 1 day.

    The days are worked out per object, so a work item shows the range over its objects. A value the generator works out from the model's geometry
    (footprint, side faces) cannot be known before Generate: the row says so. Overrides are kept per work item in `rules.itemOverrides` and reach the
    generator as recipes for the set (`withItemOverrides`), so nothing new is asked of it. Nothing here knows what the objects or activities are called. */

/** Changes to one work item (by its set's name): the recipe it is built with, and per activity a named crew and fixed days. */
export interface ItemOverride {
  recipe?: string;
  tasks?: Record<string, { crew?: string; days?: number }>;
}

export type Source =
  | { kind: 'override' }
  | { kind: 'recipe'; recipe: string; folder?: string; forAll?: boolean }
  | { kind: 'crewRule'; id: string }
  | { kind: 'sheetType'; type: string }
  | { kind: 'sheetPhase' }
  | { kind: 'default' }
  | { kind: 'none' };

export interface PlannedActivity {
  phase: string;
  name: string;
  crew: { label: string; people: number; source: Source } | null;
  /** The crew a planner can pick: a named crew of the recipe or override, if any. */
  crewId: string;
  days: { min: number; max: number; source: Source; how: string } | null;
  /** Why the days cannot be worked out before Generate, if they cannot. */
  daysNote?: string;
  limit: string;
}

export interface WorkItemPlan {
  /** The recipe that makes the activities, or null (the generator's own). */
  recipe: { id: string; source: Source } | null;
  /** Objects of the set that get another recipe's activities (another group fits them better). */
  others: { recipe: string; objects: number }[];
  activities: PlannedActivity[];
  objects: number;
  volume: number;
}

export interface PlanInput {
  /** The set's name (its group). */
  group: string;
  /** The recipes as the generator gets them: folder recipes already copied to their sets (prs/recipeInheritance.ts). */
  recipes: Recipe[];
  rules: Pick<ScenarioRules, 'crews' | 'crewTemplates' | 'parameters' | 'rates' | 'limits' | 'durations' | 'productivity' | 'rebar' | 'resourcePools' | 'itemOverrides'>;
  crewSheet: ScenarioCrew[];
  /** The objects of the set (the pour table's rows of it). */
  facts: PourFact[];
  membership: Map<string, Set<string>>;
}

const norm = (s: string) => s.trim().toUpperCase();
const typeKey = (s: string) => s.trim().replace(/ /g, '_').toUpperCase();
const num = (v: unknown): number | null => (v === undefined || v === null || String(v).trim() === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const terms = (w: When | undefined) => Object.values(w ?? {}).filter((v) => v !== undefined && String(v).trim() !== '').length;
const isChain = (r: Recipe) => r.enabled !== false && r.chain !== false;
const FOLDER_COPY = ' @ ';

export const OVERRIDE_PRIORITY = 1000;

/** The overrides of a set ({} for none). */
export const overrideOf = (rules: Pick<ScenarioRules, 'itemOverrides'>, group: string): ItemOverride =>
  Object.entries(rules.itemOverrides ?? {}).find(([k]) => norm(k) === norm(group))?.[1] ?? {};

/** Where a recipe came from, for a set: its own, a folder's (copied as "<id> @ <set>"), or one for every object. */
function recipeSource(r: Recipe, group: string): Source {
  const at = r.id.indexOf(FOLDER_COPY);
  if (at >= 0 && norm(r.group) === norm(group)) return { kind: 'recipe', recipe: r.id.slice(0, at), folder: r.folder ?? 'its folder' };
  return { kind: 'recipe', recipe: r.id, ...(r.group.trim() === '' ? { forAll: true } : {}) };
}

/** Whether a recipe's group holds an object of the set. */
function fits(r: Recipe, group: string, f: PourFact | null, membership: Map<string, Set<string>>): boolean {
  if (r.group.trim() === '' || norm(r.group) === norm(group)) return true;
  return !!f && (membership.get(f.key)?.has(r.group.trim()) ?? false);
}

/** The recipes as the generator reads them for this set: an override's recipe is a copy for the set that beats every other. The set's own chain
    recipes (and folder copies for it) are left out, since the generator joins the activities of every recipe of one group into one chain. */
function withOverride(recipes: Recipe[], group: string, o: ItemOverride): Recipe[] {
  const picked = o.recipe ? recipes.find((r) => norm(r.id) === norm(o.recipe!) && isChain(r)) : undefined;
  if (!picked) return recipes;
  const copy: Recipe = { ...picked, id: `${picked.id} for ${group}`, group, folder: undefined, priority: OVERRIDE_PRIORITY, tasks: picked.tasks.map((t) => ({ ...t, priority: Math.max(t.priority ?? 0, OVERRIDE_PRIORITY - 1) })) };
  return [copy, ...recipes.filter((r) => !(isChain(r) && norm(r.group) === norm(group)))];
}

/** The chain recipe the generator gives an object: the highest priority; a tie goes to the earlier recipe. */
function chainFor(recipes: Recipe[], group: string, f: PourFact | null, membership: Map<string, Set<string>>): Recipe | null {
  let best: Recipe | null = null;
  let rank = -Infinity;
  for (const r of recipes) {
    if (!isChain(r) || !fits(r, group, f, membership)) continue;
    const p = r.priority ?? 0;
    if (p > rank) { best = r; rank = p; }
  }
  return best;
}

interface ValueRow<T> { priority: number; terms: number; value: T; source: Source }
/** The best row (as the generator's `best`): highest priority, then most conditions, then the earlier row. */
function best<T>(rows: ValueRow<T>[]): ValueRow<T> | null {
  let out: ValueRow<T> | null = null;
  for (const r of rows) if (!out || r.priority > out.priority || (r.priority === out.priority && r.terms > out.terms)) out = r;
  return out;
}

/** The recipe tasks of a phase that set values for an object, as value rows: every recipe that fits, chain or values only. */
function taskRows(recipes: Recipe[], group: string, phase: string, f: PourFact | null, membership: Map<string, Set<string>>): { task: RecipeTask; priority: number; terms: number; source: Source }[] {
  return recipes.filter((r) => r.enabled !== false && fits(r, group, f, membership)).flatMap((r) => r.tasks
    .filter((t) => (r.chain === false || t.enabled !== false) && norm(t.phase) === norm(phase))
    .map((t) => ({ task: t, priority: t.priority ?? 0, terms: r.group.trim() ? 1 : 0, source: recipeSource(r, group) })));
}

const peopleOf = (trades: { size: number }[]) => trades.reduce((n, t) => n + (Number(t.size) || 0), 0);
const crewLabel = (c: CrewTemplate) => (c.subcontractor ? `${c.subcontractor} · ${c.id}` : c.id);
const tradesLabel = (trades: { trade: string; size: number }[]) => trades.map((t) => `${t.trade} ${t.size}`).join(', ');

/** The crew one object's activity gets. */
function crewFor(input: PlanInput, recipes: Recipe[], phase: string, f: PourFact | null, o: ItemOverride): { label: string; people: number; source: Source; id: string } | null {
  const templates = new Map(input.rules.crewTemplates.filter((c) => c.enabled !== false).map((c) => [norm(c.id), c]));
  const ov = o.tasks && Object.entries(o.tasks).find(([p]) => norm(p) === norm(phase))?.[1]?.crew;
  if (ov && templates.has(norm(ov))) { const c = templates.get(norm(ov))!; return { label: crewLabel(c), people: peopleOf(c.trades), source: { kind: 'override' }, id: c.id }; }
  // The scenario's crew rules come first in the generator's list, then the recipes' tasks (so a rule wins a tie).
  const rows: ValueRow<{ label: string; people: number; id: string }>[] = [];
  for (const r of input.rules.crews) {
    if (r.enabled === false || norm(r.phase) !== norm(phase) || (f ? !matchesWhen(r.when, f, input.membership) : terms(r.when) > 0)) continue;
    rows.push({ priority: num((r as { priority?: unknown }).priority) ?? 0, terms: terms(r.when), value: { label: tradesLabel(r.trades) || 'no people', people: peopleOf(r.trades), id: '' }, source: { kind: 'crewRule', id: r.id } });
  }
  for (const t of taskRows(recipes, input.group, phase, f, input.membership)) {
    const c = t.task.crew ? templates.get(norm(t.task.crew)) : undefined;
    if (c) rows.push({ priority: t.priority, terms: t.terms, value: { label: crewLabel(c), people: peopleOf(c.trades), id: c.id }, source: t.source });
  }
  const hit = best(rows);
  if (hit) return { ...hit.value, source: hit.source };
  // The Crews sheet: the row for the activity and the object's type, else the row for the activity.
  const sheet = (type: string) => input.crewSheet.filter((c) => norm(c.Phase) === norm(phase) && typeKey(c.PourType ?? '') === type && Number(c.Crew) > 0);
  const typed = f?.type ? sheet(typeKey(f.type)) : [];
  const any = typed.length ? typed : sheet('');
  if (any.length) return { label: any.map((c) => `${c.Trade} ${c.Crew}`).join(', '), people: any.reduce((n, c) => n + Number(c.Crew), 0), source: typed.length ? { kind: 'sheetType', type: f!.type } : { kind: 'sheetPhase' }, id: '' };
  return null;
}

/** The rebar a formula's Rebar_t reads for an object: its concrete volume times the best rebar rate (the generator's 0.25 t per m³ when none fits). */
function rebarRate(input: PlanInput, f: PourFact | null): number {
  const rows = input.rules.rebar.filter((r) => r.enabled !== false && (f ? matchesWhen(r.when, f, input.membership) : terms(r.when) === 0));
  const hit = best(rows.map((r) => ({ priority: 0, terms: terms(r.when), value: r.tonnesPerM3, source: { kind: 'default' } as Source })));
  return hit && hit.value > 0 ? hit.value : 0.25;
}

function formulaDays(formula: string, parameters: ParameterRow[], vars: Record<string, number>): number | { error: string } {
  const values: Record<string, number> = { crews: 1, ...vars };
  for (const p of parameters) if (p.enabled !== false) values[p.name] = p.value;
  const r = evaluateFormula(formula, values);
  return 'error' in r ? { error: r.error } : Math.max(0, r.value);
}

const rounded = (days: number, rounding: RateRow['rounding'] | undefined, min: number) => Math.max(rounding === 'none' ? days : rounding === 'round' ? Math.round(days) : Math.ceil(days - 1e-9), min);

/** The days one object's activity gets, or why they cannot be known yet. */
function daysFor(input: PlanInput, recipes: Recipe[], phase: string, f: PourFact | null, o: ItemOverride, people: number): { days: number; source: Source; how: string } | { note: string; source: Source } {
  const ov = o.tasks && Object.entries(o.tasks).find(([p]) => norm(p) === norm(phase))?.[1]?.days;
  if (ov !== undefined) return { days: ov, source: { kind: 'override' }, how: 'fixed' };
  const volume = f?.volume ?? 0;
  const tasks = taskRows(recipes, input.group, phase, f, input.membership);
  // A duration formula first.
  const formula = best(tasks.filter((t) => t.task.formula?.trim()).map((t) => ({ ...t, value: t.task.formula!.trim() })));
  if (formula) {
    const tonnes = volume * rebarRate(input, f);
    const d = formulaDays(formula.value, input.rules.parameters ?? [], { Concrete_m3: volume, Rebar_t: tonnes, Rebar_kg: tonnes * 1000 });
    if (typeof d === 'number') return { days: d, source: formula.source, how: `formula ${formula.value}` };
    return { note: /footprint|sides/i.test(formula.value) ? 'worked out from the model’s geometry when it is generated' : `formula ${formula.value}: ${d.error}`, source: formula.source };
  }
  // Then a productivity rate: of a recipe task, or a productivity rule.
  const rates = new Map(input.rules.rates.filter((r) => r.enabled !== false).map((r) => [norm(r.id), r]));
  const prod: ValueRow<{ basis: string; perUnit: number; people: number; shifts: number; hours: number; rounding?: RateRow['rounding']; min: number }>[] = [];
  for (const r of input.rules.productivity) {
    if (r.enabled === false || norm(r.phase) !== norm(phase) || (f ? !matchesWhen(r.when, f, input.membership) : terms(r.when) > 0)) continue;
    const x = r as unknown as RateRow;
    prod.push({ priority: 0, terms: terms(r.when), value: { basis: r.basis, perUnit: x.manhoursPerUnit ?? 0, people: num((r as { crew?: unknown }).crew) ?? 0, shifts: x.shifts ?? 1, hours: x.hoursPerShift ?? 8, rounding: x.rounding, min: x.minDays ?? 0 }, source: { kind: 'default' } });
  }
  for (const t of tasks) {
    const r = t.task.rate ? rates.get(norm(t.task.rate)) : undefined;
    if (r?.type === 'productivity') prod.push({ priority: t.priority, terms: t.terms, value: { basis: r.basis ?? 'rebar', perUnit: r.manhoursPerUnit ?? 0, people: r.people ?? 0, shifts: r.shifts ?? 1, hours: r.hoursPerShift ?? 8, rounding: r.rounding, min: r.minDays ?? 0 }, source: t.source });
  }
  const p = best(prod);
  if (p) {
    const v = p.value;
    const crew = v.people || people;
    if (v.basis !== 'rebar' && v.basis !== 'concrete') return { note: 'worked out from the model when it is generated', source: p.source };
    const quantity = v.basis === 'rebar' ? volume * rebarRate(input, f) : volume;
    if (v.perUnit > 0 && crew > 0) return { days: rounded(quantity * v.perUnit / (crew * (v.shifts || 1) * (v.hours || 8)), v.rounding, v.min), source: p.source, how: `${v.perUnit} man-hours per ${v.basis === 'rebar' ? 't' : 'm³'}, ${crew} people` };
  }
  // Then fixed days: a recipe task's days or days rate, or a duration row.
  const fixed: ValueRow<number>[] = [];
  for (const r of input.rules.durations) {
    if (r.enabled === false || (f ? !matchesWhen(r.when, f, input.membership) : terms(r.when) > 0)) continue;
    const d = Object.entries(r.phases ?? {}).find(([k]) => norm(k) === norm(phase))?.[1];
    if (num(d) !== null) fixed.push({ priority: 0, terms: terms(r.when), value: Number(d), source: { kind: 'default' } });
  }
  for (const t of tasks) {
    const rate = t.task.rate ? rates.get(norm(t.task.rate)) : undefined;
    const d = num(t.task.days) ?? (rate?.type === 'days' ? num(rate.days) : null);
    if (d !== null) fixed.push({ priority: t.priority, terms: t.terms, value: d, source: t.source });
  }
  const d = best(fixed);
  if (d) return { days: d.value, source: d.source, how: 'fixed' };
  return { days: 1, source: { kind: 'default' }, how: 'the generator’s 1 day' };
}

/** How many of an activity may run at once, as the limits say (a number, a parameter or a resource). */
function limitOf(input: PlanInput, phase: string, name: string): string {
  const rows = input.rules.limits.filter((l) => l.enabled !== false && (norm(l.phase) === norm(phase) || norm(l.phase) === norm(name)) && (!l.group || norm(l.group) === norm(input.group)));
  const mine = rows.find((l) => l.group && norm(l.group) === norm(input.group)) ?? rows[0];
  return mine ? String(mine.max) : '';
}

/** The plan of a work item. */
export function planWorkItem(input: PlanInput): WorkItemPlan {
  const o = overrideOf(input.rules, input.group);
  const recipes = withOverride(input.recipes, input.group, o);
  const objects: (PourFact | null)[] = input.facts.length ? input.facts : [null];
  // The recipe of each object: the plan is the one most objects get; the others are named.
  const byRecipe = new Map<string, { recipe: Recipe | null; facts: (PourFact | null)[] }>();
  for (const f of objects) {
    const r = chainFor(recipes, input.group, f, input.membership);
    const k = r?.id ?? '';
    (byRecipe.get(k) ?? byRecipe.set(k, { recipe: r, facts: [] }).get(k)!).facts.push(f);
  }
  const [main, ...rest] = [...byRecipe.values()].sort((a, b) => b.facts.length - a.facts.length);
  const tasks = main.recipe ? main.recipe.tasks.filter((t) => t.enabled !== false && t.phase.trim()) : [];
  const activities = tasks.map((t): PlannedActivity => {
    let crew: PlannedActivity['crew'] = null;
    let crewId = '';
    let lo = Infinity;
    let hi = -Infinity;
    let daySource: Source = { kind: 'default' };
    let how = '';
    let note: string | undefined;
    for (const f of main.facts) {
      const c = crewFor(input, recipes, t.phase, f, o);
      if (c && !crew) { crew = { label: c.label, people: c.people, source: c.source }; crewId = c.id; }
      const d = daysFor(input, recipes, t.phase, f, o, c?.people ?? 0);
      if ('note' in d) { note = d.note; daySource = d.source; continue; }
      lo = Math.min(lo, d.days);
      hi = Math.max(hi, d.days);
      daySource = d.source;
      how = d.how;
    }
    return {
      phase: t.phase, name: t.name || t.phase, crew, crewId,
      days: Number.isFinite(lo) ? { min: lo, max: hi, source: daySource, how } : null,
      ...(note ? { daysNote: note } : {}),
      limit: limitOf(input, t.phase, t.name ?? ''),
    };
  });
  return {
    recipe: main.recipe ? { id: o.recipe && norm(main.recipe.id) === norm(`${o.recipe} for ${input.group}`) ? o.recipe : main.recipe.id.split(FOLDER_COPY)[0], source: o.recipe && main.recipe.id.endsWith(` for ${input.group}`) ? { kind: 'override' } : recipeSource(main.recipe, input.group) } : null,
    others: rest.filter((x) => x.facts[0] !== null).map((x) => ({ recipe: x.recipe?.id ?? '', objects: x.facts.length })),
    activities,
    objects: input.facts.length,
    volume: input.facts.reduce((n, f) => n + (f.volume || 0), 0),
  };
}

/** Where a value came from, in the words of the work item's panel. */
export function sourceText(s: Source, phase = ''): string {
  switch (s.kind) {
    case 'override': return 'set here';
    case 'recipe': return s.folder ? `recipe ${s.recipe} (from folder ${s.folder})` : s.forAll ? `recipe ${s.recipe} (for every object)` : `recipe ${s.recipe}`;
    case 'crewRule': return `crew rule ${s.id}`;
    case 'sheetType': return `Crews sheet: ${s.type.replace(/_/g, ' ')} + ${phase}`;
    case 'sheetPhase': return `Crews sheet: ${phase}`;
    case 'default': return 'scenario default';
    case 'none': return 'none';
  }
}

/** The days of an activity as text: one number, or the range over the work item's objects. */
export const daysText = (d: { min: number; max: number }): string => {
  const f = (n: number) => (Math.round(n * 10) / 10).toLocaleString();
  return d.min === d.max ? `${f(d.min)} d` : `${f(d.min)}–${f(d.max)} d`;
};

/** The rules with one work item's override changed (an empty override goes). */
export function withItemOverride<R extends Pick<ScenarioRules, 'itemOverrides'>>(rules: R, group: string, change: (o: ItemOverride) => ItemOverride): R {
  const all = { ...(rules.itemOverrides ?? {}) };
  const key = Object.keys(all).find((k) => norm(k) === norm(group)) ?? group;
  const next = change(all[key] ?? {});
  const tasks = Object.fromEntries(Object.entries(next.tasks ?? {}).map(([p, t]) => [p, Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined && v !== ''))] as const).filter(([, t]) => Object.keys(t).length > 0));
  const clean: ItemOverride = { ...(next.recipe ? { recipe: next.recipe } : {}), ...(Object.keys(tasks).length ? { tasks } : {}) };
  if (Object.keys(clean).length) all[key] = clean; else delete all[key];
  const { itemOverrides: _old, ...rest } = rules;
  return (Object.keys(all).length ? { ...rest, itemOverrides: all } : rest) as R;
}

/** Cleans saved overrides. */
export function normalizeItemOverrides(raw: unknown): Record<string, ItemOverride> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, ItemOverride> = {};
  for (const [group, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!group.trim() || !v || typeof v !== 'object') continue;
    const o = v as ItemOverride;
    const tasks: Record<string, { crew?: string; days?: number }> = {};
    for (const [phase, t] of Object.entries(o.tasks ?? {})) {
      if (!phase.trim() || !t || typeof t !== 'object') continue;
      const crew = typeof t.crew === 'string' && t.crew.trim() ? t.crew.trim() : undefined;
      const days = num(t.days);
      if (crew || (days !== null && days >= 0)) tasks[phase] = { ...(crew ? { crew } : {}), ...(days !== null && days >= 0 ? { days } : {}) };
    }
    const recipe = typeof o.recipe === 'string' && o.recipe.trim() ? o.recipe.trim() : undefined;
    if (recipe || Object.keys(tasks).length) out[group] = { ...(recipe ? { recipe } : {}), ...(Object.keys(tasks).length ? { tasks } : {}) };
  }
  return Object.keys(out).length ? out : undefined;
}

/** The recipes as the generator should read the overrides: a work item's chosen recipe becomes a copy for its set that beats every other, and its
    crews and days a values-only recipe for the set whose tasks beat every other value (days as a formula, since a formula beats fixed days and rates).
    The same list when there is no override. */
export function withItemOverrides(recipes: Recipe[], overrides: Record<string, ItemOverride> | undefined): Recipe[] {
  if (!overrides || !Object.keys(overrides).length) return recipes;
  const out = [...recipes];
  for (const [group, o] of Object.entries(overrides)) {
    const withRecipe = withOverride(out, group, o);
    if (withRecipe !== out) out.splice(0, out.length, ...withRecipe);
    const tasks: RecipeTask[] = Object.entries(o.tasks ?? {}).map(([phase, t]) => ({ phase, ...(t.crew ? { crew: t.crew } : {}), ...(t.days !== undefined ? { formula: String(t.days) } : {}), priority: OVERRIDE_PRIORITY }));
    if (tasks.length) out.push({ id: `Overrides for ${group}`, group, chain: false, tasks });
  }
  return out;
}

/** The rules with the most of one activity of a work item that may run at once: a limit for the set and the activity (empty: the row goes). */
export function withItemLimit<R extends Pick<ScenarioRules, 'limits'>>(rules: R, group: string, phase: string, max: string): R {
  const at = rules.limits.findIndex((l) => l.group && norm(l.group) === norm(group) && norm(l.phase) === norm(phase));
  const value = max.trim();
  const limits = [...rules.limits];
  if (!value) { if (at >= 0) limits.splice(at, 1); }
  else {
    const row = { ...(at >= 0 ? limits[at] : { id: `${group}|${phase}` }), phase, group, max: Number.isFinite(Number(value)) ? Number(value) : value };
    if (at >= 0) limits[at] = row; else limits.push(row);
  }
  return { ...rules, limits };
}
