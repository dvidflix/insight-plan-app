/** WBS rules: where each activity goes in the programme's WBS, set by the user (Generate › WBS) rather than by code. The generator places the
    activities (scenario-engine/core/wbs_rules.py); this is the same evaluator, for the preview, plus the rule set Generate sends when the user has set
    none (the work-package tree), and the rules as rows of an Excel sheet. The two evaluators are held to the same cases
    (scenario-engine/tests/fixtures/wbs_rule_cases.json).

    A rule set is a list of rules; for each activity the first rule whose conditions all hold places it (a rule with no conditions always holds: the
    fallback, last). A rule's path is its levels, each a name template: {Field} is the activity's value of that field ({Field:title}, :upper,
    :lower), {Field|text if set|text if not}, {parent} the node above. A level whose template reads an empty field is left out, unless the field is
    marked {Field?}. A level can be for some phases only (the activity's phase, {phase}), and can make a node for each of them whether used or not.
    Two levels are steps of their own: "phases from recipe" (a node per phase the item's activities have, in its recipe's order, each activity in its
    own) and "per item ID" (a node per item, named by its ID, the one in its activity IDs).
    Nothing here knows any kind of object or project: the fields are whatever the work items carry. */

export const WBS_OPS = ['equals', 'not equals', 'contains', 'not contains', 'starts with', 'in', 'not in', 'is empty', 'is not empty', 'is true', 'is false'] as const;
export type WbsOp = (typeof WBS_OPS)[number];
/** The operators that take no value. */
export const NO_VALUE_OPS: readonly WbsOp[] = ['is empty', 'is not empty', 'is true', 'is false'];

export interface WbsCondition { field: string; op: WbsOp; value?: string }
export type WbsStepKind = 'phases' | 'each';
/** A level of a path. `name` is its template; a `kind` step may leave it empty and is named by its default (DEFAULT_NAMES). */
export interface WbsLevel { name: string; phases?: string[]; always?: boolean; kind?: WbsStepKind }
export interface WbsRule {
  id: string;
  name?: string;
  enabled?: boolean;
  when: WbsCondition[];
  /** Where the path starts: under the building's level node (the default) or under its Construction node. */
  under?: 'level' | 'root';
  path: WbsLevel[];
}
export interface WbsRuleSet { rules: WbsRule[] }
export type Ctx = Record<string, string | number | boolean | null | undefined>;

export const key = (name: unknown) => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The fields an activity's rules read, by key(): later sources win. */
export function context(...sources: (Record<string, unknown> | undefined | null)[]): Ctx {
  const out: Ctx = {};
  for (const src of sources) for (const [k, v] of Object.entries(src ?? {})) if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) out[key(k)] = v as Ctx[string];
  return out;
}

const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : '';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim();
};

export function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  return !['', '0', 'no', 'false', 'n', 'none'].includes(text(v).toLowerCase());
}

/** Title case as the generator's (core/helpers.py title_case): each word capitalised, the rest lower case. */
const title = (s: string) => s.replace(/_/g, ' ').split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');

/** The template with the context's values in, or null when it reads an empty field not marked ?. */
export function fill(template: string, ctx: Ctx): string | null {
  let empty = false;
  const out = String(template ?? '').replace(/\{([^{}]+)\}/g, (_, inner: string) => {
    if (inner.includes('|')) {
      const [name, yes = '', no = ''] = inner.split('|');
      return truthy(ctx[key(name.replace(/\?$/, ''))]) ? yes : no;
    }
    const at = inner.indexOf(':');
    const name = at < 0 ? inner : inner.slice(0, at);
    const fmt = at < 0 ? '' : inner.slice(at + 1).trim().toLowerCase();
    const optional = name.endsWith('?');
    const t = text(ctx[key(name.replace(/\?$/, ''))]);
    if (!t) { if (!optional) empty = true; return ''; }
    return fmt === 'title' ? title(t) : fmt === 'upper' ? t.toUpperCase() : fmt === 'lower' ? t.toLowerCase() : t;
  });
  return empty || !out.trim() ? null : out;
}

export function holds(c: WbsCondition, ctx: Ctx): boolean {
  const v = ctx[key(c.field)];
  const t = text(v).toLowerCase();
  const want = text(c.value).toLowerCase();
  const options = want.split(',').map((w) => w.trim()).filter(Boolean);
  switch (c.op) {
    case 'equals': return t === want;
    case 'not equals': return t !== want;
    case 'contains': return t.includes(want);
    case 'not contains': return !t.includes(want);
    case 'starts with': return t.startsWith(want);
    case 'in': return options.includes(t);
    case 'not in': return !options.includes(t);
    case 'is empty': return !t;
    case 'is not empty': return !!t;
    case 'is true': return truthy(v);
    case 'is false': return !truthy(v);
    default: return false;
  }
}

/** The rules that take part: switched on, with a path. */
export const usableRules = (set: WbsRuleSet | undefined) => (set?.rules ?? []).filter((r) => r.enabled !== false && r.path.length > 0);

export function firstMatch(rules: readonly WbsRule[], ctx: Ctx): WbsRule | null {
  return rules.find((r) => r.when.filter((c) => c.field.trim()).every((c) => holds(c, ctx))) ?? null;
}

/** A step's name when it has none of its own (as the generator's DEFAULT_NAMES). */
export const DEFAULT_NAMES: Record<WbsStepKind, string> = { phases: '{phase}', each: '{item_id}' };
/** How the steps are written in a level cell (and the Excel sheet); "<step>: <template>" names it another way. */
export const STEP_WORDS: Record<WbsStepKind, string> = { phases: 'phases from recipe', each: 'per item ID' };

/** A level as written in a cell: its template, or its step's words. */
export function levelText(l: WbsLevel): string {
  return l.kind ? (l.name.trim() ? `${STEP_WORDS[l.kind]}: ${l.name}` : STEP_WORDS[l.kind]) : l.name;
}

/** The level a cell's text stands for. */
export function parseLevel(t: string): WbsLevel {
  const s = t.trim();
  for (const kind of Object.keys(STEP_WORDS) as WbsStepKind[]) {
    const words = STEP_WORDS[kind].toLowerCase();
    if (s.toLowerCase() === words) return { name: '', kind };
    if (s.toLowerCase().startsWith(`${words}:`)) return { name: s.slice(words.length + 1).trim(), kind };
  }
  return { name: s };
}

/** The node names one activity is placed in under `start` (the level or root node's name), top first: what the generator registers for it. With
    `always` phase levels and "phases from recipe" steps, `extra` gets the sibling nodes made for the other phases. `phasesOf`: the phases of the
    item's activities in order (the activity's own when not given). */
export function pathOf(rule: WbsRule, ctx: Ctx, start: string, phase: string, extra?: (parentPath: string[], name: string) => void, phasesOf?: readonly string[]): string[] {
  const out: string[] = [];
  const c: Ctx = { ...ctx, [key('level_node')]: start };
  for (const level of rule.path) {
    c[key('parent')] = out.length ? out[out.length - 1] : start;
    const template = level.name || (level.kind ? DEFAULT_NAMES[level.kind] : '');
    if (level.kind === 'phases') {
      let at: string | null = null;
      for (const ph of [...new Set((phasesOf ?? [phase]).map((p) => p.trim()).filter(Boolean))]) {
        const n = fill(template, { ...c, [key('phase')]: ph });
        if (!n) continue;
        extra?.([...out], n);
        if (ph.toLowerCase() === phase.trim().toLowerCase()) at = n;
      }
      if (at === null) break;
      out.push(at);
      continue;
    }
    const phases = (level.phases ?? []).map((p) => p.trim()).filter(Boolean);
    if (phases.length && level.always && extra) for (const ph of phases) { const n = fill(level.name, { ...c, [key('phase')]: ph }); if (n) extra([...out], n); }
    if (phases.length && !phases.some((p) => p.toLowerCase() === phase.trim().toLowerCase())) break;
    const name = fill(template, c);
    if (name === null) { if (phases.length) break; continue; }
    out.push(name);
  }
  return out;
}

// ---- Generate's work packages ----

/** The fields Generate gives each work item for the rules (sent as the item's properties): its package and the packages it is in. */
export const PACKAGE_FIELDS = ['Package', 'Package code', 'Package level 1', 'Package level 2', 'Package level 3', 'Storey', 'IFC class', 'Method', 'Building', 'Set', 'Set folder', 'Set folder 1', 'Set folder 2'] as const;
/** Fields every activity has besides its work item's: the generator's own. */
export const ACTIVITY_FIELDS = ['phase', 'level', 'prefix', 'item ID'] as const;
/** Whether a rule set reads the set fields (Set, Set folder…): only then are the search sets run for them. */
export const readsSets = (set: WbsRuleSet | undefined) => (set?.rules ?? []).some((r) => r.when.some((c) => key(c.field).startsWith('set')) || r.path.some((l) => /\{\s*set/i.test(l.name)));

/** Generate's WBS when the user sets no rules: the work-package tree under the building's Construction node, a node per package, nested as the
    packages are (`depth`: how deep the deepest package is). */
export function packageTreeRules(depth: number): WbsRuleSet {
  return { rules: [{ id: 'package-tree', name: 'Follow the work packages', under: 'root', when: [], path: Array.from({ length: Math.max(1, depth) }, (_, i) => ({ name: `{Package level ${i + 1}}` })) }] };
}

/** A rule set as stored (anything unreadable left out); undefined when it has no rules. */
export function normalizeWbs(raw: unknown): WbsRuleSet | undefined {
  const rules = (raw as { rules?: unknown[] } | null)?.rules;
  if (!Array.isArray(rules)) return undefined;
  const out: WbsRule[] = [];
  for (const r of rules) {
    if (!r || typeof r !== 'object') continue;
    const x = r as Partial<WbsRule>;
    const path = (Array.isArray(x.path) ? x.path : []).flatMap((l): WbsLevel[] => {
      const lv = (typeof l === 'string' ? { name: l } : l) as Partial<WbsLevel> | null;
      const name = String(lv?.name ?? '').trim();
      const kind = lv?.kind === 'phases' || lv?.kind === 'each' ? lv.kind : undefined;
      if (kind) return [{ name, kind }];
      if (!name) return [];
      const phases = Array.isArray(lv?.phases) ? lv!.phases.map((p) => String(p).trim()).filter(Boolean) : [];
      return [{ name, ...(phases.length ? { phases } : {}), ...(phases.length && lv?.always ? { always: true } : {}) }];
    });
    const when = (Array.isArray(x.when) ? x.when : []).flatMap((c) => {
      const field = String(c?.field ?? '').trim();
      const op = (WBS_OPS as readonly string[]).includes(String(c?.op)) ? (c!.op as WbsOp) : 'equals';
      return field ? [{ field, op, ...(NO_VALUE_OPS.includes(op) ? {} : { value: String(c?.value ?? '') }) }] : [];
    });
    out.push({ id: String(x.id ?? '').trim() || `rule-${out.length + 1}`, ...(String(x.name ?? '').trim() ? { name: String(x.name).trim() } : {}), ...(x.enabled === false ? { enabled: false } : {}), when, ...(x.under === 'root' ? { under: 'root' as const } : {}), path });
  }
  return out.length ? { rules: out } : undefined;
}

// ---- The preview ----

export interface WbsItem {
  /** The item's fields (its properties as sent). */
  fields: Record<string, string>;
  /** The phases of its activities. */
  phases: string[];
  /** How many objects it stands for. */
  objects: number;
  /** Its ID as the generator numbers the items (roughly), for "per item ID". */
  id?: string;
}
export interface WbsNode { name: string; objects: number; activities: number; children: WbsNode[]; rule?: string }

/** The WBS the rules make of the items (roughly: the building's prefix and level names are the generator's; here the level node is the item's
    Storey): a tree of nodes with how many objects and activities end in each. */
export function previewTree(set: WbsRuleSet, items: readonly WbsItem[], root = 'Construction'): { tree: WbsNode; byRule: Map<string, number>; unplaced: number } {
  const top: WbsNode = { name: root, objects: 0, activities: 0, children: [] };
  const byRule = new Map<string, number>();
  let unplaced = 0;
  const rules = usableRules(set);
  const child = (n: WbsNode, name: string) => { let c = n.children.find((x) => x.name === name); if (!c) { c = { name, objects: 0, activities: 0, children: [] }; n.children.push(c); } return c; };
  for (const it of items) {
    const counted = new Set<WbsNode>();
    for (const phase of it.phases.length ? it.phases : ['']) {
      const ctx = context(it.fields, { phase, level: it.fields.Storey ?? '', item_id: it.id ?? '' });
      const rule = firstMatch(rules, ctx);
      if (!rule) { unplaced++; continue; }
      byRule.set(rule.id, (byRule.get(rule.id) ?? 0) + 1);
      const levelName = it.fields.Storey || 'No storey';
      const start = rule.under === 'root' ? top : child(top, levelName);
      // The nodes from the top down to where the activity goes.
      const chain = start === top ? [top] : [top, start];
      for (const name of pathOf(rule, ctx, rule.under === 'root' ? root : levelName, phase, (parentPath, name) => { let p = start; for (const x of parentPath) p = child(p, x); child(p, name); }, it.phases)) chain.push(child(chain[chain.length - 1], name));
      chain[chain.length - 1].activities++;
      // An item's objects count once in each node its activities are in or under.
      for (const n of chain) if (!counted.has(n)) { counted.add(n); n.objects += it.objects; }
    }
  }
  return { tree: top, byRule, unplaced };
}

// ---- As rows of an Excel sheet ----

export const WBS_SHEET = 'WBS rules';
export const WBS_README_SHEET = 'Read me';
export const MAX_LEVELS = 8;
export const WBS_COLUMNS = ['Order', 'On', 'Name', 'Starts under', 'Field 1', 'Operator 1', 'Value 1', 'Field 2', 'Operator 2', 'Value 2', 'Field 3', 'Operator 3', 'Value 3',
  ...Array.from({ length: MAX_LEVELS }, (_, i) => `Level ${i + 1}`), 'Last level for phases', 'Make every phase'] as const;
export type WbsRow = Record<string, string | number>;

export const WBS_README = [
  'WBS rules: where each activity goes in the programme’s WBS. One row is one rule; for each activity the rules are tried from the top and the first that fits places it.',
  'Field / Operator / Value (up to three, all must hold): which activities the rule is for. Operators: ' + WBS_OPS.join(', ') + '. A rule with no field fits every activity: put it last, as the fallback.',
  'Level 1, Level 2…: the WBS nodes under one another. {Field} is the activity’s value of a field; {Field:title}, {Field:upper} and {Field:lower} format it; {Field|text if set|text if not} picks a text; {parent} is the node above.',
  'A level that reads an empty field is left out (the activity stays one level up). Write {Field?} for a field that may be empty. A level of fixed text is one node for all.',
  'Two levels are steps of their own. “phases from recipe”: a node for each phase the item’s recipe makes, in its order, each activity in its own phase’s node. “per item ID”: a node per item, named by its ID (the one in its activity IDs). Write “phases from recipe: {parent} - {phase}” or “per item ID: Item {item_id}” to name them another way.',
  'Starts under: level (the building’s level node, the default) or root (the building’s Construction node, with no level node).',
  'Last level for phases: the last level is only for these phases (comma-separated), e.g. a node per phase written {parent} - {phase}. Make every phase: Yes makes a node for each of them, used or not.',
  'Fields of Generate’s work packages: ' + PACKAGE_FIELDS.join(', ') + ' (Set: the search set that comes first, in the Search sets tree’s order, for the item’s objects, when it is the same for all of them; Set folder its folder, Set folder 1 the top one); and every activity has phase and item ID. Order sets the order of the rules; On = No keeps a rule without using it.',
  'Uploading replaces the rules with the rows of this sheet.',
];

export function rulesToRows(set: WbsRuleSet): WbsRow[] {
  return set.rules.map((r, i) => {
    const row: WbsRow = { Order: i + 1, On: r.enabled === false ? 'No' : 'Yes', Name: r.name ?? '', 'Starts under': r.under === 'root' ? 'root' : 'level' };
    r.when.slice(0, 3).forEach((c, k) => { row[`Field ${k + 1}`] = c.field; row[`Operator ${k + 1}`] = c.op; row[`Value ${k + 1}`] = c.value ?? ''; });
    r.path.slice(0, MAX_LEVELS).forEach((l, k) => { row[`Level ${k + 1}`] = levelText(l); });
    const last = r.path[r.path.length - 1];
    if (last?.phases?.length && !last.kind) { row['Last level for phases'] = last.phases.join(', '); row['Make every phase'] = last.always ? 'Yes' : 'No'; }
    for (const c of WBS_COLUMNS) if (!(c in row)) row[c] = '';
    return row;
  });
}

/** The rule set of the sheet's rows, with what could not be read. */
export function rowsToRules(rows: readonly WbsRow[]): { set: WbsRuleSet; warnings: string[] } {
  const warnings: string[] = [];
  const cell = (r: WbsRow, c: string) => String(r[c] ?? '').trim();
  const parsed = rows.map((r, i) => {
    const line = i + 2;
    const when: WbsCondition[] = [];
    for (let k = 1; k <= 3; k++) {
      const field = cell(r, `Field ${k}`);
      if (!field) continue;
      const opText = cell(r, `Operator ${k}`).toLowerCase() || 'equals';
      const op = (WBS_OPS as readonly string[]).includes(opText) ? (opText as WbsOp) : null;
      if (!op) { warnings.push(`Row ${line}: operator “${cell(r, `Operator ${k}`)}” is not one of ${WBS_OPS.join(', ')}; the condition is left out.`); continue; }
      when.push({ field, op, ...(NO_VALUE_OPS.includes(op) ? {} : { value: cell(r, `Value ${k}`) }) });
    }
    const path: WbsLevel[] = Array.from({ length: MAX_LEVELS }, (_, k) => cell(r, `Level ${k + 1}`)).filter(Boolean).map(parseLevel);
    const phases = cell(r, 'Last level for phases').split(',').map((p) => p.trim()).filter(Boolean);
    if (phases.length && path.length && path[path.length - 1].kind) warnings.push(`Row ${line}: the last level is a step of its own, so “Last level for phases” is left out.`);
    else if (phases.length && path.length) Object.assign(path[path.length - 1], { phases, ...(/^y/i.test(cell(r, 'Make every phase')) ? { always: true } : {}) });
    if (!path.length) { if (when.length || cell(r, 'Name')) warnings.push(`Row ${line}: no level, so the rule is left out.`); return null; }
    const order = Number(cell(r, 'Order'));
    return { order: Number.isFinite(order) && cell(r, 'Order') ? order : i + 1, rule: { id: `rule-${i + 1}`, ...(cell(r, 'Name') ? { name: cell(r, 'Name') } : {}), ...(/^n/i.test(cell(r, 'On')) ? { enabled: false } : {}), when, ...(/^root/i.test(cell(r, 'Starts under')) ? { under: 'root' as const } : {}), path } as WbsRule };
  }).filter((x): x is { order: number; rule: WbsRule } => !!x);
  parsed.sort((a, b) => a.order - b.order);
  return { set: { rules: parsed.map((p) => p.rule) }, warnings };
}
