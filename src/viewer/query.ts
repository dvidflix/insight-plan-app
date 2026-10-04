import type { ElementSummary } from './types';
import { customFieldKeys } from '../state/customFieldsStore';

export interface QueryCondition {
  propKey: string; // '_category' | '_name' | 'Pset.Property'
  op: 'equals' | 'contains';
  value: string;
}

export type QueryMode = 'AND' | 'OR';

function fieldValue(el: ElementSummary, propKey: string): string {
  if (propKey === '_category') return el.category;
  if (propKey === '_name') return el.name;
  return String(el.props[propKey] ?? '');
}

function matches(el: ElementSummary, cond: QueryCondition): boolean {
  const v = fieldValue(el, cond.propKey).toLowerCase();
  const target = cond.value.toLowerCase();
  return cond.op === 'equals' ? v === target : v.includes(target);
}

export function evaluateQuery(elements: ElementSummary[], conditions: QueryCondition[], mode: QueryMode): number[] {
  if (conditions.length === 0) return [];
  return elements
    .filter((el) => (mode === 'AND' ? conditions.every((c) => matches(el, c)) : conditions.some((c) => matches(el, c))))
    .map((el) => el.localId);
}

/** All distinct property keys across a sample of elements, for building
    condition/quantity pickers without scanning the whole (possibly huge) model. */
export function samplePropKeys(elements: ElementSummary[], sampleSize = 300): string[] {
  const keys = new Set<string>(['_category', '_name']);
  for (const el of elements.slice(0, sampleSize)) {
    for (const k of Object.keys(el.props)) keys.add(k);
  }
  // The custom fields (SeaTable columns) are on some elements only: list them whatever the sample holds.
  for (const k of customFieldKeys()) keys.add(k);
  return [...keys];
}
