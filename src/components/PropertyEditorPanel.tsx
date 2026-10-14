import { IconRemove } from './icons';
import { useEffect, useMemo, useState } from 'react';
import { useViewerEngine } from '../viewer/ViewerEngineContext';
import { useSelectionStore } from '../state/selectionStore';
import { usePropertyQueueStore } from '../state/propertyQueueStore';
import { usePersistedState } from '../utils/persistedState';
import { applySetProperties, stepValue, type PropertyEdit, type PropertyValueType } from '../ids/patches';
import { writeBackModel } from '../ids/writeBack';

/** Properties tab › Edit properties: stage a property set / property /
    value for the selected elements, as many as needed, then write them all
    into the IFC in one go (a _FIXED copy, loaded in place of the model —
    see writeBack.ts). */

const TYPES: { id: PropertyValueType; label: string }[] = [
  { id: 'IfcLabel', label: 'Text' },
  { id: 'IfcText', label: 'Long text' },
  { id: 'IfcIdentifier', label: 'Identifier' },
  { id: 'IfcReal', label: 'Number' },
  { id: 'IfcInteger', label: 'Whole number' },
  { id: 'IfcBoolean', label: 'Yes / No' },
];
const MAX_PICKLIST = 15;
const OTHER = '__other__';
const typeLabel = (t: PropertyValueType) => TYPES.find((x) => x.id === t)?.label ?? t;

export function PropertyEditorPanel() {
  const engine = useViewerEngine();
  const byModel = useSelectionStore((s) => s.byModel);
  const { queue, add, remove, clear } = usePropertyQueueStore();
  const [pset, setPset] = usePersistedState('models.propEdit.pset', '');
  const [name, setName] = usePersistedState('models.propEdit.name', '');
  const [valueType, setValueType] = usePersistedState<PropertyValueType>('models.propEdit.type', 'IfcLabel');
  const [value, setValue] = useState('');
  const [backup, setBackup] = usePersistedState('models.propEdit.backup', true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // The selection's elements, with what they already carry.
  const selected = useMemo(() => {
    const out: { modelId: string; guid: string; props: Record<string, unknown> }[] = [];
    for (const [modelId, ids] of Object.entries(byModel)) {
      const index = engine.getIndexes().get(modelId);
      for (const id of ids) {
        const e = index?.elements.get(id);
        if (e?.guid) out.push({ modelId, guid: e.guid, props: e.props });
      }
    }
    return out;
  }, [byModel, engine]);

  const psets = useMemo(() => [...new Set(selected.flatMap((e) => Object.keys(e.props).map((k) => k.slice(0, k.indexOf('.')))))].filter(Boolean).sort(), [selected]);
  const names = useMemo(() => [...new Set(selected.flatMap((e) => Object.keys(e.props).filter((k) => k.startsWith(`${pset}.`)).map((k) => k.slice(pset.length + 1))))].sort(), [selected, pset]);
  const current = useMemo(() => {
    const vals = new Set(selected.map((e) => e.props[`${pset}.${name}`]).map((v) => (v === undefined ? '(none)' : String(v))));
    return [...vals];
  }, [selected, pset, name]);

  // The values this property takes across the loaded models: a short list is offered as a pick-list (allowed values).
  const allowed = useMemo(() => {
    if (!pset.trim() || !name.trim()) return [];
    const key = `${pset.trim()}.${name.trim()}`;
    const seen = new Set<string>();
    for (const index of engine.getIndexes().values()) {
      for (const e of index.elements.values()) {
        const v = e.props[key];
        if (v === undefined || v === null || String(v).trim() === '') continue;
        seen.add(String(v));
        if (seen.size > MAX_PICKLIST) return [];
      }
    }
    return [...seen].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
  }, [engine, pset, name]);
  const usePicklist = allowed.length >= 2 && valueType !== 'IfcBoolean';
  const [otherValue, setOtherValue] = useState(false);
  useEffect(() => setOtherValue(false), [pset, name]);

  let valueError = '';
  try {
    if (value !== '' || valueType === 'IfcReal' || valueType === 'IfcInteger') stepValue(value, valueType);
  } catch (e) {
    valueError = e instanceof Error ? e.message : String(e);
  }
  const canQueue = selected.length > 0 && pset.trim() !== '' && name.trim() !== '' && !valueError;

  const queueSelected = () => {
    const targets: Record<string, string[]> = {};
    for (const e of selected) (targets[e.modelId] ??= []).push(e.guid);
    add({ pset: pset.trim(), name: name.trim(), value, valueType, targets });
    setMessage(null);
  };

  const write = async () => {
    const perModel = new Map<string, PropertyEdit[]>();
    for (const q of queue) {
      for (const [modelId, guids] of Object.entries(q.targets)) {
        const list = perModel.get(modelId) ?? perModel.set(modelId, []).get(modelId)!;
        for (const guid of guids) list.push({ guid, pset: q.pset, name: q.name, value: q.value, valueType: q.valueType });
      }
    }
    setBusy(true);
    setMessage(null);
    const notes: string[] = [];
    try {
      for (const [modelId, edits] of perModel) {
        const log = { edit: 'properties', properties: queue.map((q) => ({ pset: q.pset, name: q.name, value: q.value, type: q.valueType, elements: q.targets[modelId]?.length ?? 0 })).filter((q) => q.elements) };
        notes.push(await writeBackModel(engine, modelId, (text) => applySetProperties(text, edits, true), log, backup));
      }
      clear();
      setMessage({ kind: 'ok', text: notes.join(' ') });
    } catch (e) {
      setMessage({ kind: 'error', text: [...notes, e instanceof Error ? e.message : String(e)].join(' ') });
    } finally {
      setBusy(false);
    }
  };

  const count = (q: (typeof queue)[number]) => Object.values(q.targets).reduce((n, g) => n + g.length, 0);

  return (
    <div className="prop-edit">
      <label className="prop-edit__field">
        <span>Property set</span>
        <input list="prop-edit-psets" value={pset} onChange={(e) => setPset(e.target.value)} placeholder="e.g. CWA Pour" />
        <datalist id="prop-edit-psets">{psets.map((p) => <option key={p} value={p} />)}</datalist>
      </label>
      <label className="prop-edit__field">
        <span>Property</span>
        <input list="prop-edit-names" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Is External?" />
        <datalist id="prop-edit-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
      </label>
      <div className="prop-edit__field">
        <span>Value</span>
        <div className="prop-edit__value">
          {valueType === 'IfcBoolean' ? (
            <select value={/^(true|yes|y|1|t)$/i.test(value) ? 'YES' : 'NO'} onChange={(e) => setValue(e.target.value)}>
              <option value="YES">Yes</option>
              <option value="NO">No</option>
            </select>
          ) : usePicklist && !otherValue ? (
            <select
              value={allowed.includes(value) ? value : ''}
              onChange={(e) => (e.target.value === OTHER ? (setOtherValue(true), setValue('')) : setValue(e.target.value))}
              title="The values this property already has in the loaded models"
            >
              <option value="" disabled>Pick a value…</option>
              {allowed.map((v) => <option key={v} value={v}>{v}</option>)}
              <option value={OTHER}>Other value…</option>
            </select>
          ) : (
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={usePicklist ? 'A new value' : undefined} />
          )}
          <select value={valueType} onChange={(e) => setValueType(e.target.value as PropertyValueType)} title="IFC value type">
            {TYPES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {valueError && <div className="prop-edit__error">{valueError}</div>}
      <div className="prop-edit__hint">
        {selected.length} object{selected.length === 1 ? '' : 's'} selected
        {selected.length > 0 && pset && name && <> · now: {current.slice(0, 4).join(', ')}{current.length > 4 ? '…' : ''}</>}
      </div>
      <button type="button" className="btn" disabled={!canQueue} onClick={queueSelected}>
        + Add selected to queue
      </button>

      <div className="prop-edit__queue">
        <div className="prop-edit__queue-head">
          <span>Queue ({queue.length})</span>
          {queue.length > 0 && (
            <button type="button" className="btn btn--small" onClick={clear}>
              Clear
            </button>
          )}
        </div>
        {queue.length === 0 && <div className="prop-edit__hint">Nothing queued yet.</div>}
        {queue.map((q) => (
          <div key={q.id} className="prop-edit__item">
            <span>
              <b>{q.pset}</b> / {q.name} = <b>{q.value === '' ? '(empty)' : q.value}</b> <small>({typeLabel(q.valueType)}) · {count(q)} object{count(q) === 1 ? '' : 's'}</small>
            </span>
            <button type="button" className="cols__icon cols__icon--remove" title="Remove" aria-label="Remove" onClick={() => remove(q.id)}>
              <IconRemove />
            </button>
          </div>
        ))}
      </div>

      <label className="prop-edit__check">
        <input type="checkbox" checked={backup} onChange={(e) => setBackup(e.target.checked)} />
        Keep a backup when writing over an earlier _FIXED file
      </label>
      <button type="button" className="btn primary" disabled={busy || queue.length === 0} onClick={() => void write()} title="Writes <name>_FIXED.ifc (the original is kept) and loads it in place of the model">
        {busy ? 'Writing…' : 'Write queued changes to IFC'}
      </button>
      {message && <div className={`model-checks__msg model-checks__msg--${message.kind}`}>{message.text}</div>}
    </div>
  );
}
