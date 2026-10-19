import { useListLevel, useTableSearchStore } from '../state/tableSearchStore';
import { useMemo, useState } from 'react';
import type { ElementSummary } from '../viewer/types';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { COL_CLASS, COL_MODEL, COL_NAME, TWIN_PREFIX, useDataTableStore } from '../state/dataTableStore';
import { useTwin } from './useTwin';
import { SEVERAL } from '../viewer/twinMatch';
import { ATTRIBUTES, elementValue } from '../viewer/bimTables';
import { conditionTest, SEARCH_OPS, type SearchCondition } from '../viewer/searchSets';
import { PresetBar } from './schedule/PresetBar';
import { combineTests } from '../viewer/filterLogic';
import { ColumnsPanel } from './schedule/ColumnsPanel';
import { GroupPanel } from './schedule/GroupPanel';
import { ColorPanel } from './schedule/ColorPanel';
import { newRuleId, type PickField } from './schedule/FieldRules';
import { FilterRules, LogicRow } from './FilterRules';
import { ConditionEditor } from './SearchSetsPanel';
import { useIndexTick, useModelFields } from './modelFields';
import { InfoTip } from './InfoTip';
import { ListConfig } from './ListConfig';
import { useVirtualFieldList } from './useVirtualFields';
import { FEATURES } from '../features';
import { pseudoObjects, useExternalTable } from '../datasources/externalRows';
import { DataSourcesTab } from '../datasources/DataSourcesBlock';
import { DataLinkSetup, LinkTriggersBlock } from '../datasources/DataLink';

const DEFAULT_COLUMNS = [COL_NAME, COL_CLASS, COL_MODEL];

/** The Data table's setup (presets, twin models, Columns, Filters, Group, Sort, Colour) for the shared List setup panel, given through
    ListConfig. Mounted with the table, so it is there whether or not the panel is up. */
export function DataTableListConfig() {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const tick = useIndexTick();
  const store = useDataTableStore();
  const { columns, setColumns, filters, filterMatch, groupRules, sortRules, colorRules, patch } = store;
  // The fields in use stay offered even if they were left out in Show / hide properties.
  const inUse = useMemo(() => [...columns, ...filters.map((f) => f.field), ...groupRules.map((r) => r.field), ...sortRules.map((r) => r.field), ...colorRules.map((r) => r.field)], [columns, filters, groupRules, sortRules, colorRules]);
  const modelFields = useModelFields(inUse);
  const scope = useDataTableStore((s) => s.scope);
  // External data showing: its columns are the properties, one pseudo-object per row (see datasources/externalRows).
  const ext = useExternalTable(scope);
  const extObjects = useMemo(() => (ext ? pseudoObjects(ext.table, ext.source.name) : null), [ext?.table, ext?.source.name]); // eslint-disable-line react-hooks/exhaustive-deps
  // Besides the properties: the search / selection set folders and the Link Group of each object.
  const virtualFields = useVirtualFieldList();
  const baseFields = useMemo<PickField[]>(() => (ext ? ext.table.columns.map((c) => ({ id: c, label: c, group: ext.source.name })) : [...modelFields, ...virtualFields]), [ext?.table, ext?.source.name, modelFields, virtualFields]); // eslint-disable-line react-hooks/exhaustive-deps
  const twin = useTwin();
  // With a twin model, every property of its objects can be a column, filter, group, sort key or colour too.
  const fields = useMemo(() => {
    if (ext || !twin.active) return baseFields;
    const keys = new Set<string>();
    for (const e of engine.getIndexes().get(twin.b!.modelId)?.elements.values() ?? []) for (const k of Object.keys(e.props)) keys.add(k);
    const own = baseFields.filter((f) => (f.group === ATTRIBUTES ? f.id !== `${ATTRIBUTES}.Model` : keys.has(f.id)));
    return [...baseFields, ...own.map((f) => ({ ...f, id: TWIN_PREFIX + f.id, label: `Twin · ${f.label}`, group: `Twin · ${f.group ?? 'Other'}` }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseFields, twin.active, twin.b]);

  // Twin layout of the Columns tab: each property with the main model's and the twin's checkbox.
  const twinColumns = useMemo(() => {
    if (ext || !twin.active) return null;
    const keysOf = (modelId: string) => {
      const keys = new Set<string>();
      for (const e of engine.getIndexes().get(modelId)?.elements.values() ?? []) for (const k of Object.keys(e.props)) keys.add(k);
      return keys;
    };
    const a = keysOf(twin.a!.modelId);
    const b = keysOf(twin.b!.modelId);
    const isAttr = (id: string) => id.startsWith(`${ATTRIBUTES}.`);
    const hasOwn = (id: string) => (isAttr(id) ? true : a.has(id));
    const hasTwin = (id: string) => (isAttr(id) ? id !== `${ATTRIBUTES}.Model` : b.has(id));
    const listed = baseFields.filter((f) => hasOwn(f.id) || hasTwin(f.id));
    return { listed, hasOwn, twinOf: (id: string) => (hasTwin(id) ? TWIN_PREFIX + id : null) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [twin.active, twin.a, twin.b, baseFields, tick]);

  const valuesOf = useMemo(() => {
    const cache = new Map<string, { value: string; count: number }[]>();
    return (field: string) => {
      let list = cache.get(field);
      if (!list) {
        const counts = new Map<string, number>();
        if (extObjects) {
          for (const e of extObjects) { const v = elementValue(e, field); counts.set(v, (counts.get(v) ?? 0) + 1); }
          list = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
          cache.set(field, list);
          return list;
        }
        const isTwin = field.startsWith(TWIN_PREFIX);
        const key = isTwin ? field.slice(TWIN_PREFIX.length) : field;
        const indexes = isTwin ? [engine.getIndexes().get(twin.b?.modelId ?? '')].filter((x) => !!x) : [...engine.getIndexes().values()];
        for (const index of indexes) for (const e of index!.elements.values()) {
          const v = elementValue(e, key);
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        list = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
        cache.set(field, list);
      }
      return list;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, models, tick, twin.b, extObjects]);

  const level = useListLevel('datatable');
  const badges = { columns: columns.length, filters: filters.filter((c) => conditionTest(c)).length, group: groupRules.length, sort: sortRules.length, color: colorRules.length };
  return (
    <ListConfig
      id="datatable"
      searchable
      level={groupRules.length === 0 ? undefined : { value: level, max: groupRules.length - 1, set: (v) => useTableSearchStore.getState().setListLevel('datatable', v) }}
      label="Data table"
      badges={badges}
      extra={ext ? <LinkTriggersBlock /> : <><PresetsRow /><TwinBlock twin={twin} /></>}
      panels={{
        source: FEATURES.dataSources ? <DataSourcesTab /> : undefined,
        match: ext ? <DataLinkSetup sourceId={ext.source.id} tableName={ext.name} table={ext.table} groups={ext.groups} /> : undefined,
        columns: (
          <ColumnsPanel
            catalog={fields.map((f) => ({ id: f.id, label: f.label, group: f.group ?? 'Other' }))}
            listed={twinColumns?.listed.map((f) => ({ id: f.id, label: f.label, group: f.group ?? 'Other' }))}
            twin={twinColumns ? { titles: ['Main model', 'Twin'], hints: [twin.a!.name, twin.b!.name], twinOf: twinColumns.twinOf, hasOwn: twinColumns.hasOwn } : undefined}
            views={[{ id: 'table', label: 'Data table', selected: columns, defaults: ext ? ext.table.columns : DEFAULT_COLUMNS, onChange: setColumns }]}
            presets={[]}
            sort={{ rules: sortRules, onChange: (r) => patch({ sortRules: r }) }}
            groupOrder={[ATTRIBUTES]}
            closedGroups={[]}
          />
        ),
        filters: <FiltersTab fields={fields} filters={filters} match={filterMatch} logic={store.filterLogic} onChange={(pp) => patch(pp)} objects={extObjects} />,
        group: <GroupPanel bare fields={fields} rules={groupRules} onChange={(r) => patch({ groupRules: r })} onClose={() => {}} onCollapseAll={() => store.setGroupsCollapsed(true)} onExpandAll={() => store.setGroupsCollapsed(false)} />,
        color: <ColorPanel bare fields={fields} valuesOf={valuesOf} rules={colorRules} onChange={(r) => patch({ colorRules: r })} onClose={() => {}} />,
      }}
    />
  );
}

/** Presets: the whole setup of the table (columns, widths, filters, groups,
    sorting, colours, totals, scope and twin models) kept under a name. */
function PresetsRow() {
  const { presets, savePreset, applyPreset, removePreset } = useDataTableStore();
  const [picked, setPicked] = useState('');
  const save = () => {
    const current = presets.find((p) => p.id === picked);
    const name = window.prompt('Save the table setup as a preset named:', current?.name ?? `Table ${presets.length + 1}`)?.trim();
    if (!name) return;
    if (presets.some((p) => p.name === name && p.id !== picked) && !window.confirm(`Replace the preset "${name}"?`)) return;
    savePreset(name);
    setPicked('');
  };
  return (
    <div className="dtp__sets dtp__presets">
      <select value={picked} onChange={(e) => { setPicked(e.target.value); if (e.target.value) applyPreset(e.target.value); }} disabled={presets.length === 0} title="Load a saved table setup">
        <option value="">{presets.length ? 'Preset…' : 'No presets yet'}</option>
        {presets.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button type="button" className="btn btn--small" onClick={save} title="Keep the table as it is now (columns, filters, groups, sorting, colours, totals, twin models) as a preset">Save as…</button>
      <button type="button" className="btn btn--small" disabled={!picked} onClick={() => { const p = presets.find((x) => x.id === picked); if (p && window.confirm(`Delete the preset "${p.name}"?`)) { removePreset(p.id); setPicked(''); } }}>Delete</button>
      <InfoTip>A preset keeps the table's whole setup: columns and their widths, filters, grouping, sorting, row colours, totals, which objects are listed and the twin models. Choosing one replaces the table's setup.</InfoTip>
    </div>
  );
}

/** Twin models: two models that share geometry but no properties. The table
    lists the primary model's objects; each one's twin (the object of the
    other model in the same place) is there as "Twin" columns. */
function TwinBlock({ twin }: { twin: ReturnType<typeof useTwin> }) {
  const models = useModelsStore((s) => s.models);
  const setup = useDataTableStore((s) => s.twin);
  const patch = useDataTableStore((s) => s.patch);
  const set = (p: Partial<typeof setup>) => patch({ twin: { ...setup, ...p } });
  const counts = useMemo(() => {
    if (!twin.map || !twin.a) return null;
    let several = 0;
    let matched = 0;
    for (const v of twin.map.values()) {
      if (v === SEVERAL) several++;
      else matched++;
    }
    return { matched, several, none: twin.a.elements.length - matched - several };
  }, [twin.map, twin.a]);
  return (
    <div className="dtp__twin">
      <div className="cols__heading"><span>Twin model</span></div>
      <label className="ss__import-field">Table lists the objects of
        <select value={setup.primary ?? ''} onChange={(e) => set({ primary: e.target.value || null })}>
          <option value="">(all models, no twin)</option>
          {models.map((m) => <option key={m.modelId} value={m.name}>{m.name}</option>)}
        </select>
      </label>
      <label className="ss__import-field">Twin model (same geometry)
        <select value={setup.twin ?? ''} onChange={(e) => set({ twin: e.target.value || null })}>
          <option value="">(none)</option>
          {models.filter((m) => m.name !== setup.primary).map((m) => <option key={m.modelId} value={m.name}>{m.name}</option>)}
        </select>
      </label>
      <label className="ss__import-field">Tolerance (m): boxes must agree on every side within
        <input type="number" min={0.0001} step={0.005} value={setup.tolerance} onChange={(e) => set({ tolerance: Math.max(0.0001, Number(e.target.value) || 0.01) })} />
      </label>
      {twin.active && (
        <div className="flt__hint">
          {twin.busy || !counts
            ? 'Matching objects by geometry…'
            : `${counts.matched.toLocaleString()} of ${twin.a!.elements.length.toLocaleString()} objects have a twin${counts.several ? `, ${counts.several.toLocaleString()} have several possible (left blank)` : ''}${counts.none ? `, ${counts.none.toLocaleString()} have none` : ''}. Add the Twin properties in Columns.`}
        </div>
      )}
    </div>
  );
}

/** Filters: conditions a row must meet — the same conditions as Search
    sets, so a filter can be saved as one (and a set loaded as the filter). */
function FiltersTab({ fields, filters, match, logic, onChange, objects }: {
  /** External data showing: its rows as pseudo-objects (the counts are over those, not the model). */
  objects: ElementSummary[] | null;
  fields: PickField[];
  filters: SearchCondition[];
  match: 'all' | 'any';
  /** The formula over the rule numbers; empty: all / any of them. */
  logic: string;
  onChange: (p: { filters?: SearchCondition[]; filterMatch?: 'all' | 'any'; filterLogic?: string }) => void;
}) {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const tick = useIndexTick();
  const savedFilters = useDataTableStore((st) => st.savedFilters);
  const { saveFilter, removeFilter } = useDataTableStore.getState();
  const byId = new Map(fields.map((f) => [f.id, f]));
  const total = useMemo(() => {
    if (objects) return objects.length;
    let n = 0;
    for (const index of engine.getIndexes().values()) n += index.elements.size;
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, models, tick, objects]);
  const matched = useMemo(
    () => {
      const keep = combineTests(filters.map((c) => conditionTest(c)), match, logic);
      if (!keep) return total;
      let n = 0;
      if (objects) {
        for (const e of objects) if (keep(e)) n++;
        return n;
      }
      for (const index of engine.getIndexes().values()) for (const e of index.elements.values()) if (keep(e)) n++;
      return n;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, filters, match, logic, models, tick, total, objects],
  );
  const setFilters = (next: SearchCondition[]) => onChange({ filters: next });
  const patchCondition = (id: string, p: Partial<SearchCondition>) => setFilters(filters.map((c) => (c.id === id ? { ...c, ...p } : c)));
  // The condition being edited under the summary table (a new one opens at once).
  const [editing, setEditing] = useState<string | null>(null);
  const add = (f: PickField) => {
    const c: SearchCondition = { id: newRuleId('c'), field: f.id, op: 'anyOf', value: '', values: [] };
    setFilters([...filters, c]);
    setEditing(c.id);
  };
  const active = filters.filter((c) => conditionTest(c)).length;
  const labelOf = (id: string) => byId.get(id)?.label ?? id;
  /** A condition in a few words: how it compares, and with what. */
  const summaryOf = (c: SearchCondition) => {
    const picked = c.values?.length ? c.values.join(', ') : c.value;
    const op = SEARCH_OPS.find((o) => o.op === c.op)?.label ?? '';
    return [op, c.op === 'between' && c.value2 ? `${c.value} – ${c.value2}` : picked].filter(Boolean).join(' ');
  };
  const noun = objects ? 'rows' : 'objects';
  const hint = total === 0
    ? <div className="flt__hint">{objects ? 'This table has no rows.' : 'Load a model to filter its objects.'}</div>
    : active > 0 ? <div className="flt__hint"><b>{matched.toLocaleString()}</b> of {total.toLocaleString()} {noun}{matched === 0 && <span className="flt__none"> — no matches</span>}</div> : null;
  const editingCondition = filters.find((c) => c.id === editing);
  return (
    <FilterRules
      presets={(
        <PresetBar
          noun="filter"
          items={savedFilters.map((f) => ({ id: f.id, label: f.name, user: true }))}
          saveDisabled={active === 0}
          onApply={(id) => {
            const f = savedFilters.find((x) => x.id === id);
            if (f) onChange({ filters: f.filters.map((c) => ({ ...c, id: newRuleId('c') })), filterMatch: f.match, filterLogic: f.logic ?? '' });
          }}
          onSave={(name) => saveFilter(name, match, filters, logic)}
          onDelete={removeFilter}
        />
      )}
      tip="Conditions a row must meet. The search box in the header and the per-column boxes in the table filter on top of these."
      hint={hint}
      rows={filters.map((c) => ({ id: c.id, field: labelOf(c.field), summary: summaryOf(c), dim: !conditionTest(c) }))}
      onRemove={(id) => setFilters(filters.filter((c) => c.id !== id))}
      onReorder={(ids) => setFilters(ids.map((id) => filters.find((c) => c.id === id)!))}
      onClearAll={() => setFilters([])}
      editingId={editing}
      onEdit={setEditing}
      editor={editingCondition && <ConditionEditor key={editingCondition.id} condition={editingCondition} field={byId.get(editingCondition.field)} fields={fields} onChange={(p) => patchCondition(editingCondition.id, p)} />}
      combine={<LogicRow count={filters.length} match={match} logic={logic} onChange={(p) => onChange({ ...(p.match ? { filterMatch: p.match } : {}), ...(p.logic !== undefined ? { filterLogic: p.logic } : {}) })} />}
      fields={fields}
      picked={new Set(filters.map((c) => c.field))}
      onPick={add}
    />
  );
}
