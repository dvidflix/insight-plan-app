import { useMemo } from 'react';
import { useSearchSetsStore } from '../../../state/searchSetsStore';
import { recipeFolderChoices } from '../../../prs/recipeInheritance';
import { setsOfTarget } from '../../../prs/extraAttach';
import { closestName } from '../../../utils/closestName';

/** A choice of a search set or a folder of them (Models › Search sets), for anything that attaches to the tree: an extra activity, a summary bar. The folders
    come first (a folder stands for every set inside it), then the sets, each under its folder. A value is found the way the generator finds it (any case,
    a folder by its path; `ruleGroups`: also a rule group of the scenario, which a summary bar may be for). A value that is none of these is kept, and the
    cell says it was renamed or deleted and offers the nearest name, so nothing is lost and nothing is changed without a click. */
const norm = (s: string) => s.trim().toUpperCase();

export function TreeTargetPicker({ value, onChange, none = 'Choose a set or folder…', width, ruleGroups }: { value: string; onChange: (v: string) => void; none?: string; width?: number; ruleGroups?: readonly string[] }) {
  const sets = useSearchSetsStore((s) => s.sets);
  const folders = useMemo(() => recipeFolderChoices(sets), [sets]);
  const byFolder = useMemo(() => {
    const by = new Map<string, string[]>();
    for (const s of sets) if (s.kind !== 'selection') by.set(s.group ?? '', [...(by.get(s.group ?? '') ?? []), s.name]);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [sets]);
  const listed = !value || folders.includes(value) || byFolder.some(([, names]) => names.includes(value));
  const asRuleGroup = !!value && !!ruleGroups?.some((g) => norm(g) === norm(value));
  const found = listed || asRuleGroup || setsOfTarget(value, sets).length > 0 || folders.some((f) => norm(f) === norm(value));
  const suggestion = useMemo(() => (found ? null : closestName(value, [...folders, ...byFolder.flatMap(([, names]) => names)])), [found, value, folders, byFolder]);
  return (
    <>
      <select className={`rel-cell${found ? '' : ' is-bad'}`} value={value} style={width ? { width } : undefined} aria-label="Search set or folder" title={found ? 'A search set, or a folder of them (every set inside it)' : `No search set or folder is called “${value}” now: it was renamed or deleted`} onChange={(e) => onChange(e.target.value)}>
        <option value="">{none}</option>
        {!listed && <option value={value}>{asRuleGroup ? `${value} (a rule group of this scenario)` : found ? value : `${value} (not found)`}</option>}
        {folders.length > 0 && <optgroup label="Folders · every set inside">{folders.map((f) => <option key={`f|${f}`} value={f}>{f}</option>)}</optgroup>}
        {byFolder.filter(([, names]) => names.length > 0).map(([folder, names]) => <optgroup key={folder || '(none)'} label={`Search sets · ${folder || 'no folder'}`}>{names.map((n) => <option key={`${folder}|${n}`} value={n}>{n}</option>)}</optgroup>)}
      </select>
      {!found && (
        <div className="tree-pick__missing" role="status">
          This set or folder was renamed or deleted.{' '}
          {suggestion && <><button type="button" className="link-btn" onClick={() => onChange(suggestion)} title={`Point it at “${suggestion}” instead`}>Use “{suggestion}”</button>{' '}or pick</>}
          {!suggestion && 'Pick'} another in the list.
        </div>
      )}
    </>
  );
}
