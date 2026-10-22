import { evaluateFormula, formulaNames } from '../schedule/durationFormula';
import { edgesFromFollows, followsText, parseUses, usesText, type Recipe, type RecipeEdge, type RecipeTask } from './recipes';
import type { CrewTemplate, LimitRow, ParameterRow, PoolKind, PoolRow, RateRow, RelType, RuleSequence, SequenceStep, TradeRow } from './rules';
import { RATE_HEAD, crewText, parseCrewText, parseRatesPaste, parseTradesPaste, ratesToTsv } from './relational';

/** The recipes as one Excel workbook, for people who would rather read a table than a graph: Recipes (a row per activity of each logical group),
    Parameters (the named rates and limits the formulas read), Limits (how many activities of a kind run at once), Steps (the search sets in the
    order they are built, with the link into each) and Resources (equipment, cranes and materials, and how many there are). The tables are the
    source of truth: edit them in Excel, upload, and the recipes and the scenario follow. A sheet is the whole list for what it holds, except that a
    recipe not in the Recipes sheet is kept. Columns are matched by name (an asterisk or a bracketed note is ignored), in any order. */

export type Row = Record<string, string | number>;
export interface RecipeSheets {
  recipes?: Row[];
  parameters?: Row[];
  limits?: Row[];
  steps?: Row[];
  resources?: Row[];
  rates?: Row[];
  crews?: Row[];
  trades?: Row[];
}

export const RECIPE_SHEET_NAMES = { recipes: 'Recipes', parameters: 'Parameters', limits: 'Limits', steps: 'Steps', resources: 'Resources', rates: 'Rates', crews: 'Crews', trades: 'Trades', readme: 'Read me' } as const;

/** The quantities of each pour a formula can use, besides the parameters (worked out when the programme is generated). */
export const QUANTITY_NAMES = ['Concrete_m3', 'Rebar_t', 'Rebar_kg', 'Footprint_m2', 'Sides_m2', 'crews'] as const;

export const STEPS_ID = 'STEPS';

export const RECIPE_README: string[] = [
  'Recipes: a row per activity of a logical group (External Wall, Slab ...). Every pour of that group gets these activities, in Order. Follows is what the activity waits for: "Rebar", "Decking@80" (starts when 80% done), "Rebar:SS+16" (start to start, 16 hours later).',
  'Days is a fixed duration; Duration Formula is worked out for each pour from its quantities and the Parameters, e.g. Rebar_kg / Rebar_Rate or max(1, Concrete_m3 / Concrete_Rate). The formula wins when both are given.',
  `Formula names: ${QUANTITY_NAMES.join(', ')} (the pour's own quantities), and every name in Parameters (not case sensitive). Functions: min, max, abs, ceil, floor, round, sqrt.`,
  'Parameters: the sheet is the whole list for the scenario. Change a rate and update 4D: every duration that reads it follows.',
  'Limits: at most "Max at once" activities of the Activity kind run together (Formwork, with Max at once = Formwork_Sets_Available or a number). The programme is linked in lanes, in the order of the Steps.',
  'Steps: the search sets in the order they are built. Each step waits for the one before it (finish to start) unless Link into it says otherwise (FS, SS, FF, SF, with Lag in hours). Per level repeats the step for every level in turn.',
  'Resources: equipment, cranes and materials (Kind = equipment, crane or material) and how many there are. A row not in the sheet is kept.',
  'Rates, Crews and Trades: each sheet is the whole list for the scenario (a rate, crew or trade not in the sheet is removed). Rates: Type is days, productivity or rebar, and only the columns of that type are read. Crews: Crew is the trades and people per day ("SF 6, CP 4"). Trades: Code, Name and People per day.',
  'A recipe not in the Recipes sheet is kept. Recipes: edit Recipe and Logical Group to make a new recipe; the activities of a recipe in the sheet are exactly the rows given.',
];

const norm = (h: string) => h.replace(/\*/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
type Cells = Map<string, string | number>;
const cells = (sheet: Row[] | undefined): Cells[] => (sheet ?? []).map((r) => new Map(Object.entries(r).map(([k, v]) => [norm(k), v])));
const text = (c: Cells, h: string) => String(c.get(h) ?? '').trim();
const numberOf = (c: Cells, h: string): number | undefined => {
  const t = text(c, h).replace(',', '.');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};
const yes = (v: string) => /^(y|yes|true|1|x)/i.test(v.trim());
const upper = (s: string) => s.trim().toUpperCase();

/** The quantity names a formula reads: the column "Quantity driver" of the Recipes sheet. */
const driverOf = (formula: string | undefined) => formulaNames(formula ?? '').filter((n) => QUANTITY_NAMES.some((q) => q.toLowerCase() === n.toLowerCase())).join(', ');

// ---------------------------------------------------------------- to sheets

export interface BookSource {
  recipes: Recipe[];
  pools: PoolRow[];
  parameters: ParameterRow[];
  limits: LimitRow[];
  sequences: RuleSequence[];
  rates?: RateRow[];
  crews?: CrewTemplate[];
  trades?: TradeRow[];
}

export const RATE_SHEET_HEAD = RATE_HEAD.map((h, i) => (i === 0 ? 'ID*' : h));
export const CREW_SHEET_HEAD = ['ID*', 'Crew', 'Subcontractor', 'Crews available'];
export const TRADE_SHEET_HEAD = ['Code*', 'Name', 'People per day'];

const TEXT_RATE_COLUMNS = new Set(['ID', 'Type', 'Basis', 'Property set', 'Property', 'If none', 'Round']);
/** The Rates table as rows keyed by heading (numbers stay numbers, so Excel can add them up). */
const rateRows = (rows: RateRow[]): Row[] => {
  const [head, ...body] = ratesToTsv(rows).split('\n');
  const heads = head.split('\t');
  return body.filter((l) => l !== '').map((l) => Object.fromEntries(l.split('\t').map((v, i) => [RATE_SHEET_HEAD[i], v !== '' && !TEXT_RATE_COLUMNS.has(heads[i]) && Number.isFinite(Number(v)) ? Number(v) : v])));
};

export function toRecipeSheets(src: BookSource): Required<RecipeSheets> {
  const recipes: Row[] = [];
  for (const r of src.recipes) {
    if (r.chain === false) continue;
    r.tasks.forEach((t, i) => {
      recipes.push({
        'Recipe*': r.id,
        'Logical Group': r.group,
        Order: i + 1,
        'Activity*': t.phase,
        Name: t.name ?? '',
        Suffix: t.suffix ?? '',
        Material: t.material ?? '',
        Follows: followsText(r, t.phase),
        Days: t.days ?? '',
        'Duration Formula': t.formula ?? '',
        'Quantity driver (read only)': driverOf(t.formula),
        Rate: t.rate ?? '',
        'Rebar rate': t.density ?? '',
        Crew: t.crew ?? '',
        Calendar: t.calendar ?? '',
        Equipment: usesText(t.equipment),
        Cranes: usesText(t.cranes),
        Materials: usesText(t.materials),
        Priority: t.priority ?? '',
        'Finish after': t.finishAfter ? 'yes' : '',
        Gates: t.gates ? 'yes' : '',
      });
    });
  }
  const steps = src.sequences.find((s) => upper(s.id) === STEPS_ID)?.steps ?? [];
  return {
    recipes,
    parameters: src.parameters.map((p) => ({ 'Name*': p.name, 'Value*': p.value, Unit: p.unit ?? '', Notes: p.note ?? '' })),
    limits: src.limits.map((l) => ({ 'Activity*': l.phase, 'Logical Group': l.group ?? '', 'Max at once': l.max, Notes: l.note ?? '' })),
    steps: steps.map((s, i) => ({ Step: i + 1, 'Search set / group*': s.group, 'Per level': s.perLevel ? 'yes' : '', 'Link into it': s.type && s.type !== 'FS' ? s.type : '', 'Lag (h)': s.lagHours ?? '', Notes: s.note ?? '' })),
    resources: src.pools.map((p) => ({ Kind: p.kind, 'ID*': p.id, Name: p.name, Quantity: p.quantity, Notes: p.note ?? '' })),
    rates: rateRows(src.rates ?? []),
    crews: (src.crews ?? []).map((c) => ({ 'ID*': c.id, Crew: crewText(c), Subcontractor: c.subcontractor ?? '', 'Crews available': c.available ?? '' })),
    trades: (src.trades ?? []).map((t) => ({ 'Code*': t.id, Name: t.name, 'People per day': t.capacity })),
  };
}

// ---------------------------------------------------------------- from sheets

export interface BookApplied {
  /** Recipes after the upload (all of them: the ones the sheet does not name are as they were). */
  recipes?: Recipe[];
  pools?: PoolRow[];
  parameters?: ParameterRow[];
  limits?: LimitRow[];
  /** The steps of the Steps sequence (none: the steps are removed). Undefined: the workbook has no Steps sheet. */
  steps?: SequenceStep[];
  /** The whole lists of the Rates, Crews and Trades sheets (undefined: no such sheet, or it could not be read). */
  rates?: RateRow[];
  crews?: CrewTemplate[];
  trades?: TradeRow[];
  /** What was done, a line each. */
  summary: string[];
  /** What was wrong or left out. */
  warnings: string[];
}

/** Checks a formula against the parameters and quantities: the problem in words, or '' when it can be worked out. */
export function formulaProblem(formula: string, parameterNames: string[]): string {
  const vars: Record<string, number> = { crews: 1 };
  for (const n of [...QUANTITY_NAMES, ...parameterNames]) vars[n] = 1;
  const r = evaluateFormula(formula, vars);
  return 'error' in r ? r.error : '';
}

/** Days a formula gives for one pour with these quantities and parameters (a number, or the problem), for the preview. */
export function previewDays(formula: string, parameters: ParameterRow[], quantities: Partial<Record<(typeof QUANTITY_NAMES)[number], number>>): { days: number } | { error: string } {
  const vars: Record<string, number> = { crews: 1, ...quantities };
  for (const p of parameters) if (p.enabled !== false) vars[p.name] = p.value;
  const r = evaluateFormula(formula, vars);
  return 'error' in r ? { error: r.error } : { days: r.value };
}

const TYPES: RelType[] = ['FS', 'SS', 'FF', 'SF'];

export function fromRecipeSheets(sheets: RecipeSheets, current: { recipes: Recipe[]; pools: PoolRow[]; parameters: ParameterRow[]; groupIds?: string[] }): BookApplied {
  const out: BookApplied = { summary: [], warnings: [] };
  const missing = (what: string, rows: Cells[], need: string[]) => {
    const first = rows[0];
    const lacking = first ? need.filter((h) => !first.has(h)) : [];
    if (lacking.length) out.warnings.push(`The ${what} sheet has no column “${lacking.join('”, “')}”: it was not read. Columns must keep their names.`);
    return lacking.length > 0;
  };

  // ---- Parameters (read first: the formulas are checked against them)
  let parameterNames = current.parameters.map((p) => p.name);
  if (sheets.parameters) {
    const rows = cells(sheets.parameters);
    if (!missing('Parameters', rows, ['name', 'value'])) {
      const list: ParameterRow[] = [];
      const seen = new Set<string>();
      rows.forEach((c, i) => {
        const name = text(c, 'name');
        if (!name) return;
        const value = numberOf(c, 'value');
        if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) return void out.warnings.push(`Parameters row ${i + 2}: “${name}” is not a name a formula can use (letters, digits and _, starting with a letter).`);
        if (value === undefined) return void out.warnings.push(`Parameters row ${i + 2}: “${name}” has no number as its value.`);
        if (seen.has(name.toLowerCase())) return void out.warnings.push(`Parameters row ${i + 2}: “${name}” is there twice: the first one is used.`);
        seen.add(name.toLowerCase());
        list.push({ id: name, name, value, ...(text(c, 'unit') ? { unit: text(c, 'unit') } : {}), ...(text(c, 'notes') ? { note: text(c, 'notes') } : {}) });
      });
      out.parameters = list;
      parameterNames = list.map((p) => p.name);
      out.summary.push(`Parameters: ${list.length}`);
    }
  }

  // ---- Recipes
  if (sheets.recipes) {
    const rows = cells(sheets.recipes);
    if (!missing('Recipes', rows, ['recipe', 'activity'])) {
      const byId = new Map<string, { id: string; group: string; rows: { c: Cells; at: number; order: number }[] }>();
      rows.forEach((c, at) => {
        const id = text(c, 'recipe');
        const phase = text(c, 'activity');
        if (!id && !phase) return;
        if (!id || !phase) return void out.warnings.push(`Recipes row ${at + 2}: a recipe and an activity are both needed.`);
        const entry = byId.get(upper(id)) ?? { id, group: text(c, 'logical group'), rows: [] };
        if (!entry.group) entry.group = text(c, 'logical group');
        entry.rows.push({ c, at, order: numberOf(c, 'order') ?? Number.MAX_SAFE_INTEGER });
        byId.set(upper(id), entry);
      });
      const next = [...current.recipes];
      let added = 0;
      let changed = 0;
      for (const entry of byId.values()) {
        entry.rows.sort((a, b) => a.order - b.order || a.at - b.at);
        const was = next.findIndex((r) => upper(r.id) === upper(entry.id));
        const old = was >= 0 ? next[was] : undefined;
        const edges: RecipeEdge[] = [];
        const tasks = entry.rows.map(({ c, at }): RecipeTask => {
          const phase = text(c, 'activity');
          const kept = old?.tasks.find((t) => upper(t.phase) === upper(phase));
          const t: RecipeTask = { phase };
          if (text(c, 'name')) t.name = text(c, 'name');
          if (text(c, 'suffix')) t.suffix = text(c, 'suffix');
          if (/^reb/i.test(text(c, 'material'))) t.material = 'rebar';
          else if (/^conc/i.test(text(c, 'material'))) t.material = 'concrete';
          // Days may hold a formula typed there: text that is not a number is the formula.
          const daysText = text(c, 'days');
          const formula = text(c, 'duration formula') || (daysText && numberOf(c, 'days') === undefined ? daysText : '');
          if (numberOf(c, 'days') !== undefined) t.days = numberOf(c, 'days');
          if (formula) {
            const problem = formulaProblem(formula, parameterNames);
            if (problem) out.warnings.push(`Recipes row ${at + 2} (${entry.id} · ${phase}): ${problem}`);
            t.formula = formula;
          }
          if (text(c, 'rate')) t.rate = text(c, 'rate');
          if (text(c, 'rebar rate')) t.density = text(c, 'rebar rate');
          if (text(c, 'crew')) t.crew = text(c, 'crew');
          if (text(c, 'calendar')) t.calendar = text(c, 'calendar');
          for (const [h, key] of [['equipment', 'equipment'], ['cranes', 'cranes'], ['materials', 'materials']] as const) {
            const list = parseUses(text(c, h));
            if (list.length) t[key] = list;
          }
          if (numberOf(c, 'priority') !== undefined) t.priority = numberOf(c, 'priority');
          if (yes(text(c, 'finish after'))) t.finishAfter = true;
          if (yes(text(c, 'gates'))) t.gates = true;
          // What the sheet does not carry stays: the place in the graph, links to other recipes, a switch-off and the note.
          if (kept) {
            if (kept.x !== undefined) { t.x = kept.x; t.y = kept.y; }
            if (kept.w) t.w = kept.w;
            if (kept.links) t.links = kept.links;
            if (kept.enabled === false) t.enabled = false;
            if (kept.note) t.note = kept.note;
          }
          edges.push(...edgesFromFollows(text(c, 'follows'), phase));
          return t;
        });
        const phases = new Set(tasks.map((t) => upper(t.phase)));
        for (const e of edges) if (!phases.has(upper(e.from))) out.warnings.push(`Recipe ${entry.id}: “${e.to}” follows “${e.from}”, which is not one of its activities.`);
        const recipe: Recipe = { ...(old ?? { id: entry.id }), group: entry.group || old?.group || '', tasks, ...(edges.length ? { edges } : { edges: undefined }) };
        if (old) {
          // Say what the sheet changed in it, so a file that is the same as what the app has is seen to be.
          const differs = tasks.filter((t) => {
            const was = old.tasks.find((x) => upper(x.phase) === upper(t.phase));
            return !was || JSON.stringify(was) !== JSON.stringify(t) || followsText(old, t.phase) !== followsText({ edges }, t.phase);
          }).map((t) => t.phase);
          const gone = old.tasks.filter((x) => !phases.has(upper(x.phase))).map((x) => x.phase);
          out.summary.push(differs.length || gone.length
            ? `${entry.id}: ${differs.length ? `changed ${differs.join(', ')}` : ''}${differs.length && gone.length ? '; ' : ''}${gone.length ? `removed ${gone.join(', ')}` : ''}`
            : `${entry.id}: the same as the app already has`);
          next[was] = recipe; changed++;
        } else { next.push(recipe); added++; }
      }
      out.recipes = next;
      out.summary.push(`Recipes: ${added} new, ${changed} changed (${byId.size} in the sheet)`);
    }
  }

  // ---- Limits
  if (sheets.limits) {
    const rows = cells(sheets.limits);
    if (!missing('Limits', rows, ['activity'])) {
      const list: LimitRow[] = [];
      rows.forEach((c, i) => {
        const phase = text(c, 'activity');
        if (!phase) return;
        const raw = text(c, 'max at once');
        const n = numberOf(c, 'max at once');
        if (raw && n === undefined && !parameterNames.some((p) => p.toLowerCase() === raw.toLowerCase())) out.warnings.push(`Limits row ${i + 2}: “${raw}” is neither a number nor a parameter.`);
        const group = text(c, 'logical group');
        list.push({ id: `${group ? `${group}|` : ''}${phase}`, phase, ...(group ? { group } : {}), max: n ?? raw, ...(text(c, 'notes') ? { note: text(c, 'notes') } : {}) });
      });
      out.limits = list;
      out.summary.push(`Limits: ${list.length}`);
    }
  }

  // ---- Steps
  if (sheets.steps) {
    const rows = cells(sheets.steps);
    const groupHead = rows[0]?.has('search set / group') ? 'search set / group' : 'search set';
    if (!missing('Steps', rows, [groupHead])) {
      const picked = rows.map((c, at) => ({ c, at, order: numberOf(c, 'step') ?? Number.MAX_SAFE_INTEGER })).filter(({ c }) => text(c, groupHead));
      picked.sort((a, b) => a.order - b.order || a.at - b.at);
      const known = new Set((current.groupIds ?? []).map(upper));
      const steps = picked.map(({ c, at }): SequenceStep => {
        const group = text(c, groupHead);
        if (known.size && !known.has(upper(group))) out.warnings.push(`Steps row ${at + 2}: no search set or group is called “${group}”.`);
        const type = upper(text(c, 'link into it')) as RelType;
        if (text(c, 'link into it') && !TYPES.includes(type)) out.warnings.push(`Steps row ${at + 2}: “${text(c, 'link into it')}” is not a link type (FS, SS, FF, SF).`);
        return {
          group,
          ...(yes(text(c, 'per level')) ? { perLevel: true } : {}),
          ...(TYPES.includes(type) && type !== 'FS' ? { type } : {}),
          ...(numberOf(c, 'lag') ? { lagHours: numberOf(c, 'lag') } : {}),
          ...(text(c, 'notes') ? { note: text(c, 'notes') } : {}),
        };
      });
      out.steps = steps;
      out.summary.push(`Steps: ${steps.length}`);
    }
  }

  // ---- Resources
  if (sheets.resources) {
    const rows = cells(sheets.resources);
    if (!missing('Resources', rows, ['id'])) {
      const next = [...current.pools];
      let n = 0;
      rows.forEach((c, i) => {
        const id = text(c, 'id');
        if (!id) return;
        const kind = text(c, 'kind').toLowerCase() as PoolKind;
        if (kind !== 'equipment' && kind !== 'crane' && kind !== 'material') return void out.warnings.push(`Resources row ${i + 2}: Kind must be equipment, crane or material.`);
        const row: PoolRow = { id, kind, name: text(c, 'name'), quantity: numberOf(c, 'quantity') ?? 0, ...(text(c, 'notes') ? { note: text(c, 'notes') } : {}) };
        const at = next.findIndex((p) => p.kind === kind && upper(p.id) === upper(id));
        if (at >= 0) next[at] = { ...next[at], ...row }; else next.push(row);
        n++;
      });
      out.pools = next;
      out.summary.push(`Resources: ${n}`);
    }
  }

  // ---- Rates, Crews, Trades (each sheet is the whole list)
  const asTsv = (rows: Cells[], heads: string[]) => rows.map((c) => heads.map((h) => text(c, norm(h))).join('\t')).join('\n');
  if (sheets.rates) {
    const rows = cells(sheets.rates);
    if (!missing('Rates', rows, ['id', 'type'])) {
      const list = parseRatesPaste(asTsv(rows, RATE_SHEET_HEAD)).filter((r) => r.id.trim());
      out.rates = list;
      out.summary.push(`Rates: ${list.length}`);
    }
  }
  if (sheets.trades) {
    const rows = cells(sheets.trades);
    if (!missing('Trades', rows, ['code'])) {
      const list = parseTradesPaste(asTsv(rows, TRADE_SHEET_HEAD));
      out.trades = list;
      out.summary.push(`Trades: ${list.length}`);
    }
  }
  if (sheets.crews) {
    const rows = cells(sheets.crews);
    if (!missing('Crews', rows, ['id', 'crew'])) {
      const list: CrewTemplate[] = [];
      for (const c of rows) {
        const id = text(c, 'id');
        if (!id) continue;
        const available = numberOf(c, 'crews available');
        list.push({ id, trades: parseCrewText(text(c, 'crew')), ...(text(c, 'subcontractor') ? { subcontractor: text(c, 'subcontractor') } : {}), ...(available !== undefined ? { available } : {}) });
      }
      out.crews = list;
      out.summary.push(`Crews: ${list.length}`);
    }
  }
  return out;
}
