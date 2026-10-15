import { DirectionToggle, FieldPicker, RuleRows, newRuleId, type PickField } from './FieldRules';
import { PresetBar, type PresetItem } from './PresetBar';
import { removeUserPreset, saveUserPreset, useUserPresetsStore } from '../../state/userPresetsStore';
import { InfoTip } from '../InfoTip';

export interface SortRule {
  id: string;
  field: string;
  direction: 'up' | 'down';
}

/** One-click sorts, used when their fields exist (Programmes). */
type SortKey = { field: string; direction: 'up' | 'down' };
const PRESETS: { label: string; rules: { field: string; direction: 'up' | 'down' }[] }[] = [
  { label: 'Start', rules: [{ field: 'start', direction: 'up' }] },
  { label: 'Finish', rules: [{ field: 'finish', direction: 'up' }] },
  { label: 'Activity ID', rules: [{ field: 'code', direction: 'up' }] },
  { label: 'Total float', rules: [{ field: 'floatDays', direction: 'up' }, { field: 'start', direction: 'up' }] },
];

interface SortPanelProps {
  /** Fields that can be sorted on (the schedule's column catalog). */
  fields: PickField[];
  rules: SortRule[];
  onChange: (rules: SortRule[]) => void;
  onClose: () => void;
  width?: number;
  /** Renders just the inner content (no aside wrapper, header or close
      button) for embedding inside a Configuration tab. */
  bare?: boolean;
  /** One-click sorts (default: the Programmes').  */
  presets?: { label: string; rules: { field: string; direction: 'up' | 'down' }[] }[];
}

/** Sort: the sort keys in order (drag or ↑ ↓; the first decides, the next
    ones break ties), A→Z / Z→A each, then every field to add a key from —
    the same way the Columns tab works. */
export function SortPanel({ fields, rules, onChange, onClose, width, bare = false, presets: offered = PRESETS }: SortPanelProps) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const used = new Set(rules.map((r) => r.field));
  const update = (id: string, patch: Partial<SortRule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const pick = (f: PickField) => {
    if (used.has(f.id)) return;
    onChange([...rules, { id: newRuleId('sort'), field: f.id, direction: 'up' }]);
  };
  const presets = offered.filter((p) => p.rules.every((r) => byId.has(r.field)));
  const saved = useUserPresetsStore((st) => st.presets).filter((p) => p.kind === 'sort' && (p.data as SortKey[]).every((r) => byId.has(r.field)));
  const sortItems: PresetItem[] = [...presets.map((p) => ({ id: p.label, label: p.label })), ...saved.map((p) => ({ id: p.id, label: p.name, user: true }))];

  const body = (
    <div className="cols">
      <PresetBar
        noun="sort"
        items={sortItems}
        saveDisabled={rules.length === 0}
        onApply={(id) => {
          const keys = sortItems.find((i) => i.id === id)?.user ? (saved.find((p) => p.id === id)?.data as SortKey[] | undefined) : presets.find((p) => p.label === id)?.rules;
          if (keys) onChange(keys.map((r) => ({ id: newRuleId('sort'), ...r })));
        }}
        onSave={(name) => saveUserPreset('sort', name, rules.map((r) => ({ field: r.field, direction: r.direction })))}
        onDelete={removeUserPreset}
      />

      <div className="cols__heading">
        <span>
          Sorted by <b>{rules.length}</b>{' '}
          <InfoTip>The first field decides the order; the next ones only break ties. Drag or use ↑ ↓ to change which comes first. Sorting turns off dragging rows in Scenarios.</InfoTip>
        </span>
        {rules.length > 0 && <button type="button" className="cols__link" onClick={() => onChange([])}>Clear all</button>}
      </div>
      <RuleRows grid={{ key: 'sort', columns: [{ label: 'Field' }, { label: 'Order', width: 96 }] }} rules={rules} onChange={onChange} empty="Not sorted: pick a field below.">
        {(r) => (
          <>
            <span className="rgrid__cell rgrid__cell--grow" title={byId.get(r.field)?.label ?? r.field}>{byId.get(r.field)?.label ?? r.field}</span>
            <span className="rgrid__cell rgrid__cell--op"><DirectionToggle value={r.direction} onChange={(direction) => update(r.id, { direction })} /></span>
          </>
        )}
      </RuleRows>

      <div className="cols__heading"><span>Available fields <b>{fields.length}</b></span></div>
      <FieldPicker catalog={fields} picked={used} onPick={pick} />
    </div>
  );

  if (bare) return body;

  return (
    <aside className="sort-panel" style={width ? { width } : undefined}>
      <div className="filter-sidebar-header">
        <span>Sort</span>
        <button className="icon-btn" onClick={onClose} title="Close">{'✕'}</button>
      </div>
      {body}
    </aside>
  );
}
