import { useEffect, useState } from 'react';

/** localStorage-backed useState — same call shape as useState, but the
    value survives reloads and round-trips through the app configuration
    file (see appConfig.ts, which snapshots every key under one of
    PERSISTED_CONFIG_PREFIXES). `serialize`/`deserialize` let non-JSON-native
    shapes (Set, Map) plug in; both default to identity for plain
    arrays/records/primitives. */
export function usePersistedState<T>(
  key: string,
  defaultValue: T,
  serialize: (v: T) => unknown = (v) => v,
  deserialize: (v: unknown) => T = (v) => v as T,
): readonly [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? defaultValue : deserialize(JSON.parse(stored));
    } catch {
      return defaultValue;
    }
  });

  // Settings pulled in from the project database (db/uiSettingsSync.ts) replace the value.
  useEffect(() => {
    const onApplied = (e: Event) => {
      if (!(e as CustomEvent<{ keys: string[] }>).detail.keys.includes(key)) return;
      try {
        const stored = localStorage.getItem(key);
        setValue(stored === null ? defaultValue : deserialize(JSON.parse(stored)));
      } catch {
        // keep the current value
      }
    };
    window.addEventListener('ip-ui-settings', onApplied);
    return () => window.removeEventListener('ip-ui-settings', onApplied);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(serialize(value)));
    } catch {
      // Storage full/unavailable — the setting just won't survive a reload.
    }
  }, [key, value, serialize]);

  return [value, setValue] as const;
}

/** usePersistedState specialized for Set<string> (hidden-column sets,
    collapsed-group sets, etc.), which JSON can't represent directly. */
export function usePersistedStringSet(key: string, defaultValue: Set<string> = new Set()) {
  return usePersistedState<Set<string>>(
    key,
    defaultValue,
    (v) => [...v],
    (v) => new Set(v as string[]),
  );
}

/** Every localStorage key under one of these prefixes is treated as part of
    "the app configuration" — captured by exportAppConfig and overwritten by
    importAppConfig. Add a prefix here when a new area starts persisting
    settings this way. */
export const PERSISTED_CONFIG_PREFIXES = ['schedule.', 'table.', 'gantt.', 'viewer.', 'sequence.', 'timelines.'];

export function snapshotPersistedConfig(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && PERSISTED_CONFIG_PREFIXES.some((p) => key.startsWith(p))) {
      out[key] = localStorage.getItem(key) as string;
    }
  }
  return out;
}

export function restorePersistedConfig(snapshot: Record<string, string>) {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key && PERSISTED_CONFIG_PREFIXES.some((p) => key.startsWith(p))) localStorage.removeItem(key);
  }
  for (const [k, v] of Object.entries(snapshot)) localStorage.setItem(k, v);
}
