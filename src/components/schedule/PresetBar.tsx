import { useEffect, useState } from 'react';
import { InfoTip } from '../InfoTip';

export interface PresetItem {
  id: string;
  label: string;
  /** Saved by the user: the only ones Delete takes away. */
  user?: boolean;
}

interface PresetBarProps {
  items: PresetItem[];
  onApply: (id: string) => void;
  /** Keeps what is set now under a name. */
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
  /** Nothing to keep yet (no columns, no filters ...). */
  saveDisabled?: boolean;
  /** What the thing is called in the messages: "filter", "sort" ... */
  noun?: string;
}

/** The Presets menu of a setup panel: the built-in ones, then yours, in one dropdown, with Save as (keeps what is set now under a name) and Delete (yours only). */
export function PresetBar({ items, onApply, onSave, onDelete, saveDisabled, noun = 'preset' }: PresetBarProps) {
  const [selected, setSelected] = useState('');
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const chosen = items.find((i) => i.id === selected);
  const builtIn = items.filter((i) => !i.user);
  const mine = items.filter((i) => i.user);

  useEffect(() => {
    if (!justSaved) return;
    const made = items.find((i) => i.user && i.label.toLowerCase() === justSaved.toLowerCase());
    if (made) setSelected(made.id);
    setJustSaved(null);
  }, [items, justSaved]);

  const saveAs = () => {
    const name = window.prompt(`Name for this ${noun}:`, chosen?.user ? chosen.label : '')?.trim();
    if (!name) return;
    if (mine.some((i) => i.label.toLowerCase() === name.toLowerCase()) && !window.confirm(`Replace your ${noun} “${name}”?`)) return;
    onSave(name);
    setJustSaved(name);
  };

  return (
    <div className="dtp__sets">
      <select
        value={chosen ? selected : ''}
        aria-label="Presets"
        title={`Load a saved ${noun}`}
        onChange={(e) => {
          setSelected(e.target.value);
          if (e.target.value) onApply(e.target.value);
        }}
      >
        <option value="" disabled>Preset…</option>
        {builtIn.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        {mine.length > 0 && <optgroup label="Saved by you">{mine.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</optgroup>}
      </select>
      <button type="button" className="btn btn--small" onClick={saveAs} disabled={saveDisabled} title={`Keep what is set now as a ${noun} of your own`}>Save as…</button>
      <button
        type="button"
        className="btn btn--small"
        disabled={!chosen?.user}
        onClick={() => {
          if (chosen?.user && window.confirm(`Delete your ${noun} “${chosen.label}”?`)) {
            onDelete(chosen.id);
            setSelected('');
          }
        }}
        title={chosen?.user ? `Delete “${chosen.label}”` : `Only a ${noun} you saved can be deleted`}
      >Delete</button>
      <InfoTip>Choosing a {noun} replaces what is set now. Save as keeps the current setup under a name; Delete removes only {noun}s you saved.</InfoTip>
    </div>
  );
}
