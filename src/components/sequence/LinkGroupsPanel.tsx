import { useMemo, useState } from 'react';
import type { ScheduleModel } from '../../schedule/types';
import type { ElementSummary } from '../../viewer/types';
import {
  buildMatchExportRows,
  computeGroupLinks,
  emptyGroup,
  newId,
  objectFieldKey,
  objectFieldLabel,
  parseObjectFieldKey,
  taskFieldOptions,
  type CompareOp,
  type Conjunction,
  type LinkGroup,
  type MatchRule,
  type ObjectFilterRule,
  type TaskFilterRule,
} from '../../schedule/linkGroups';
import { samplePropKeys } from '../../viewer/query';
import { useLinkGroupsStore } from '../../state/linkGroupsStore';
import { useAppearanceStore } from '../../state/appearanceStore';
import { useTagsStore } from '../../state/tagsStore';
import { TagEditor } from './TagEditor';
import { HexColorInput } from '../HexColorInput';
import { downloadCsv } from '../../utils/csv';
import { IconCopy, IconEye, IconEyeOff, IconPencil } from '../icons';

const OPS: { value: CompareOp; label: string }[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Not equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'notContains', label: 'Does not contain' },
  { value: 'startsWith', label: 'Starts with' },
  { value: 'endsWith', label: 'Ends with' },
];

interface LinkGroupsPanelProps {
  model: ScheduleModel;
  elements: ElementSummary[];
  /** Each loaded model's elements, so the property pickers list every model's properties (not just the first model's). */
  elementSets?: ElementSummary[][];
  onPreview: (group: LinkGroup) => void;
}

export function LinkGroupsPanel({ model, elements, elementSets, onPreview }: LinkGroupsPanelProps) {
  const groups = useLinkGroupsStore((s) => s.groups);
  const add = useLinkGroupsStore((s) => s.add);
  const update = useLinkGroupsStore((s) => s.update);
  const remove = useLinkGroupsStore((s) => s.remove);
  const replaceAll = useLinkGroupsStore((s) => s.replaceAll);
  // Order matters: a task in two groups takes the first group's appearance.
  // Drag a row onto another: it goes before or after it (the line shows which), as in the Scenarios table.
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const moveGroup = (id: string, target: string, after: boolean) => {
    if (id === target) return;
    const moving = groups.find((g) => g.id === id);
    if (!moving) return;
    const rest = groups.filter((g) => g.id !== id);
    const at = rest.findIndex((g) => g.id === target) + (after ? 1 : 0);
    replaceAll([...rest.slice(0, at), moving, ...rest.slice(at)]);
  };
  /** A copy right under the original, to change from there. */
  const duplicate = (g: LinkGroup) => {
    const i = groups.findIndex((x) => x.id === g.id);
    const copy: LinkGroup = { ...structuredClone(g), id: newId(), name: `${g.name} (copy)` };
    replaceAll([...groups.slice(0, i + 1), copy, ...groups.slice(i + 1)]);
  };
  const [editing, setEditing] = useState<LinkGroup | null>(null);

  const taskOptions = useMemo(() => taskFieldOptions(model), [model]);
  const objectKeys = useMemo(() => {
    const keys = new Set<string>(['_file']);
    for (const set of elementSets ?? [elements]) for (const k of samplePropKeys(set)) keys.add(k);
    return [...keys];
  }, [elements, elementSets]);

  // Each group's links once, and the totals (a task or object in several groups counts once).
  const linked = useMemo(() => {
    const byGroup = new Map<string, { tasks: number; elements: number }>();
    const tasks = new Set<string>();
    const objects = new Set<number>();
    for (const g of groups) {
      const r = computeGroupLinks(model, elements, g);
      byGroup.set(g.id, { tasks: r.taskIds.size, elements: r.elementIds.size });
      for (const id of r.taskIds) tasks.add(id);
      for (const id of r.elementIds) objects.add(id);
    }
    return { byGroup, totalTasks: tasks.size, totalObjects: objects.size };
  }, [model, elements, groups]);

  const handleExportMatches = () => {
    const rows = buildMatchExportRows(model, elements, groups);
    downloadCsv(
      'link-group-matches.csv',
      ['Group', 'Activity ID', 'Activity Name', 'Element GUID', 'Element Name', 'Element Category', 'Matched On'],
      rows.map((r) => [r.group, r.activityId, r.activityName, r.elementGuid, r.elementName, r.elementCategory, r.matchedOn]),
    );
  };

  if (editing) {
    return (
      <GroupEditor
        group={editing}
        taskOptions={taskOptions}
        objectKeys={objectKeys}
        onCancel={() => setEditing(null)}
        onDelete={
          groups.some((x) => x.id === editing.id)
            ? () => {
                if (!window.confirm(`Delete the link group "${editing.name}"?`)) return;
                remove(editing.id);
                setEditing(null);
              }
            : undefined
        }
        onSave={(g) => {
          if (groups.some((x) => x.id === g.id)) update(g);
          else add(g);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div>
      <div style={{ padding: '4px 8px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={() => setEditing(emptyGroup())}>
          + New Group
        </button>
        <button className="btn" onClick={handleExportMatches} title="Export the matched task/object pairs and which fields matched them">
          Export matches (CSV)
        </button>
      </div>
      {groups.length === 0 && <div style={{ padding: '8px', color: 'var(--text-dim)' }}>No groups yet. A group filters tasks and objects, then pairs them by matching field values.</div>}
      {groups.length > 0 && (
        <table className="seq-grid">
          <thead>
            <tr>
              <th className="seq-grid__swatch" />
              <th>Name</th>
              <th className="seq-grid__num" title="Linked tasks">Tasks</th>
              <th className="seq-grid__num" title="Linked objects">Objects</th>
              <th className="seq-grid__actions" />
            </tr>
          </thead>
          <tbody>
            <tr className="seq-grid__totals" title="Linked in all the groups together (a task or object in several groups counts once)">
              <td className="seq-grid__swatch" />
              <td className="seq-grid__name">Total</td>
              <td className="seq-grid__num">{linked.totalTasks}</td>
              <td className="seq-grid__num">{linked.totalObjects}</td>
              <td className="seq-grid__actions" />
            </tr>
            {groups.map((g) => {
              const c = linked.byGroup.get(g.id) ?? { tasks: 0, elements: 0 };
              return (
                <tr
                  key={g.id}
                  className={[dragId === g.id ? 'is-dragging' : '', drop?.id === g.id && dragId !== g.id ? (drop.after ? 'drop-after' : 'drop-before') : ''].filter(Boolean).join(' ') || undefined}
                  draggable
                  onDragStart={(e) => { setDragId(g.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const after = e.clientY > rect.top + rect.height / 2;
                    if (drop?.id !== g.id || drop.after !== after) setDrop({ id: g.id, after });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragId && drop) moveGroup(dragId, drop.id, drop.after);
                    setDragId(null);
                    setDrop(null);
                  }}
                  onDragEnd={() => { setDragId(null); setDrop(null); }}
                  title="Drag to reorder: a task in two groups takes the first one's appearance"
                >
                  <td className="seq-grid__swatch"><span className="seq-grid__dot" style={{ background: g.color, opacity: g.hidden ? 0.35 : 1 }} /></td>
                  <td className="seq-grid__name" title={`${g.name} (click to preview in the 3D view)`} onClick={() => onPreview(g)}>{g.name}</td>
                  <td className="seq-grid__num">{c.tasks}</td>
                  <td className="seq-grid__num">{c.elements}</td>
                  <td className="seq-grid__actions">
                    <button type="button" title={g.hidden ? 'Hidden in the 3D view (click to show)' : 'Shown in the 3D view (click to hide)'} aria-label={g.hidden ? 'Show group' : 'Hide group'} onClick={() => update({ ...g, hidden: !g.hidden })}>{g.hidden ? <IconEyeOff /> : <IconEye />}</button>
                    <button type="button" title="Edit" aria-label="Edit" onClick={() => setEditing(g)}><IconPencil /></button>
                    <button type="button" title="Duplicate" aria-label="Duplicate" onClick={() => duplicate(g)}><IconCopy /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function GroupEditor({
  group,
  taskOptions,
  objectKeys,
  onSave,
  onCancel,
  onDelete,
}: {
  group: LinkGroup;
  taskOptions: { value: string; label: string }[];
  objectKeys: string[];
  onSave: (g: LinkGroup) => void;
  onCancel: () => void;
  /** Deletes the group (an existing one only). */
  onDelete?: () => void;
}) {
  const [g, setG] = useState<LinkGroup>(group);
  const appearanceProfiles = useAppearanceStore((s) => s.profiles);
  const tags = useTagsStore((s) => s.tags);
  const addTag = useTagsStore((s) => s.add);
  const updateTag = useTagsStore((s) => s.update);
  const [tagOpen, setTagOpen] = useState(false);

  const addTaskFilter = () =>
    setG({ ...g, taskFilters: [...g.taskFilters, { id: newId(), attribute: taskOptions[0]?.value ?? '_code', op: 'equals', value: '', conj: 'or' }] });
  const addObjectFilter = () =>
    setG({
      ...g,
      objectFilters: [...g.objectFilters, { id: newId(), propertySet: '_category', attribute: '', op: 'equals', value: '', conj: 'or', caseSensitive: false, ignore: false }],
    });
  const addMatchRule = () =>
    setG({ ...g, matchRules: [...g.matchRules, { id: newId(), taskField: taskOptions[0]?.value ?? '_code', objectPropertySet: '_category', objectAttribute: '', conj: 'or' }] });

  const updateTaskFilter = (id: string, patch: Partial<TaskFilterRule>) =>
    setG({ ...g, taskFilters: g.taskFilters.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const updateObjectFilter = (id: string, patch: Partial<ObjectFilterRule>) =>
    setG({ ...g, objectFilters: g.objectFilters.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const updateMatchRule = (id: string, patch: Partial<MatchRule>) =>
    setG({ ...g, matchRules: g.matchRules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  return (
    <div style={{ padding: 8 }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="Group name" style={{ flex: 1 }} />
        <HexColorInput value={g.color} onChange={(hex) => setG({ ...g, color: hex })} />
      </div>

      <label style={{ display: 'block', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 2 }}>Appearance Profile</div>
        <select
          value={g.appearanceProfileId ?? ''}
          onChange={(e) => setG({ ...g, appearanceProfileId: e.target.value || null })}
          style={{ width: '100%' }}
        >
          <option value="">None — default pending/in-progress/done look</option>
          {appearanceProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'block', marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: 2 }}>Tag (label while a task is active)</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={g.tagId ?? ''} onChange={(e) => setG({ ...g, tagId: e.target.value || null })} style={{ flex: 1 }}>
            <option value="">None</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button type="button" className="btn btn--small" onClick={() => { const id = addTag(); setG({ ...g, tagId: id }); setTagOpen(true); }}>+ New</button>
          {g.tagId && <button type="button" className={`btn btn--small${tagOpen ? ' primary' : ''}`} onClick={() => setTagOpen((v) => !v)}>Edit</button>}
        </div>
      </label>
      {tagOpen && tags.find((t) => t.id === g.tagId) && (
        <div style={{ marginBottom: 10 }}>
          <TagEditor tag={tags.find((t) => t.id === g.tagId)!} onChange={(patch) => updateTag(g.tagId!, patch)} />
        </div>
      )}

      <h3 style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Filter Tasks</h3>
      {g.taskFilters.map((r, i) => (
        <div key={r.id} className="rule-row rule-row--task">
          {i > 0 ? (
            <select value={r.conj} onChange={(e) => updateTaskFilter(r.id, { conj: e.target.value as 'and' | 'or' })}>
              <option value="or">Or</option>
              <option value="and">And</option>
            </select>
          ) : <span />}
          <select value={r.attribute} onChange={(e) => updateTaskFilter(r.id, { attribute: e.target.value })}>
            {taskOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select value={r.op} onChange={(e) => updateTaskFilter(r.id, { op: e.target.value as CompareOp })}>
            {OPS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input value={r.value} onChange={(e) => updateTaskFilter(r.id, { value: e.target.value })} placeholder="value" />
          <button className="btn rule-row__x" title="Remove" onClick={() => setG({ ...g, taskFilters: g.taskFilters.filter((x) => x.id !== r.id) })}>
            {'✕'}
          </button>
        </div>
      ))}
      <button className="btn" onClick={addTaskFilter} style={{ marginBottom: 10 }}>
        + condition
      </button>

      <h3 style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Filter Objects</h3>
      {g.objectFilters.map((r, i) => (
        <div key={r.id} className="rule-row rule-row--object">
          {i > 0 ? (
            <select value={r.conj} onChange={(e) => updateObjectFilter(r.id, { conj: e.target.value as 'and' | 'or' })}>
              <option value="or">Or</option>
              <option value="and">And</option>
            </select>
          ) : <span />}
          <select
            value={objectFieldKey(r.propertySet, r.attribute)}
            onChange={(e) => {
              const { propertySet, attribute } = parseObjectFieldKey(e.target.value);
              updateObjectFilter(r.id, { propertySet, attribute });
            }}
          >
            {objectKeys.map((k) => (
              <option key={k} value={k}>
                {objectFieldLabel(k)}
              </option>
            ))}
          </select>
          <select value={r.op} onChange={(e) => updateObjectFilter(r.id, { op: e.target.value as CompareOp })}>
            {OPS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input value={r.value} onChange={(e) => updateObjectFilter(r.id, { value: e.target.value })} placeholder="value" />
          <span className="rule-row__flags">
            <button type="button" className={`tags__chip${r.caseSensitive ? ' active' : ''}`} aria-pressed={r.caseSensitive} title="Case-sensitive" onClick={() => updateObjectFilter(r.id, { caseSensitive: !r.caseSensitive })}>Aa</button>
            <button type="button" className={`tags__chip${r.ignore ? ' active' : ''}`} aria-pressed={r.ignore} title="Ignore this condition" onClick={() => updateObjectFilter(r.id, { ignore: !r.ignore })}>Ign</button>
          </span>
          <button className="btn rule-row__x" title="Remove" onClick={() => setG({ ...g, objectFilters: g.objectFilters.filter((x) => x.id !== r.id) })}>
            {'✕'}
          </button>
        </div>
      ))}
      <button className="btn" onClick={addObjectFilter} style={{ marginBottom: 10 }}>
        + condition
      </button>

      <h3 style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Matching Criteria</h3>
      <div style={{ color: 'var(--text-dim)', fontSize: 11, marginBottom: 4 }}>
        Links a filtered task to a filtered object when these fields hold equal values. "And" rules must all match the same object at once; "Or" rules are independent alternatives.
      </div>
      {g.matchRules.map((r, i) => (
        <div key={r.id} className="rule-row rule-row--match">
          {i > 0 ? (
            <select value={r.conj} onChange={(e) => updateMatchRule(r.id, { conj: e.target.value as Conjunction })}>
              <option value="or">Or</option>
              <option value="and">And</option>
            </select>
          ) : <span />}
          <select value={r.taskField} onChange={(e) => updateMatchRule(r.id, { taskField: e.target.value })}>
            {taskOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <span style={{ color: 'var(--text-dim)' }}>=</span>
          <select
            value={objectFieldKey(r.objectPropertySet, r.objectAttribute)}
            onChange={(e) => {
              const { propertySet, attribute } = parseObjectFieldKey(e.target.value);
              updateMatchRule(r.id, { objectPropertySet: propertySet, objectAttribute: attribute });
            }}
          >
            {objectKeys.map((k) => (
              <option key={k} value={k}>
                {objectFieldLabel(k)}
              </option>
            ))}
          </select>
          <button className="btn rule-row__x" title="Remove" onClick={() => setG({ ...g, matchRules: g.matchRules.filter((x) => x.id !== r.id) })}>
            {'✕'}
          </button>
        </div>
      ))}
      <button className="btn" onClick={addMatchRule} style={{ marginBottom: 12 }}>
        + matching rule
      </button>

      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn primary" onClick={() => onSave(g)} disabled={!g.name.trim()}>
          Save
        </button>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        {onDelete && (
          <button className="btn btn--danger" style={{ marginLeft: 'auto' }} onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}
