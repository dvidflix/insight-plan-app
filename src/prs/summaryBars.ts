import type { SearchSet } from '../viewer/searchSets';
import { setsOfTarget } from './extraAttach';
import type { LevelTask, RuleGroup, ScenarioRules } from './rules';

/** A summary bar (a level task) can be for a search set, or for a folder of them (every set inside, at any depth): one bar for each building and level,
    from the first object of the set, or of any set of the folder, to the last. The scenario keeps the target as typed in the bar's `group`. For the
    generator each such bar is given a rule group of its own that includes the sets (a rule group can be made of other groups) and is made per building
    and level, and the bar points at it. Nothing is written on the sets. */

const norm = (s: string) => s.trim().toUpperCase();
export const BARS_SUFFIX = ' (per level)';

/** The names of the sets that summary bars are for (they must be rule groups for the generator to find them). */
export const barSetNames = (tasks: readonly LevelTask[], sets: readonly SearchSet[]): string[] =>
  [...new Set(tasks.filter((t) => t.enabled !== false && t.group.trim()).flatMap((t) => setsOfTarget(t.group, sets).map((s) => s.name)))];

/** The rules as the generator should read their summary bars: each bar for a set or a folder points at a group made per building and level. The same
    rules when no bar is for a set or a folder. A bar for a rule group of the scenario that is made per something already is left alone. */
export function withBarGroups(rules: ScenarioRules, sets: readonly SearchSet[]): ScenarioRules {
  const made: RuleGroup[] = [];
  const tasks = rules.levelTasks.map((t) => {
    if (!t.group.trim()) return t;
    const own = rules.groups.find((g) => norm(g.id) === norm(t.group));
    if (own && own.forEach.length > 0) return t;
    const names = setsOfTarget(t.group, sets).map((s) => s.name);
    if (!names.length) return t;
    const id = `${t.group.trim()}${BARS_SUFFIX}`;
    if (!made.some((g) => g.id === id)) made.push({ id, name: id, forEach: ['building', 'level'], filters: [], include: names });
    return { ...t, group: id };
  });
  return made.length ? { ...rules, levelTasks: tasks, groups: [...rules.groups.filter((g) => !made.some((m) => m.id === g.id)), ...made] } : rules;
}
