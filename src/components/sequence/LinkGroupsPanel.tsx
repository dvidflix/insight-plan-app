import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import type { ScheduleModel } from '../../schedule/types';
import type { ElementSummary } from '../../viewer/types';
import { usePropertyVisibilityStore } from '../../state/propertyVisibilityStore';
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
import { HexColorInput } from '../HexColorInput';
import { CellPick } from '../CellPick';
import { downloadCsv } from '../../utils/csv';
import { basisFinish, basisStart } from '../../schedule/linking';
import { DEFAULT_SUB_SEQUENCE, MAX_OVERLAP_PCT, MIN_OVERLAP_PCT, slotWindow, type SubSequence } from '../../schedule/subSequence';
import { IconCopy, IconEye, IconEyeOff, IconPencil, IconSectionChevron } from '../icons';
import { usePersistedState } from '../../utils/persistedState';

/** The section header's "New group" button asks the panel (mounted once the section is open) to start a new group. */
export const useLinkGroupsUiStore = create<{ newRequested: boolean; requestNew: () => void; clearNew: () => void }>((set) => ({
  newRequested: false,
  requestNew: () => set({ newRequested: true }),
  clearNew: () => set({ newRequested: false }),
}));

/** The matched task / object pairs of every group as a CSV (the section header's export button). */
export function exportLinkGroupMatches(model: ScheduleModel, elements: ElementSummary[], groups: LinkGroup[]) {
  const rows = buildMatchExportRows(model, elements, groups);
  downloadCsv(
    'link-group-matches.csv',
    ['Group', 'Activity ID', 'Activity Name', 'Element GUID', 'Element Name', 'Element Category', 'Matched On'],
    rows.map((r) => [r.group, r.activityId, r.activityName, r.elementGuid, r.elementName, r.elementCategory, r.matchedOn]),
  );
}

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
  const newRequested = useLinkGroupsUiStore((st) => st.newRequested);
  useEffect(() => {
    if (!newRequested) return;
    useLinkGroupsUiStore.getState().clearNew();
    setEditing(emptyGroup());
  }, [newRequested]);

  const taskOptions = useMemo(() => taskFieldOptions(model), [model]);
  // The object properties to pick from: all but those hidden on the Properties tab (Show / hide properties),
  // plus any a group already uses, so its rules still show.
  const hiddenPsets = usePropertyVisibilityStore((st) => st.hiddenPsets);
  const hiddenProps = usePropertyVisibilityStore((st) => st.hiddenProps);
  const objectKeys = useMemo(() => {
    const keys = new Set<string>(['_file']);
    const hiddenSet = new Set(hiddenPsets);
    const hiddenOne = new Set(hiddenProps);
    for (const set of elementSets ?? [elements]) {
      for (const k of samplePropKeys(set)) {
        const dot = k.indexOf('.');
        if (hiddenOne.has(k) || (dot > 0 && hiddenSet.has(k.slice(0, dot)))) continue;
        keys.add(k);
      }
    }
    for (const g of groups) {
      for (const r of g.objectFilters) keys.add(objectFieldKey(r.propertySet, r.attribute));
      for (const r of g.matchRules) keys.add(objectFieldKey(r.objectPropertySet, r.objectAttribute));
    }
    return [...keys];
  }, [elements, elementSets, groups, hiddenPsets, hiddenProps]);

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

  if (editing) {
    return (
      <GroupEditor
        group={editing}
        model={model}
        elements={elements}
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

/** A block of the editor: a thin title bar with its "+ add" button, then a table-like list of one-line rows under
    column headings. */
function GeSection({ id, title, count, heads, cols, onAdd, addLabel = '+ condition', children }: { id: string; title: string; count: number; heads: string[]; cols: string; onAdd: () => void; addLabel?: string; children: ReactNode }) {
  const [closed, setClosed] = usePersistedState<string[]>('groupEditor.closed', []);
  const open = !closed.includes(id);
  return (
    <section className="ge-sec">
      <div className="ge-sec__bar">
        <button type="button" className="ge-sec__toggle" aria-expanded={open} onClick={() => setClosed(open ? [...closed, id] : closed.filter((x) => x !== id))}>
          <IconSectionChevron className="section-chevron" />
          <span>{title}</span>
          {count > 0 && <span className="ge-sec__count">{count}</span>}
        </button>
        {open && <button type="button" className="ge-add" onClick={onAdd}>{addLabel}</button>}
      </div>
      {open && (
        <div className="ge-table">
          <div className="ge-row ge-row--head" style={{ gridTemplateColumns: cols }}>{heads.map((h, i) => <span key={i}>{h}</span>)}</div>
          {children}
        </div>
      )}
    </section>
  );
}

const ConjSelect = ({ value, first, onChange }: { value: Conjunction; first: boolean; onChange: (c: Conjunction) => void }) =>
  first ? <span /> : (
    <CellPick value={value} options={[{ value: 'or', label: 'Or' }, { value: 'and', label: 'And' }]} onChange={(v) => onChange(v as Conjunction)} title="And / Or" />
  );

/** Grid columns of each block's rows (and its headings). */
const GE_COLS = {
  task: '44px minmax(0, 1.5fr) 84px minmax(0, 1fr) 26px',
  object: '44px minmax(0, 1.5fr) 84px minmax(0, 1fr) 68px 26px',
  match: '44px minmax(0, 1fr) 10px minmax(0, 1fr) 46px 26px',
};

function GroupEditor({
  group,
  model,
  elements,
  taskOptions,
  objectKeys,
  onSave,
  onCancel,
  onDelete,
}: {
  group: LinkGroup;
  model: ScheduleModel;
  elements: ElementSummary[];
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
  // Matching rules whose "split on" separators are showing.
  const [splitOpen, setSplitOpen] = useState<Set<string>>(new Set());

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

  const objectOptions = useMemo(() => objectKeys.map((k) => ({ value: k, label: objectFieldLabel(k) })), [objectKeys]);
  const sub: SubSequence = g.subSequence ?? DEFAULT_SUB_SEQUENCE;
  const setSub = (patch: Partial<SubSequence>) => setG({ ...g, subSequence: { ...sub, ...patch } });
  const firstObjectKey = g.matchRules[0] ? objectFieldKey(g.matchRules[0].objectPropertySet, g.matchRules[0].objectAttribute) : '';
  // What the sub-sequence does with the objects now: how many activities split, into how many parts, and the first one's slots.
  const preview = useMemo(() => {
    if (!sub.enabled || g.matchRules.length === 0) return null;
    const links = computeGroupLinks(model, elements, g);
    const split = [...(links.sub ?? new Map())];
    const partsOf = (slots: Map<number, { slots: number }>) => Math.max(...[...slots.values()].map((x) => x.slots));
    const parts = split.reduce((n, [, slots]) => n + partsOf(slots), 0);
    const first = split[0];
    const activity = first && model.activities.find((a) => a.id === first[0]);
    const start = activity ? basisStart(activity, 'planned')?.getTime() : undefined;
    const finish = activity ? basisFinish(activity, 'planned')?.getTime() : undefined;
    let example = '';
    if (activity && first && start !== undefined && finish !== undefined) {
      const n = partsOf(first[1]);
      const fmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      const at = (i: number) => slotWindow(start, finish, i, n, sub.overlapPct);
      example = `${activity.code}: ${n} parts, the first ${fmt(at(0)[0])} to ${fmt(at(0)[1])}, the last ${fmt(at(n - 1)[0])} to ${fmt(at(n - 1)[1])}.`;
    }
    return { linked: links.taskToElements.size, split: split.length, parts, example };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sub.enabled, sub.overlapPct, sub.separator, sub.field, g.matchRules, g.taskFilters, g.objectFilters, model, elements]);

  return (
    <div className="ge">
      <div className="ge-props">
        <span className="ge-props__label">Group name:</span>
        <span className="ge-props__field">
          <input className="ge-name" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="Group name" aria-label="Group name" />
          <HexColorInput value={g.color} onChange={(hex) => setG({ ...g, color: hex })} />
        </span>
        <span className="ge-props__label" title="Appearance Profile: the colours and opacity this group's objects take as their tasks start and finish">Appearance:</span>
        <span className="ge-props__field">
          <select value={g.appearanceProfileId ?? ''} onChange={(e) => setG({ ...g, appearanceProfileId: e.target.value || null })} aria-label="Appearance">
            <option value="">Default</option>
            {appearanceProfiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </span>
        <span className="ge-props__label" title="Tag: a label shown in the 3D view while a task of this group is active">Tag:</span>
        <span className="ge-props__field">
          <select value={g.tagId ?? ''} onChange={(e) => setG({ ...g, tagId: e.target.value || null })} aria-label="Tag">
            <option value="">None</option>
            {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </span>
      </div>

      <GeSection id="tasks" title="Tasks" count={g.taskFilters.length} heads={['', 'Field', 'Is', 'Value', '']} cols={GE_COLS.task} onAdd={addTaskFilter}>
        {g.taskFilters.map((r, i) => (
          <div key={r.id} className="ge-row" style={{ gridTemplateColumns: GE_COLS.task }}>
            <ConjSelect value={r.conj} first={i === 0} onChange={(conj) => updateTaskFilter(r.id, { conj })} />
            <CellPick value={r.attribute} options={taskOptions} onChange={(attribute) => updateTaskFilter(r.id, { attribute })} />
            <CellPick value={r.op} options={OPS} onChange={(op) => updateTaskFilter(r.id, { op: op as CompareOp })} />
            <input value={r.value} onChange={(e) => updateTaskFilter(r.id, { value: e.target.value })} placeholder="value" />
            <button type="button" className="ge-x" title="Remove" aria-label="Remove" onClick={() => setG({ ...g, taskFilters: g.taskFilters.filter((x) => x.id !== r.id) })}>{'✕'}</button>
          </div>
        ))}
        {g.taskFilters.length === 0 && <div className="ge-none">All tasks</div>}
      </GeSection>

      <GeSection id="objects" title="Objects" count={g.objectFilters.length} heads={['', 'Field', 'Is', 'Value', '', '']} cols={GE_COLS.object} onAdd={addObjectFilter}>
        {g.objectFilters.map((r, i) => (
          <div key={r.id} className="ge-row" style={{ gridTemplateColumns: GE_COLS.object }}>
            <ConjSelect value={r.conj} first={i === 0} onChange={(conj) => updateObjectFilter(r.id, { conj })} />
            <CellPick
              value={objectFieldKey(r.propertySet, r.attribute)}
              options={objectOptions}
              onChange={(k) => { const { propertySet, attribute } = parseObjectFieldKey(k); updateObjectFilter(r.id, { propertySet, attribute }); }}
            />
            <CellPick value={r.op} options={OPS} onChange={(op) => updateObjectFilter(r.id, { op: op as CompareOp })} />
            <input value={r.value} onChange={(e) => updateObjectFilter(r.id, { value: e.target.value })} placeholder="value" />
            <span className="ge-flags">
              <button type="button" className={`tags__chip${r.caseSensitive ? ' active' : ''}`} aria-pressed={r.caseSensitive} title="Case-sensitive" onClick={() => updateObjectFilter(r.id, { caseSensitive: !r.caseSensitive })}>Aa</button>
              <button type="button" className={`tags__chip${r.ignore ? ' active' : ''}`} aria-pressed={r.ignore} title="Ignore this condition" onClick={() => updateObjectFilter(r.id, { ignore: !r.ignore })}>Ign</button>
            </span>
            <button type="button" className="ge-x" title="Remove" aria-label="Remove" onClick={() => setG({ ...g, objectFilters: g.objectFilters.filter((x) => x.id !== r.id) })}>{'✕'}</button>
          </div>
        ))}
        {g.objectFilters.length === 0 && <div className="ge-none">All objects</div>}
      </GeSection>

      <GeSection id="matching" title="Matching" count={g.matchRules.length} heads={['', 'Task field', '', 'Object field', '', '']} cols={GE_COLS.match} onAdd={addMatchRule} addLabel="+ rule">
        {g.matchRules.map((r, i) => {
          const splits = (r.taskSeparators?.length ?? 0) + (r.objectSeparators?.length ?? 0);
          const open = splitOpen.has(r.id);
          return (
            <Fragment key={r.id}>
              <div className="ge-row" style={{ gridTemplateColumns: GE_COLS.match }}>
                <ConjSelect value={r.conj} first={i === 0} onChange={(conj) => updateMatchRule(r.id, { conj })} />
                <CellPick value={r.taskField} options={taskOptions} onChange={(taskField) => updateMatchRule(r.id, { taskField })} />
                <span className="ge-eq">=</span>
                <CellPick
                  value={objectFieldKey(r.objectPropertySet, r.objectAttribute)}
                  options={objectOptions}
                  onChange={(k) => { const { propertySet, attribute } = parseObjectFieldKey(k); updateMatchRule(r.id, { objectPropertySet: propertySet, objectAttribute: attribute }); }}
                />
                <button
                  type="button"
                  className={`tags__chip${open || splits ? ' active' : ''}`}
                  aria-pressed={open}
                  title="A field holding several values (like A || B) can be split on separators: one equal value then links"
                  onClick={() => setSplitOpen((o) => { const n = new Set(o); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                >split{splits ? ` ${splits}` : ''}</button>
                <button type="button" className="ge-x" title="Remove" aria-label="Remove" onClick={() => setG({ ...g, matchRules: g.matchRules.filter((x) => x.id !== r.id) })}>{'✕'}</button>
              </div>
              {open && (
                <div className="rule-seps">
                  <SeparatorsEditor label="Task value holds several, split on" value={r.taskSeparators ?? []} onChange={(taskSeparators) => updateMatchRule(r.id, { taskSeparators })} />
                  <SeparatorsEditor label="Object value holds several, split on" value={r.objectSeparators ?? []} onChange={(objectSeparators) => updateMatchRule(r.id, { objectSeparators })} />
                </div>
              )}
            </Fragment>
          );
        })}
        {g.matchRules.length === 0 && <div className="ge-none">No rule: the group only selects the tasks and objects above, without pairing them.</div>}
      </GeSection>

      <section className="ge-sec">
        <div className="ge-sec__bar">
          <label className="ge-check" title="One activity for a parent ID, the model in parts (P101-1, P101-2, ...): the activity's time is shared between the parts, so they appear one at a time">
            <input type="checkbox" checked={sub.enabled} disabled={g.matchRules.length === 0} onChange={(e) => setSub({ enabled: e.target.checked })} />
            <span>Parts in sequence</span>
          </label>
          <span className="ge-hint">{g.matchRules.length === 0 ? 'needs a matching rule' : 'one activity, many parts'}</span>
        </div>
        {sub.enabled && (
          <div className="ge-sub">
            <div className="ge-sub__grid">
              <label>
                <span>Object ID field</span>
                <select value={sub.field} onChange={(e) => setSub({ field: e.target.value })}>
                  <option value="">The first rule&rsquo;s object field{firstObjectKey ? ` (${objectFieldLabel(firstObjectKey)})` : ''}</option>
                  {objectKeys.map((k) => <option key={k} value={k}>{objectFieldLabel(k)}</option>)}
                </select>
              </label>
              <label title="What comes between the parent ID and the index in the object's ID">
                <span>Index separator</span>
                <span className="ge-sub__sep">
                  <input value={sub.separator} maxLength={4} onChange={(e) => setSub({ separator: e.target.value })} aria-label="Index separator" />
                  {['-', '.', '_', '/'].map((c) => <button key={c} type="button" className={`tags__chip${sub.separator === c ? ' active' : ''}`} onClick={() => setSub({ separator: c })}>{c}</button>)}
                </span>
              </label>
              <label title="0: one after the other. Positive: the next part starts before the one before it ends. Negative: a gap between parts.">
                <span>Overlap / gap: <b>{sub.overlapPct > 0 ? `${sub.overlapPct}% overlap` : sub.overlapPct < 0 ? `${-sub.overlapPct}% gap` : 'none'}</b></span>
                <span className="ge-sub__range">
                  <input type="range" min={MIN_OVERLAP_PCT} max={MAX_OVERLAP_PCT} step={5} value={sub.overlapPct} onChange={(e) => setSub({ overlapPct: Number(e.target.value) })} aria-label="Overlap or gap" />
                  <input type="number" min={MIN_OVERLAP_PCT} max={MAX_OVERLAP_PCT} value={sub.overlapPct} onChange={(e) => setSub({ overlapPct: Math.min(MAX_OVERLAP_PCT, Math.max(MIN_OVERLAP_PCT, Number(e.target.value) || 0)) })} aria-label="Overlap or gap, percent" />
                </span>
              </label>
            </div>
            <div className="ge-hint">
              The objects&rsquo; IDs are &ldquo;parent{sub.separator || '-'}index&rdquo;: the parent is matched to the activity (by the rules above) and the parts, in index order, share its dates.
              {preview && <> <b>{preview.linked}</b> activit{preview.linked === 1 ? 'y' : 'ies'} linked, <b>{preview.split}</b> split into <b>{preview.parts}</b> parts. {preview.example}</>}
            </div>
          </div>
        )}
      </section>

      <div className="ge-foot">
        <button className="btn primary btn--small" onClick={() => onSave(g)} disabled={!g.name.trim()}>Save</button>
        <button className="btn btn--small" onClick={onCancel}>Cancel</button>
        {onDelete && <button className="btn btn--danger btn--small" style={{ marginLeft: 'auto' }} onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}

/** Separators for a field that holds several values: the usual ones to switch on, any other typed in (Enter). */
const COMMON_SEPARATORS = ['||', '|', ',', ';', '/'];
function SeparatorsEditor({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const toggle = (sep: string) => onChange(value.includes(sep) ? value.filter((x) => x !== sep) : [...value, sep]);
  const add = () => {
    // Spaces count here (" - " is a separator); only an empty entry is ignored.
    if (draft.trim() !== '' && !value.includes(draft)) onChange([...value, draft]);
    setDraft('');
  };
  const custom = value.filter((x) => !COMMON_SEPARATORS.includes(x));
  return (
    <div className="rule-seps__side" title="Several values in one field: the text is cut at each separator, and one equal value is enough to link">
      <span className="rule-seps__label">{label}</span>
      {COMMON_SEPARATORS.map((sep) => (
        <button key={sep} type="button" className={`tags__chip${value.includes(sep) ? ' active' : ''}`} aria-pressed={value.includes(sep)} onClick={() => toggle(sep)}>{sep}</button>
      ))}
      {custom.map((sep) => (
        <button key={sep} type="button" className="tags__chip active" title="Remove this separator" onClick={() => toggle(sep)}>{JSON.stringify(sep).slice(1, -1)} ×</button>
      ))}
      <input
        className="rule-seps__input"
        value={draft}
        placeholder="other…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        onBlur={add}
        aria-label="Add a separator"
      />
    </div>
  );
}
