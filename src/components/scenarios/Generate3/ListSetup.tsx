import { useState } from 'react';
import { ListConfig } from '../../ListConfig';
import { FilterRules } from '../../FilterRules';
import { ColorPanel } from '../../schedule/ColorPanel';
import { useListConfigStore } from '../../../state/listConfigStore';
import { PACKAGE_FIELDS, type PackageFacts } from '../../../prs/packageFields';
import { G3_LIST, useG3List, valuesOfField } from './useListView';

/** Generate 3's package list in the List setup panel (N), like every other list: Filter (keep the packages with chosen values of a field) and
    Colour (rules that colour packages in the list, the timeline and 3D). The main header's search box narrows the list too ("Search on Work
    packages"). */

const FIELDS = PACKAGE_FIELDS.map((f) => ({ ...f, group: 'Package' }));

export function PackageListSetup({ facts }: { facts: readonly PackageFacts[] }) {
  const filters = useG3List((s) => s.filters);
  const colorRules = useG3List((s) => s.colorRules);
  const active = Object.values(filters).filter((k) => k.length).length;
  return (
    <ListConfig
      id={G3_LIST}
      label="Work packages"
      searchable
      badges={{ filters: active, color: colorRules.length }}
      panels={{
        filters: <PackageFilters facts={facts} />,
        color: <ColorPanel bare rules={colorRules} onChange={(r) => useG3List.getState().setColorRules(r)} onClose={() => useListConfigStore.getState().setNOpen(false)} fields={FIELDS} valuesOf={(field) => valuesOfField(facts, field)} />,
      }}
    />
  );
}

function PackageFilters({ facts }: { facts: readonly PackageFacts[] }) {
  const filters = useG3List((s) => s.filters);
  const { setFilter, clearFilters } = useG3List.getState();
  const [editing, setEditing] = useState<string | null>(null);
  const [order, setOrder] = useState<string[]>([]);
  const byKey = new Map(FIELDS.map((f) => [f.id, f]));
  const activeIds = new Set(FIELDS.filter((f) => (filters[f.id]?.length ?? 0) > 0).map((f) => f.id));
  const rowIds = [...order.filter((id) => byKey.has(id) && (activeIds.has(id) || id === editing)), ...[...activeIds].filter((id) => !order.includes(id))];
  const summaryOf = (id: string) => { const kept = filters[id] ?? []; return kept.length <= 2 ? kept.join(', ') : `${kept.length} values`; };
  const edited = editing ? byKey.get(editing) : undefined;
  const kept = edited ? filters[edited.id] ?? [] : [];
  return (
    <FilterRules
      tip="Keep only the packages that have one of the chosen values of a field (the packages that hold them stay, dimmed). Click a filter to change its values."
      rows={rowIds.map((id) => ({ id, field: byKey.get(id)!.label, summary: summaryOf(id), dim: !activeIds.has(id) }))}
      onRemove={(id) => { setFilter(id, []); setOrder((o) => o.filter((x) => x !== id)); if (editing === id) setEditing(null); }}
      onReorder={setOrder}
      onClearAll={() => { clearFilters(); setOrder([]); setEditing(null); }}
      editingId={editing}
      onEdit={setEditing}
      editorTitle={edited ? `Edit ${edited.label}` : 'Edit filter'}
      editor={edited && (
        <div className="flt__values">
          {valuesOfField(facts, edited.id).map(({ value, count }) => (
            <label key={value} className="cols__check">
              <input type="checkbox" checked={kept.includes(value)} onChange={() => setFilter(edited.id, kept.includes(value) ? kept.filter((x) => x !== value) : [...kept, value])} />
              <span title={value}>{value}</span>
              <span className="flt__n">{count}</span>
            </label>
          ))}
          {facts.length === 0 && <div className="flt__hint">No packages.</div>}
        </div>
      )}
      combine={<div className="flt__hint">A package must match every filter.</div>}
      fields={FIELDS}
      picked={activeIds}
      onPick={(f) => { setOrder((o) => (o.includes(f.id) ? o : [...o, f.id])); setEditing(f.id); }}
    />
  );
}
