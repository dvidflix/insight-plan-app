/** Browser side of the retired / extra activities bridge (vite-plugins/seatablePlugin.ts): SeaTable's "Retired",
    "Extra activities" and "Baselines" tables, which the scenario generator reads (as a local copy) to leave tasks out of
    a generated programme and to add the extra ones. */

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/seatable/${path}`, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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

export interface AdjustmentsStatus {
  /** Rows of each table; null when the table does not exist in the base. */
  retired: number | null;
  extras: number | null;
  baselines: number | null;
  /** The local copy the generator reads, and when it was last pulled. */
  file: string;
  pulledAt: string | null;
}

export interface AdjustmentsPulled {
  retired: number;
  extras: number;
  baselines: number;
  /** Tables the base does not have (yet). */
  missing: string[];
  file: string;
  pulledAt: string;
}

export const adjustmentsStatus = () => api<AdjustmentsStatus>('adjustments/status');

/** Adds generated tasks to the Retired table (a task already there is left alone). */
export const pushRetired = (tasks: { taskId: string; name?: string; reason?: string }[]) => api<{ added: number; skipped: number }>('retired/push', { tasks });

/** Reads the three tables into the local copy the generator uses. */
export const pullAdjustments = () => api<AdjustmentsPulled>('adjustments/pull', {});
