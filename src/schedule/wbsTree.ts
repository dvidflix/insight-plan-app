/** A real parent-child WBS hierarchy built from "/"-joined path strings —
    used so "Group Levels" can genuinely collapse the tree at a given depth
    instead of merging deeper bands into one flat bucket (which is what
    truncating the path into a single group key did). */
export interface WbsTreeNode<T> {
  /** Full "/"-joined path to this node — its unique key. */
  path: string;
  /** This node's own segment (last part of the path). */
  label: string;
  /** 0-based nesting depth. */
  depth: number;
  /** Rows whose WBS path is exactly this node (not a descendant). */
  rows: T[];
  children: WbsTreeNode<T>[];
  /** Rows at this node plus every descendant — what a group header's count should show. */
  descendantCount: number;
}

const byNumericText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** `codePathOf` (segment-for-segment parallel to `pathOf`) orders siblings by
    WBS code, so "Level 2" comes before "Level 10" the way the schedule's own
    WBS does; without it (or with no code) siblings fall back to their names,
    compared numerically. */
export function buildWbsTree<T>(rows: T[], pathOf: (r: T) => string, codePathOf?: (r: T) => string | undefined): WbsTreeNode<T>[] {
  interface Mut {
    path: string;
    label: string;
    code: string;
    depth: number;
    rows: T[];
    children: Map<string, Mut>;
  }
  const root = new Map<string, Mut>();

  for (const r of rows) {
    const full = pathOf(r) || '(no WBS)';
    const segments = full.split(' / ').filter(Boolean);
    if (segments.length === 0) segments.push('(no WBS)');
    const rawCodes = codePathOf?.(r)?.split(' / ');
    const codes = rawCodes && rawCodes.length === segments.length ? rawCodes : [];
    let map = root;
    let prefix = '';
    let node: Mut | undefined;
    for (let d = 0; d < segments.length; d++) {
      const label = segments[d];
      const path = prefix ? `${prefix} / ${label}` : label;
      node = map.get(path);
      if (!node) {
        node = { path, label, code: (codes[d] ?? '').trim(), depth: d, rows: [], children: new Map() };
        map.set(path, node);
      }
      prefix = path;
      map = node.children;
    }
    node!.rows.push(r);
  }

  function finalize(map: Map<string, Mut>): WbsTreeNode<T>[] {
    return [...map.values()]
      .sort((a, b) => (a.code && b.code ? byNumericText(a.code, b.code) : 0) || byNumericText(a.label, b.label))
      .map((n): WbsTreeNode<T> => {
        const children = finalize(n.children);
        const descendantCount = n.rows.length + children.reduce((s, c) => s + c.descendantCount, 0);
        return { path: n.path, label: n.label, depth: n.depth, rows: n.rows, children, descendantCount };
      });
  }
  return finalize(root);
}

/** Every node path at or beyond `minDepth` — used to seed the collapsed set
    when a "Group Level N" is picked (collapse depth N and deeper). */
export function wbsPathsAtOrBeyondDepth<T>(nodes: WbsTreeNode<T>[], minDepth: number, out: string[] = []): string[] {
  for (const n of nodes) {
    if (n.depth >= minDepth) out.push(n.path);
    wbsPathsAtOrBeyondDepth(n.children, minDepth, out);
  }
  return out;
}

export function allWbsPaths<T>(nodes: WbsTreeNode<T>[], out: string[] = []): string[] {
  for (const n of nodes) {
    out.push(n.path);
    allWbsPaths(n.children, out);
  }
  return out;
}

/** A group-rule tree (see buildRuleTree) comes back sorted A→Z at every
    level; a rule set to "down" reverses its own level. */
export function orderGroupLevels<T extends { children: T[] }>(nodes: T[], rules: { direction: 'up' | 'down' }[], depth = 0): T[] {
  const ordered = rules[depth]?.direction === 'down' ? [...nodes].reverse() : nodes;
  return ordered.map((n) => ({ ...n, children: orderGroupLevels(n.children, rules, depth + 1) }));
}

/** Nested groups from group rules: one level per rule, by `valueOf` the
    rule's field, in the rules' order and directions. */
export function buildRuleTree<T>(rows: T[], rules: { field: string; direction: 'up' | 'down' }[], valueOf: (row: T, field: string) => string): WbsTreeNode<T>[] {
  // A value containing the path separator must not split into extra levels.
  const clean = (v: string) => (v.trim() || '(none)').replace(/ \/ /g, ' ∕ ');
  return orderGroupLevels(buildWbsTree(rows, (r) => rules.map((g) => clean(valueOf(r, g.field))).join(' / ')), rules);
}
