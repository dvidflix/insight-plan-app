import { freshId, isEmptyRules, NO_RULES, type ObjectJoin, type ScenarioRules } from './rules';

/** Joins the picked objects (GlobalIds, in the order they were picked) into one: the first picked is the main object and the others become
    its members, so the generator gives them the main's activities only. Objects that were already joined go with the one they were joined
    to: picking a main object brings its members along, and an object leaves the join it was in. */
export function joinObjects(rules: ScenarioRules, picked: string[]): ScenarioRules {
  const guids = [...new Set(picked)];
  if (guids.length < 2) return rules;
  const [main, ...others] = guids;
  const pickedSet = new Set(guids);
  const members = new Set(others);
  const kept: ObjectJoin[] = [];
  for (const j of rules.joins ?? []) {
    if (pickedSet.has(j.main)) {
      for (const m of j.members) if (m !== main) members.add(m); // a main object that was picked takes its members with it
      continue;
    }
    const rest = j.members.filter((m) => !pickedSet.has(m));
    if (rest.length) kept.push(rest.length === j.members.length ? j : { ...j, members: rest });
  }
  const id = freshId('JOIN', kept.map((j) => j.id));
  return { ...rules, joins: [...kept, { id, main, members: [...members] }] };
}

/** Takes the picked objects out of their joins: a picked main object dissolves its join, a picked member leaves it. */
export function unjoinObjects(rules: ScenarioRules, picked: string[]): ScenarioRules {
  const pickedSet = new Set(picked);
  const before = rules.joins ?? [];
  const joins: ObjectJoin[] = [];
  for (const j of before) {
    if (pickedSet.has(j.main)) continue;
    const rest = j.members.filter((m) => !pickedSet.has(m));
    if (rest.length) joins.push(rest.length === j.members.length ? j : { ...j, members: rest });
  }
  return joins.length === before.length && joins.every((j, i) => j === before[i]) ? rules : { ...rules, joins };
}

/** The main object each joined object is taken as (a member -> its main). */
export function joinMap(joins: ObjectJoin[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const j of joins ?? []) if (j.enabled !== false) for (const m of j.members) if (!out.has(m)) out.set(m, j.main);
  return out;
}

/** These rules with the scenario's own joins (an empty list for none): what a preset is loaded, added or saved without. A scenario is two parts:
    its order (the sequence, and the objects joined into one) and its rules; a preset is rules only, so it neither brings joins nor takes them away. */
export function withJoins(rules: ScenarioRules, joins: ObjectJoin[] | undefined): ScenarioRules {
  const next = { ...rules, joins: joins ?? [] };
  return isEmptyRules(next) ? NO_RULES : next;
}
