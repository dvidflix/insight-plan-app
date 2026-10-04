import type { ModelContext } from './evaluate';
import type { SpecResult } from './runIds';

/** Custom rules: model checks IDS can't express (it can't count, or compare
    one value with another), kept as JSON files in docs/ids/rules and shown
    in Model checks next to the IDS specifications, under "Custom rules".
    Patches link to a rule as to a specification: {"ids": "Custom rules",
    "specification": "<rule id>"}. */

export const RULES_FILE = 'Custom rules';

/** Where a model's Unit + Building code comes from: the elements with any
    of these property sets (merged in order, a later set winning). */
export interface UnitBuildingSource {
  psets: string[];
  building: string;
  unit?: string;
}

/** One IfcBuilding per model, named its elements' Unit + Building (1HN). */
export interface SingleBuildingRule extends UnitBuildingSource {
  type: 'single-building';
}

/** An element's Name equals one of these properties (by name, in any
    property set), e.g. its Full Pour ID String or Pour ID Number. */
export interface NameMatchesPropertyRule {
  type: 'name-matches-property';
  /** Property names, in order of preference (the patch copies the first found). */
  properties: string[];
}

/** An element's property (by name, in any property set) is exactly this many
    digits, e.g. Pour ID Number 0389, not 389. */
export interface PropertyDigitsRule {
  type: 'property-digits';
  properties: string[];
  digits: number;
}

export type RuleCheck = SingleBuildingRule | NameMatchesPropertyRule | PropertyDigitsRule;

export type Rule = RuleCheck & {
  id: string;
  name: string;
  description?: string;
  instructions?: string;
};

/** An element's properties from these sets, a later set winning. */
export function mergedProps(props: Record<string, unknown>, psets: string[]): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  let found = false;
  for (const pset of psets) {
    for (const [k, v] of Object.entries(props)) {
      if (!k.startsWith(`${pset}.`)) continue;
      out[k.slice(pset.length + 1)] = v;
      found = true;
    }
  }
  return found ? out : null;
}

/** Unit + Building from an element's merged properties (1 + HN → 1HN), or
    '' when it has no Building. */
export function unitBuildingOf(p: Record<string, unknown>, src: UnitBuildingSource): string {
  const base = String(p[src.building] ?? '').trim().toUpperCase();
  if (!base) return '';
  let unit = src.unit ? String(p[src.unit] ?? '').trim().toUpperCase() : '';
  if (['UNKNOWN', 'NONE', 'N/A'].includes(unit)) unit = '';
  return `${unit}${base}`;
}

/** The name a model's building should have: the first element's Unit +
    Building, and how the elements' values spread. */
export function expectedBuilding(ctx: Pick<ModelContext, 'candidates'>, src: UnitBuildingSource): { name: string; values: Map<string, number> } {
  const values = new Map<string, number>();
  let name = '';
  for (const c of ctx.candidates) {
    const p = mergedProps(c.props, src.psets);
    if (!p) continue;
    const code = unitBuildingOf(p, src);
    if (!code) continue;
    if (!name) name = code;
    values.set(code, (values.get(code) ?? 0) + 1);
  }
  return { name, values };
}

/** The element's values of these properties (by name, in any set), in the
    order given; empty values left out. */
export function propertyValues(props: Record<string, unknown>, names: string[]): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const name of names) {
    for (const [k, v] of Object.entries(props)) {
      if (k.slice(k.indexOf('.') + 1) !== name) continue;
      const value = String(v ?? '').trim();
      if (value && !out.some((o) => o.name === name && o.value === value)) out.push({ name, value });
    }
  }
  return out;
}

/** Same text, ignoring case and surrounding spaces; numbers by value (0389 = 389). */
export function sameValue(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  if (x.toUpperCase() === y.toUpperCase()) return true;
  return /^-?\d+(\.\d+)?$/.test(x) && /^-?\d+(\.\d+)?$/.test(y) && Number(x) === Number(y);
}

function evaluateNameMatches(rule: NameMatchesPropertyRule, ctx: ModelContext): Pick<SpecResult, 'applicable' | 'passed' | 'failures'> {
  let applicable = 0;
  const failures: SpecResult['failures'] = [];
  for (const c of ctx.candidates) {
    const values = propertyValues(c.props, rule.properties);
    if (!values.length) continue;
    applicable++;
    if (values.some((v) => sameValue(c.name, v.value))) continue;
    failures.push({ modelId: ctx.modelId, localId: c.localId, guid: c.guid, reasons: [`Name ${c.name || '(none)'} matches none of ${values.map((v) => `${v.name} = ${v.value}`).join(', ')}`] });
  }
  return { applicable, passed: applicable - failures.length, failures };
}

function evaluateDigits(rule: PropertyDigitsRule, ctx: ModelContext): Pick<SpecResult, 'applicable' | 'passed' | 'failures'> {
  let applicable = 0;
  const failures: SpecResult['failures'] = [];
  const exact = new RegExp(`^\\d{${rule.digits}}$`);
  for (const c of ctx.candidates) {
    const values = propertyValues(c.props, rule.properties);
    if (!values.length) continue;
    applicable++;
    const bad = values.filter((v) => !exact.test(v.value));
    if (!bad.length) continue;
    failures.push({ modelId: ctx.modelId, localId: c.localId, guid: c.guid, reasons: bad.map((v) => `${v.name} = ${v.value} is not ${rule.digits} digits`) });
  }
  return { applicable, passed: applicable - failures.length, failures };
}

function evaluateSingleBuilding(rule: SingleBuildingRule, ctx: ModelContext): Pick<SpecResult, 'applicable' | 'passed' | 'failures'> {
  const buildings = ctx.candidates.filter((c) => c.category.toUpperCase() === 'IFCBUILDING');
  const { name, values } = expectedBuilding(ctx, rule);
  const failures: SpecResult['failures'] = [];
  const spread = values.size > 1 ? ` (the elements say ${[...values].map(([v, n]) => `${v} ×${n}`).join(', ')})` : '';
  for (const b of buildings) {
    const reasons: string[] = [];
    if (buildings.length > 1) reasons.push(`One of ${buildings.length} buildings: the model should have one`);
    if (!name) reasons.push(`No element has ${rule.building} to name it by`);
    else if (b.name.trim().toUpperCase() !== name) reasons.push(`Named ${b.name || '(none)'}, should be ${name}${spread}`);
    if (reasons.length) failures.push({ modelId: ctx.modelId, localId: b.localId, guid: b.guid, reasons });
  }
  if (buildings.length === 0) failures.push({ modelId: ctx.modelId, localId: 0, guid: '', reasons: ['The model has no IfcBuilding'] });
  const applicable = Math.max(buildings.length, 1);
  return { applicable, passed: applicable - failures.length, failures };
}

/** Runs the rules against the models, as Model checks results. */
export function runRules(rules: Rule[], models: ModelContext[]): SpecResult[] {
  return rules.map((rule) => {
    const result: SpecResult = { key: `${RULES_FILE}#${rule.id}`, file: RULES_FILE, name: rule.name, identifier: rule.id, description: rule.description, instructions: rule.instructions, applicable: 0, passed: 0, failures: [] };
    try {
      for (const ctx of models) {
        const r = rule.type === 'single-building' ? evaluateSingleBuilding(rule, ctx) : rule.type === 'name-matches-property' ? evaluateNameMatches(rule, ctx) : rule.type === 'property-digits' ? evaluateDigits(rule, ctx) : null;
        if (!r) throw new Error(`Unknown rule type "${(rule as { type: string }).type}".`);
        result.applicable += r.applicable;
        result.passed += r.passed;
        result.failures.push(...r.failures);
      }
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
    }
    return result;
  });
}
