import { useMemo, useState } from 'react';
import type { ElementSummary } from '../viewer/types';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { COL_CLASS, COL_MODEL, COL_NAME, TWIN_PREFIX, useDataTableStore } from '../state/dataTableStore';
import { useTwin } from './useTwin';
import { SEVERAL } from '../viewer/twinMatch';
import { useSearchSetsStore } from '../state/searchSetsStore';
import { ATTRIBUTES, elementValue } from '../viewer/bimTables';
import { conditionTest, countIds, runSearchSet, SEARCH_OPS, type SearchCondition } from '../viewer/searchSets';
import { FilterShell, type FilterChip } from './FilterShell';
import { ColumnsPanel } from './schedule/ColumnsPanel';
import { GroupPanel } from './schedule/GroupPanel';
import { SortPanel } from './schedule/SortPanel';
import { ColorPanel } from './schedule/ColorPanel';
import { FieldPicker, RuleRows, newRuleId, type PickField } from './schedule/FieldRules';
import { ConditionEditor } from './SearchSetsPanel';
import { useIndexTick, useModelFields } from './modelFields';
import { InfoTip } from './InfoTip';
import { ListConfig } from './ListConfig';
import { FEATURES } from '../features';
import { pseudoObjects, useExternalTable } from '../datasources/externalRows';
import { DataSourcesBlock } from '../datasources/DataSourcesBlock';

const DEFAULT_COLUMNS = [COL_NAME, COL_CLASS, COL_MODEL];

/** The Data table's setup (presets, twin models, Columns, Filters, Group, Sort, Colour) for the shared List setup panel, given through
    ListConfig. Mounted with the table, so it is there whether or not the panel is up. */
export function DataTableListConfig() {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const tick = useIndexTick();
  const store = useDataTableStore();
  const { columns, setColumns, filters, filterMatch, groupRules, sortRules, colorRules, patch } = store;
  const modelFields = useModelFields();
  const scope = useDataTableStore((s) => s.scope);
  // External data showing: its columns are the properties, one pseudo-object per row (see datasources/externalRows).
  const ext = useExternalTable(scope);
  const extObjects = useMemo(() => (ext ? pseudoObjects(ext.table, ext.source.name) : null), [ext?.table, ext?.source.name]); // eslint-disable-line react-hooks/exhaustive-deps
  const baseFields = useMemo<PickField[]>(() => (ext ? ext.table.columns.map((c) => ({ id: c, label: c, group: ext.source.name })) : modelFields), [ext?.table, ext?.source.name, modelFields]); // eslint-disable-line react-hooks/exhaustive-deps
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

  const badges = { columns: columns.length, filters: filters.filter((c) => conditionTest(c)).length, group: groupRules.length, sort: sortRules.length, color: colorRules.length };
  return (
    <ListConfig
      id="datatable"
      searchable
      label="Data table"
      badges={badges}
      extra={<>{!ext && <PresetsRow />}{!ext && <TwinBlock twin={twin} />}{FEATURES.dataSources && <DataSourcesBlock />}</>}
      panels={{
        columns: (
          <ColumnsPanel
            catalog={fields.map((f) => ({ id: f.id, label: f.label, group: f.group ?? 'Other' }))}
            listed={twinColumns?.listed.map((f) => ({ id: f.id, label: f.label, group: f.group ?? 'Other' }))}
            twin={twinColumns ? { titles: ['Main model', 'Twin'], hints: [twin.a!.name, twin.b!.name], twinOf: twinColumns.twinOf, hasOwn: twinColumns.hasOwn } : undefined}
            views={[{ id: 'table', label: 'Data table', selected: columns, defaults: ext ? ext.table.columns : DEFAULT_COLUMNS, onChange: setColumns }]}
            presets={[]}
            groupOrder={[ATTRIBUTES]}
            closedGroups={[]}
          />
        ),
        filters: <FiltersTab fields={fields} filters={filters} match={filterMatch} onChange={(pp) => patch(pp)} objects={extObjects} />,
        group: <GroupPanel bare fields={fields} rules={groupRules} onChange={(r) => patch({ groupRules: r })} onClose={() => {}} onCollapseAll={() => store.setGroupsCollapsed(true)} onExpandAll={() => store.setGroupsCollapsed(false)} />,
        sort: <SortPanel bare fields={fields} rules={sortRules} onChange={(r) => patch({ sortRules: r })} onClose={() => {}} />,
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
function FiltersTab({ fields, filters, match, onChange, objects }: {
  /** External data showing: its rows as pseudo-objects (the counts are over those, not the model). */
  objects: ElementSummary[] | null;
  fields: PickField[];
  filters: SearchCondition[];
  match: 'all' | 'any';
  onChange: (p: { filters?: SearchCondition[]; filterMatch?: 'all' | 'any' }) => void;
}) {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const tick = useIndexTick();
  const { sets, save } = useSearchSetsStore();
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
      if (!filters.some((c) => conditionTest(c))) return total;
      if (objects) {
        const tests = filters.map((c) => conditionTest(c)).filter((t): t is (e: ElementSummary) => boolean => t !== null);
        return objects.filter((e) => (match === 'all' ? tests.every((t) => t(e)) : tests.some((t) => t(e)))).length;
      }
      return countIds(runSearchSet(engine.getIndexes(), { match, conditions: filters }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, filters, match, models, tick, total, objects],
  );
  const setFilters = (next: SearchCondition[]) => onChange({ filters: next });
  const patchCondition = (id: string, p: Partial<SearchCondition>) => setFilters(filters.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const add = (f: PickField) => setFilters([...filters, { id: newRuleId('c'), field: f.id, op: 'anyOf', value: '', values: [] }]);
  const saveAsSet = () => {
    const name = window.prompt('Save the filter as a search set named:', `Data table filter ${sets.length + 1}`)?.trim();
    if (name) save({ id: newRuleId('ss'), name, group: '', match, conditions: filters.map((c) => ({ ...c, id: newRuleId('c') })) });
  };
  const loadSet = (id: string) => {
    const set = sets.find((s) => s.id === id);
    if (set) onChange({ filters: set.conditions.map((c) => ({ ...c, id: newRuleId('c') })), filterMatch: set.match });
  };

  const labelOf = (id: string) => byId.get(id)?.label ?? id;
  const summaryOf = (c: SearchCondition) => {
    const picked = c.values?.length ? c.values.join(', ') : c.value;
    const op = SEARCH_OPS.find((o) => o.op === c.op)?.label ?? '';
    return [op, c.op === 'between' && c.value2 ? `${c.value} – ${c.value2}` : picked].filter(Boolean).join(' ');
  };
  const [builderOpen, setBuilderOpen] = useState(false);
  const chips: FilterChip[] = filters.filter((c) => conditionTest(c)).map((c) => ({
    id: c.id,
    label: labelOf(c.field),
    summary: summaryOf(c),
    onRemove: () => setFilters(filters.filter((x) => x.id !== c.id)),
    onEdit: () => setBuilderOpen(true),
  }));
  return (
    <FilterShell
      className="flt"
      matched={matched}
      total={total}
      noun={objects ? 'rows' : 'objects'}
      emptyHint={objects ? 'This table has no rows.' : 'Load a model to filter its objects.'}
      chips={chips}
      onClearAll={() => setFilters([])}
      combine={(
        <div className="disp__row">
          <span>Rows matching</span>
          <div className="segmented-choice">
            <button type="button" className={match === 'all' ? 'active' : ''} onClick={() => onChange({ filterMatch: 'all' })}>All conditions</button>
            <button type="button" className={match === 'any' ? 'active' : ''} onClick={() => onChange({ filterMatch: 'any' })}>Any condition</button>
          </div>
        </div>
      )}
      presets={(
        <div className="dtp__sets">
          <select value="" onChange={(e) => loadSet(e.target.value)} disabled={sets.length === 0}>
            <option value="">{sets.length ? 'Use a saved filter (search set)…' : 'No saved filters yet'}</option>
            {sets.map((s) => <option key={s.id} value={s.id}>{s.group ? `${s.group} › ${s.name}` : s.name}</option>)}
          </select>
          <button type="button" className="btn btn--small" disabled={!filters.some((c) => conditionTest(c))} onClick={saveAsSet}>Save as…</button>
          <InfoTip>Filters are the same conditions as Search sets: load one as the filter, or keep this filter as a search set. The search box and the per-column boxes in the table filter on top of these.</InfoTip>
        </div>
      )}
      advanced={(
        <>
          <RuleRows rules={filters} onChange={setFilters} empty="No filter yet: pick a property below to add a condition.">
            {(c) => <ConditionEditor condition={c} field={byId.get(c.field)} fields={fields} onChange={(p) => patchCondition(c.id, p)} />}
          </RuleRows>
          <div className="cols__heading"><span>Add a condition</span></div>
          <FieldPicker catalog={fields} picked={new Set(filters.map((c) => c.field))} onPick={add} placeholder="Search properties…" />
        </>
      )}
      advancedOpen={builderOpen}
      onAdvancedOpen={setBuilderOpen}
    />
  );
}
