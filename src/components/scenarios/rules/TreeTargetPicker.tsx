import { useMemo } from 'react';
import { useSearchSetsStore } from '../../../state/searchSetsStore';
import { recipeFolderChoices } from '../../../prs/recipeInheritance';

/** A choice of a search set or a folder of them (Models › Search sets), for anything that attaches to the tree: an extra activity, a summary bar. The folders
    come first (a folder stands for every set inside it), then the sets, each under its folder. A value that is neither is kept and marked, so nothing is lost. */
export function TreeTargetPicker({ value, onChange, none = 'Choose a set or folder…', width }: { value: string; onChange: (v: string) => void; none?: string; width?: number }) {
  const sets = useSearchSetsStore((s) => s.sets);
  const folders = useMemo(() => recipeFolderChoices(sets), [sets]);
  const byFolder = useMemo(() => {
    const by = new Map<string, string[]>();
    for (const s of sets) if (s.kind !== 'selection') by.set(s.group ?? '', [...(by.get(s.group ?? '') ?? []), s.name]);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  }, [sets]);
  const known = !value || folders.includes(value) || byFolder.some(([, names]) => names.includes(value));
  return (
    <select className="rel-cell" value={value} style={width ? { width } : undefined} aria-label="Search set or folder" title="A search set, or a folder of them (every set inside it)" onChange={(e) => onChange(e.target.value)}>
      <option value="">{none}</option>
      {!known && <option value={value}>{value} (not found)</option>}
      {folders.length > 0 && <optgroup label="Folders · every set inside">{folders.map((f) => <option key={`f|${f}`} value={f}>{f}</option>)}</optgroup>}
      {byFolder.filter(([, names]) => names.length > 0).map(([folder, names]) => <optgroup key={folder || '(none)'} label={`Search sets · ${folder || 'no folder'}`}>{names.map((n) => <option key={`${folder}|${n}`} value={n}>{n}</option>)}</optgroup>)}
    </select>
  );
}
