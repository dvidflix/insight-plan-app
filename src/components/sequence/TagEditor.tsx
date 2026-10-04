import { useMemo, useRef, useState } from 'react';
import { useSequenceSchedule } from '../../state/scheduleStore';
import { useModelsStore } from '../../state/modelsStore';
import { useSequenceTimelineStore } from '../../state/sequenceTimelineStore';
import { DEFAULT_TAG_FONT_SIZE, tagCss, type Tag } from '../../state/tagsStore';
import { HexColorInput } from '../HexColorInput';
import { taskFieldOptions } from '../../schedule/linkGroups';
import { TASK_TOKENS, renderTag } from '../../schedule/tagTemplate';
import { samplePropKeys } from '../../viewer/query';

const SEPARATORS = [' – ', ': ', ' · ', ', ', ' / '];
const OBJECT_BUILTINS: { key: string; label: string }[] = [
  { key: '_name', label: 'Object name' },
  { key: '_category', label: 'Object class' },
  { key: '_guid', label: 'Object GUID' },
];

/** Edits one tag: a name and a label built by clicking in task fields, object
    properties and separators (or typing text between them), with a live
    preview against a sample task and object. */
export function TagEditor({ tag, onChange, onDelete }: { tag: Tag; onChange: (patch: Partial<Omit<Tag, 'id'>>) => void; onDelete?: () => void }) {
  const schedule = useSequenceSchedule();
  const models = useModelsStore((s) => s.models);
  const basis = useSequenceTimelineStore((s) => s.basis);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [propQuery, setPropQuery] = useState('');

  const taskFields = useMemo(
    () => (schedule ? taskFieldOptions(schedule).filter((o) => o.value !== '_code' && o.value !== '_name') : []),
    [schedule],
  );
  const objectKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const m of models) for (const k of samplePropKeys(m.elements)) if (!k.startsWith('_')) keys.add(k);
    return [...keys].sort((a, b) => a.localeCompare(b));
  }, [models]);

  const insert = (text: string) => {
    const el = inputRef.current;
    const at = el?.selectionStart ?? tag.template.length;
    const end = el?.selectionEnd ?? at;
    onChange({ template: tag.template.slice(0, at) + text + tag.template.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + text.length, at + text.length);
    });
  };

  const addObjectProp = (raw: string) => {
    const key = raw.trim();
    if (!key) return;
    insert(`{Obj:${key}}`);
    setPropQuery('');
  };

  // A sample to preview against: the first activity and the first object.
  const preview = useMemo(() => {
    const task = schedule?.activities[0];
    const elements = models[0]?.elements.slice(0, 1) ?? [];
    if (!tag.template.trim()) return '';
    return renderTag(tag.template, { activeCount: 1, task, elements, basis });
  }, [schedule, models, tag.template, basis]);

  return (
    <div className="tags__item">
      <div className="tags__row">
        <input value={tag.name} onChange={(e) => onChange({ name: e.target.value })} placeholder="Tag name" style={{ flex: 1 }} />
        {onDelete && <button type="button" className="btn btn--small" onClick={onDelete} title="Delete tag">{'✕'}</button>}
      </div>

      <textarea
        ref={inputRef}
        rows={2}
        value={tag.template}
        onChange={(e) => onChange({ template: e.target.value })}
        placeholder="Type text and insert fields below, e.g. Pour {Obj:PourID} – {Obj:Volume} m³"
        style={{ width: '100%', resize: 'vertical', fontSize: 12 }}
      />

      <div className="tags__chips">
        <span className="tags__chips-label">Task</span>
        {TASK_TOKENS.map((t) => (
          <button key={t.token} type="button" className="tags__chip" onClick={() => insert(t.token)}>{t.label}</button>
        ))}
        {taskFields.length > 0 && (
          <select
            value=""
            onChange={(e) => { if (e.target.value) insert(`{Task:${e.target.value}}`); }}
            className="tags__chip"
            title="Insert an activity code or user field"
          >
            <option value="">More task fields…</option>
            {taskFields.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        )}
      </div>

      <div className="tags__chips">
        <span className="tags__chips-label">Object</span>
        {OBJECT_BUILTINS.map((o) => (
          <button key={o.key} type="button" className="tags__chip" onClick={() => insert(`{Obj:${o.key}}`)}>{o.label}</button>
        ))}
        <input
          className="tags__prop"
          list={`tag-props-${tag.id}`}
          value={propQuery}
          placeholder={models.length ? 'Search a property…' : 'Load a model first'}
          disabled={models.length === 0}
          onChange={(e) => {
            const v = e.target.value;
            setPropQuery(v);
            if (objectKeys.includes(v)) addObjectProp(v); // picked from the list
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') addObjectProp(propQuery); }}
        />
        <datalist id={`tag-props-${tag.id}`}>
          {objectKeys.map((k) => <option key={k} value={k} />)}
        </datalist>
      </div>

      <div className="tags__chips">
        <span className="tags__chips-label">Text</span>
        {SEPARATORS.map((sep) => (
          <button key={sep} type="button" className="tags__chip" onClick={() => insert(sep)}>{`“${sep}”`}</button>
        ))}
      </div>

      <div className="tags__chips">
        <span className="tags__chips-label">Style</span>
        <label className="tags__style" title="Font size (px)">
          Size
          <input
            type="number"
            min={8}
            max={48}
            value={tag.fontSize ?? DEFAULT_TAG_FONT_SIZE}
            onChange={(e) => {
              const n = Math.round(Number(e.target.value));
              onChange({ fontSize: Number.isFinite(n) && n > 0 ? Math.max(8, Math.min(48, n)) : undefined });
            }}
          />
        </label>
        <button type="button" className={`tags__chip tags__chip--b${tag.bold ? ' active' : ''}`} aria-pressed={!!tag.bold} title="Bold" onClick={() => onChange({ bold: !tag.bold })}>B</button>
        <button type="button" className={`tags__chip tags__chip--i${tag.italic ? ' active' : ''}`} aria-pressed={!!tag.italic} title="Italic" onClick={() => onChange({ italic: !tag.italic })}>I</button>
        <label className="tags__style" title="Text colour">
          Text
          <HexColorInput value={tag.textColor ?? '#1f2328'} onChange={(hex) => onChange({ textColor: hex })} />
        </label>
        <label className="tags__style" title="Background colour">
          Fill
          <HexColorInput value={tag.background ?? '#ffffff'} onChange={(hex) => onChange({ background: hex })} />
        </label>
        <button
          type="button"
          className="tags__chip"
          title="Back to the default look"
          onClick={() => onChange({ fontSize: undefined, bold: undefined, italic: undefined, textColor: undefined, background: undefined })}
        >
          Reset
        </button>
      </div>

      {preview && (
        <div className="tags__preview" style={tagCss(tag)} title="Preview using the first task and object">
          {preview}
        </div>
      )}
    </div>
  );
}
