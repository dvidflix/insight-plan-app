import { IconRemove } from './icons';
export interface FileChip {
  id: string;
  label: string;
  sublabel?: string;
  active?: boolean;
}

interface FileChipBarProps {
  chips: FileChip[];
  accept: string;
  addLabel: string;
  multiple?: boolean;
  onAdd: (file: File) => void;
  onRemove: (id: string) => void;
  onSelect?: (id: string) => void;
}

/** A slim "loaded files" bar: a chip per loaded model/schedule with a close
    button, plus an always-available "+" to add another — so files can be
    added or removed at any time instead of only from an empty-state dropzone. */
export function FileChipBar({ chips, onRemove, onSelect }: FileChipBarProps) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', padding: 8, borderBottom: '1px solid var(--border)' }}>
      {chips.map((chip) => (
        <div
          key={chip.id}
          title={chip.sublabel ?? chip.label}
          role={onSelect ? 'button' : undefined}
          tabIndex={onSelect ? 0 : undefined}
          aria-label={chip.label}
          aria-pressed={onSelect ? chip.active : undefined}
          onClick={() => onSelect?.(chip.id)}
          onKeyDown={(e) => {
            if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              onSelect(chip.id);
            }
          }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 8px',
            borderRadius: 999, fontSize: 12, cursor: onSelect ? 'pointer' : 'default',
            background: chip.active ? 'var(--accent-dim)' : 'var(--bg-elevated)',
            border: '1px solid var(--border)',
          }}
        >
          <button
            className="btn"
            aria-label={`Remove ${chip.label}`}
            style={{ padding: '0 5px', borderRadius: 999, lineHeight: '16px' }}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(chip.id);
            }}
          >
            <IconRemove />
          </button>
        </div>
      ))}
    </div>
  );
}
