/** Projects whose models have been put back after a start (they load a moment after the page does). Until then "0 models" is not true. */
const done = new Set<string>();
const listeners = new Set<() => void>();

export const restoreStatus = {
  done: (root: string) => done.has(root),
  mark(root: string) {
    done.add(root);
    for (const l of listeners) l();
  },
  onChange(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};
