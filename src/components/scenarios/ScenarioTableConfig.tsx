import { useFocusStore, type FocusColourMode } from '../../state/focusStore';
import { GroupPanel } from '../schedule/GroupPanel';
import { SortPanel } from '../schedule/SortPanel';
import { SCN_OPS, type ScnColorRule, type ScnFilterRule, type ScnOp, type ScnTableConfig } from '../../scenarios/tableView';
import { InfoTip } from '../InfoTip';
import { ColumnsPanel } from '../schedule/ColumnsPanel';

type Field = { id: string; label: string };
const newId = () => crypto.randomUUID();
const SWATCHES = ['', '#f6b8cb', '#aecbf2', '#b9e6b0', '#f5e79c', '#f6b3a9', '#d9dde0'];

export type ScnConfigTab = 'columns' | 'filters' | 'group' | 'sort' | 'color';

export function scnTabBadges(cfg: ScnTableConfig, allColumns: Field[]): Record<ScnConfigTab, number> {
  return {
    columns: (cfg.columns ?? allColumns.map((c) => c.id)).length,
    filters: cfg.filters.filter((f) => f.field).length,
    group: cfg.groups.length,
    sort: cfg.sorts.length,
    color: cfg.colors.filter((c) => c.color).length,
  };
}

/** Body of one Scenarios Configuration tab (Columns / Filters / Group / Sort
    / Color), same look as the Programmes table's Configuration. */
export function ScenarioTableConfig({
  tab,
  cfg,
  onChange,
  fields,
  defaultColumns,
  onCollapseAll,
  onExpandAll,
}: {
  tab: ScnConfigTab;
  cfg: ScnTableConfig;
  onChange: (next: ScnTableConfig) => void;
  fields: Field[];
  defaultColumns: string[];
  onCollapseAll: () => void;
  onExpandAll: () => void;
}) {
  const patch = (p: Partial<ScnTableConfig>) => onChange({ ...cfg, ...p });
  if (tab === 'columns') return <ColumnsTab cfg={cfg} patch={patch} fields={fields} defaultColumns={defaultColumns} />;
  if (tab === 'filters') return <RulesTab rules={cfg.filters} fields={fields} onChange={(filters) => patch({ filters })} addLabel="+ Add filter" hint="Rows must meet every filter." />;
  if (tab === 'group')
    return (
      <>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 0', fontSize: 12 }}>
          Order groups by
          <select value={cfg.groupOrder ?? 'name'} onChange={(e) => patch({ groupOrder: e.target.value as 'name' | 'maxStep' })} title="A↑ / A↓ on each group level sets the direction">
            <option value="name">Name</option>
            <option value="maxStep">Max step</option>
          </select>
        </label>
        <GroupPanel bare fields={fields} rules={cfg.groups} onChange={(groups) => patch({ groups })} onClose={() => {}} onCollapseAll={onCollapseAll} onExpandAll={onExpandAll} />
      </>
    );
  if (tab === 'sort') return <SortPanel bare fields={fields} rules={cfg.sorts} onChange={(sorts) => patch({ sorts })} onClose={() => {}} />;
  return (
    <>
      <FocusColourOptions />
      <RulesTab rules={cfg.colors} fields={fields} onChange={(colors) => patch({ colors: colors as ScnColorRule[] })} addLabel="+ Add rule" hint="First matching rule colours the row." withColor />
    </>
  );
}

/** How Focus (Scenarios toolbar) colours the focused pours, in 3D and in their rows. */
function FocusColourOptions() {
  const mode = useFocusStore((s) => s.colourMode);
  const setMode = useFocusStore((s) => s.setColourMode);
  const options: [FocusColourMode, string][] = [['random', 'Random colour per pour'], ['original', "The model's own colours"]];
  return (
    <div style={{ padding: '10px 12px 6px', fontSize: 12 }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Focus colours</div>
      {options.map(([id, label]) => (
        <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', cursor: 'pointer' }}>
          <input type="radio" name="focus-colours" checked={mode === id} onChange={() => setMode(id)} />
          {label}
        </label>
      ))}
      <div style={{ color: 'var(--text-dim)', marginTop: 4 }}>While Focus is on, the focused pours and their rows get these colours.</div>
    </div>
  );
}

/** The pour table's columns, grouped for the picker. */
const COLUMN_GROUP: [string, RegExp][] = [
  ['Sequence', /^#(step|base|shift)$/i],
  ['Pour', /^(Pour Type|Concrete Stage|Pour Volume m3|Height|Included)$/i],
  ['Location', /^(Level|General Level \d|Building|Building Zone)$/i],
  ['Logic groups', /^Logic Group \d$/i],
  ['Identity', /^(Pour ID|\w+ Pour ID|PlanningProposedPourID|GUID)$/i],
];
const GROUP_ORDER = COLUMN_GROUP.map(([g]) => g);
const groupOf = (f: Field) => COLUMN_GROUP.find(([, re]) => re.test(f.id))?.[0] ?? 'Other';

/** Same picker as the Programmes table and Gantt (schedule/ColumnsPanel),
    plus the scenario table's own saved presets. */
function ColumnsTab({ cfg, patch, fields, defaultColumns }: { cfg: ScnTableConfig; patch: (p: Partial<ScnTableConfig>) => void; fields: Field[]; defaultColumns: string[] }) {
  return (
    <ColumnsPanel
      catalog={fields.map((f) => ({ id: f.id, label: f.label, group: groupOf(f) }))}
      views={[{ id: 'pours', label: 'Order', selected: cfg.columns ?? defaultColumns, defaults: defaultColumns, onChange: (columns) => patch({ columns }) }]}
      presets={cfg.presets.map((p) => ({ id: p.name, label: p.name, ids: p.columns }))}
      groupOrder={GROUP_ORDER}
      closedGroups={[]}
      onSavePreset={(name, columns) => patch({ presets: [...cfg.presets.filter((p) => p.name !== name), { name, columns }] })}
      onDeletePreset={(name) => patch({ presets: cfg.presets.filter((p) => p.name !== name) })}
    />
  );
}

function RulesTab({
  rules,
  fields,
  onChange,
  addLabel,
  hint,
  withColor,
}: {
  rules: (ScnFilterRule | ScnColorRule)[];
  fields: Field[];
  onChange: (rules: (ScnFilterRule | ScnColorRule)[]) => void;
  addLabel: string;
  hint: string;
  withColor?: boolean;
}) {
  const update = (id: string, p: Partial<ScnColorRule>) => onChange(rules.map((r) => (r.id === id ? { ...r, ...p } : r)));
  return (
    <div className="disp">
      {rules.map((r) => {
        const needsValue = SCN_OPS.find((o) => o.id === r.op)?.needsValue;
        return (
          <div className="scn-rule" key={r.id}>
            <button className="rule-row__remove" type="button" onClick={() => onChange(rules.filter((x) => x.id !== r.id))} title="Remove">✕</button>
            <select value={r.field} onChange={(e) => update(r.id, { field: e.target.value })}>
              {fields.map((f) => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            <select value={r.op} onChange={(e) => update(r.id, { op: e.target.value as ScnOp })}>
              {SCN_OPS.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
            {needsValue && <input value={r.value} onChange={(e) => update(r.id, { value: e.target.value })} placeholder="value" />}
            {withColor && (
              <div className="color-rule__swatches">
                {SWATCHES.map((c) => (
                  <button
                    key={c || 'none'}
                    type="button"
                    className={`color-swatch${(r as ScnColorRule).color === (c || null) ? ' active' : ''}${c === '' ? ' color-swatch--none' : ''}`}
                    style={c ? { background: c } : undefined}
                    onClick={() => update(r.id, { color: c || null })}
                    aria-label={c ? `Colour ${c}` : 'No colour'}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      <div className="info-tip-row">
        <button
          className="sort-panel__add"
          type="button"
          onClick={() => onChange([...rules, withColor ? { id: newId(), field: fields[0]?.id ?? '', op: 'equals', value: '', color: SWATCHES[1] } : { id: newId(), field: fields[0]?.id ?? '', op: 'contains', value: '' }])}
        >
          {addLabel}
        </button>
        <InfoTip>{hint}</InfoTip>
      </div>
    </div>
  );
}
