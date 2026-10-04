import { useMemo, useState } from 'react';
import { useSequenceSchedule } from '../../state/scheduleStore';
import { useSequenceTimelineStore } from '../../state/sequenceTimelineStore';
import { useSequenceLabelStore, type LabelPosition } from '../../state/sequenceLabelStore';
import { useTagsStore } from '../../state/tagsStore';
import { TagEditor } from './TagEditor';
import { IconPencil } from '../icons';
import { CollapsibleSection, useOpenSections } from '../CollapsibleSection';
import { scheduleRange } from '../../schedule/linking';
import { alignDown, nextBoundary } from '../../schedule/period';
import { renderLabelTemplate, LABEL_TOKEN_HELP, LABEL_PRESETS, DEFAULT_LABEL_TEMPLATE } from '../../schedule/labelTemplate';

const POSITIONS: { value: LabelPosition; label: string }[] = [
  { value: 'top-left', label: '↖' },
  { value: 'top-center', label: '↑' },
  { value: 'top-right', label: '↗' },
  { value: 'middle-left', label: '←' },
  { value: 'center', label: '•' },
  { value: 'middle-right', label: '→' },
  { value: 'bottom-left', label: '↙' },
  { value: 'bottom-center', label: '↓' },
  { value: 'bottom-right', label: '↘' },
];

/** 4D Sequencing > Label, as collapsible sections: the tags, then the
    on-viewport date label — its position (a 3x3 grid over
    the viewport, same idea as PowerPoint's text-anchor picker) and the
    Navisworks-style template string (see schedule/labelTemplate.ts). */
export function LabelPanel() {
  const model = useSequenceSchedule();
  const basis = useSequenceTimelineStore((s) => s.basis);
  const stepUnit = useSequenceTimelineStore((s) => s.stepUnit);
  const date = useSequenceTimelineStore((s) => s.date);
  const enabled = useSequenceLabelStore((s) => s.enabled);
  const setEnabled = useSequenceLabelStore((s) => s.setEnabled);
  const position = useSequenceLabelStore((s) => s.position);
  const setPosition = useSequenceLabelStore((s) => s.setPosition);
  const template = useSequenceLabelStore((s) => s.template);
  const setTemplate = useSequenceLabelStore((s) => s.setTemplate);

  const tags = useTagsStore((s) => s.tags);
  const addTag = useTagsStore((s) => s.add);
  const updateTag = useTagsStore((s) => s.update);
  const removeTag = useTagsStore((s) => s.remove);
  const placement = useTagsStore((s) => s.placement);
  const setPlacement = useTagsStore((s) => s.setPlacement);

  // The tag being edited (the list shows when none is).
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = tags.find((t) => t.id === editingId) ?? null;

  const sections = useOpenSections<'tags' | 'date'>('sequence.labelSections', ['tags']);

  const range = useMemo(() => scheduleRange(model, basis), [model, basis]);
  const preview = useMemo(() => {
    if (!range || date === null || !template.trim()) return '';
    try {
      return renderLabelTemplate(template, { date: new Date(date), range, period: { start: alignDown(date, stepUnit), end: nextBoundary(date, stepUnit) } });
    } catch {
      return '';
    }
  }, [template, range, date, stepUnit]);

  return (
    <div>
      <CollapsibleSection
        title="Tags"
        open={sections.isOpen('tags')}
        onToggle={() => sections.toggle('tags')}
        tip={
          <>
            <p>A tag is a label shown while a Link Group that uses it has an active task. Build it from task fields, properties of the linked objects and your own text; pick the tag in the group's editor (you can also create one there).</p>
            <p><b>Bottom corner:</b> active tags stack at the bottom-left of the viewer.</p>
            <p><b>Next to objects:</b> each active tag sits by the middle of its objects with a leader line, moved apart so tags never overlap. A per-task tag gets one callout per task.</p>
          </>
        }
      >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="segmented-choice">
        <button type="button" className={placement === 'corner' ? 'active' : ''} onClick={() => setPlacement('corner')}>Bottom corner</button>
        <button type="button" className={placement === 'objects' ? 'active' : ''} onClick={() => setPlacement('objects')}>Next to objects</button>
      </div>
      {editing ? (
        <>
          <TagEditor
            tag={editing}
            onChange={(patch) => updateTag(editing.id, patch)}
            onDelete={() => {
              if (!window.confirm(`Delete the tag "${editing.name}"?`)) return;
              removeTag(editing.id);
              setEditingId(null);
            }}
          />
          <button type="button" className="btn btn--small" onClick={() => setEditingId(null)} style={{ alignSelf: 'flex-start' }}>Done</button>
        </>
      ) : (
        <>
          <button type="button" className="btn primary" onClick={() => setEditingId(addTag())} style={{ alignSelf: 'flex-start' }}>+ New Tag</button>
          {tags.length === 0 && <div style={{ color: 'var(--text-dim)' }}>No tags yet.</div>}
          {tags.length > 0 && (
            <table className="seq-grid">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Label</th>
                  <th className="seq-grid__actions" />
                </tr>
              </thead>
              <tbody>
                {tags.map((t) => (
                  <tr key={t.id}>
                    <td className="seq-grid__name" title="Click to edit" onClick={() => setEditingId(t.id)} style={{ fontWeight: t.bold ? 700 : undefined, fontStyle: t.italic ? 'italic' : undefined }}>{t.name}</td>
                    <td style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-dim)' }} title={t.template}>{t.template}</td>
                    <td className="seq-grid__actions">
                      <button type="button" title="Edit" aria-label="Edit" onClick={() => setEditingId(t.id)}><IconPencil /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
      </div>
      </CollapsibleSection>

      <CollapsibleSection title="Date label" open={sections.isOpen('date')} onToggle={() => sections.toggle('date')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Show label on viewer</span>
        <button type="button" role="switch" aria-checked={enabled} className={`switch${enabled ? ' on' : ''}`} onClick={() => setEnabled(!enabled)}>
          <span className="switch__thumb" />
        </button>
      </div>

      <div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 4 }}>Position</div>
        <div className="label-position-grid">
          {POSITIONS.map((p) => (
            <button
              key={p.value}
              type="button"
              className={`label-position-grid__cell${position === p.value ? ' active' : ''}`}
              title={p.value}
              onClick={() => setPosition(p.value)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <label className="disp__row">
        <span>Preset</span>
        <select
          value={[...LABEL_PRESETS, { template: DEFAULT_LABEL_TEMPLATE }].find((p) => p.template === template)?.template ?? ''}
          onChange={(e) => e.target.value && setTemplate(e.target.value)}
          style={{ maxWidth: 220 }}
        >
          <option value="">Custom</option>
          <option value={DEFAULT_LABEL_TEMPLATE}>Default (week + week commencing)</option>
          {LABEL_PRESETS.map((p) => (
            <option key={p.label} value={p.template}>{p.label}</option>
          ))}
        </select>
      </label>

      <label style={{ display: 'block' }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 4 }}>Template</div>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={3}
          style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
        />
      </label>

      {preview && (
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 4 }}>Preview</div>
          <div className="label-preview">{preview}</div>
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        {LABEL_TOKEN_HELP.map((t) => (
          <div key={t.token} style={{ display: 'flex', gap: 6, marginBottom: 2 }}>
            <code>{t.token}</code>
            <span>{t.description}</span>
          </div>
        ))}
        <div style={{ marginTop: 4 }}>Wrap literal text in "double quotes"; any date pattern (yyyy/mmm/dd…) also works inside {'{}'}.</div>
      </div>
      </div>
      </CollapsibleSection>
    </div>
  );
}
