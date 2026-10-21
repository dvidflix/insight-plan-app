import { normalizeRules, type ScenarioRules } from './rules';

/** Every rule names the groups it is for by name (the `group` of a step, a limit, a level task or an assignment, and the `group` term of a `when`); several
    are written with "|" (`Internal Wall|External Wall`). Replacing a group by another (or by several) is a change of that text wherever it is. The groups
    themselves (`groups`) are left as they are: they are what the name stands for. */
const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

function swap(value: string, from: string, to: string): string | null {
  const parts = value.split('|');
  if (!parts.some((p) => same(p, from))) return null;
  const out: string[] = [];
  for (const part of parts) for (const p of same(part, from) ? to.split('|') : [part]) if (!out.some((o) => same(o, p))) out.push(p.trim());
  return out.join('|');
}

/** The rules with the group `from` replaced by `to` everywhere they name it, and how many places that was. */
export function replaceGroupName(rules: ScenarioRules, from: string, to: string): { rules: ScenarioRules; count: number } {
  let count = 0;
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === 'group' && typeof value === 'string') {
        const next = swap(value, from, to);
        if (next !== null) count++;
        out[key] = next ?? value;
      } else out[key] = walk(value);
    }
    return out;
  };
  const { groups, ...rest } = rules;
  const next = walk(rest) as Omit<ScenarioRules, 'groups'>;
  return { rules: count ? normalizeRules({ ...next, groups }) : rules, count };
}

/** The group names the rules use, once each, as written (the names inside "A|B" apart). */
export function groupNamesUsed(rules: ScenarioRules): string[] {
  const found = new Map<string, string>();
  const walk = (node: unknown) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'group' && typeof value === 'string') for (const p of value.split('|')) { if (p.trim()) found.set(p.trim().toUpperCase(), p.trim()); }
        else walk(value);
      }
    }
  };
  const { groups: _groups, ...rest } = rules;
  walk(rest);
  return [...found.values()].sort((a, b) => a.localeCompare(b));
}

/** The ids of the groups of the rules that nothing uses: no rule, recipe or step names them, no other group includes them, they have no role (exclude,
    stair step) and they are not one of `keep` (the names of the search sets, which the groups are made from). */
export function unusedGroupIds(rules: ScenarioRules, keep: Iterable<string> = []): string[] {
  const used = new Set(groupNamesUsed(rules).map((n) => n.toUpperCase()));
  const kept = new Set([...keep].map((n) => n.trim().toUpperCase()));
  const included = new Set(rules.groups.flatMap((g) => (g.include ?? []).map((i) => String(i).toUpperCase())));
  return rules.groups
    .filter((g) => !g.treatAs && !used.has(g.id.toUpperCase()) && !kept.has(g.id.toUpperCase()) && !included.has(g.id.toUpperCase()))
    .map((g) => g.id);
}

/** With recipes on, the generator reads the recipes and leaves the older chain and assignment rows out (see forGenerator): they and the groups only they
    used are what an old preset left behind. This is the rules without them: no chains, no assignments, and no group that nothing names any more
    (the sets named in `keep` stay). `rows` and `groups` say what goes. The same rules when there are no recipes on. */
export function retireSuperseded(rules: ScenarioRules, keep: Iterable<string> = []): { rules: ScenarioRules; rows: number; groups: string[] } {
  if (!rules.recipes.some((r) => r.enabled !== false)) return { rules, rows: 0, groups: unusedGroupIds(rules, keep) };
  const rows = rules.chains.length + rules.assignments.length;
  const bare = { ...rules, chains: [], assignments: [] };
  const groups = unusedGroupIds(bare, keep);
  const drop = new Set(groups);
  return { rules: { ...bare, groups: bare.groups.filter((g) => !drop.has(g.id)) }, rows, groups };
}
