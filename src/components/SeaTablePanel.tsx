import { useEffect, useMemo, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useModelsStore } from '../state/modelsStore';
import { usePropertyVisibilityStore } from '../state/propertyVisibilityStore';
import { useCustomFieldsStore, useSeaTableUiStore } from '../state/customFieldsStore';
import { collectPush, getStatus, pullFields, pushElements, type SeaTableStatus } from '../seatable/client';
import { useIndexTick } from './modelFields';
import { prettyClass } from '../viewer/bimTables';
import { usePersistedState } from '../utils/persistedState';
import { IconSectionChevron } from './icons';
import { InfoTip } from './InfoTip';

/** Inputs › SeaTable (model data): push the elements of chosen IFC classes, with the properties the
    Properties table shows, into SeaTable's "Elements" table; pull the columns its users add back as
    custom fields ("Custom" property group), on a button or whenever a model loads. */
export function SeaTablePanel({ bare = false }: { bare?: boolean } = {}) {
  const engine = useViewerEngine();
  const models = useModelsStore((s) => s.models);
  const tick = useIndexTick();
  const { pushClasses, setPushClasses, autoPull, setAutoPull, fields, values, pulledAt, lastPush } = useCustomFieldsStore();
  const busy = useSeaTableUiStore((s) => s.busy);
  const progress = useSeaTableUiStore((s) => s.progress);
  const message = useSeaTableUiStore((s) => s.message);
  const hiddenPsets = usePropertyVisibilityStore((s) => s.hiddenPsets);
  const hiddenProps = usePropertyVisibilityStore((s) => s.hiddenProps);
  const [openState, setOpen] = usePersistedState('models.seatablePanelOpen', true);
  const open = bare || openState;
  const [status, setStatus] = useState<SeaTableStatus | null>(null);

  const refreshStatus = () => void getStatus().then(setStatus).catch((e) => setStatus({ configured: false, reachable: false, envFile: '', error: String(e) }));
  useEffect(() => {
    if (open) refreshStatus();
  }, [open]);

  // The IFC classes of the loaded models with their element counts.
  const classes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const index of engine.getIndexes().values()) for (const el of index.elements.values()) counts.set(el.category, (counts.get(el.category) ?? 0) + 1);
    return [...counts].map(([category, n]) => ({ category, n })).sort((a, b) => a.category.localeCompare(b.category));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, models, tick]);
  const chosen = useMemo(() => new Set(pushClasses), [pushClasses]);

  // What a push would send.
  const plan = useMemo(() => {
    if (!open || pushClasses.length === 0) return { elements: 0, properties: 0 };
    const set = collectPush(engine, pushClasses);
    return { elements: set.rows.length, properties: set.properties.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, engine, pushClasses, hiddenPsets, hiddenProps, models, tick]);

  const toggle = (category: string) => setPushClasses(chosen.has(category) ? pushClasses.filter((c) => c !== category) : [...pushClasses, category]);
  const ok = status?.configured && status.reachable;
  const elementsWithFields = Object.keys(values).length;

  return (
    <div className={bare ? "seatable-panel" : "inputs-panel seatable-panel"}>
      {!bare && <div className="inputs-panel__header">
        <button type="button" className="export-fields__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
          <IconSectionChevron className="section-chevron" />
          <span>SeaTable (model data)</span>
        </button>
        <InfoTip>
          <p><b>Push</b> sends the elements of the IFC classes you tick, with the properties the Properties table shows (see Show / hide properties), to the <b>Elements</b> table of the SeaTable base, one row per element, by its GlobalId. It only updates those columns; the rows of elements that left the model are marked Removed, not deleted.</p>
          <p><b>Pull</b> brings back every column you add to that table yourself (use names without a dot) as <b>Custom</b> properties of the elements: in Properties, the Data table, colour, filters, search sets and link groups.</p>
        </InfoTip>
        <span className="inputs-panel__count" title="Elements with custom fields">{elementsWithFields}</span>
      </div>}
      {open && (
        <div className={bare ? "seatable-panel__body" : "inputs-panel__body seatable-panel__body"}>
          <div className="seatable-panel__status">
            {status === null ? 'Checking SeaTable…' : ok ? <>Connected to <b>{status.address}</b>{status.table ? ` · Elements table: ${status.columns} columns` : ' · no Elements table yet (the first push makes it)'}</> : <span className="seatable-panel__bad">{status.error ?? 'SeaTable is not reachable.'}</span>}
            <button type="button" className="cols__link" onClick={refreshStatus}>Check again</button>
          </div>

          <div className="cols__heading"><span>Push: IFC classes <b>{classes.length}</b></span></div>
          {classes.length === 0 && <div className="flt__hint">Load a model to list its IFC classes.</div>}
          <div className="seatable-panel__classes">
            {classes.map((c) => (
              <label key={c.category} className="cols__check">
                <input type="checkbox" checked={chosen.has(c.category)} onChange={() => toggle(c.category)} />
                <span title={c.category}>{prettyClass(c.category)}</span>
                <span className="flt__n">{c.n.toLocaleString()}</span>
              </label>
            ))}
          </div>
          <div className="seatable-panel__row">
            <button type="button" className="cols__link" onClick={() => setPushClasses(classes.map((c) => c.category))}>All</button>
            <button type="button" className="cols__link" onClick={() => setPushClasses([])}>None</button>
            <span className="seatable-panel__spacer" />
            <button type="button" className="btn primary" disabled={!ok || busy !== null || plan.elements === 0} onClick={() => void pushElements(engine, pushClasses)}>
              Push {plan.elements ? `${plan.elements.toLocaleString()} elements` : 'to SeaTable'}
            </button>
          </div>
          {plan.elements > 0 && <div className="flt__hint">{plan.elements.toLocaleString()} elements, {plan.properties} properties (the ones the Properties table shows).</div>}
          {lastPush && <div className="flt__hint">Last push {new Date(lastPush.at).toLocaleString()}: {lastPush.elements.toLocaleString()} elements, {lastPush.added} new, {lastPush.updated} updated{lastPush.removed ? `, ${lastPush.removed} removed from the models` : ''}.</div>}

          <div className="cols__heading"><span>Pull: custom fields <b>{fields.length}</b></span></div>
          <div className="seatable-panel__row">
            <button type="button" className="btn" disabled={!ok || busy !== null} onClick={() => void pullFields(engine)}>Pull custom fields</button>
            <label className="cols__check seatable-panel__auto" title="Pull when a model loads (the saved copy is used at once; if SeaTable is off it stays).">
              <input type="checkbox" checked={autoPull} onChange={(e) => setAutoPull(e.target.checked)} />
              <span>Pull when a model loads</span>
            </label>
          </div>
          {fields.length > 0 ? (
            <div className="flt__hint">
              {fields.join(' · ')} — {elementsWithFields.toLocaleString()} elements{pulledAt ? `, pulled ${new Date(pulledAt).toLocaleString()}` : ''}. Shown as the “Custom” property group.
            </div>
          ) : (
            <div className="flt__hint">None yet: add your own columns to the Elements table in SeaTable (names without a dot), fill them in, then pull.</div>
          )}

          {progress && (
            <div className="inputs-panel__busy">
              <span>{progress.label} {progress.total > 1 ? `${Math.round((progress.done / progress.total) * 100)}%` : ''}</span>
              <progress value={progress.done} max={Math.max(1, progress.total)} />
            </div>
          )}
          {message && <div className={message.kind === 'error' ? 'inputs-panel__error' : 'flt__hint'}>{message.text}</div>}
        </div>
      )}
    </div>
  );
}
