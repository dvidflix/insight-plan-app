import { useRef, useState, type DragEvent } from 'react';

interface FileDropProps {
  label: string;
  /** Secondary line under the label, e.g. the supported formats. */
  hint?: string;
  accept: string;
  multiple?: boolean;
  onFile: (file: File) => void;
}

export function FileDrop({ label, hint, accept, multiple, onFile }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    for (const file of e.dataTransfer.files) {
      onFile(file);
      if (!multiple) break;
    }
  };

  return (
    <div
      className={`dropzone${over ? ' dropzone--over' : ''}`}
      title={hint}
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
    >
      <svg className="dropzone__icon" viewBox="0 0 24 24" width="44" height="44" fill="currentColor" aria-hidden="true">
        <path d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" />
      </svg>
      <span className="dropzone__label">{label}</span>
      {hint && <span className="dropzone__hint">{hint}</span>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => {
          for (const file of e.target.files ?? []) onFile(file);
          e.target.value = '';
        }}
      />
    </div>
  );
}
