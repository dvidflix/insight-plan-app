import { create } from 'zustand';

/** Site capacity per labour trade (resource name → people per day), over
    the programme's own max units: Programmes > Resources' levelling limit.
    Kept in the browser (same key and format as before) and, with a project
    database open, in its ip_trade_capacity table (see db/dbSync.ts). */

const KEY = 'resources.capacity';

function load(): Record<string, number> {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? {} : (JSON.parse(v) as Record<string, number>);
  } catch {
    return {};
  }
}

export const useTradeCapacityStore = create<{ capacities: Record<string, number> }>(() => ({ capacities: load() }));

useTradeCapacityStore.subscribe((s, prev) => {
  if (s.capacities === prev.capacities) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(s.capacities));
  } catch {
    // not remembered
  }
});

export const setTradeCapacities = (capacities: Record<string, number>) => useTradeCapacityStore.setState({ capacities });
