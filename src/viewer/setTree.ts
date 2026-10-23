import type { SearchSet } from './searchSets';

/** The folders of Models › Search sets as a tree. A set's folder is a path written "Top / Next / Last" (the spool tool makes them so); the path is the
    work breakdown and the order of the tree is the order things are built. Nothing here knows what the sets are called. */

export const FOLDER_SEP = ' / ';

const norm = (s: string) => s.trim().toUpperCase();
const numbered = (name: string) => /^\s*\d+/.test(name);
const lead = (name: string) => Number(/^\s*(\d+)/.exec(name)?.[1] ?? 0);
const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** The parts of a folder path ('' for no folder). */
export const folderParts = (path: string): string[] => path.split('/').map((p) => p.trim()).filter(Boolean);
/** A folder path written one way: parts trimmed, joined with " / ". */
export const folderKey = (path: string): string => folderParts(path).join(FOLDER_SEP);

/** Whether a set's folder is `folder` itself or inside it. The empty folder (no folder) holds only the sets with none. */
export function isInFolder(group: string, folder: string): boolean {
  const g = folderParts(group);
  const f = folderParts(folder);
  return g.length >= f.length && f.every((p, i) => norm(p) === norm(g[i])) && (f.length > 0 || g.length === 0);
}

/** Every folder path of the sets, with the folders between (a set in "A / B / C" makes A, A / B and A / B / C), in tree order. */
export function folderPaths(sets: readonly Pick<SearchSet, 'group'>[]): string[] {
  const all = new Map<string, string>();
  for (const s of sets) {
    const parts = folderParts(s.group ?? '');
    for (let i = 1; i <= parts.length; i++) all.set(norm(parts.slice(0, i).join(FOLDER_SEP)), parts.slice(0, i).join(FOLDER_SEP));
  }
  return [...all.values()].sort(comparePaths);
}

/** Paths in tree order: part by part, by the number a part starts with when both do, else by text with numbers in their order. */
export function comparePaths(a: string, b: string): number {
  const pa = folderParts(a);
  const pb = folderParts(b);
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    const d = numbered(pa[i]) && numbered(pb[i]) ? lead(pa[i]) - lead(pb[i]) || natural(pa[i], pb[i]) : natural(pa[i], pb[i]);
    if (d !== 0) return d;
  }
  return pa.length - pb.length;
}

/** The folder and every folder above it, nearest first: "A / B / C" gives ["A / B / C", "A / B", "A"]. */
export function folderAndAncestors(path: string): string[] {
  const parts = folderParts(path);
  return parts.map((_, i) => parts.slice(0, parts.length - i).join(FOLDER_SEP));
}

/** The sets of one folder in their order: by the number the names start with when they all do, else as the folder lists them. */
function ownSets<S extends Pick<SearchSet, 'name' | 'group'>>(sets: readonly S[], folder: string): S[] {
  const own = sets.filter((s) => norm(folderKey(s.group ?? '')) === norm(folderKey(folder)));
  return own.every((s) => numbered(s.name)) ? [...own].sort((a, b) => lead(a.name) - lead(b.name) || natural(a.name, b.name)) : own;
}

/** Walks the tree from a folder: the sets of the folder first, in their order, then each folder inside it in tree order, the same way. This is the order
    the work is built in. `include` leaves sets out (a selection set holds fixed objects and is no step). */
export function walkFolder<S extends Pick<SearchSet, 'name' | 'group'>>(sets: readonly S[], folder: string, include: (s: S) => boolean = () => true): S[] {
  const root = folderKey(folder);
  const inside = sets.filter((s) => isInFolder(s.group ?? '', root) && include(s));
  const out: S[] = [];
  const visit = (path: string) => {
    out.push(...ownSets(inside, path));
    const children = folderPaths(inside.filter((s) => isInFolder(s.group ?? '', path))).filter((p) => folderParts(p).length === folderParts(path).length + 1 && isInFolder(p, path));
    for (const c of children) visit(c);
  };
  visit(root);
  return out;
}

/** The names of the folders directly inside a folder (for a tree view), in tree order. */
export const childFolders = (sets: readonly Pick<SearchSet, 'group'>[], folder: string): string[] =>
  folderPaths(sets).filter((p) => folderParts(p).length === folderParts(folder).length + 1 && (folderParts(folder).length === 0 || isInFolder(p, folder)));

/** The sets inside a folder, at any depth. */
export const setsInside = <S extends Pick<SearchSet, 'group'>>(sets: readonly S[], folder: string): S[] => sets.filter((s) => isInFolder(s.group ?? '', folder));

/** The sets inside `from` with their folder moved to `to` (the path above `from` is replaced by `to`; the parts below stay): renaming "A / B" to "A / C", or
    moving it under another folder, is the same change. Only the sets that change are returned. A folder cannot go inside itself. */
export function moveFolder<S extends Pick<SearchSet, 'group'>>(sets: readonly S[], from: string, to: string): S[] {
  const f = folderParts(from);
  const t = folderParts(to);
  if (!f.length || !t.length || isInFolder(t.join(FOLDER_SEP), from) && t.length > f.length) return [];
  return setsInside(sets, from).map((s) => ({ ...s, group: [...t, ...folderParts(s.group ?? '').slice(f.length)].join(FOLDER_SEP) })).filter((s, i) => s.group !== (setsInside(sets, from)[i].group ?? ''));
}

/** Whether every folder above a folder is open (`closed` holds the paths of shut folders): a folder under a shut one is not shown. */
export const isShown = (folder: string, closed: ReadonlySet<string>): boolean => folderAndAncestors(folder).slice(1).every((p) => !closed.has(p));

/** Search sets (not selection sets) that share a name: a recipe, a step or an attachment finds a set by its name, so they are one to the generator. */
export function duplicateSetNames<S extends Pick<SearchSet, 'name' | 'group' | 'kind'>>(sets: readonly S[]): { name: string; folders: string[] }[] {
  const by = new Map<string, { name: string; folders: string[] }>();
  for (const s of sets) {
    if (s.kind === 'selection') continue;
    const k = norm(s.name);
    const e = by.get(k) ?? by.set(k, { name: s.name, folders: [] }).get(k)!;
    e.folders.push(folderKey(s.group ?? '') || '(no folder)');
  }
  return [...by.values()].filter((e) => e.folders.length > 1);
}
