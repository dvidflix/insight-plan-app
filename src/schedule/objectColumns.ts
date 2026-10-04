import type { ElementSummary } from '../viewer/types';
import type { ColumnDef } from './columns';
import type { ActivityObjects } from './activityObjects';

/** Columns from the 3D objects an activity is linked to (Link Groups, or those of
    the activities with the same Element ID): Level, Pour Type, Pour Volume (m3),
    Height, how many objects, and every other property the linked objects carry.
    With several objects the cell shows up to three distinct values (+n more);
    Pour Volume is added up, Height runs from the lowest Min to the highest Max
    Elevation. Nothing is added until models are loaded and linked. */
const GROUP = 'Linked 3D objects';
const MAX_VALUES = 3;
const POUR = 'CWA Pour.';

const asNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const fmtNum = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function buildObjectColumns(objects: ActivityObjects, loadedModels: { modelId: string; elements: ElementSummary[] }[]): ColumnDef[] {
  const elementByKey = new Map<string, ElementSummary>();
  for (const m of loadedModels) for (const el of m.elements) elementByKey.set(`${m.modelId}:${el.localId}`, el);

  const cache = new Map<string, ElementSummary[]>();
  const elementsOf = (activityId: string): ElementSummary[] => {
    const hit = cache.get(activityId);
    if (hit) return hit;
    const list: ElementSummary[] = [];
    for (const [modelId, ids] of objects.objectsOf.get(activityId) ?? []) {
      for (const id of ids) {
        const el = elementByKey.get(`${modelId}:${id}`);
        if (el) list.push(el);
      }
    }
    cache.set(activityId, list);
    return list;
  };

  // Every property of the linked objects, found once.
  const linked = new Set<ElementSummary>();
  for (const [, byModel] of objects.objectsOf) {
    for (const [modelId, ids] of byModel) for (const id of ids) {
      const el = elementByKey.get(`${modelId}:${id}`);
      if (el) linked.add(el);
    }
  }
  if (linked.size === 0) return [];
  const keys = new Set<string>();
  for (const el of linked) for (const k of Object.keys(el.props)) keys.add(k);

  const sumOf = (activityId: string, key: string): number | null => {
    let total = 0;
    let any = false;
    for (const el of elementsOf(activityId)) {
      const n = asNumber(el.props[key]);
      if (n !== null) { total += n; any = true; }
    }
    return any ? total : null;
  };
  const heightOf = (activityId: string): number | null => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const el of elementsOf(activityId)) {
      const min = asNumber(el.props[`${POUR}Min Elevation`]);
      const max = asNumber(el.props[`${POUR}Max Elevation`]);
      if (min !== null) lo = Math.min(lo, min);
      if (max !== null) hi = Math.max(hi, max);
    }
    return Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo ? hi - lo : null;
  };
  const distinct = (activityId: string, key: string): string => {
    const seen: string[] = [];
    for (const el of elementsOf(activityId)) {
      const v = el.props[key];
      const s = v === null || v === undefined ? '' : String(v).trim();
      if (s && !seen.includes(s)) seen.push(s);
    }
    return seen.length > MAX_VALUES ? `${seen.slice(0, MAX_VALUES).join(', ')} +${seen.length - MAX_VALUES}` : seen.join(', ');
  };

  const numeric = (id: string, label: string, width: number, get: (activityId: string) => number | null, summable: boolean): ColumnDef => ({
    id, label, group: GROUP, width, align: 'right', summable,
    value: (a) => get(a.id),
    text: (a) => { const v = get(a.id); return v === null ? '' : fmtNum(v); },
    sort: (a) => get(a.id) ?? Number.NEGATIVE_INFINITY,
  });
  const textual = (id: string, label: string, width: number, get: (activityId: string) => string): ColumnDef => ({
    id, label, group: GROUP, width, text: (a) => get(a.id), sort: (a) => get(a.id).toLowerCase(),
  });

  const cols: ColumnDef[] = [
    textual('obj:level', 'Level', 80, objects.levelOf),
    textual('obj:pourType', 'Pour Type', 130, objects.pourTypeOf),
    numeric('obj:pourVolume', 'Pour Volume (m3)', 130, (id) => sumOf(id, `${POUR}Pour Volume m3`), true),
    numeric('obj:height', 'Height (m)', 100, heightOf, false),
    numeric('obj:count', 'Linked objects', 110, (id) => { const n = elementsOf(id).length; return n || null; }, true),
  ];
  // Everything else the objects carry, by property (the picker's search finds them).
  for (const key of [...keys].sort()) {
    const sample = [...linked].slice(0, 200).map((el) => el.props[key]).filter((v) => v !== undefined && v !== '');
    const isNumber = sample.length > 0 && sample.every((v) => asNumber(v) !== null);
    cols.push({
      id: `obj:prop:${key}`, label: key, group: GROUP, width: 130, align: isNumber ? 'right' : undefined,
      text: (a) => distinct(a.id, key),
      sort: (a) => {
        const first = elementsOf(a.id).map((el) => asNumber(el.props[key])).find((n) => n !== null);
        return isNumber ? first ?? Number.NEGATIVE_INFINITY : distinct(a.id, key).toLowerCase();
      },
    });
  }
  return cols;
}
