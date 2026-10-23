import { matchColorRules, type ColorRule } from '../components/schedule/ColorPanel';
import { className, type PackageObject, type ResolvedMethod, type WorkPackage } from './workPackages';
import { searchTokens } from '../schedule/search';

/** Generate 3's package list as a list like the others: the fields a package can be filtered, searched and coloured by (the main header's search
    box and the List setup panel, N), and what each package's values are. A package that does not match but holds one that does stays in the list
    as context, so the tree still reads. */

export const PACKAGE_FIELDS: { id: string; label: string }[] = [
  { id: 'code', label: 'Code' },
  { id: 'name', label: 'Name' },
  { id: 'inside', label: 'Inside (package)' },
  { id: 'method', label: 'Method' },
  { id: 'crew', label: 'Crew' },
  { id: 'storey', label: 'Storey' },
  { id: 'type', label: 'Type' },
  { id: 'set', label: 'Search set' },
  { id: 'holds', label: 'Holds' },
  { id: 'order', label: 'Object order' },
];

export interface PackageFacts {
  id: string;
  parent?: string;
  values: Record<string, string[]>;
}

/** Each package's values of the fields. `objects` are what it holds with the packages inside it; `method` is null for a package with no objects of its own. */
export function packageFacts(p: WorkPackage, code: string, parentName: string, children: number, objects: readonly PackageObject[], own: number, method: ResolvedMethod | undefined): PackageFacts {
  const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))];
  return {
    id: p.id,
    ...(p.parent ? { parent: p.parent } : {}),
    values: {
      code: [code],
      name: [p.name],
      inside: [parentName],
      method: own && method ? [method.name] : [],
      crew: own && method?.crew ? [method.crew] : [],
      storey: uniq(objects.map((o) => o.storey)),
      type: uniq(objects.map((o) => className(o.cls))),
      set: uniq(p.parts.map((x) => x.set ?? '')),
      holds: [children ? 'other packages' : own ? 'objects' : 'nothing'],
      order: [own ? (p.objectOrder && Object.keys(p.objectOrder).length ? 'objects one by one' : 'one piece') : ''],
    },
  };
}

/** Whether a package has one of the kept values of every filtered field (a field with none kept does not filter). */
export function passesFilters(f: PackageFacts, filters: Record<string, string[]>, none: string): boolean {
  return Object.entries(filters).every(([field, kept]) => {
    if (!kept.length) return true;
    const vs = f.values[field] ?? [];
    return (vs.length ? vs : [none]).some((v) => kept.includes(v));
  });
}

/** Whether a package matches the search box: one of the alternatives (split on commas, semicolons, "||" and lines) has all its words in the
    package's values. */
export function matchesQuery(f: PackageFacts, query: string): boolean {
  const alts = searchTokens(query).map((a) => a.split(/\s+/).filter(Boolean)).filter((a) => a.length);
  if (!alts.length) return true;
  const text = Object.values(f.values).flat().join(' ').toLowerCase();
  return alts.some((words) => words.every((w) => text.includes(w)));
}

/** The packages to show, or null for all: the ones that match, and the packages that hold them (as context). `matched` are the matching ones. */
export function visiblePackages(facts: readonly PackageFacts[], filters: Record<string, string[]>, query: string, none: string): { visible: Set<string>; matched: Set<string> } | null {
  const active = query.trim() !== '' || Object.values(filters).some((k) => k.length);
  if (!active) return null;
  const byId = new Map(facts.map((f) => [f.id, f]));
  const matched = new Set(facts.filter((f) => passesFilters(f, filters, none) && matchesQuery(f, query)).map((f) => f.id));
  const visible = new Set(matched);
  for (const id of matched) for (let up = byId.get(id)?.parent; up && !visible.has(up); up = byId.get(up)?.parent) visible.add(up);
  return { visible, matched };
}

/** A package's colour: the first colour rule that matches it, else its own. */
export const packageColor = (f: PackageFacts, rules: readonly ColorRule[], own: string): string => matchColorRules([...rules], (field) => (f.values[field] ?? []).join(', ')) ?? own;
