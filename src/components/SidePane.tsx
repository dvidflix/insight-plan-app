import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSidePaneStore } from '../state/sidePaneStore';
import { ResizeHandle, useResizableWidth } from './ResizeHandle';
import { SettingsPanel } from './SettingsMenu';
import { IconChevronLeft, IconGear, IconSidePanel } from './icons';

export interface SidePaneTab<Id extends string = string> {
  id: Id;
  label: string;
  icon: ReactNode;
  /** Count shown on the icon (e.g. rules configured); 0 hides it. */
  badge?: number;
}

/** The app's one side pane, full window height on the right: an icon tab
    bar as tall as the top bar (the page's tabs, then Settings, equal widths)
    over the active tab. Hidden, it
    leaves a thin strip with an arrow to bring it back. Pages fill it with
    <SidePane>; with none showing, it holds Settings alone. */
export function SidePaneHost() {
  const claims = useSidePaneStore((s) => s.claims);
  // A page without tabs (Inputs) keeps the pane hidden until asked for.
  const open = useSidePaneStore((s) => (s.claims === 0 ? s.bareOpen : s.open));
  const setOpen = useSidePaneStore((s) => s.setOpen);
  const dockClaims = useSidePaneStore((s) => s.dockClaims);
  const width = useResizableWidth('sidePane.width', 380, 280, 760);
  const paneRef = useRef<HTMLElement | null>(null);
  // The docked panel's share of the pane's height (drag the divider; remembered).
  const [split, setSplit] = useState(() => {
    const v = Number(localStorage.getItem('sidePane.dockSplit'));
    return v >= 0.15 && v <= 0.85 ? v : 0.5;
  });
  const startSplit = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = paneRef.current?.getBoundingClientRect();
    if (!rect) return;
    let last = split;
    const move = (ev: MouseEvent) => {
      last = Math.min(0.85, Math.max(0.15, (rect.bottom - ev.clientY) / rect.height));
      setSplit(last);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      localStorage.setItem('sidePane.dockSplit', String(last));
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  if (!open) {
    return (
      <button type="button" className="side-pane-reveal" title="Show side pane" aria-label="Show side pane" onClick={() => setOpen(true)}>
        <IconChevronLeft />
      </button>
    );
  }
  return (
    <>
      <ResizeHandle onMouseDown={width.startDrag(true)} />
      <aside className="config-panel side-pane" style={{ width: width.width }} ref={paneRef}>
        <div className="side-pane__main" ref={(el) => { if (useSidePaneStore.getState().host !== el) useSidePaneStore.setState({ host: el }); }}>
          {claims === 0 && <PaneContent tabs={[]} active="" onSelect={() => {}} />}
        </div>
        {dockClaims > 0 && <div className="side-pane__split" role="separator" aria-orientation="horizontal" aria-label="Resize the docked panel" tabIndex={0} onMouseDown={startSplit} />}
        <div
          className="side-pane__dock"
          style={dockClaims > 0 ? { flex: `0 0 ${split * 100}%` } : { display: 'none' }}
          ref={(el) => { if (useSidePaneStore.getState().dockHost !== el) useSidePaneStore.setState({ dockHost: el }); }}
        />
      </aside>
    </>
  );
}

/** A page's tabs in the side pane. `children` is the active tab's body;
    `bodyClassName` replaces the default padded, scrolling body. */
export function SidePane<Id extends string>(props: {
  tabs: SidePaneTab<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  bodyClassName?: string;
  /** Shown under the body of the page's tabs (not under Settings). */
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const host = useSidePaneStore((s) => s.host);
  const open = useSidePaneStore((s) => s.open);
  useEffect(() => {
    useSidePaneStore.setState((s) => ({ claims: s.claims + 1 }));
    return () => { useSidePaneStore.setState((s) => ({ claims: s.claims - 1 })); };
  }, []);
  if (!open || !host || !host.isConnected) return null;
  return createPortal(<PaneContent {...props} />, host);
}

function PaneContent<Id extends string>({ tabs, active, onSelect, bodyClassName, footer, children }: {
  tabs: SidePaneTab<Id>[];
  active: Id;
  onSelect: (id: Id) => void;
  bodyClassName?: string;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const settingsPicked = useSidePaneStore((s) => s.settings);
  const setSettings = useSidePaneStore((s) => s.setSettings);
  const setOpen = useSidePaneStore((s) => s.setOpen);
  const settings = settingsPicked || tabs.length === 0;

  const tabButton = (key: string, label: string, icon: ReactNode, selected: boolean, onClick: () => void, badge = 0) => (
    <button key={key} type="button" role="tab" aria-selected={selected} aria-label={label} title={label} className={`side-pane__tab${selected ? ' active' : ''}`} onClick={onClick}>
      {icon}
      {badge > 0 && <span className="side-pane__badge">{badge}</span>}
    </button>
  );

  return (
    <>
      <div className="side-pane__bar" role={tabs.length ? 'tablist' : undefined}>
        {tabs.map((t) => tabButton(t.id, t.label, t.icon, !settings && t.id === active, () => { setSettings(false); onSelect(t.id); }, t.badge))}
        {/* A page without tabs of its own: Settings is all there is — a title, not a lone tab. */}
        {tabs.length ? tabButton('settings', 'Settings', <IconGear />, settings, () => setSettings(true)) : <span className="side-pane__title">Settings</span>}
        <button type="button" className="side-pane__hide" title="Hide side pane" aria-label="Hide side pane" onClick={() => setOpen(false)}>
          <IconSidePanel />
        </button>
      </div>
      {settings ? (
        <div className="config-panel__body side-pane__settings" role="tabpanel"><SettingsPanel /></div>
      ) : (
        <>
          <div className={bodyClassName ?? 'config-panel__body'} role="tabpanel">{children}</div>
          {footer}
        </>
      )}
    </>
  );
}

/** A page's second panel, under the side pane's tabs: the pane is split in
    two, with a draggable divider. Shown only while the pane is open. */
export function SidePaneDock({ children }: { children: ReactNode }) {
  const dockHost = useSidePaneStore((s) => s.dockHost);
  const open = useSidePaneStore((s) => s.open);
  useEffect(() => {
    useSidePaneStore.setState((s) => ({ dockClaims: s.dockClaims + 1 }));
    return () => { useSidePaneStore.setState((s) => ({ dockClaims: s.dockClaims - 1 })); };
  }, []);
  if (!open || !dockHost || !dockHost.isConnected) return null;
  return createPortal(children, dockHost);
}
