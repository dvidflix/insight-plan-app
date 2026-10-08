import type { ViewerEngine } from '../viewer/ViewerEngine';
import { applyCustomFields } from '../viewer/customFields';
import { useCustomFieldsStore, useSeaTableUiStore, type FieldValue } from '../state/customFieldsStore';
import { usePropertyVisibilityStore } from '../state/propertyVisibilityStore';

/** Browser side of the SeaTable bridge (vite-plugins/seatablePlugin.ts). */

export interface SeaTableStatus {
  configured: boolean;
  reachable: boolean;
  envFile: string;
  address?: string;
  table?: boolean;
  columns?: number;
  hasRows?: boolean;
  error?: string;
}

async function api<T>(path: string, init?: { method: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/seatable/${path}`, init ? { method: init.method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body ?? {}) } : undefined);
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`SeaTable bridge: ${res.status} ${text.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(json.error ?? `SeaTable bridge: ${res.status}`);
  return json as T;
}

export const getStatus = () => api<SeaTableStatus>('status');

const ui = (patch: Partial<ReturnType<typeof useSeaTableUiStore.getState>>) => useSeaTableUiStore.setState(patch);

// ---------------------------------------------------------------- what to push

export interface PushRow {
  guid: string;
  class: string;
  name: string;
  model: string;
  props: Record<string, string | number>;
}

export interface PushSet {
  rows: PushRow[];
  /** The model properties pushed: those the Properties table shows (not hidden in Show / hide properties). */
  properties: { key: string; numeric: boolean }[];
}

/** The elements of the chosen IFC classes with their shown properties. */
export function collectPush(engine: ViewerEngine, classes: Iterable<string>): PushSet {
  const wanted = new Set(classes);
  const { hiddenPsets, hiddenProps } = usePropertyVisibilityStore.getState();
  const hiddenSets = new Set(hiddenPsets);
  const hiddenKeys = new Set(hiddenProps);
  const rows: PushRow[] = [];
  const numeric = new Map<string, boolean>();
  for (const index of engine.getIndexes().values()) {
    for (const el of index.elements.values()) {
      if (!wanted.has(el.category)) continue;
      const props: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(el.props)) {
        const dot = k.indexOf('.');
        if (dot <= 0 || k.startsWith('Custom.') || hiddenSets.has(k.slice(0, dot)) || hiddenKeys.has(k)) continue;
        if (v === null || v === undefined || v === '') continue;
        const value = typeof v === 'number' || typeof v === 'string' ? v : String(v);
        props[k] = value;
        numeric.set(k, (numeric.get(k) ?? true) && typeof value === 'number');
      }
      rows.push({ guid: el.guid, class: el.category, name: el.name, model: el.fileName || index.name, props });
    }
  }
  return { rows, properties: [...numeric].sort(([a], [b]) => a.localeCompare(b)).map(([key, n]) => ({ key, numeric: n })) };
}

// ---------------------------------------------------------------- push

const CHUNK = 250;

export async function pushElements(engine: ViewerEngine, classes: string[]) {
  const store = useCustomFieldsStore.getState();
  ui({ busy: 'push', message: null, progress: { done: 0, total: 1, label: 'Collecting the elements…' } });
  try {
    const set = collectPush(engine, classes);
    if (set.rows.length === 0) throw new Error('No elements of the chosen classes are loaded.');
    ui({ progress: { done: 0, total: set.rows.length, label: `Preparing ${set.properties.length} property columns…` } });
    const start = await api<{ session: string; existingRows: number; addedColumns: number }>('push/start', { method: 'POST', body: { properties: set.properties } });
    let added = 0;
    let updated = 0;
    let done = 0;
    const byModel = new Map<string, PushRow[]>();
    for (const r of set.rows) (byModel.get(r.model) ?? byModel.set(r.model, []).get(r.model)!).push(r);
    for (const [model, rows] of byModel) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const r = await api<{ added: number; updated: number }>('push/rows', { method: 'POST', body: { session: start.session, model, rows: chunk.map(({ guid, class: c, name, props }) => ({ guid, class: c, name, props })) } });
        added += r.added;
        updated += r.updated;
        done += chunk.length;
        ui({ progress: { done, total: set.rows.length, label: `Pushing ${model}…` } });
      }
    }
    const fin = await api<{ removed: number }>('push/finish', { method: 'POST', body: { session: start.session } });
    store.setLastPush({ at: new Date().toISOString(), elements: set.rows.length, properties: set.properties.length, added, updated, removed: fin.removed });
    ui({ message: { kind: 'ok', text: `Pushed ${set.rows.length.toLocaleString()} elements (${added} new, ${updated} updated${fin.removed ? `, ${fin.removed} no longer in the models` : ''}) with ${set.properties.length} properties${start.addedColumns ? `, ${start.addedColumns} new columns` : ''}.` } });
  } catch (e) {
    ui({ message: { kind: 'error', text: e instanceof Error ? e.message : String(e) } });
  } finally {
    ui({ busy: null, progress: null });
  }
}

// ---------------------------------------------------------------- pull

interface PourTable {
  columns: { name: string; type: string }[];
  rows: { pourId: string; buildings: string[]; values: Record<string, FieldValue> }[];
}

const POUR_SET = 'CWA Pour';
const norm = (v: unknown) => String(v ?? '').trim().toUpperCase();

/** The property of an element by set and name, ignoring case and surrounding spaces. */
function pourProp(props: Record<string, unknown>, name: string): unknown {
  const direct = props[`${POUR_SET}.${name}`];
  if (direct !== undefined) return direct;
  const want = `${POUR_SET}.${name}`.toUpperCase();
  for (const k in props) if (k.trim().toUpperCase() === want) return props[k];
  return undefined;
}

/** Gives the elements the columns of the "Models metadata" row with their HPC Pour ID and their Unit + Building
    (the row's Buildings are like "1HDAB"). What the Elements table already has for an element is kept. */
function matchPours(engine: ViewerEngine, pours: PourTable, values: Record<string, Record<string, FieldValue>>) {
  const byPour = new Map<string, PourTable['rows']>();
  for (const row of pours.rows) {
    const id = norm(row.pourId);
    (byPour.get(id) ?? byPour.set(id, []).get(id)!).push(row);
  }
  for (const index of engine.getIndexes().values()) {
    for (const el of index.elements.values()) {
      const id = pourProp(el.props, 'HPC Pour ID');
      if (id === undefined || id === null || id === '') continue;
      const candidates = byPour.get(norm(id));
      if (!candidates) continue;
      const building = norm(pourProp(el.props, 'Building'));
      const unit = norm(pourProp(el.props, 'Unit'));
      const key = `${unit}${building}`;
      const hit = candidates.find((c) => c.buildings.some((b) => norm(b) === key));
      if (!hit) continue;
      values[el.guid] = { ...hit.values, ...values[el.guid] };
    }
  }
}

/** Reads the user's columns of the Elements table into the custom fields and puts them on the loaded elements.
    `quiet`: no message unless something changed or failed (the automatic pull when a model loads). */
export async function pullFields(engine: ViewerEngine, opts: { quiet?: boolean } = {}) {
  if (useSeaTableUiStore.getState().busy) return;
  ui({ busy: 'pull', message: opts.quiet ? useSeaTableUiStore.getState().message : null, progress: { done: 0, total: 1, label: 'Reading the custom columns…' } });
  try {
    const r = await api<{ columns: { name: string; type: string }[]; rows: { guid: string; values: Record<string, FieldValue> }[]; pours?: PourTable; note?: string }>('pull');
    const values: Record<string, Record<string, FieldValue>> = {};
    for (const row of r.rows) values[row.guid] = row.values;
    const fields = r.columns.map((c) => c.name);
    if (r.pours?.rows.length) {
      for (const c of r.pours.columns) if (!fields.includes(c.name)) fields.push(c.name);
      matchPours(engine, r.pours, values);
    }
    const before = useCustomFieldsStore.getState();
    const same = JSON.stringify(before.fields) === JSON.stringify(fields) && JSON.stringify(before.values) === JSON.stringify(values);
    useCustomFieldsStore.getState().setPulled(fields, values);
    applyCustomFields(engine);
    if (!opts.quiet || !same) {
      const n = r.rows.length;
      ui({ message: { kind: r.note ? 'warn' : 'ok', text: r.note ?? `Pulled ${fields.length} custom column${fields.length === 1 ? '' : 's'} for ${n.toLocaleString()} element${n === 1 ? '' : 's'}.` } });
    }
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    const have = useCustomFieldsStore.getState().fields.length > 0;
    ui({ message: { kind: opts.quiet ? 'warn' : 'error', text: opts.quiet ? `SeaTable not reachable${have ? ': using the saved custom fields' : ''}. (${text})` : text } });
  } finally {
    ui({ busy: null, progress: null });
  }
}
