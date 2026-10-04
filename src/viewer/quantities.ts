import type { ElementSummary } from './types';

export interface QuantityRow {
  key: string;
  category: string;
  typeName: string;
  count: number;
  area: number;
  volume: number;
  length: number;
  perimeter: number;
  localIds: number[];
}

function firstMatch(props: Record<string, unknown>, suffix: RegExp): number {
  let netValue: number | undefined;
  let anyValue: number | undefined;
  for (const [key, val] of Object.entries(props)) {
    if (!suffix.test(key)) continue;
    const n = Number(val);
    if (!Number.isFinite(n)) continue;
    if (anyValue === undefined) anyValue = n;
    if (/net/i.test(key)) netValue = n;
  }
  return netValue ?? anyValue ?? 0;
}

/** Aggregates elements grouped by category + type name into Count/Area/
    Volume/Length/Perimeter rows for the quantities panel (grouped by
    Qto_* quantity sets). */
export function computeQuantities(elements: ElementSummary[]): QuantityRow[] {
  const groups = new Map<string, QuantityRow>();
  for (const el of elements) {
    const typeName = el.name || 'Unnamed';
    const key = `${el.category}::${typeName}`;
    let row = groups.get(key);
    if (!row) {
      row = { key, category: el.category || 'Uncategorized', typeName, count: 0, area: 0, volume: 0, length: 0, perimeter: 0, localIds: [] };
      groups.set(key, row);
    }
    row.count++;
    row.area += firstMatch(el.props, /Area$/i);
    row.volume += firstMatch(el.props, /Volume$/i);
    row.length += firstMatch(el.props, /Length$/i);
    row.perimeter += firstMatch(el.props, /Perimeter$/i);
    row.localIds.push(el.localId);
  }
  return [...groups.values()].sort((a, b) => a.category.localeCompare(b.category) || a.typeName.localeCompare(b.typeName));
}
