import { IconFlag, IconFlagFinish } from '../icons';
import type { FlagState } from '../../state/scenarioStore';

/** Review flag: click cycles none → flagged (to fix) → done (fixed) → none.
    An unflagged one only shows faintly, until the row is hovered. */
export function FlagToggle({ state, onChange, what }: { state: FlagState | undefined; onChange: (next: FlagState | null) => void; what: string }) {
  const next: FlagState | null = state === undefined ? 'flag' : state === 'flag' ? 'done' : null;
  const title = state === 'flag' ? `Flagged to fix: ${what} (click to mark as done)` : state === 'done' ? `Fixed: ${what} (click to clear the flag)` : `Flag ${what} to fix`;
  return (
    <button
      type="button"
      className={`scn-flag${state ? ` is-${state}` : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange(next);
      }}
      title={title}
      aria-label={title}
    >
      {state === 'done' ? <IconFlagFinish width={15} height={15} /> : <IconFlag width={15} height={15} />}
    </button>
  );
}
