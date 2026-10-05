import { useEffect, useRef } from 'react';
import { sanitizeNote } from '../utils/richText';

const COLOURS = [
  { value: '', label: 'Text colour' },
  { value: '#d6336c', label: 'Red' },
  { value: '#e8590c', label: 'Orange' },
  { value: '#2f9e44', label: 'Green' },
  { value: '#1c7ed6', label: 'Blue' },
  { value: '#1f2328', label: 'Black' },
];

/** A small formatted-text box (bold, italic, underline, lists, colour, link) for notes. The value is sanitised
    HTML; the box is not re-rendered while typing, so the caret stays where it is. Saves as you type (briefly
    delayed) and when it loses focus. */
export function RichNoteEditor({ value, onChange, placeholder = 'Note…' }: { value: string; onChange: (html: string) => void; placeholder?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = sanitizeNote(value);
    // Set once per marker (the parent keys the editor on it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const emit = () => {
    window.clearTimeout(timer.current);
    latest.current(sanitizeNote(ref.current?.innerHTML ?? ''));
  };
  const queue = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(emit, 400);
  };
  const run = (command: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };
  const keepFocus = (e: React.MouseEvent) => e.preventDefault();

  const tool = (label: string, title: string, command: string, style?: React.CSSProperties) => (
    <button type="button" className="rne__btn" title={title} aria-label={title} style={style} onMouseDown={keepFocus} onClick={() => run(command)}>{label}</button>
  );

  return (
    <div className="rne">
      <div className="rne__bar">
        {tool('B', 'Bold', 'bold', { fontWeight: 700 })}
        {tool('I', 'Italic', 'italic', { fontStyle: 'italic' })}
        {tool('U', 'Underline', 'underline', { textDecoration: 'underline' })}
        {tool('•', 'Bulleted list', 'insertUnorderedList')}
        {tool('1.', 'Numbered list', 'insertOrderedList')}
        <select className="rne__colour" title="Text colour" value="" onChange={(e) => { if (e.target.value) run('foreColor', e.target.value); }}>
          {COLOURS.map((c) => <option key={c.value} value={c.value} style={c.value ? { color: c.value } : undefined}>{c.label}</option>)}
        </select>
        <button type="button" className="rne__btn" title="Link" aria-label="Link" onMouseDown={keepFocus} onClick={() => {
          const url = window.prompt('Link to (https://…)', 'https://');
          if (url && /^(https?:|mailto:)/i.test(url)) run('createLink', url);
        }}>🔗</button>
        {tool('Tx', 'Clear formatting', 'removeFormat')}
      </div>
      <div
        ref={ref}
        className="rne__box"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={queue}
        onBlur={emit}
      />
    </div>
  );
}
