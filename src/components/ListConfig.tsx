import { useCallback, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DockPanel } from './Dock';
import { useDockStore, type DockPanelId } from '../state/dockStore';
import { activeTargetId, CONFIG_KINDS, useListConfigStore, type ConfigKind } from '../state/listConfigStore';

const KIND_LABEL: Record<ConfigKind, string> = { columns: 'Columns', filters: 'Filters', group: 'Group', sort: 'Sort', color: 'Color' };
const KIND_PANEL: Record<ConfigKind, DockPanelId> = { columns: 'cfgColumns', filters: 'cfgFilters', group: 'cfgGroup', sort: 'cfgSort', color: 'cfgColor' };

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

/** Brings up the settings of a list: it becomes the list the panels are for, and the Columns panel comes up. */
export function openConfig(id: string) {
  useListConfigStore.getState().focus(id);
  useDockStore.getState().reveal('cfgColumns');
}

function PinIcon({ on }: { on: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round">
      <path d="M9.5 1.8 14.2 6.5 12.6 7.1 10.4 9.3 10.9 12 9.9 13 6.6 9.7 2.5 13.8 2.2 13.5 6.3 9.4 3 6.1 4 5.1 6.7 5.6 8.9 3.4Z" />
    </svg>
  );
}

/** The strip at the top of each panel: which list it is for (any list that has this setting can be chosen), and a pin that
    holds it there whatever is clicked. */
function ConfigHead({ kind }: { kind: ConfigKind }) {
  const targets = useListConfigStore((s) => s.targets);
  const activeId = useListConfigStore(activeTargetId);
  const pinned = useListConfigStore((s) => s.pinned);
  const choices = Object.values(targets).filter((t) => t.kinds.includes(kind));
  const active = activeId ? targets[activeId] : undefined;
  const supported = !!active && active.kinds.includes(kind);
  return (
    <div className="lcfg__head">
      <span className="lcfg__for">For</span>
      <select
        className="lcfg__pick"
        value={supported ? active!.id : ''}
        onChange={(e) => useListConfigStore.getState().focus(e.target.value)}
        aria-label={`The list these ${KIND_LABEL[kind].toLowerCase()} settings are for`}
      >
        {!supported && <option value="" disabled>{active ? `${active.label} (none)` : 'No list'}</option>}
        {choices.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>
      <button
        type="button"
        className={`icon-btn lcfg__pin${pinned ? ' is-on' : ''}`}
        aria-pressed={!!pinned}
        disabled={!active}
        onClick={() => useListConfigStore.getState().setPinned(pinned ? null : activeId)}
        title={pinned ? 'Pinned: these settings stay with this list. Click to follow the list you click in again.' : 'Pin: keep these settings on this list, whatever you click in next'}
        aria-label={pinned ? 'Unpin' : 'Pin to this list'}
      >
        <PinIcon on={!!pinned} />
      </button>
    </div>
  );
}

function ConfigSlot({ kind }: { kind: ConfigKind }) {
  const setSlot = useListConfigStore((s) => s.setSlot);
  const ref = useCallback((el: HTMLDivElement | null) => setSlot(kind, el), [setSlot, kind]);
  const targets = useListConfigStore((s) => s.targets);
  const activeId = useListConfigStore(activeTargetId);
  const active = activeId ? targets[activeId] : undefined;
  const others = Object.values(targets).filter((t) => t.kinds.includes(kind) && t.id !== active?.id);
  return (
    <>
      <ConfigHead kind={kind} />
      {active?.kinds.includes(kind)
        ? <div ref={ref} className="config-panel__body lcfg__slot" />
        : (
          <div className="flt__hint lcfg__none">
            {active ? `${active.label} has no ${KIND_LABEL[kind].toLowerCase()} settings.` : 'Click a list to set it up.'}
            {others.length > 0 && ' Pick another list above.'}
          </div>
        )}
    </>
  );
}

function ConfigPanelOf({ kind }: { kind: ConfigKind }) {
  const badge = useListConfigStore((s) => { const id = activeTargetId(s); return id ? s.targets[id]?.badges[kind] ?? 0 : 0; });
  return (
    <DockPanel id={KIND_PANEL[kind]} label={badge ? `${KIND_LABEL[kind]} (${badge})` : KIND_LABEL[kind]}>
      <ConfigSlot kind={kind} />
    </DockPanel>
  );
}

/** The five shared panels, there while any list can be set up (the Panels menu shows them once, for whichever list is active). */
export function ListConfigPanels() {
  const any = useListConfigStore((s) => Object.keys(s.targets).length > 0);
  if (!any) return null;
  return <>{CONFIG_KINDS.map((k) => <ConfigPanelOf key={k} kind={k} />)}</>;
}
