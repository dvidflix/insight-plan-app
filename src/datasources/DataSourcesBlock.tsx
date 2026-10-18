import { useDataTableStore } from '../state/dataTableStore';
import { IconAddCircleOutline, IconRemove, IconSync } from '../components/icons';
import { chooseDataFiles, chooseFileFor, showSource } from './addFiles';
import { DataLinkSetup } from './DataLink';
import { SOURCE_KIND_LABEL } from './parsers';
import { useExternalTable } from './externalRows';
import { useDataSourcesStore } from './store';

/** The Data table's external data, in its settings panel: the sources (add, read again, remove) and, for the table showing, the
    ID Match that couples its rows to the model and the triggers between the two. */
export function DataSourcesBlock() {
  const sources = useDataSourcesStore((s) => s.sources);
  const data = useDataSourcesStore((s) => s.data);
  const busy = useDataSourcesStore((s) => s.busy);
  const errors = useDataSourcesStore((s) => s.errors);
  const scope = useDataTableStore((s) => s.scope);
  const ext = useExternalTable(scope);
  const st = useDataSourcesStore.getState;

  return (
    <div className="dtp__sources">
      <div className="cols__heading">
        <span>External data</span>
        <button type="button" className="btn btn--small" onClick={() => void chooseDataFiles()} title="Add CSV / text, Excel or SQLite files: each table is then in the table's list above (you can also drop files on the table)">
          <IconAddCircleOutline width={14} height={14} /> Add data file…
        </button>
      </div>
      {sources.length === 0 && <div className="flt__hint">No external data yet. Add a CSV, Excel or SQLite (.db) file, or drop it on the table.</div>}
      {sources.map((x) => {
        const tables = data[x.id];
        const showing = ext?.source.id === x.id;
        return (
          <div key={x.id} className="disp__row" style={{ gap: 6, background: showing ? 'rgb(var(--accent-rgb) / 0.08)' : undefined }}>
            <button type="button" className="cols__link" style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} disabled={!tables} onClick={() => showSource(x.id)} title={`${x.fileName} · ${SOURCE_KIND_LABEL[x.kind]}${tables ? ` · ${Object.keys(tables).length} table(s)` : ''}`}>
              {x.name}
            </button>
            <span className="flt__hint" style={{ margin: 0, whiteSpace: 'nowrap' }}>{busy[x.id] ? 'Reading…' : x.loadedAt ? new Date(x.loadedAt).toLocaleTimeString() : 'not read'}</span>
            <button type="button" className="mini-btn mini-btn--icon" title="Read the file again" aria-label={`Refresh ${x.name}`} disabled={busy[x.id]} onClick={() => void st().refresh(x.id)}><IconSync width={16} height={16} /></button>
            <button type="button" className="mini-btn mini-btn--icon" title="Choose the file again" aria-label={`Choose the file of ${x.name} again`} onClick={() => void chooseFileFor(x.id)}><IconAddCircleOutline width={16} height={16} /></button>
            <button type="button" className="mini-btn mini-btn--icon" title="Remove the source (the file is not touched)" aria-label={`Remove ${x.name}`} onClick={() => st().remove(x.id)}><IconRemove width={16} height={16} /></button>
            {errors[x.id] && <div className="flt__hint" style={{ flexBasis: '100%', color: 'var(--danger, #c0392b)' }}>{errors[x.id]}</div>}
            {!tables && !busy[x.id] && !errors[x.id] && <div className="flt__hint" style={{ flexBasis: '100%' }}>Not read yet in this session: press Refresh.</div>}
          </div>
        );
      })}
      {ext && <DataLinkSetup sourceId={ext.source.id} tableName={ext.name} table={ext.table} match={ext.match} />}
    </div>
  );
}
