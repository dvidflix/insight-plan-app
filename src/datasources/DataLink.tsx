import { useMemo } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useIndexTick, useModelFields } from '../components/modelFields';
import { CollapsibleSection, useOpenSections } from '../components/CollapsibleSection';
import { InfoTip } from '../components/InfoTip';
import { IconAddCircleOutline, IconRemove } from '../components/icons';
import { matchedRowCount, type IdMatch, type MatchCondition } from './idMatch';
import type { DataTable } from './parsers';
import { useDataSourcesStore } from './store';

const TRIGGERS = [
  { id: 'toGrid', label: '3D → table', tip: 'Selecting objects in 3D narrows the table to the rows that match them. Reset the filter with “Show all rows”.' },
  { id: 'selectInGrid', label: 'Select the rows', tip: 'Also selects those rows (needs 3D → table).', needs: 'toGrid' },
  { id: 'toModel', label: 'Table → 3D', tip: 'Selecting rows in the table selects the objects that match them in 3D.' },
  { id: 'reframe', label: 'Zoom to them', tip: 'Also zooms to the objects (needs Table → 3D).', needs: 'toModel' },
  { id: 'isolate', label: 'Isolate them', tip: 'Also shows only those objects and hides the rest (needs Table → 3D).', needs: 'toModel' },
] as const;

/** The ID Match of a table (which column is which model property) and the triggers between the table and the 3D view. */
export function DataLinkSetup({ sourceId, tableName, table, match }: { sourceId: string; tableName: string; table: DataTable; match: IdMatch }) {
  const engine = useViewerEngine();
  const tick = useIndexTick();
  const fields = useModelFields();
  const triggers = useDataSourcesStore((s) => s.triggers);
  const sections = useOpenSections<'link'>('dataSources.sections', []);
  const set = (next: IdMatch) => useDataSourcesStore.getState().setMatch(sourceId, tableName, next);
  const setGroup = (gi: number, group: MatchCondition[]) => set({ groups: match.groups.map((g, i) => (i === gi ? group : g)).filter((g) => g.length > 0) });
  const used = useMemo(() => matchedRowCount(match, table, engine.getIndexes()), [match, table, engine, tick]);
  const hasRules = match.groups.some((g) => g.some((c) => c.column && c.field));

  return (
    <CollapsibleSection title="3D link (ID Match)" open={sections.isOpen('link')} onToggle={() => sections.toggle('link')} flush
      tip={<><p>An ID Match tells the app which rows and which model objects are the same thing: a column of the table equals a property of the objects (case and spaces ignored).</p><p>The conditions of a group must all hold (AND); the match holds when any group does (OR). Use one group per package when a federated model names the property differently.</p></>}
    >
      <div className="disp">
        <datalist id="ds-fields">{fields.map((f) => <option key={f.id} value={f.id}>{f.group} › {f.label}</option>)}</datalist>
        {match.groups.map((group, gi) => (
          <div key={gi} style={{ border: '1px solid var(--border)', padding: '4px 6px', marginBottom: 6 }}>
            <div className="cols__heading"><span>{gi === 0 ? 'Match when' : 'or when'}</span></div>
            {group.map((c, ci) => (
              <div key={ci} className="disp__row" style={{ gap: 6 }}>
                <span className="flt__hint" style={{ width: 28, margin: 0 }}>{ci === 0 ? '' : 'and'}</span>
                <select value={c.column} onChange={(e) => setGroup(gi, group.map((x, i) => (i === ci ? { ...x, column: e.target.value } : x)))} aria-label="Table column">
                  <option value="">— column —</option>
                  {table.columns.map((col) => <option key={col} value={col}>{col}</option>)}
                </select>
                <span>=</span>
                <input list="ds-fields" value={c.field} placeholder="model property" style={{ flex: 1, minWidth: 0 }} onChange={(e) => setGroup(gi, group.map((x, i) => (i === ci ? { ...x, field: e.target.value } : x)))} aria-label="Model property" />
                <button type="button" className="mini-btn mini-btn--icon" title="Remove the condition" aria-label="Remove the condition" onClick={() => setGroup(gi, group.filter((_, i) => i !== ci))}><IconRemove width={14} height={14} /></button>
              </div>
            ))}
            <button type="button" className="btn btn--small" onClick={() => setGroup(gi, [...group, { column: '', field: '' }])}>+ and (another condition)</button>
          </div>
        ))}
        <div className="disp__row">
          <button type="button" className="btn btn--small" onClick={() => set({ groups: [...match.groups, [{ column: '', field: '' }]] })}>
            <IconAddCircleOutline width={14} height={14} /> {match.groups.length === 0 ? 'Add a match' : 'Add an “or” group'}
          </button>
          {hasRules && <span className="flt__hint" style={{ margin: 0 }}>{used.toLocaleString()} of {table.rows.length.toLocaleString()} rows have objects in the models</span>}
        </div>
        <div className="cols__heading"><span>Triggers</span></div>
        {TRIGGERS.map((t) => {
          const needs = 'needs' in t ? t.needs : undefined;
          const off = !!needs && !triggers[needs];
          return (
            <div key={t.id} className="disp__row" style={{ opacity: off ? 0.5 : 1 }}>
              <span>{t.label} <InfoTip>{t.tip}</InfoTip></span>
              <button type="button" role="switch" aria-checked={triggers[t.id] && !off} disabled={off} className={`switch${triggers[t.id] && !off ? ' on' : ''}`} onClick={() => useDataSourcesStore.getState().setTriggers({ [t.id]: !triggers[t.id] })}>
                <span className="switch__thumb" />
              </button>
            </div>
          );
        })}
      </div>
    </CollapsibleSection>
  );
}
