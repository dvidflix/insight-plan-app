import { DirectionToggle, FieldPicker, RuleRows, newRuleId, type PickField } from './FieldRules';
import { InfoTip } from '../InfoTip';
import { ExpandCollapseToggle } from '../ExpandCollapseToggle';

export interface GroupRule {
  id: string;
  field: string;
  direction: 'up' | 'down';
}

interface GroupPanelProps {
  /** Fields that can be grouped on (the schedule's column catalog). */
  fields: PickField[];
  rules: GroupRule[];
  onChange: (rules: GroupRule[]) => void;
  onClose: () => void;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  /** Gantt only: group by the WBS tree while no field rules are set. Omit
      to hide the switch. */
  groupByWbs?: boolean;
  onToggleGroupByWbs?: () => void;
  /** A second switch above the levels (the Inputs list: several levels on one line). */
  extraToggle?: { label: string; tip: string; on: boolean; onToggle: () => void };
  width?: number;
  /** Renders just the inner content (no aside wrapper, header or close
      button) for embedding inside a Configuration tab. */
  bare?: boolean;
  /** One-click groupings; one is hidden when a field it needs is not offered. */
  presets?: { label: string; fields: string[] }[];
}

/** Group: the grouping levels in order (drag or ↑ ↓ to nest differently,
    A→Z / Z→A per level), then every field to add a level from — the same
    way the Columns tab works. */
export function GroupPanel({ fields, rules, onChange, onClose, onCollapseAll, onExpandAll, groupByWbs, onToggleGroupByWbs, extraToggle, width, bare = false, presets: offered = [] }: GroupPanelProps) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const used = new Set(rules.map((r) => r.field));
  const update = (id: string, patch: Partial<GroupRule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const pick = (f: PickField) => {
    if (used.has(f.id)) return;
    onChange([...rules, { id: newRuleId('group'), field: f.id, direction: 'up' }]);
  };

  const presets = offered.filter((p) => p.fields.every((f) => byId.has(f)));

  const body = (
    <div className="cols">
      {presets.length > 0 && (
        <div className="cols__presets">
          <span className="cols__hint">Presets</span>
          {presets.map((p) => (
            <button key={p.label} type="button" onClick={() => onChange(p.fields.map((field) => ({ id: newRuleId('group'), field, direction: 'up' as const })))}>{p.label}</button>
          ))}
        </div>
      )}

      {onToggleGroupByWbs && (
        <div className="disp__row">
          <span>
            Group by WBS{' '}
            <InfoTip>When no fields are picked below, the Gantt groups its rows by the WBS tree. Picked fields replace it.</InfoTip>
          </span>
          <button type="button" role="switch" aria-checked={!!groupByWbs} className={`switch${groupByWbs ? ' on' : ''}`} onClick={onToggleGroupByWbs}>
            <span className="switch__thumb" />
          </button>
        </div>
      )}

      {extraToggle && (
        <div className="disp__row">
          <span>
            {extraToggle.label}{' '}
            <InfoTip>{extraToggle.tip}</InfoTip>
          </span>
          <button type="button" role="switch" aria-checked={extraToggle.on} className={`switch${extraToggle.on ? ' on' : ''}`} onClick={extraToggle.onToggle}>
            <span className="switch__thumb" />
          </button>
        </div>
      )}

      <div className="cols__heading">
        <span>
          Grouped by <b>{rules.length}</b>{' '}
          <InfoTip>Each field is one level of grouping, the first one outermost. Drag or use ↑ ↓ to nest them differently; A→Z / Z→A orders that level's groups.</InfoTip>
        </span>
        {rules.length > 0 && <button type="button" className="cols__link" onClick={() => onChange([])}>Clear all</button>}
      </div>
      <RuleRows rules={rules} onChange={onChange} empty="Not grouped: pick a field below.">
        {(r, i) => (
          <>
            <span className="rule-item__level">{i + 1}</span>
            <span className="cols__label" title={byId.get(r.field)?.label ?? r.field}>{byId.get(r.field)?.label ?? r.field}</span>
            <DirectionToggle value={r.direction} onChange={(direction) => update(r.id, { direction })} />
          </>
        )}
      </RuleRows>
      <div className="rule-actions">
        <ExpandCollapseToggle className="btn btn--small" onCollapse={onCollapseAll} onExpand={onExpandAll} />
      </div>

      <div className="cols__heading"><span>Available fields <b>{fields.length}</b></span></div>
      <FieldPicker catalog={fields} picked={used} onPick={pick} />
    </div>
  );

  if (bare) return body;

  return (
    <aside className="group-panel" style={width ? { width } : undefined}>
      <div className="filter-sidebar-header">
        <span>Group</span>
        <button className="icon-btn" onClick={onClose} title="Close">{'✕'}</button>
      </div>
      {body}
    </aside>
  );
}
