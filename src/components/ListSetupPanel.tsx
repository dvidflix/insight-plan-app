import { useCallback, useEffect, useState } from 'react';
import { activeTargetId, useListConfigStore, type ConfigKind } from '../state/listConfigStore';
import { useDockNavStore } from '../state/dockNavStore';
import { IconCellProperties, IconClose, IconColumns, IconFilter, IconGroup, IconPalette, IconPin, IconSort } from './icons';

const KIND_LABEL: Record<ConfigKind, string> = { filters: 'Filters', group: 'Group', sort: 'Sort', color: 'Colour', columns: 'Columns' };
const KIND_ICON = { filters: IconFilter, group: IconGroup, sort: IconSort, color: IconPalette, columns: IconColumns };
const SECTION_ORDER: ConfigKind[] = ['filters', 'group', 'sort', 'color', 'columns'];

/** Where the active list draws one setting's body (through ListConfig's portal). */
function Slot({ kind }: { kind: ConfigKind }) {
  const setSlot = useListConfigStore((s) => s.setSlot);
  const ref = useCallback((el: HTMLDivElement | null) => setSlot(kind, el), [setSlot, kind]);
  return <div ref={ref} className="lcfg__slot" />;
}

/** Whether a key press is for typing (so N does not toggle the panel while a name or a number is being entered). */
function typing(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/** The list setup, as Blender's N panel: press N and it opens beside the docks, on the side of them that faces the 3D view. It follows
    the list last clicked in (or the pinned one), so the lists carry no filter, group or sort buttons of their own. */
export function NPanel() {
  const open = useListConfigStore((s) => s.nOpen);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || typing(e.target)) return;
      e.preventDefault();
      const st = useListConfigStore.getState();
      st.setNOpen(!st.nOpen);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const width = useDockNavStore((s) => s.nWidth);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const from = e.clientX;
    const start = width;
    const move = (m: MouseEvent) => {
      // The panel is left of the right dock: dragging its left edge left makes it wider.
      const next = Math.round(Math.min(Math.max(260, start + (from - m.clientX)), Math.min(900, window.innerWidth * 0.6)));
      useDockNavStore.getState().setNWidth(next);
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  if (!open) return null;
  return (
    <>
    <div className="resize-handle" onMouseDown={startResize} role="separator" aria-label="Resize the list setup panel" />
    <aside className="npanel" aria-label="List setup" style={{ width, flexBasis: width }}>
      <div className="npanel__head">
        <IconCellProperties width={18} height={18} />
        <span className="npanel__title">List setup</span>
        <button type="button" className="icon-btn dock__tool" onClick={() => useListConfigStore.getState().setNOpen(false)} title="Close (N)" aria-label="Close list setup"><IconClose /></button>
      </div>
      <ListSetupPanel />
    </aside>
    </>
  );
}

function ListSetupPanel() {
  const targets = useListConfigStore((s) => s.targets);
  const activeId = useListConfigStore((s) => activeTargetId(s));
  const pinned = useListConfigStore((s) => s.pinned);
  const kind = useListConfigStore((s) => s.kind);
  const { setPinned, setKind, setExtraSlot } = useListConfigStore.getState();
  const extraRef = useCallback((el: HTMLDivElement | null) => setExtraSlot(el), [setExtraSlot]);
  const [extraOpen, setExtraOpen] = useState(true);

  const target = activeId ? targets[activeId] : null;
  if (!target) return <div className="flt__hint lcfg__none">Click into a list (the Gantt, Tasks, Data table, Programmes) to set it up here.</div>;
  const kinds = SECTION_ORDER.filter((k) => target.kinds.includes(k));
  const shown = kinds.includes(kind) ? kind : kinds[0];
  return (
    <div className="lcfg">
      <div className="lcfg__head">
        <span className="lcfg__for">List</span>
        <span className="lcfg__name" title={target.label}>{target.label}</span>
        <button type="button" className={`btn btn--small lcfg__pin${pinned === activeId ? ' is-on' : ''}`} onClick={() => setPinned(pinned === activeId ? null : activeId)} title={pinned === activeId ? 'Following this list only: click to follow whichever list you click in' : 'Keep this panel on this list whichever list you click in'} aria-pressed={pinned === activeId}>
          <IconPin width={14} height={14} />
        </button>
      </div>
      {/* Icons, with the name beside the open one (and beside every one when the panel is wide enough). */}
      <div className="lcfg__tabs" role="tablist">
        {kinds.map((k) => {
          const n = k === 'columns' ? 0 : target.badges[k] ?? 0;
          const Icon = KIND_ICON[k];
          return (
            <button key={k} type="button" role="tab" aria-selected={shown === k} className={`lcfg__tab${shown === k ? ' is-active' : ''}`} title={KIND_LABEL[k]} onClick={() => setKind(k)}>
              <Icon width={16} height={16} />
              <span className="lcfg__tab-label">{KIND_LABEL[k]}</span>
              {n > 0 && <span className="dtp__badge">{n}</span>}
            </button>
          );
        })}
      </div>
      <div className="lcfg__body" key={shown}>
        <Slot kind={shown} />
      </div>
      {/* The list's own settings stay at the foot whichever tab is up; the draw point stays mounted while folded. */}
      <div className="lcfg__foot" hidden={!target.hasExtra}>
        <button type="button" className="lcfg__foot-head" aria-expanded={extraOpen} onClick={() => setExtraOpen(!extraOpen)}>
          <span aria-hidden>{extraOpen ? '▾' : '▸'}</span> {target.label} settings
        </button>
        <div ref={extraRef} className="lcfg__extra" hidden={!extraOpen} />
      </div>
    </div>
  );
}
