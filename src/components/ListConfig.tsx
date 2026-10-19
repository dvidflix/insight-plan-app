import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { activeTargetId, CONFIG_KINDS, useListConfigStore, type ConfigKind } from '../state/listConfigStore';

/** What a list gives the shared Columns / Filters / Group / Sort / Color panels: its own bodies, drawn into them while it is
    the list they are for. It stays mounted with its list, so its state and handlers stay where they were. */
export function ListConfig({ id, label, badges, panels, extra, searchable, level }: { /** The header's search box filters this list while it is the active one. */ searchable?: boolean; /** The header's ‹ 2 › stepper sets how many group levels this list shows while it is the active one (omit when it has no groups). */ level?: { value: string; max: number; set: (value: string) => void }; id: string; label: string; badges?: Partial<Record<ConfigKind, number>>; panels: Partial<Record<ConfigKind, ReactNode>>; /** The list's own setup (presets, twin models ...), drawn above the settings. */ extra?: ReactNode }) {
  const hasExtra = extra != null;
  const kinds = CONFIG_KINDS.filter((k) => panels[k] != null);
  const kindKey = kinds.join();
  const badgeKey = JSON.stringify(badges ?? {});
  // The setter is read through a ref, so the registered one never goes stale.
  const setLevel = useRef(level?.set);
  setLevel.current = level?.set;
  const hasLevel = !!level;
  const levelValue = level?.value ?? '';
  const levelMax = level?.max ?? 0;
  useEffect(() => {
    useListConfigStore.getState().register({
      id, label, kinds: kindKey ? (kindKey.split(',') as ConfigKind[]) : [], badges: JSON.parse(badgeKey), hasExtra, searchable: !!searchable,
      level: hasLevel ? { value: levelValue, max: levelMax, set: (v) => setLevel.current?.(v) } : undefined,
    });
  }, [id, label, kindKey, badgeKey, hasExtra, searchable, hasLevel, levelValue, levelMax]);
  useEffect(() => () => useListConfigStore.getState().unregister(id), [id]);
  const mine = useListConfigStore((s) => activeTargetId(s) === id);
  const slots = useListConfigStore((s) => s.slots);
  const extraSlot = useListConfigStore((s) => s.extraSlot);
  if (!mine) return null;
  return (
    <>
      {extra && extraSlot ? createPortal(extra, extraSlot, 'extra') : null}
      {kinds.map((k) => (slots[k] ? createPortal(panels[k], slots[k] as HTMLElement, k) : null))}
    </>
  );
}

/** Makes a list the one the setup panel is for (at a setting, when given) and brings the panel up. */
export function openConfig(id: string, kind?: ConfigKind) {
  useListConfigStore.getState().focus(id, kind);
  useListConfigStore.getState().setNOpen(true);
}
