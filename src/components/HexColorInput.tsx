import { useEffect, useState } from 'react';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

interface HexColorInputProps {
  value: string;
  onChange: (hex: string) => void;
  disabled?: boolean;
  swatchWidth?: number;
}

/** A `<input type="color">` swatch paired with a plain text hex field, kept
    in sync both ways — the swatch alone can't be copy-pasted between fields
    (most browsers show it as a color well, not selectable text), so this is
    the "type or paste a hex code" affordance next to every color picker. */
export function HexColorInput({ value, onChange, disabled = false, swatchWidth = 32 }: HexColorInputProps) {
  const [text, setText] = useState(value);

  useEffect(() => setText(value), [value]);

  const commit = (v: string) => {
    const normalized = v.trim();
    const withHash = normalized.startsWith('#') ? normalized : `#${normalized}`;
    if (HEX_RE.test(withHash)) onChange(withHash.toLowerCase());
    else setText(value);
  };

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <input type="color" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} style={{ width: swatchWidth }} />
      <input
        type="text"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value);
        }}
        placeholder="#rrggbb"
        spellCheck={false}
        style={{ width: 74, fontFamily: 'monospace', fontSize: 12 }}
      />
    </div>
  );
}
