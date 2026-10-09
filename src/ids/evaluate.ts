import * as OBC from '@thatopen/components';
import * as FRAGS from '@thatopen/fragments';
import type { ModelTreeNode } from '../viewer/types';

/** Evaluates a parsed IDS specification against one loaded model, from the
    viewer's own element index. That Open parses the .ids file; its
    evaluation has gaps with how this app loads models (property
    applicability finds nothing, applicability facets are OR-ed instead of
    AND-ed, attribute applicability and partOf are empty stubs), so Entity,
    Attribute, Property and PartOf are judged here, with IDS 1.0 semantics.
    Classification and Material requirements still go to That Open. */

type Param = OBC.IDSFacetParameter | string | undefined | null;
type Value = string | number | boolean | null | undefined;

/** An element or spatial node the specification may apply to. */
export interface Candidate {
  localId: number;
  category: string;
  guid: string;
  name: string;
  description: string;
  /** "Pset.Property" → value. */
  props: Record<string, unknown>;
}

export interface ModelContext {
  modelId: string;
  candidates: Candidate[];
  /** The IFC header's Originating System ('' when unknown). */
  originatingSystem?: string;
  /** Spatial ancestors, nearest first, as [localId, IFC class]. */
  ancestors: Map<number, [number, string][]>;
  /** An element's IFC attributes (Name, ObjectType, Tag, PredefinedType…). */
  attributes: (localIds: number[]) => Promise<Map<number, Record<string, Value>>>;
}

export interface Evaluation {
  applicable: number;
  failures: { localId: number; guid: string; reasons: string[] }[];
}

export function describe(p: Param): string {
  if (p === undefined || p === null) return '';
  if (typeof p === 'string') return p;
  switch (p.type) {
    case 'simple':
      return String(p.parameter);
    case 'enumeration':
      return p.parameter.length > 6 ? `one of ${p.parameter.slice(0, 6).join(', ')}… (${p.parameter.length})` : `one of ${p.parameter.join(', ')}`;
    case 'pattern':
      return `matching ${p.parameter}`;
    case 'bounds': {
      const { min, max, minInclusive, maxInclusive } = p.parameter;
      return [min !== undefined ? `${minInclusive ? '≥' : '>'} ${min}` : '', max !== undefined ? `${maxInclusive ? '≤' : '<'} ${max}` : ''].filter(Boolean).join(' and ');
    }
    case 'length':
      return `length ${p.parameter.length ?? `${p.parameter.min ?? 0}–${p.parameter.max ?? '∞'}`}`;
    default:
      return JSON.stringify(p);
  }
}

const same = (a: unknown, b: unknown, ignoreCase: boolean) => {
  if (typeof a === 'number' || typeof b === 'number') {
    const x = Number(a);
    const y = Number(b);
    if (Number.isFinite(x) && Number.isFinite(y)) return Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
  }
  const s = String(a);
  const t = String(b);
  return ignoreCase ? s.toUpperCase() === t.toUpperCase() : s === t;
};

/** Whether a value meets an IDS parameter (absent parameter: anything does). */
export function matches(p: Param, value: Value, ignoreCase = false): boolean {
  if (p === undefined || p === null) return true;
  if (value === undefined || value === null) return false;
  if (typeof p === 'string') return same(value, p, ignoreCase);
  switch (p.type) {
    case 'simple':
      return same(value, p.parameter, ignoreCase);
    case 'enumeration':
      return (p.parameter as unknown[]).some((x) => same(value, x, ignoreCase));
    case 'pattern':
      return new RegExp(`^(?:${p.parameter})$`, ignoreCase ? 'i' : '').test(String(value));
    case 'bounds': {
      const n = Number(value);
      const { min, max, minInclusive, maxInclusive } = p.parameter;
      if (!Number.isFinite(n)) return false;
      if (min !== undefined && (minInclusive ? n < min : n <= min)) return false;
      if (max !== undefined && (maxInclusive ? n > max : n >= max)) return false;
      return true;
    }
    case 'length': {
      const len = String(value).length;
      const { length, min, max } = p.parameter;
      return (length === undefined || len === length) && (min === undefined || len >= min) && (max === undefined || len <= max);
    }
    default:
      return false;
  }
}

const provided = (v: Value) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
const shown = (v: Value) => (provided(v) ? String(v) : 'none');

interface FacetLike {
  facetType: OBC.IDSFacetType;
  cardinality?: OBC.IDSConditionalCardinaltiy;
  [key: string]: unknown;
}

/** Holds, or why not. `asApplicability` ignores cardinality (all required). */
type Verdict = { pass: true } | { pass: false; why: string };
const ok: Verdict = { pass: true };
const no = (why: string): Verdict => ({ pass: false, why });

/** Applies cardinality to "found / found with a matching value". */
function judge(cardinality: OBC.IDSConditionalCardinaltiy, exists: boolean, valueOk: boolean, what: string, current: string, wanted: string): Verdict {
  if (cardinality === 'prohibited') return exists && valueOk ? no(`${what} ${wanted ? `is ${current}, must not be ${wanted}` : 'must not be there'}`) : ok;
  if (!exists) return cardinality === 'optional' ? ok : no(`${what} is missing`);
  return valueOk ? ok : no(`${what}: ${current}, needs ${wanted}`);
}

function entityVerdict(f: FacetLike, c: Candidate, attrs: Record<string, Value> | undefined): Verdict {
  const name = f.name as Param;
  if (!matches(name, c.category, true)) return no(`Entity: ${c.category}, needs ${describe(name)}`);
  const pt = f.predefinedType as Param;
  if (pt && !matches(pt, attrs?.PredefinedType ?? attrs?.ObjectType, true)) return no(`PredefinedType: ${shown(attrs?.PredefinedType)}, needs ${describe(pt)}`);
  return ok;
}

function attributeVerdict(f: FacetLike, attrs: Record<string, Value>, cardinality: OBC.IDSConditionalCardinaltiy): Verdict {
  const names = Object.keys(attrs).filter((k) => matches(f.name as Param, k));
  const found = names.filter((k) => provided(attrs[k]));
  const value = f.value as Param;
  const good = found.some((k) => matches(value, attrs[k]));
  const label = `Attribute ${describe(f.name as Param)}`;
  return judge(cardinality, found.length > 0, value ? good : true, label, found.map((k) => shown(attrs[k])).join(', ') || 'none', describe(value));
}

function propertyVerdict(f: FacetLike, c: Candidate, cardinality: OBC.IDSConditionalCardinaltiy): Verdict {
  const hits: Value[] = [];
  for (const [key, v] of Object.entries(c.props)) {
    const dot = key.indexOf('.');
    if (dot < 0) continue;
    if (!matches(f.propertySet as Param, key.slice(0, dot)) || !matches(f.baseName as Param, key.slice(dot + 1))) continue;
    if (provided(v as Value)) hits.push(v as Value);
  }
  const value = f.value as Param;
  const good = hits.some((v) => matches(value, v));
  const label = `${describe(f.propertySet as Param)} / ${describe(f.baseName as Param)}`;
  return judge(cardinality, hits.length > 0, value ? good : true, label, hits.map(shown).join(', ') || 'none', describe(value));
}

/** With a relation, the nearest spatial parent must be of the class;
    without one, any ancestor may be. */
function partOfVerdict(f: FacetLike, chain: [number, string][], cardinality: OBC.IDSConditionalCardinaltiy): Verdict {
  const entity = (f.entity ?? {}) as { name?: Param };
  const candidates = String(f.relation ?? '') ? chain.slice(0, 1) : chain;
  const found = candidates.some(([, cls]) => matches(entity.name, cls, true));
  return judge(cardinality, found, true, `Part of ${describe(entity.name)}`, chain[0]?.[1] ?? 'nothing', '');
}

const needsAttributes = (f: FacetLike) => f.facetType === 'Attribute' || (f.facetType === 'Entity' && !!f.predefinedType);

export async function evaluateSpec(spec: OBC.IDSSpecification, ctx: ModelContext): Promise<Evaluation> {
  const applicability = [...spec.applicability] as unknown as FacetLike[];
  const requirements = [...spec.requirements] as unknown as FacetLike[];
  for (const f of applicability) if (f.facetType === 'Classification' || f.facetType === 'Material') throw new Error(`${f.facetType} in applicability is not supported yet.`);

  // Applicability: every facet must hold. Cheap facets first, attributes
  // (read from the model) only for what is left.
  let pool = ctx.candidates;
  const cheap = applicability.filter((f) => !needsAttributes(f));
  const costly = applicability.filter(needsAttributes);
  pool = pool.filter((c) =>
    cheap.every((f) => {
      if (f.facetType === 'Entity') return entityVerdict(f, c, undefined).pass;
      if (f.facetType === 'Property') return propertyVerdict(f, c, 'required').pass;
      if (f.facetType === 'PartOf') return partOfVerdict(f, ctx.ancestors.get(c.localId) ?? [], 'required').pass;
      return true;
    }),
  );
  const wantAttrs = costly.length > 0 || requirements.some(needsAttributes);
  const attrs = wantAttrs && pool.length ? await ctx.attributes(pool.map((c) => c.localId)) : new Map<number, Record<string, Value>>();
  if (costly.length) {
    pool = pool.filter((c) => {
      const a = attrs.get(c.localId) ?? {};
      return costly.every((f) => (f.facetType === 'Entity' ? entityVerdict(f, c, a) : attributeVerdict(f, a, 'required')).pass);
    });
  }

  // Requirements.
  const reasons = new Map<number, string[]>();
  const fail = (id: number, why: string) => (reasons.get(id) ?? reasons.set(id, []).get(id)!).push(why);
  for (const f of requirements) {
    const cardinality = f.cardinality ?? 'required';
    if (f.facetType === 'Classification' || f.facetType === 'Material') {
      const result = new FRAGS.DataMap() as unknown as OBC.IDSCheckResult;
      await (f as unknown as OBC.IDSFacet).test({ [ctx.modelId]: new Set(pool.map((c) => c.localId)) }, result, { skipIfFails: false });
      for (const [, items] of result) for (const [id, item] of items) if (!item.pass) fail(id, `${f.facetType} requirement not met`);
      continue;
    }
    for (const c of pool) {
      const a = attrs.get(c.localId) ?? {};
      const v =
        f.facetType === 'Entity'
          ? cardinality === 'prohibited'
            ? entityVerdict(f, c, a).pass
              ? no(`Entity must not be ${describe(f.name as Param)}`)
              : ok
            : entityVerdict(f, c, a)
          : f.facetType === 'Attribute'
            ? attributeVerdict(f, a, cardinality)
            : f.facetType === 'Property'
              ? propertyVerdict(f, c, cardinality)
              : f.facetType === 'PartOf'
                ? partOfVerdict(f, ctx.ancestors.get(c.localId) ?? [], cardinality)
                : ok;
      if (!v.pass) fail(c.localId, v.why);
    }
  }
  const byId = new Map(pool.map((c) => [c.localId, c]));
  return {
    applicable: pool.length,
    failures: [...reasons].map(([localId, why]) => ({ localId, guid: byId.get(localId)?.guid ?? '', reasons: why })),
  };
}

/** The spatial tree's items with their IFC class. Fragments groups items
    under category nodes (no local id) — IFCBUILDINGSTOREY › storey item —
    so an item's class is that of the category node above it. */
export function spatialItems(tree: ModelTreeNode | undefined, visit: (localId: number, cls: string, chain: [number, string][]) => void) {
  const walk = (node: ModelTreeNode, cls: string, chain: [number, string][]) => {
    if (node.localId === null) {
      for (const c of node.children) walk(c, node.category.toUpperCase(), chain);
      return;
    }
    visit(node.localId, cls, chain);
    const next: [number, string][] = [[node.localId, cls], ...chain];
    for (const c of node.children) walk(c, cls, next);
  };
  if (tree) walk(tree, tree.category.toUpperCase(), []);
}

/** Each item's ancestors in the spatial tree, nearest first, as [localId, IFC class]. */
export function ancestorsOf(tree: ModelTreeNode | undefined): Map<number, [number, string][]> {
  const out = new Map<number, [number, string][]>();
  spatialItems(tree, (id, _cls, chain) => out.set(id, chain));
  return out;
}
