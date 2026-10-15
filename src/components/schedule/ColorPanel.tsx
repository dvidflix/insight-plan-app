import { useState } from 'react';
import type { Activity } from '../../schedule/types';
import { WBS_PALETTES, wbsPaletteFor } from '../../schedule/wbsPalette';
import { FieldPicker, RuleRows, newRuleId, type PickField } from './FieldRules';
import { InfoTip } from '../InfoTip';
import { HexCell } from '../HexCell';
import { PresetBar, type PresetItem } from './PresetBar';
import { removeUserPreset, saveUserPreset, useUserPresetsStore } from '../../state/userPresetsStore';

export type ColorOp = 'is' | 'contains' | 'starts' | 'empty';

export interface ColorRule {
  id: string;
  field: string;
  /** How the value is compared (missing = 'is', as rules were before). */
  op?: ColorOp;
  value: string;
  color: string | null;
}

const OPS: { id: ColorOp; label: string }[] = [
  { id: 'is', label: 'is' },
  { id: 'contains', label: 'contains' },
  { id: 'starts', label: 'starts with' },
  { id: 'empty', label: 'is empty' },
];

/** The fields colour rules used before they could use any column: still
    matched on their raw values too, so saved rules keep working. */
export const COLOR_RULE_FIELDS: { id: string; label: string; get: (a: Activity) => string }[] = [
  { id: 'code', label: 'Activity ID', get: (a) => a.code },
  { id: 'name', label: 'Name', get: (a) => a.name },
  { id: 'wbsPath', label: 'WBS', get: (a) => a.wbsPath },
  { id: 'status', label: 'Status', get: (a) => a.status },
  { id: 'type', label: 'Type', get: (a) => a.type },
];

const SWATCHES = ['#f6b8cb', '#aecbf2', '#b9e6b0', '#f5e79c', '#f6b3a9', '#d9dde0', '#c9b8f2', '#9fe0dc'];
/** Distinct light colours for "Colour by field". */
const AUTO_COLORS = ['#aecbf2', '#b9e6b0', '#f5e79c', '#f6b8cb', '#c9b8f2', '#9fe0dc', '#f6c89f', '#d9dde0', '#e3c9a8', '#b8e0f6', '#dcf2b8', '#f2b8e6'];
const AUTO_LIMIT = 24;

/** Reads a field's display text for an activity (the column's text). */
export type FieldLookup = (fieldId: string, activity: Activity) => string | undefined;

/** First matching rule (top to bottom) wins; a rule applies once it has a
    colour and a value to compare (except "is empty"). */
export function resolveRuleColor(rules: ColorRule[], activity: Activity, lookup?: FieldLookup): string | null {
  for (const rule of rules) {
    const op = rule.op ?? 'is';
    if (!rule.color || (op !== 'empty' && !rule.value.trim())) continue;
    const legacy = COLOR_RULE_FIELDS.find((f) => f.id === rule.field)?.get(activity);
    const text = (lookup?.(rule.field, activity) ?? legacy ?? '').toLowerCase();
    const raw = legacy?.toLowerCase();
    const v = rule.value.trim().toLowerCase();
    const hit =
      op === 'empty' ? text.trim() === '' :
      op === 'contains' ? text.includes(v) :
      op === 'starts' ? text.startsWith(v) :
      text === v || raw === v;
    if (hit) return rule.color;
  }
  return null;
}

/** resolveRuleColor for any row: `text` reads a field's display text. */
export function matchColorRules(rules: ColorRule[], text: (fieldId: string) => string): string | null {
  for (const rule of rules) {
    const op = rule.op ?? 'is';
    if (!rule.color || (op !== 'empty' && !rule.value.trim())) continue;
    const t = text(rule.field).toLowerCase();
    const v = rule.value.trim().toLowerCase();
    const hit = op === 'empty' ? t.trim() === '' : op === 'contains' ? t.includes(v) : op === 'starts' ? t.startsWith(v) : t === v;
    if (hit) return rule.color;
  }
  return null;
}

interface ColorPanelProps {
  rules: ColorRule[];
  onChange: (rules: ColorRule[]) => void;
  onClose: () => void;
  /** The Gantt's grouping palette; omit both to leave that row out. */
  wbsPalette?: string;
  onWbsPaletteChange?: (id: string) => void;
  /** Fields a rule can test (the schedule's column catalog). */
  fields?: PickField[];
  /** Distinct values of a field, most common first (for suggestions and
      "Colour by field"). */
  valuesOf?: (fieldId: string) => { value: string; count: number }[];
  width?: number;
  /** Renders just the inner content (no aside wrapper, header or close
      button) for embedding inside a Configuration tab. */
  bare?: boolean;
}

/** Color: rules in priority order (the first match colours the row; drag
    or ↑ ↓ to reorder), each a field, a test, a value (suggested from the
    data) and a colour — plus "Colour by field" to make one rule per value. */
export function ColorPanel({ rules, onChange, onClose, wbsPalette, onWbsPaletteChange, fields = COLOR_RULE_FIELDS, valuesOf, width, bare = false }: ColorPanelProps) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const [autoField, setAutoField] = useState('');
  const saved = useUserPresetsStore((st) => st.presets).filter((p) => p.kind === 'color' && (p.data as ColorRule[]).every((r) => byId.has(r.field)));
  const colourItems: PresetItem[] = saved.map((p) => ({ id: p.id, label: p.name, user: true }));
  const update = (id: string, patch: Partial<ColorRule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const addFor = (f: PickField) => onChange([...rules, { id: newRuleId('color'), field: f.id, op: 'is', value: '', color: SWATCHES[rules.length % SWATCHES.length] }]);
  const colourByField = (fieldId: string) => {
    const values = (valuesOf?.(fieldId) ?? []).filter((v) => v.value !== '').slice(0, AUTO_LIMIT);
    onChange(values.map((v, i) => ({ id: newRuleId('color'), field: fieldId, op: 'is', value: v.value, color: AUTO_COLORS[i % AUTO_COLORS.length] })));
  };

  const body = (
    <div className="cols">
      {wbsPalette && onWbsPaletteChange && <div className="color-panel__palette">
        <span className="groupby-panel__title">Grouping palette:</span>
        <select value={wbsPalette} onChange={(e) => onWbsPaletteChange(e.target.value)}>
          {Object.entries(WBS_PALETTES).map(([id, p]) => (
            <option key={id} value={id}>{p.label}</option>
          ))}
        </select>
        <div className="color-panel__palette-swatches">
          {wbsPaletteFor(wbsPalette).colors.slice(0, 8).map((c, i) => (
            <span key={i} className="color-panel__palette-swatch" style={{ background: c }} />
          ))}
        </div>
      </div>}

      <PresetBar
        noun="colouring"
        items={colourItems}
        saveDisabled={rules.length === 0}
        onApply={(id) => {
          const kept = saved.find((p) => p.id === id)?.data as ColorRule[] | undefined;
          if (kept) onChange(kept.map((r) => ({ ...r, id: newRuleId('color') })));
        }}
        onSave={(name) => saveUserPreset('color', name, rules)}
        onDelete={removeUserPreset}
      />

      {valuesOf && (
        <div className="info-tip-row color-auto">
          <select value={autoField} onChange={(e) => setAutoField(e.target.value)}>
            <option value="">Colour by field…</option>
            {fields.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <button type="button" className="btn btn--small primary" disabled={!autoField} onClick={() => colourByField(autoField)}>Apply</button>
          <InfoTip>Replaces the rules with one per value of the field (the {AUTO_LIMIT} most common), each its own colour. Edit or remove any of them after.</InfoTip>
        </div>
      )}

      <div className="cols__heading">
        <span>
          Rules <b>{rules.length}</b>{' '}
          <InfoTip>The first rule that matches colours the row, so order matters: drag or use ↑ ↓. The value box suggests the field's values.</InfoTip>
        </span>
        {rules.length > 0 && <button type="button" className="cols__link" onClick={() => onChange([])}>Clear all</button>}
      </div>
      <RuleRows grid={{ key: 'color', columns: [{ label: 'Field' }, { label: 'Condition', width: 96 }, { label: 'Value' }, { label: 'Colour', width: 56 }] }} rules={rules} onChange={onChange} empty="No colour rules: pick a field below, or colour by field above.">
        {(r) => {
          const op = r.op ?? 'is';
          const listId = `color-values-${r.id}`;
          const suggestions = valuesOf ? valuesOf(r.field).slice(0, 200) : [];
          return (
            <>
              <span className="rgrid__cell rgrid__cell--grow" title={byId.get(r.field)?.label ?? r.field}>{byId.get(r.field)?.label ?? r.field}</span>
              <select className="rgrid__cell rgrid__cell--op" value={op} onChange={(e) => update(r.id, { op: e.target.value as ColorOp })} aria-label="Condition">
                {OPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              {op === 'empty'
                ? <span className="rgrid__cell rgrid__cell--grow" />
                : (
                  <>
                    <input className="rgrid__cell rgrid__cell--grow" placeholder="value" list={listId} value={r.value} onChange={(e) => update(r.id, { value: e.target.value })} aria-label="Value" />
                    <datalist id={listId}>
                      {suggestions.map((s) => <option key={s.value} value={s.value}>{`${s.count}`}</option>)}
                    </datalist>
                  </>
                )}
              <HexCell value={r.color} onChange={(hex) => update(r.id, { color: hex })} />
            </>
          );
        }}
      </RuleRows>

      <div className="cols__heading"><span>Add a rule for… <b>{fields.length}</b></span></div>
      <FieldPicker catalog={fields} picked={new Set()} onPick={addFor} />
    </div>
  );

  if (bare) return body;

  return (
    <aside className="color-panel" style={width ? { width } : undefined}>
      <div className="filter-sidebar-header">
        <span>Color</span>
        <button className="icon-btn" onClick={onClose} title="Close">{'✕'}</button>
      </div>
      {body}
    </aside>
  );
}
