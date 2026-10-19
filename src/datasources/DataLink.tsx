import { useMemo, useState, type ReactNode } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useIndexTick } from '../components/modelFields';
import { InfoTip } from '../components/InfoTip';
import { OPS, SeparatorsEditor } from '../components/sequence/LinkGroupsPanel';
import { IconAddCircleOutline, IconCopy, IconDownload, IconEye, IconEyeOff, IconPencil, IconRemove } from '../components/icons';
import { newId, objectFieldKey, objectFieldLabel, parseObjectFieldKey, type CompareOp, type Conjunction } from '../schedule/linkGroups';
import { samplePropKeys } from '../viewer/query';
import { downloadCsv } from '../utils/csv';
import { computeMatchGroup, emptyMatchGroup, linkTotals, matchPairs, rowValue, suggestRule, type DataMatchRule, type MatchGroup, type ObjectFilterRule, type RowFilterRule } from './matchGroups';
import type { DataTable } from './parsers';
import { useDataSourcesStore } from './store';

/** The triggers between the table and the 3D view, as two directions: each has a switch, and options that go with it. */
const TRIGGER_GROUPS = [
  {
    id: 'toGrid' as const,
    label: '3D → table',
    tip: 'Selecting objects in 3D narrows the table to the rows they match. Reset it with “Show all rows”.',
    options: [{ id: 'selectInGrid' as const, label: 'Select the rows', tip: 'Also select those rows in the table.' }],
  },
  {
    id: 'toModel' as const,
    label: 'Table → 3D',
    tip: 'Selecting rows in the table selects the objects they match in 3D.',
    options: [
      { id: 'reframe' as const, label: 'Zoom to them', tip: 'Also zoom to the objects.' },
      { id: 'isolate' as const, label: 'Isolate them', tip: 'Also show only those objects and hide the rest.' },
    ],
  },
];

/** The Match tab: how the table is coupled to the model, as match groups (as Link Groups pair tasks with objects) with how many rows
    and objects each matches. */
export function DataLinkSetup({ sourceId, tableName, table, groups }: { sourceId: string; tableName: string; table: DataTable; groups: MatchGroup[] }) {
  const engine = useViewerEngine();
  const tick = useIndexTick();
  const [editing, setEditing] = useState<MatchGroup | null>(null);
  const set = (next: MatchGroup[]) => useDataSourcesStore.getState().setGroups(sourceId, tableName, next);

  // Every group evaluated once: its rows and objects (the totals are over the groups that are on).
  const linked = useMemo(() => {
    const byGroup = new Map(groups.map((g) => [g.id, computeMatchGroup(table, engine.getIndexes(), g)]));
    return { byGroup, total: linkTotals(groups.filter((g) => !g.hidden).map((g) => byGroup.get(g.id)!)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, table, engine, tick]);

  const objectKeys = useMemo(() => {
    const keys = new Set<string>(['_guid', '_file']);
    const elements = [...engine.getIndexes().values()].flatMap((i) => [...i.elements.values()]);
    for (const k of samplePropKeys(elements)) keys.add(k);
    for (const g of groups) {
      for (const r of g.objectFilters) keys.add(objectFieldKey(r.propertySet, r.attribute));
      for (const r of g.matchRules) keys.add(objectFieldKey(r.objectPropertySet, r.objectAttribute));
    }
    return [...keys];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, groups, tick]);

  const duplicate = (g: MatchGroup) => {
    const i = groups.findIndex((x) => x.id === g.id);
    set([...groups.slice(0, i + 1), { ...structuredClone(g), id: newId(), name: `${g.name} (copy)` }, ...groups.slice(i + 1)]);
  };
  /** Selects the group's objects in the 3D view (the preview of a Link Group). */
  const preview = (g: MatchGroup) => {
    const l = linked.byGroup.get(g.id);
    if (l && Object.keys(l.objects).length) void engine.selectElements(l.objects, true);
  };
  const exportMatches = () => {
    const rows = matchPairs(table, engine.getIndexes(), groups);
    downloadCsv(
      'data-match-groups.csv',
      ['Group', 'Row', ...table.columns, 'Object GUID', 'Object name', 'Object class'],
      rows.map((r) => [r.group, r.row + 1, ...table.columns.map((c) => rowValue(table, r.row, c)), r.objectGuid, r.objectName, r.objectCategory]),
    );
  };

  if (editing) {
    return (
      <MatchGroupEditor
        group={editing}
        table={table}
        objectKeys={objectKeys}
        onCancel={() => setEditing(null)}
        onDelete={groups.some((x) => x.id === editing.id) ? () => { if (window.confirm(`Delete the match group "${editing.name}"?`)) { set(groups.filter((x) => x.id !== editing.id)); setEditing(null); } } : undefined}
        onSave={(g) => { set(groups.some((x) => x.id === g.id) ? groups.map((x) => (x.id === g.id ? g : x)) : [...groups, g]); setEditing(null); }}
      />
    );
  }

  return (
    <div className="dm-tab">
      <div className="dm-tab__head" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px' }}>
        <span className="dm-tab__title" style={{ flex: 1 }}>Match groups <b>{groups.length}</b> <InfoTip><p>Match groups tell the app which rows of the table and which model objects are the same thing, as Link Groups pair tasks with objects: a group says which rows, which objects, and the rules that pair them (a column equals a property).</p><p>Rules joined with And must all hold; Or starts an alternative. Several groups can couple the same table, for a federated model whose packages name the property differently.</p></InfoTip></span>
        <button type="button" className="mini-btn mini-btn--icon" onClick={exportMatches} disabled={groups.length === 0} title="Export matches (CSV): the matched row / object pairs of every group" aria-label="Export matches (CSV)"><IconDownload width={16} height={16} /></button>
        <button type="button" className="mini-btn mini-btn--icon" onClick={() => setEditing({ ...emptyMatchGroup(), matchRules: [suggestRule(table, objectKeys)] })} title="New match group" aria-label="New match group"><IconAddCircleOutline width={20} height={20} /></button>
      </div>
      {groups.length === 0 && <div className="flt__hint" style={{ padding: 8 }}>No match group yet. A group picks rows and objects, then pairs them by matching a column with a property. Add one with the + above.</div>}
      {groups.length > 0 && (
        <table className="seq-grid">
          <thead>
            <tr>
              <th>Name</th>
              <th className="seq-grid__num" title="Rows of the table that match">Rows</th>
              <th className="seq-grid__num" title="Objects of the models that match">Objects</th>
              <th className="seq-grid__actions" />
            </tr>
          </thead>
          <tbody>
            <tr className="seq-grid__totals" title="Matched by all the groups that are on together (a row or object in several groups counts once)">
              <td className="seq-grid__name">Total <span className="flt__hint" style={{ margin: 0 }}>of {table.rows.length.toLocaleString()} rows</span></td>
              <td className="seq-grid__num">{linked.total.rows.toLocaleString()}</td>
              <td className="seq-grid__num">{linked.total.objects.toLocaleString()}</td>
              <td className="seq-grid__actions" />
            </tr>
            {groups.map((g) => {
              const c = linked.byGroup.get(g.id);
              return (
                <tr key={g.id}>
                  <td className="seq-grid__name" style={g.hidden ? { opacity: 0.5 } : undefined} title={`${g.name} (click to select its objects in the 3D view)`} onClick={() => preview(g)}>{g.name}</td>
                  <td className="seq-grid__num">{c ? c.rows.size.toLocaleString() : 0}</td>
                  <td className="seq-grid__num">{c ? c.objectCount.toLocaleString() : 0}</td>
                  <td className="seq-grid__actions">
                    <button type="button" title={g.hidden ? 'Off: not used by the triggers (click to switch on)' : 'On: used by the triggers (click to switch off)'} aria-label={g.hidden ? 'Switch the group on' : 'Switch the group off'} onClick={() => set(groups.map((x) => (x.id === g.id ? { ...x, hidden: !x.hidden } : x)))}>{g.hidden ? <IconEyeOff /> : <IconEye />}</button>
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

/** The triggers between the table and the 3D view (at the foot of the list setup, whichever tab is up). */
export function LinkTriggersBlock() {
  const triggers = useDataSourcesStore((s) => s.triggers);
  const set = useDataSourcesStore.getState().setTriggers;
  return (
    <div className="dm-trig">
      <div className="cols__heading"><span>Triggers</span></div>
      {TRIGGER_GROUPS.map((g) => (
        <div key={g.id} className="dm-trig__group">
          <div className="dm-trig__main">
            <button type="button" role="switch" aria-checked={triggers[g.id]} aria-label={g.label} className={`switch${triggers[g.id] ? ' on' : ''}`} onClick={() => set({ [g.id]: !triggers[g.id] })}>
              <span className="switch__thumb" />
            </button>
            <b>{g.label}</b>
            <InfoTip>{g.tip}</InfoTip>
          </div>
          <div className="dm-trig__opts" aria-label={`${g.label} options`}>
            {g.options.map((o) => (
              <button key={o.id} type="button" className={`tags__chip${triggers[o.id] && triggers[g.id] ? ' active' : ''}`} aria-pressed={triggers[o.id] && triggers[g.id]} disabled={!triggers[g.id]} title={o.tip} onClick={() => set({ [o.id]: !triggers[o.id] })}>{o.label}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A block of the match group editor: a title with its count and an add button, then the rules, each on full-width lines. */
function MgSection({ title, count, addLabel, onAdd, empty, children }: { title: string; count: number; addLabel: string; onAdd: () => void; empty: string; children: ReactNode }) {
  return (
    <section className="mg-sec">
      <div className="mg-sec__bar">
        <span className="mg-sec__title">{title}</span>
        {count > 0 && <span className="mg-sec__count">{count}</span>}
        <button type="button" className="mg-add" onClick={onAdd}>{addLabel}</button>
      </div>
      {count === 0 ? <div className="mg-none">{empty}</div> : children}
    </section>
  );
}

/** And / Or between two rules (nothing before the first). */
const MgConj = ({ value, first, onChange }: { value: Conjunction; first: boolean; onChange: (c: Conjunction) => void }) =>
  first ? null : (
    <div className="mg-conj">
      <select value={value} onChange={(e) => onChange(e.target.value as Conjunction)} aria-label="And / Or">
        <option value="or">Or</option>
        <option value="and">And</option>
      </select>
    </div>
  );

const MgFlags = ({ caseSensitive, ignore, onChange }: { caseSensitive: boolean; ignore: boolean; onChange: (p: { caseSensitive?: boolean; ignore?: boolean }) => void }) => (
  <>
    <button type="button" className={`tags__chip${caseSensitive ? ' active' : ''}`} aria-pressed={caseSensitive} title="Case-sensitive" onClick={() => onChange({ caseSensitive: !caseSensitive })}>Aa</button>
    <button type="button" className={`tags__chip${ignore ? ' active' : ''}`} aria-pressed={ignore} title="Ignore this condition" onClick={() => onChange({ ignore: !ignore })}>Ign</button>
  </>
);

const MgRemove = ({ onClick }: { onClick: () => void }) => (
  <button type="button" className="cols__icon cols__icon--remove" title="Remove" aria-label="Remove" onClick={onClick}><IconRemove /></button>
);

/** The editor of one match group: its rows, its objects and the matching rules. Each rule takes full-width lines, so nothing is cut off
    in a narrow panel. */
function MatchGroupEditor({ group, table, objectKeys, onSave, onCancel, onDelete }: {
  group: MatchGroup;
  table: DataTable;
  objectKeys: string[];
  onSave: (g: MatchGroup) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [g, setG] = useState<MatchGroup>(group);
  const [splitOpen, setSplitOpen] = useState<Set<string>>(new Set());

  const addRowFilter = () => setG({ ...g, rowFilters: [...g.rowFilters, { id: newId(), column: table.columns[0] ?? '', op: 'equals', value: '', conj: 'or', caseSensitive: false, ignore: false }] });
  const addObjectFilter = () => setG({ ...g, objectFilters: [...g.objectFilters, { id: newId(), propertySet: '_category', attribute: '', op: 'equals', value: '', conj: 'or', caseSensitive: false, ignore: false }] });
  const addRule = () => setG({ ...g, matchRules: [...g.matchRules, { id: newId(), column: table.columns[0] ?? '', objectPropertySet: '_category', objectAttribute: '', conj: 'or' }] });
  const updateRowFilter = (id: string, patch: Partial<RowFilterRule>) => setG({ ...g, rowFilters: g.rowFilters.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const updateObjectFilter = (id: string, patch: Partial<ObjectFilterRule>) => setG({ ...g, objectFilters: g.objectFilters.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  const updateRule = (id: string, patch: Partial<DataMatchRule>) => setG({ ...g, matchRules: g.matchRules.map((r) => (r.id === id ? { ...r, ...patch } : r)) });

  const columnSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Column" title={value}>
      {!table.columns.includes(value) && <option value={value}>{value || '— column —'}</option>}
      {table.columns.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
  const objectSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Object field" title={value}>
      {!objectKeys.includes(value) && <option value={value}>{objectFieldLabel(value)}</option>}
      {objectKeys.map((k) => <option key={k} value={k}>{objectFieldLabel(k)}</option>)}
    </select>
  );
  const opSelect = (value: CompareOp, onChange: (v: CompareOp) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value as CompareOp)} aria-label="Is">
      {OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  return (
    <div className="mg">
      <div className="mg-name">
        <input value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="Group name" aria-label="Group name" />
      </div>

      <MgSection title="Rows" count={g.rowFilters.length} addLabel="+ condition" onAdd={addRowFilter} empty="All rows of the table">
        {g.rowFilters.map((r, i) => (
          <div key={r.id} className="mg-rule">
            <MgConj value={r.conj} first={i === 0} onChange={(conj) => updateRowFilter(r.id, { conj })} />
            <div className="mg-line">{columnSelect(r.column, (column) => updateRowFilter(r.id, { column }))}{opSelect(r.op, (op) => updateRowFilter(r.id, { op }))}</div>
            <div className="mg-line">
              <input value={r.value} onChange={(e) => updateRowFilter(r.id, { value: e.target.value })} placeholder="value" aria-label="Value" />
              <MgFlags caseSensitive={r.caseSensitive} ignore={r.ignore} onChange={(p) => updateRowFilter(r.id, p)} />
              <MgRemove onClick={() => setG({ ...g, rowFilters: g.rowFilters.filter((x) => x.id !== r.id) })} />
            </div>
          </div>
        ))}
      </MgSection>

      <MgSection title="Objects" count={g.objectFilters.length} addLabel="+ condition" onAdd={addObjectFilter} empty="All objects of the models">
        {g.objectFilters.map((r, i) => (
          <div key={r.id} className="mg-rule">
            <MgConj value={r.conj} first={i === 0} onChange={(conj) => updateObjectFilter(r.id, { conj })} />
            <div className="mg-line">
              {objectSelect(objectFieldKey(r.propertySet, r.attribute), (k) => { const { propertySet, attribute } = parseObjectFieldKey(k); updateObjectFilter(r.id, { propertySet, attribute }); })}
              {opSelect(r.op, (op) => updateObjectFilter(r.id, { op }))}
            </div>
            <div className="mg-line">
              <input value={r.value} onChange={(e) => updateObjectFilter(r.id, { value: e.target.value })} placeholder="value" aria-label="Value" />
              <MgFlags caseSensitive={r.caseSensitive} ignore={r.ignore} onChange={(p) => updateObjectFilter(r.id, p)} />
              <MgRemove onClick={() => setG({ ...g, objectFilters: g.objectFilters.filter((x) => x.id !== r.id) })} />
            </div>
          </div>
        ))}
      </MgSection>

      <MgSection title="Matching" count={g.matchRules.length} addLabel="+ rule" onAdd={addRule} empty="No rule: the group only picks the rows and objects above, without pairing them.">
        {g.matchRules.map((r, i) => {
          const splits = (r.rowSeparators?.length ?? 0) + (r.objectSeparators?.length ?? 0);
          const open = splitOpen.has(r.id);
          return (
            <div key={r.id} className="mg-rule">
              <MgConj value={r.conj} first={i === 0} onChange={(conj) => updateRule(r.id, { conj })} />
              <div className="mg-line"><span className="mg-side">Column</span>{columnSelect(r.column, (column) => updateRule(r.id, { column }))}</div>
              <div className="mg-line">
                <span className="mg-side">equals</span>
                {objectSelect(objectFieldKey(r.objectPropertySet, r.objectAttribute), (k) => { const { propertySet, attribute } = parseObjectFieldKey(k); updateRule(r.id, { objectPropertySet: propertySet, objectAttribute: attribute }); })}
              </div>
              <div className="mg-line mg-line--end">
                <button
                  type="button"
                  className={`tags__chip${open || splits ? ' active' : ''}`}
                  aria-pressed={open}
                  title="A field holding several values (like A || B) can be split on separators: one equal value then matches"
                  onClick={() => setSplitOpen((o) => { const n = new Set(o); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })}
                >split{splits ? ` ${splits}` : ''}</button>
                <MgRemove onClick={() => setG({ ...g, matchRules: g.matchRules.filter((x) => x.id !== r.id) })} />
              </div>
              {open && (
                <div className="rule-seps">
                  <SeparatorsEditor label="Row value holds several, split on" value={r.rowSeparators ?? []} onChange={(rowSeparators) => updateRule(r.id, { rowSeparators })} />
                  <SeparatorsEditor label="Object value holds several, split on" value={r.objectSeparators ?? []} onChange={(objectSeparators) => updateRule(r.id, { objectSeparators })} />
                </div>
              )}
            </div>
          );
        })}
      </MgSection>

      <div className="mg-foot">
        <button className="btn primary btn--small" onClick={() => onSave(g)} disabled={!g.name.trim()}>Save</button>
        <button className="btn btn--small" onClick={onCancel}>Cancel</button>
        {onDelete && <button className="btn btn--danger btn--small" style={{ marginLeft: 'auto' }} onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}
