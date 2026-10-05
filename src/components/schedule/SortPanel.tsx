import { DirectionToggle, FieldPicker, RuleRows, newRuleId, type PickField } from './FieldRules';
import { InfoTip } from '../InfoTip';

export interface SortRule {
  id: string;
  field: string;
  direction: 'up' | 'down';
}

/** One-click sorts, used when their fields exist (Programmes). */
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

  const body = (
    <div className="cols">
      {presets.length > 0 && (
        <div className="cols__presets">
          <span className="cols__hint">Presets</span>
          {presets.map((p) => (
            <button key={p.label} type="button" onClick={() => onChange(p.rules.map((r) => ({ id: newRuleId('sort'), ...r })))}>{p.label}</button>
          ))}
        </div>
      )}

      <div className="cols__heading">
        <span>
          Sorted by <b>{rules.length}</b>{' '}
          <InfoTip>The first field decides the order; the next ones only break ties. Drag or use ↑ ↓ to change which comes first. Sorting turns off dragging rows in Scenarios.</InfoTip>
        </span>
        {rules.length > 0 && <button type="button" className="cols__link" onClick={() => onChange([])}>Clear all</button>}
      </div>
      <RuleRows rules={rules} onChange={onChange} empty="Not sorted: pick a field below.">
        {(r, i) => (
          <>
            <span className="rule-item__level">{i + 1}</span>
            <span className="cols__label" title={byId.get(r.field)?.label ?? r.field}>{byId.get(r.field)?.label ?? r.field}</span>
            <DirectionToggle value={r.direction} onChange={(direction) => update(r.id, { direction })} />
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
