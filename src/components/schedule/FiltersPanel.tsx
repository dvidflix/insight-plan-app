import { useEffect, useMemo, useState } from 'react';
import type { Activity, ScheduleModel } from '../../schedule/types';
import {
  TEXT_MODES, applyFieldFilters, filterRuleIds, fieldIsActive, isPresenceMode, buildFilterFields, emptyFilterState, rangeActive,
  type FieldFilterState, type FilterFieldDef, type TextMode, type RangeFilter,
} from '../../schedule/filterFields';
import { InfoTip } from '../InfoTip';
import { FilterRules, LogicRow } from '../FilterRules';
import { useCalcFilterFields } from '../../schedule/calculatedColumns';
import { queryMatcher } from '../../schedule/search';
import { PresetBar } from './PresetBar';
import { removeUserPreset, saveUserPreset, useUserPresetsStore } from '../../state/userPresetsStore';
import { deserializeFilters, serializeFilters, type SerializedFilters } from '../../state/scheduleLayoutsStore';

type SetState = (next: FieldFilterState | ((prev: FieldFilterState) => FieldFilterState)) => void;

interface FiltersPanelProps {
  model: ScheduleModel;
  /** Activities before any field filter (i.e. after the toolbar search). */
  baseActivities: Activity[];
  state: FieldFilterState;
  onChange: SetState;
}

/** One-click filters — each is a field plus the selection/range it sets. */
const QUICK: { id: string; label: string; fieldId: string; values?: string[]; range?: RangeFilter }[] = [
  { id: 'critical', label: 'Critical', fieldId: 'critical', values: ['Yes'] },
  { id: 'negative', label: 'Negative float', fieldId: 'floatDays', range: { min: '', max: '-0.1' } },
  { id: 'highfloat', label: 'High float (44d+)', fieldId: 'floatDays', range: { min: '44', max: '' } },
  { id: 'inprogress', label: 'In progress', fieldId: 'status', values: ['in-progress'] },
  { id: 'notstarted', label: 'Not started', fieldId: 'status', values: ['not-started'] },
  { id: 'completed', label: 'Completed', fieldId: 'status', values: ['completed'] },
  { id: 'nopreds', label: 'No predecessors', fieldId: 'noPreds', values: ['Yes'] },
  { id: 'nosuccs', label: 'No successors', fieldId: 'noSuccs', values: ['Yes'] },
  { id: 'milestones', label: 'Milestones', fieldId: 'type', values: ['milestone-start', 'milestone-finish'] },
];

function clearField(prev: FieldFilterState, id: string): FieldFilterState {
  const selectModes = { ...prev.selectModes };
  delete selectModes[id];
  const selections = { ...prev.selections };
  const textFilters = { ...prev.textFilters };
  const textModes = { ...prev.textModes };
  const ranges = { ...prev.ranges };
  delete selections[id];
  delete textFilters[id];
  delete textModes[id];
  delete ranges[id];
  return { combine: prev.combine, selectModes, selections, textFilters, textModes, ranges };
}

function summarize(f: FilterFieldDef, s: FieldFilterState): string {
  if (f.kind === 'text') {
    const mode = s.textModes?.[f.id] ?? 'contains';
    if (mode === 'empty') return 'empty';
    if (mode === 'filled') return 'has a value';
    const prefix = { contains: '', all: 'all of ', starts: 'starts ', ends: 'ends ', equals: '= ', excludes: 'not ' }[mode];
    return `${prefix}“${s.textFilters[f.id]}”`;
  }
  if (f.kind === 'select') {
    const labels = [...(s.selections[f.id] ?? [])].map((v) => f.values.find((x) => x.value === v)?.label ?? v);
    return labels.length <= 2 ? labels.join(', ') : `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
  }
  const r = s.ranges[f.id];
  const u = f.unit ?? '';
  const lower = r.minExclusive ? '>' : '≥';
  if (r.min && r.max) return r.minExclusive ? `> ${r.min}${u} and ≤ ${r.max}${u}` : `${r.min}${u} – ${r.max}${u}`;
  return r.min ? `${lower} ${r.min}${u}` : `≤ ${r.max}${u}`;
}

export function FiltersPanel({ model, baseActivities, state, onChange }: FiltersPanelProps) {
  const calcFields = useCalcFilterFields(model);
  const fields = useMemo(() => buildFilterFields(model, calcFields), [model, calcFields]);
  const visibleFields = useMemo(() => fields.filter((f) => f.hasData), [fields]);
  const matched = useMemo(() => applyFieldFilters(baseActivities, fields, state), [baseActivities, fields, state]);
  // The filter being edited under the table (a field just picked is there at once, before it has a value).
  const [editing, setEditing] = useState<string | null>(null);

  const byId = useMemo(() => new Map(visibleFields.map((f) => [f.id, f])), [visibleFields]);
  const activeFields = visibleFields.filter((f) => fieldIsActive(f, state));
  const activeIds = new Set(activeFields.map((f) => f.id));
  // The rows are the filters, numbered as the logic formula means them: the order of the table is kept in the state.
  const rowIds = filterRuleIds(fields, state).filter((id) => byId.has(id) && (activeIds.has(id) || id === editing));
  // The state lists only the filters that count (the one being edited too): a field that was picked and left without a value drops out.
  useEffect(() => {
    const stale = (state.order ?? []).filter((id) => !activeIds.has(id) && id !== editing);
    if (stale.length) onChange((prev) => ({ ...prev, order: (prev.order ?? []).filter((id) => !stale.includes(id)) }));
  });
  const setOrder = (order: string[]) => onChange((prev) => ({ ...prev, order }));

  const clear = (id: string) => onChange((prev) => clearField(prev, id));
  const quickActive = (qf: (typeof QUICK)[number]) => {
    if (qf.values) {
      const sel = state.selections[qf.fieldId];
      return !!sel && sel.size === qf.values.length && qf.values.every((v) => sel.has(v));
    }
    const r = state.ranges[qf.fieldId];
    return !!r && r.min === qf.range!.min && r.max === qf.range!.max;
  };
  const toggleQuick = (qf: (typeof QUICK)[number]) => {
    if (quickActive(qf)) return clear(qf.fieldId);
    onChange((prev) => qf.values
      ? { ...prev, selections: { ...prev.selections, [qf.fieldId]: new Set(qf.values) } }
      : { ...prev, ranges: { ...prev.ranges, [qf.fieldId]: { ...qf.range! } } });
  };
  const quick = QUICK.filter((qf) => visibleFields.some((f) => f.id === qf.fieldId));
  const saved = useUserPresetsStore((st) => st.presets).filter((p) => p.kind === 'filters');
  const edited = editing ? byId.get(editing) : undefined;

  return (
    <FilterRules
      presets={(
        <PresetBar
          noun="filter"
          items={saved.map((p) => ({ id: p.id, label: p.name, user: true }))}
          saveDisabled={activeFields.length === 0}
          onApply={(id) => {
            const kept = saved.find((p) => p.id === id)?.data as SerializedFilters | undefined;
            if (kept) { onChange(deserializeFilters(kept)); setEditing(null); }
          }}
          onSave={(name) => saveUserPreset('filters', name, serializeFilters(state))}
          onDelete={removeUserPreset}
        />
      )}
      tip="Conditions an activity must meet. Click a filter to change it; pick a field below to add one."
      hint={baseActivities.length === 0 ? null : activeFields.length > 0 && <div className="flt__hint"><b>{matched.length.toLocaleString()}</b> of {baseActivities.length.toLocaleString()} activities{matched.length === 0 && <span className="flt__none"> — no matches</span>}</div>}
      quick={quick.length > 0 && (
        <div className="fsh__quick" role="group" aria-label="Quick filters">
          {quick.map((qf) => (
            <button key={qf.id} type="button" className={`fsh__pill${quickActive(qf) ? ' on' : ''}`} aria-pressed={quickActive(qf)} onClick={() => toggleQuick(qf)}>{qf.label}</button>
          ))}
        </div>
      )}
      rows={rowIds.map((id) => ({ id, field: byId.get(id)!.label, summary: activeIds.has(id) ? summarize(byId.get(id)!, state) : '', dim: !activeIds.has(id) }))}
      onRemove={(id) => { onChange((prev) => ({ ...clearField(prev, id), order: (prev.order ?? []).filter((x) => x !== id) })); if (editing === id) setEditing(null); }}
      onReorder={setOrder}
      onClearAll={() => { onChange((prev) => ({ ...emptyFilterState(), combine: prev.combine })); setEditing(null); }}
      editingId={editing}
      onEdit={setEditing}
      editorTitle={edited ? `Edit ${edited.label}` : 'Edit filter'}
      editor={edited && (
        <>
          {edited.kind === 'text' && <TextBody field={edited} state={state} onChange={onChange} />}
          {edited.kind === 'select' && <SelectBody field={edited} fields={fields} base={baseActivities} state={state} onChange={onChange} />}
          {(edited.kind === 'number' || edited.kind === 'date') && <RangeBody field={edited} state={state} onChange={onChange} />}
        </>
      )}
      combine={<LogicRow count={rowIds.length} match={state.combine ?? 'all'} logic={state.logic ?? ''} onChange={(p) => onChange((prev) => ({ ...prev, ...(p.match ? { combine: p.match } : {}), ...(p.logic !== undefined ? { logic: p.logic } : {}) }))} />}
      fields={visibleFields.map((f) => ({ id: f.id, label: f.label, group: f.group }))}
      picked={activeIds}
      onPick={(f) => { onChange((prev) => ({ ...prev, order: filterRuleIds(fields, prev).includes(f.id) ? prev.order : [...filterRuleIds(fields, prev), f.id] })); setEditing(f.id); }}
    />
  );
}

function TextBody({ field: f, state, onChange }: { field: FilterFieldDef; state: FieldFilterState; onChange: SetState }) {
  const mode: TextMode = state.textModes?.[f.id] ?? 'contains';
  const setMode = (m: TextMode) => onChange((prev) => ({ ...prev, textModes: { ...prev.textModes, [f.id]: m } }));
  const placeholder = { contains: 'Contains any of', all: 'Contains all of', starts: 'Starts with', ends: 'Ends with', equals: 'Is exactly', excludes: 'Does not contain', empty: '', filled: '' }[mode];
  return (
    <>
      <div className="flt__modes" role="group" aria-label="Match">
        {TEXT_MODES.map((m) => (
          <button key={m.value} type="button" className={mode === m.value ? 'on' : ''} aria-pressed={mode === m.value} title={m.title} onClick={() => setMode(m.value)}>{m.label}</button>
        ))}
      </div>
      {isPresenceMode(mode) ? (
        <div className="flt__hint">{mode === 'empty' ? `Only rows where ${f.label} has no value.` : `Only rows where ${f.label} has a value; the empty ones are left out.`}</div>
      ) : (
        <div className="info-tip-row">
          <input
            className="cols__search"
            style={{ marginBottom: 4 }}
            placeholder={`${placeholder}… (${f.label})`}
            value={state.textFilters[f.id] ?? ''}
            onChange={(e) => onChange((prev) => ({ ...prev, textFilters: { ...prev.textFilters, [f.id]: e.target.value } }))}
          />
          <InfoTip>Separate several terms with commas or new lines to match any of them (with “Not”, none of them may match). Use Filled to leave out rows with no value, or Empty to keep only those.</InfoTip>
        </div>
      )}
    </>
  );
}

function RangeBody({ field: f, state, onChange }: { field: FilterFieldDef; state: FieldFilterState; onChange: SetState }) {
  const r = state.ranges[f.id] ?? { min: '', max: '' };
  const set = (patch: Partial<RangeFilter>) => onChange((prev) => ({ ...prev, ranges: { ...prev.ranges, [f.id]: { ...r, ...patch } } }));
  const type = f.kind === 'date' ? 'date' : 'number';
  return (
    <>
      <div className="flt__range">
        <label>
          <span>{f.kind === 'date' ? 'From' : 'Min'}</span>
          <input type={type} step="any" value={r.min} placeholder={f.extent?.[0]} onChange={(e) => set({ min: e.target.value })} />
        </label>
        {f.kind === 'number' && (
          <button
            type="button"
            className={`flt__strict${r.minExclusive ? ' on' : ''}`}
            aria-pressed={!!r.minExclusive}
            title={r.minExclusive ? 'Greater than the minimum (click for: at least the minimum)' : 'At least the minimum (click for: greater than the minimum)'}
            onClick={() => set({ minExclusive: !r.minExclusive })}
          >
            {r.minExclusive ? '>' : '≥'}
          </button>
        )}
        <label>
          <span>{f.kind === 'date' ? 'To' : 'Max'}</span>
          <input type={type} step="any" value={r.max} placeholder={f.extent?.[1]} onChange={(e) => set({ max: e.target.value })} />
        </label>
        {f.unit && <span className="flt__unit">{f.unit}</span>}
      </div>
      {f.kind === 'number' && (
        <div className="flt__quick">
          <button type="button" className={`flt__toggle${r.min === '0' && r.max === '' && r.minExclusive ? ' on' : ''}`} onClick={() => set({ min: '0', max: '', minExclusive: true })} title="Keep only rows with a value above 0 (rows with no value or 0 go)">&gt; 0</button>
          <button type="button" className={`flt__toggle${r.min === '0' && r.max === '' && !r.minExclusive ? ' on' : ''}`} onClick={() => set({ min: '0', max: '', minExclusive: false })} title="Keep rows with a value of 0 or more (rows with no value go)">≥ 0</button>
        </div>
      )}
      {f.extent && <div className="flt__hint">Data range: {f.extent[0]} – {f.extent[1]}{f.unit ?? ''}</div>}
    </>
  );
}

function SelectBody({ field: f, fields, base, state, onChange }: { field: FilterFieldDef; fields: FilterFieldDef[]; base: Activity[]; state: FieldFilterState; onChange: SetState }) {
  const [valueSearch, setValueSearch] = useState('');
  const sel = state.selections[f.id];
  const mode = state.selectModes?.[f.id] ?? 'any';
  const setMode = (m: 'any' | 'all') => onChange((prev) => ({ ...prev, selectModes: { ...prev.selectModes, [f.id]: m } }));

  // How many activities each value would leave, given every OTHER filter.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of applyFieldFilters(base, fields, state, f.id)) for (const v of new Set(f.activityValues(a))) m.set(v, (m.get(v) ?? 0) + 1);
    return m;
  }, [base, fields, state, f]);

  const setSel = (next: Set<string>) => onChange((prev) => ({ ...prev, selections: { ...prev.selections, [f.id]: next } }));
  const toggle = (v: string) => {
    const next = new Set(sel);
    if (!next.delete(v)) next.add(v);
    setSel(next);
  };

  const q = valueSearch.trim().toLowerCase();
  const hit = queryMatcher(valueSearch);
  const list = q ? f.values.filter((v) => hit(v.label)) : f.values;

  if (f.display === 'chips') {
    return (
      <div className="flt__chips">
        {f.values.map((v) => (
          <button key={v.value} type="button" className={`flt__toggle${sel?.has(v.value) ? ' on' : ''}`} aria-pressed={!!sel?.has(v.value)} onClick={() => toggle(v.value)}>
            {v.label} <span className="flt__n">{counts.get(v.value) ?? 0}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      {f.values.length > 8 && (
        <input className="cols__search" style={{ marginBottom: 4 }} type="search" placeholder="Search values…" value={valueSearch} onChange={(e) => setValueSearch(e.target.value)} />
      )}
      {(sel?.size ?? 0) > 1 && (
        <div className="flt__match">
          <span className="flt__match-label">Has</span>
          <div className="flt__modes" role="group" aria-label="How the ticked values combine">
            <button type="button" className={mode === 'any' ? 'on' : ''} aria-pressed={mode === 'any'} onClick={() => setMode('any')} title="OR: the activity has at least one of the ticked values">Any of</button>
            <button type="button" className={mode === 'all' ? 'on' : ''} aria-pressed={mode === 'all'} onClick={() => setMode('all')} title="AND: the activity has every ticked value">All of</button>
          </div>
          <span className="flt__match-label">the ticked</span>
        </div>
      )}
      <div className="flt__bulk">
        <button type="button" className="cols__link" onClick={() => setSel(new Set([...(sel ?? []), ...list.map((v) => v.value)]))}>Select {q ? 'shown' : 'all'}</button>
        <button type="button" className="cols__link" onClick={() => setSel(new Set([...(sel ?? [])].filter((v) => !list.some((x) => x.value === v))))}>None</button>
      </div>
      <div className="flt__values">
        {list.map((v) => {
          const n = counts.get(v.value) ?? 0;
          return (
            <label className={`cols__check${n === 0 && !sel?.has(v.value) ? ' flt__zero' : ''}`} key={v.value}>
              <input type="checkbox" checked={!!sel?.has(v.value)} onChange={() => toggle(v.value)} />
              <span title={v.label}>{v.label}</span>
              <span className="flt__n">{n}</span>
            </label>
          );
        })}
        {list.length === 0 && <div className="flt__hint">No matching values.</div>}
      </div>
    </>
  );
}
