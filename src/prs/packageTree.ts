import type { WorkPackage } from './workPackages';

/** Generate 3's work packages as a tree: a package can hold other packages (`parent`), so a planner sees and edits a real breakdown (a building with
    its levels, say). The list is kept in tree order (a package, then the packages inside it, then its next sibling), which is also the build order:
    the packages are built top to bottom. Codes follow the tree: WP-01, WP-01.01, WP-01.02, WP-02. */

type Pkg = Pick<WorkPackage, 'id' | 'parent'>;

/** The parent each package really has: one that exists and is not inside the package itself (a loop is cut). */
function parents<P extends Pkg>(packages: readonly P[]): Map<string, string | undefined> {
  const ids = new Set(packages.map((p) => p.id));
  const raw = new Map(packages.map((p) => [p.id, p.parent && ids.has(p.parent) && p.parent !== p.id ? p.parent : undefined]));
  const out = new Map<string, string | undefined>();
  for (const p of packages) {
    let up = raw.get(p.id);
    const seen = new Set([p.id]);
    while (up && !seen.has(up)) { seen.add(up); up = raw.get(up); }
    out.set(p.id, up ? undefined : raw.get(p.id));
  }
  return out;
}

/** The packages in tree order, each parent before what it holds; siblings keep their order. Parents that are missing or would make a loop are dropped. */
export function inTreeOrder<P extends Pkg>(packages: readonly P[]): P[] {
  const up = parents(packages);
  const kids = new Map<string | undefined, P[]>();
  for (const p of packages) { const k = up.get(p.id); (kids.get(k) ?? kids.set(k, []).get(k)!).push(p); }
  const out: P[] = [];
  const walk = (id: string | undefined) => { for (const p of kids.get(id) ?? []) { out.push(up.get(p.id) === p.parent ? p : { ...p, parent: up.get(p.id) }); walk(p.id); } };
  walk(undefined);
  return out;
}

export interface TreeRow<P extends Pkg = WorkPackage> {
  pkg: P;
  /** 0 at the top. */
  depth: number;
  /** Its place in the list. */
  index: number;
  code: string;
  /** How many packages are directly inside it. */
  children: number;
}

/** Each package with its depth, code and how many it holds, in tree order. */
export function treeRows<P extends Pkg>(packages: readonly P[]): TreeRow<P>[] {
  const ordered = inTreeOrder(packages);
  const depth = new Map<string, number>();
  const code = new Map<string, string>();
  const count = new Map<string | undefined, number>();
  for (const p of ordered) count.set(p.parent, (count.get(p.parent) ?? 0) + 1);
  const seen = new Map<string | undefined, number>();
  return ordered.map((pkg, index) => {
    const d = pkg.parent ? (depth.get(pkg.parent) ?? 0) + 1 : 0;
    depth.set(pkg.id, d);
    const n = (seen.get(pkg.parent) ?? 0) + 1;
    seen.set(pkg.parent, n);
    const c = pkg.parent ? `${code.get(pkg.parent)}.${String(n).padStart(2, '0')}` : `WP-${String(n).padStart(2, '0')}`;
    code.set(pkg.id, c);
    return { pkg, depth: d, index, code: c, children: count.get(pkg.id) ?? 0 };
  });
}

/** Each package's code. */
export const codesOf = (packages: readonly Pkg[]): Map<string, string> => new Map(treeRows(packages).map((r) => [r.pkg.id, r.code]));

/** The ids of a package and of everything inside it, at any depth. */
export function subtreeIds(packages: readonly Pkg[], id: string): string[] {
  const up = parents(packages);
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const p of packages) if (up.get(p.id) === out[i]) out.push(p.id);
  return out;
}

/** The ids of the packages a package is inside, nearest first. */
export function ancestorsOf(packages: readonly Pkg[], id: string): string[] {
  const up = parents(packages);
  const out: string[] = [];
  for (let at = up.get(id); at && !out.includes(at); at = up.get(at)) out.push(at);
  return out;
}

/** A package (with everything inside it) moved: before or after another package (as its sibling), or into one (as its last package). Moving a
    package into itself or into what it holds changes nothing. */
export function movePackage<P extends Pkg>(packages: readonly P[], id: string, where: 'before' | 'after' | 'inside', targetId: string): P[] {
  const ordered = inTreeOrder(packages);
  const block = new Set(subtreeIds(ordered, id));
  if (block.has(targetId)) return ordered;
  const moving = ordered.filter((p) => block.has(p.id));
  const rest = ordered.filter((p) => !block.has(p.id));
  const target = rest.find((p) => p.id === targetId);
  if (!target || !moving.length) return ordered;
  const parent = where === 'inside' ? target.id : target.parent;
  const head = { ...moving[0], parent } as P;
  if (!parent) delete (head as Pkg).parent;
  const block2 = [head, ...moving.slice(1)];
  let at = rest.indexOf(target);
  if (where !== 'before') { const inside = new Set(subtreeIds(rest, target.id)); while (at + 1 < rest.length && inside.has(rest[at + 1].id)) at++; at++; }
  return inTreeOrder([...rest.slice(0, at), ...block2, ...rest.slice(at)]);
}

/** A package put inside the package just above it at its level (its previous sibling), as that one's last package. */
export function indentPackage<P extends Pkg>(packages: readonly P[], id: string): P[] {
  const ordered = inTreeOrder(packages);
  const me = ordered.find((p) => p.id === id);
  if (!me) return ordered;
  const siblings = ordered.filter((p) => p.parent === me.parent);
  const prev = siblings[siblings.indexOf(me) - 1];
  return prev ? movePackage(ordered, id, 'inside', prev.id) : ordered;
}

/** A package taken out of the package it is in: it comes right after that one, at its level. */
export function outdentPackage<P extends Pkg>(packages: readonly P[], id: string): P[] {
  const ordered = inTreeOrder(packages);
  const me = ordered.find((p) => p.id === id);
  return me?.parent ? movePackage(ordered, id, 'after', me.parent) : ordered;
}

/** A package taken away; the packages inside it move up into its place. */
export function removePackage<P extends Pkg>(packages: readonly P[], id: string): P[] {
  const ordered = inTreeOrder(packages);
  const me = ordered.find((p) => p.id === id);
  if (!me) return ordered;
  return ordered.filter((p) => p.id !== id).map((p) => {
    if (p.parent !== id) return p;
    const q = { ...p, parent: me.parent } as P;
    if (!me.parent) delete (q as Pkg).parent;
    return q;
  });
}
