import { useEffect, useSyncExternalStore } from 'react';
import type { WbsTreeNode } from '../schedule/wbsTree';

/** The WBS order the user set (Programmes > WBS, the arrows): for each parent WBS path ('' = the top level), its
    children's paths in the order wanted. Kept in the browser (and so in the scene and the project database's
    settings), applied to the WBS view, the Table and the Gantt, and sent to the generator so the schedule it
    writes has its WBS in this order. */
export type WbsOrder = Record<string, string[]>;

const KEY = 'schedule.wbsResourceOrder';

const read = (): WbsOrder => {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as WbsOrder) : {};
  } catch {
    return {};
  }
};

let current = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getWbsOrder = (): WbsOrder => current;

export function setWbsOrder(next: WbsOrder) {
  current = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // not remembered
  }
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

export function useWbsOrder(): readonly [WbsOrder, (next: WbsOrder) => void] {
  const order = useSyncExternalStore(subscribe, getWbsOrder);
  // Settings pulled in from the project database replace it (db/uiSettingsSync.ts).
  useEffect(() => {
    const onApplied = (e: Event) => {
      if ((e as CustomEvent<{ keys: string[] }>).detail.keys.includes(KEY)) {
        current = read();
        emit();
      }
    };
    window.addEventListener('ip-ui-settings', onApplied);
    return () => window.removeEventListener('ip-ui-settings', onApplied);
  }, []);
  return [order, setWbsOrder] as const;
}

/** Puts every level of a WBS tree in the saved order (levels the order doesn't list keep their place, after the listed ones). */
export function applyWbsOrder<T>(tree: WbsTreeNode<T>[], order: WbsOrder, parentKey = ''): WbsTreeNode<T>[] {
  const list = order[parentKey];
  const rank = (n: WbsTreeNode<T>) => {
    const i = list ? list.indexOf(n.path) : -1;
    return i < 0 ? (list?.length ?? 0) : i;
  };
  const sorted = list ? [...tree].sort((a, b) => rank(a) - rank(b)) : tree;
  return sorted.map((n) => ({ ...n, children: applyWbsOrder(n.children, order, n.path) }));
}
