import type { SearchSet } from '../viewer/searchSets';
import type { ScenarioRules, SequenceStep } from './rules';
import { walkFolder } from '../viewer/setTree';

/** A sequence may take its steps from a folder of search sets (Models > Search sets): each set is a step, in the order of the folder (by number when
    the names start with one: "1 Rafts", "2 Walls L1" ...). The set's name is the group of the step, so a set is a group like any other. */
/** The sets of a folder as steps, in order (selection sets hold fixed objects and cannot be tested as a group, so they are not steps). */
export function folderStepSets(sets: SearchSet[], folder: string): SearchSet[] {
  // The tree is walked: the folder's own sets first, then each folder inside it (a folder path is written "Top / Next"), in tree order.
  return walkFolder(sets, folder, (s) => s.kind !== 'selection');
}

/** The names of the sets that sequences take as steps (each is a group). */
export function stepSetNames(rules: ScenarioRules, sets: SearchSet[]): string[] {
  return rules.sequences.filter((q) => q.stepsFolder && q.enabled !== false).flatMap((q) => folderStepSets(sets, q.stepsFolder!).map((s) => s.name));
}

/** The rules with the steps of every sequence that has a folder made from its sets (a step keeps its own options, per level and link, by its group).
    The same rules when nothing changes. */
export function withFolderSteps(rules: ScenarioRules, sets: SearchSet[]): ScenarioRules {
  let changed = false;
  const sequences = rules.sequences.map((q) => {
    if (!q.stepsFolder) return q;
    const old = new Map(q.steps.map((s) => [s.group.trim().toUpperCase(), s]));
    const steps: SequenceStep[] = folderStepSets(sets, q.stepsFolder).map((s) => ({ ...(old.get(s.name.trim().toUpperCase()) ?? {}), group: s.name }));
    if (JSON.stringify(steps) === JSON.stringify(q.steps)) return q;
    changed = true;
    return { ...q, steps };
  });
  return changed ? { ...rules, sequences } : rules;
}
