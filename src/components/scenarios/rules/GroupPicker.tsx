import { recipeFolder } from '../../../state/recipeFolderStore';

/** The group of objects a step, a level task or a limit is for, picked from a list: the search sets the user made (Models › Search sets), under the
    folder each is kept in. Nothing the app made or assumed is offered: not the folder it mirrors its own groups into, and not rule groups. A name already
    chosen that comes from there (or from nowhere) stays in the list as it is, so nothing is lost. */

const same = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

export function GroupPicker({ value, onChange, folders, none = 'Choose a group…', title, invalid }: {
  value: string;
  onChange: (v: string) => void;
  /** The search sets by folder. */
  folders: { folder: string; names: string[] }[];
  /** What the empty choice says ('every object' for a limit). */
  none?: string;
  title?: string;
  invalid?: boolean;
}) {
  const own = folders.filter((f) => f.folder !== recipeFolder() && f.names.length > 0);
  const offered = own.some((f) => f.names.some((n) => same(n, value)));
  return (
    <select value={value} aria-invalid={invalid} aria-label="Group" title={title ?? 'The objects it is for: one of your search sets (Models › Search sets)'} onChange={(e) => onChange(e.target.value)}>
      <option value="">{none}</option>
      {value.trim() && !offered && <option value={value}>{value}</option>}
      {own.map((f) => (
        <optgroup key={f.folder} label={f.folder ? `Search sets · ${f.folder}` : 'Search sets'}>{f.names.map((g) => <option key={`${f.folder}|${g}`} value={g}>{g}</option>)}</optgroup>
      ))}
    </select>
  );
}
