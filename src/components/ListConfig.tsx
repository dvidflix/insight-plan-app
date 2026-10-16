import { useCallback, useEffect, type ReactNode } from 'react';
import { ToolPopover } from './TablePopovers';
import { IconColumns, IconFilter, IconGroup, IconPalette, IconSort } from './icons';
import { createPortal } from 'react-dom';
import { activeTargetId, CONFIG_KINDS, useListConfigStore, type ConfigKind } from '../state/listConfigStore';

/** What a list gives the shared Columns / Filters / Group / Sort / Color panels: its own bodies, drawn into them while it is
    the list they are for. It stays mounted with its list, so its state and handlers stay where they were. */
export function ListConfig({ id, label, badges, panels }: { id: string; label: string; badges?: Partial<Record<ConfigKind, number>>; panels: Partial<Record<ConfigKind, ReactNode>> }) {
  const kinds = CONFIG_KINDS.filter((k) => panels[k] != null);
  const kindKey = kinds.join();
  const badgeKey = JSON.stringify(badges ?? {});
  useEffect(() => {
    useListConfigStore.getState().register({ id, label, kinds: kindKey ? (kindKey.split(',') as ConfigKind[]) : [], badges: JSON.parse(badgeKey) });
  }, [id, label, kindKey, badgeKey]);
  useEffect(() => () => useListConfigStore.getState().unregister(id), [id]);
  const mine = useListConfigStore((s) => activeTargetId(s) === id);
  const slots = useListConfigStore((s) => s.slots);
  if (!mine) return null;
  return <>{kinds.map((k) => (slots[k] ? createPortal(panels[k], slots[k] as HTMLElement, k) : null))}</>;
}

/** Makes a list the one the tools are for. */
export function openConfig(id: string) {
  useListConfigStore.getState().focus(id);
}

/** Where a popover draws what the list gives that setting (its body goes in through ListConfig's portal). */
function Slot({ kind }: { kind: ConfigKind }) {
  const setSlot = useListConfigStore((s) => s.setSlot);
  const ref = useCallback((el: HTMLDivElement | null) => setSlot(kind, el), [setSlot, kind]);
  return <div ref={ref} className="lcfg__slot" />;
}

const TOOLS: { kind: ConfigKind; label: string; icon: ReactNode; one: string }[] = [
  { kind: 'filters', label: 'Filter', icon: <IconFilter width={16} height={16} />, one: 'filter' },
  { kind: 'sort', label: 'Sort', icon: <IconSort width={16} height={16} />, one: 'sort' },
  { kind: 'group', label: 'Group', icon: <IconGroup width={16} height={16} />, one: 'group' },
  { kind: 'columns', label: 'Columns', icon: <IconColumns width={16} height={16} />, one: 'column' },
  { kind: 'color', label: 'Color', icon: <IconPalette width={16} height={16} />, one: 'rule' },
];

/** A table's tools as SeaTable has them: Filter, Sort, Group, Columns and Color, each a button with its popover under it, lit with a
    count when something is set. They are for the list `id`, whatever was clicked last. */
export function ListTools({ id, iconOnly = true }: { id: string; iconOnly?: boolean }) {
  const target = useListConfigStore((s) => s.targets[id]);
  if (!target) return null;
  return (
    <span className="tp-row">
      {TOOLS.filter((t) => target.kinds.includes(t.kind)).map((t) => {
        const n = target.badges[t.kind] ?? 0;
        return (
          <ToolPopover key={t.kind} icon={t.icon} label={t.label} active={n} activeLabel={t.kind === 'columns' ? t.label : `${n} ${t.one}${n === 1 ? '' : 's'}`} width={t.kind === 'filters' ? 540 : 480} iconOnly={iconOnly} onOpen={() => useListConfigStore.getState().focus(id)}>
            <Slot kind={t.kind} />
          </ToolPopover>
        );
      })}
    </span>
  );
}

/** (The five panels are gone from the docks: each table has its tools in its toolbar.) */
export function ListConfigPanels() {
  return null;
}
