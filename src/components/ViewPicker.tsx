import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { useAppPrefsStore } from '../state/appPrefsStore';
import { DOCK_DEFAULTS, DOCK_SIDES, panelOrder, SIDE_LABEL, useDockStore, type DockPanelId, type DockSide } from '../state/dockStore';
import { SCHEDULE_TABS, type TabId } from '../pages/SchedulePage';
import { SideIcon, TAB_ICONS } from './Dock';
import { IS_SATELLITE } from '../state/satellite';
import { usePersistedState } from '../utils/persistedState';
import { openSatelliteWindow } from '../state/windowSync';
import { blockedWindows } from '../state/workspaces';
import { WindowsFooter } from './WorkspaceBar';
import { scenes } from '../state/scenes';
import { GlobalSearch } from './GlobalSearch';
import { ToolPopover } from './TablePopovers';
import { IconChecklist, IconChevronDown, IconDashboard, IconEyeOff, IconHome, IconGantt, IconLineGraph, IconList, IconPencil, IconSchema, IconShortText, IconSidePanel, IconGridTable, IconSplit, IconTagOutline, IconTimeline, IconTree, IconTwoPane } from './icons';

export interface PageItem {
  id: string;
  label: string;
  icon: ReactNode;
}

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** The icons of the Programmes views in the picker. */
const VIEW_ICONS: Record<TabId, Icon> = {
  gantt: IconGantt, activities: IconGridTable, planner: IconPencil, wbs: IconTree, codes: IconTagOutline, resources: IconLineGraph,
  calendars: IconTimeline, heatmap: IconDashboard, lookahead: IconList, compare: IconTwoPane, concrete: IconTwoPane, checks: IconChecklist,
  reports: IconDashboard, bulkedit: IconPencil, renumber: IconShortText, explorer: IconSchema, network: IconSchema, ppc: IconChecklist,
  montecarlo: IconLineGraph, anonymise: IconEyeOff, whatif: IconSplit,
};

/** Everything is something the main window can show, a panel that sits left, bottom or right, or both (the Gantt). They are
    grouped by what they are about. */
type Group = 'Inputs' | 'Planning' | 'Models' | 'Tools';
/** The first column is Inputs (its page, its tools, the workspaces). The other three are a table read across: a row per stream
    (Planning, Models, Tools: analysis, the settings and the other pages), with the stream's name, then the views it can show in the main window, then its panels, so
    the panels line up with the stream they belong to. */
const STREAMS: Group[] = ['Models', 'Planning', 'Tools'];

const VIEW_GROUP: Record<TabId, Group> = {
  gantt: 'Planning', activities: 'Planning', planner: 'Planning', wbs: 'Planning', codes: 'Planning', resources: 'Planning',
  calendars: 'Planning', heatmap: 'Planning', lookahead: 'Planning',
  compare: 'Tools', concrete: 'Tools', checks: 'Tools', reports: 'Tools', explorer: 'Tools', network: 'Tools', ppc: 'Tools', montecarlo: 'Tools', whatif: 'Tools',
  bulkedit: 'Tools', renumber: 'Tools', anonymise: 'Tools',
};

const PANEL_GROUP: Partial<Record<DockPanelId, Group>> = {
  details: 'Planning', links: 'Planning', predecessors: 'Planning', successors: 'Planning', layouts: 'Planning', planning: 'Planning', gantt: 'Planning', resources: 'Planning', scenarios: 'Planning', recipes: 'Planning', rules: 'Planning', dictionary: 'Planning', generated: 'Planning',
  related: 'Models', tree: 'Models', properties: 'Models', search: 'Models', views: 'Models', viewpoints: 'Models', colour: 'Models', clash: 'Models',
  datatable: 'Models', files: 'Models', topics: 'Models', fourD: 'Models', tasks: 'Models',
  checks: 'Tools', compare: 'Tools',
};

/** The Tools panels in this order (the list settings first). */
const TOOL_ORDER: DockPanelId[] = ['checks', 'compare', 'cfgColumns', 'cfgFilters', 'cfgGroup', 'cfgSort', 'cfgColor', 'dictionary', 'generated', 'settings', 'tableSetup', 'scenarioSettings'];

interface Row {
  key: string;
  label: string;
  icon: ReactNode;
  group: Group;
  /** The main window can show it: whether it does now, and how to make it. */
  main?: { on: boolean; run: () => void };
  /** It is a panel. */
  panel?: DockPanelId;
  /** A view that is also a panel (the Gantt): the row shows the view; its panel has a row of its own with the side buttons. */
  sides?: boolean;
  /** The panel is what the main window shows now: docking it hands the main window back to the 3D view. */
  leaveMain?: boolean;
}

/** A row of the picker, whatever it is: the same four buttons, main window, left, bottom and right, each working where it can. */
function PickerRow({ row, close, backTo3D }: { row: Row; close: () => void; backTo3D: () => void }) {
  const entry = useDockStore((s) => (row.panel ? s.entries[row.panel] : undefined));
  const placement = useDockStore((s) => (row.panel ? s.placement[row.panel] : undefined));
  const side: DockSide | 'closed' = row.panel ? placement ?? DOCK_DEFAULTS[row.panel] : 'closed';
  const docked = !!entry && (entry.shown !== undefined ? entry.shown : side !== 'closed');
  const dock = useDockStore.getState;

  const showAsMain = () => {
    if (!row.main) return;
    // The main window and a pane are two places for the same thing: it leaves the pane when it becomes the main window.
    if (row.panel && docked) dock().close(row.panel);
    close();
    row.main.run();
  };
  const onSide = (s: DockSide) => {
    if (!row.panel || !entry) return;
    if (docked && side === s) {
      dock().close(row.panel);
      return;
    }
    dock().move(row.panel, s);
    // It was the main window: the 3D view takes the main window back, with it beside.
    if (row.main?.on || row.leaveMain) backTo3D();
  };
  const name = () => {
    if (row.main) showAsMain();
    else if (row.panel && entry) {
      if (docked) dock().close(row.panel);
      else dock().reveal(row.panel);
    }
  };

  return (
    <div className={`ws-row${row.main?.on ? ' is-main' : docked ? ' is-docked' : ''}`}>
      <button type="button" className="ws-row__name" onClick={name} disabled={!row.main && !entry} title={row.main ? `Show ${row.label} as the main window` : docked ? `Close ${row.label}` : `Open ${row.label}`}>
        {row.icon}
        <span>{row.label}</span>
        
      </button>
      {row.sides !== false && !!row.panel && <span className="ws-row__btns">
        {DOCK_SIDES.map((s) => (entry
          ? <button key={s} type="button" className={`icon-btn dock__tool${docked && side === s ? ' is-on' : ''}`} onClick={() => onSide(s)} title={`${row.label} in the ${SIDE_LABEL[s].toLowerCase()} pane`} aria-label={`${row.label} in the ${SIDE_LABEL[s].toLowerCase()} pane`} aria-pressed={docked && side === s}><SideIcon side={s} /></button>
          : <span key={s} className="dock__tool dock__tool--none" />))}
      </span>}
    </div>
  );
}

/** Like Blender's editor-type button: one menu for everything there is to see. Each row has the same four buttons: show it as the
    main window, or in the left, bottom or right pane. Rows are grouped by what they are about (the programme, the 3D / 4D view,
    analysis, tools). On a Programmes view it sits in that view's toolbar, so a second window can change its view too (it has no
    pages: `pages` is empty there). */
function ViewMenu({ pages, page, onPage, tab, onTab, named = false }: PickerProps) {
  const experimental = useAppPrefsStore((s) => s.experimental);
  const entries = useDockStore((s) => s.entries);
  const [menu, setMenu] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuEl = useRef<HTMLDivElement>(null);
  // The order of the rows of each list (views, panels), as the user dragged them: rows not listed keep their place at the end.
  const [order, setOrder] = usePersistedState<Record<string, string[]>>('picker.order', {});
  const drag = useRef<{ list: string; key: string } | null>(null);
  const [over, setOver] = useState<{ list: string; key: string; after: boolean } | null>(null);
  const sorted = (rows: Row[], list: string) => {
    const saved = order[list];
    if (!saved) return rows;
    const at = (r: Row) => { const i = saved.indexOf(r.key); return i < 0 ? saved.length + rows.indexOf(r) : i; };
    return [...rows].sort((a, b) => at(a) - at(b));
  };
  const dropOn = (list: string, rows: Row[], targetKey: string, after: boolean) => {
    const from = drag.current;
    drag.current = null;
    setOver(null);
    if (!from || from.list !== list || from.key === targetKey) return;
    const keys = rows.map((r) => r.key).filter((k) => k !== from.key);
    const at = keys.indexOf(targetKey) + (after ? 1 : 0);
    keys.splice(at, 0, from.key);
    setOrder((o) => ({ ...o, [list]: keys }));
  };
  /** A row that can be dragged to another place in its list. */
  const row = (r: Row, list: string, rows: Row[]) => (
    <div
      key={r.key}
      className={`ws-drag${over?.list === list && over.key === r.key ? (over.after ? ' drop-after' : ' drop-before') : ''}`}
      draggable
      onDragStart={(e) => { drag.current = { list, key: r.key }; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.key); }}
      onDragOver={(e) => {
        if (drag.current?.list !== list) return;
        e.preventDefault();
        const b = e.currentTarget.getBoundingClientRect();
        const after = e.clientY > b.top + b.height / 2;
        if (over?.key !== r.key || over.after !== after || over.list !== list) setOver({ list, key: r.key, after });
      }}
      onDrop={(e) => { e.preventDefault(); dropOn(list, rows, r.key, over?.key === r.key && over.after); }}
      onDragEnd={() => { drag.current = null; setOver(null); }}
    >
      <PickerRow row={r} close={() => setMenu(false)} backTo3D={backTo3D} />
    </div>
  );
  const [shift, setShift] = useState(0);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [menu]);

  // The menu is wide: when it would run off the right of the window it slides left to fit.
  useLayoutEffect(() => {
    if (!menu) { setShift(0); return; }
    const el = menuEl.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const over = r.right - (window.innerWidth - 8);
    if (over > 0) setShift((cur) => cur - Math.min(over, r.left - 8));
  }, [menu]);

  const views = useMemo(() => SCHEDULE_TABS.filter((t) => !t.experimental || experimental[t.experimental]), [experimental]);
  const here = page === 'schedule' ? views.find((v) => v.id === tab)?.label ?? 'Programmes' : pages.find((p) => p.id === page)?.label ?? 'Page';
  const HereIcon = page === 'schedule' ? VIEW_ICONS[tab] ?? IconGantt : null;
  const hereIcon = HereIcon ? <HereIcon width={16} height={16} /> : pages.find((p) => p.id === page)?.icon;

  const rows = useMemo(() => {
    const out: Row[] = [];
    // Inputs is the first column's big button; Planning and Models are the streams' buttons; the views are rows below.
    for (const p of pages.filter((x) => x.id !== 'schedule' && x.id !== 'home' && x.id !== 'inputs')) {
      out.push({
        key: `page:${p.id}`, label: p.label, icon: p.icon, group: p.id === 'model' || p.id === 'sequence' ? 'Models' : p.id === 'inputs' ? 'Inputs' : 'Tools',
        main: { on: p.id === page, run: () => onPage(p.id) },
      });
    }
    for (const v of views) {
      const ViewIcon = VIEW_ICONS[v.id];
      out.push({
        key: `view:${v.id}`, label: v.label, icon: <ViewIcon width={16} height={16} />, group: VIEW_GROUP[v.id] ?? 'Planning',
        main: { on: page === 'schedule' && tab === v.id, run: () => { onTab(v.id); onPage('schedule'); } },
        panel: v.id === 'gantt' ? 'gantt' : undefined,
        sides: v.id === 'gantt' ? false : undefined,
      });
    }
    for (const e of Object.values(entries)) {
      if (!e || e.id === 'settings' || e.id === 'files') continue; // General settings and Files belong to Home: no row in the picker
      const PanelIcon = TAB_ICONS[e.id];
      out.push({ key: `panel:${e.id}`, label: e.label, icon: PanelIcon ? <PanelIcon width={16} height={16} /> : null, group: PANEL_GROUP[e.id] ?? 'Tools', panel: e.id, leaveMain: e.id === 'gantt' && page === 'schedule' && tab === 'gantt' });
    }
    return out;
  }, [pages, views, entries, page, tab, onPage, onTab]);

  /** Within a group: what the main window can show, in order, then the panels by name (the tools by their own order). */
  const inGroup = (g: Group) => {
    const mine = rows.filter((r) => r.group === g);
    const panels = mine.filter((r) => !r.main).sort((a, b) => (g === 'Tools' ? TOOL_ORDER.indexOf(a.panel!) - TOOL_ORDER.indexOf(b.panel!) : a.label.localeCompare(b.label)));
    return [...mine.filter((r) => r.main), ...panels];
  };
  const backTo3D = () => onPage(pages.some((p) => p.id === 'model') ? 'model' : 'schedule');

  return (
    <div className="ws-page" ref={root}>
      <button type="button" className={`ws-page__btn${menu ? ' is-open' : ''}${!IS_SATELLITE && blockedWindows().length > 0 ? ' has-alert' : ''}`} onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label="What the main window shows, and the panes around it" title={`Showing: ${here}. Choose what shows: as the main window, or in a left, bottom or right pane`}>
        <IconChevronDown className="ws-page__chev" width={16} height={16} />
        {hereIcon}
        {named && <span className="ws-page__name">{here}</span>}
      </button>
      {menu && (
        <div className="ws-page__menu ws-page__menu--streams" role="menu" ref={menuEl} style={shift ? { left: shift } : undefined}>
          <div className="ws-views">
            {STREAMS.map((g) => {
              const list = inGroup(g);
              if (list.length === 0) return null;
              const views = sorted(list.filter((r) => r.main), g + ':views');
              return (
                <div key={g} className="ws-views__group" role="group" aria-label={g}>
                  <div className="ws-views__label">{g}</div>
                  {views.map((r) => row(r, g + ':views', views))}
                </div>
              );
            })}
          </div>
          <WindowsFooter onNewWindow={() => openSatelliteWindow(tab)} close={() => setMenu(false)} />
        </div>
      )}
    </div>
  );
}

type PickerProps = { /** No view menu (the Home page has nothing to switch to). */ hideView?: boolean; /** Shows the name of what is showing beside the icon. */ named?: boolean; pages: PageItem[]; page: string; onPage: (id: string) => void; tab: TabId; onTab: (id: TabId) => void; /** Beside the view button, before the search (the Programmes level). */ afterView?: ReactNode; /** After the search box (the tools for what is picked). */ afterSearch?: ReactNode; /** The search box is placed elsewhere by the page. */ hideSearch?: boolean };

/** The first button of the bar: the Home icon with the name of the scene you are in. Home is the first page of the app, where the scenes are. */
function HomeButton({ pages, page, onPage }: Pick<PickerProps, 'pages' | 'page' | 'onPage'>) {
  const [store, setStore] = useState(scenes.get);
  useEffect(() => {
    const refresh = () => setStore(scenes.get());
    window.addEventListener('ip-scenes', refresh);
    return () => window.removeEventListener('ip-scenes', refresh);
  }, []);
  const name = store.scenes.find((s) => s.id === store.activeId)?.name ?? 'Scene';
  if (!pages.some((p) => p.id === 'home')) return null;
  return (
    <button type="button" className={'ws-page__btn ws-top__btn' + (page === 'home' ? ' is-on' : '')} onClick={() => onPage('home')} aria-pressed={page === 'home'} aria-label="Home" title={'Home: the scenes and workspaces. You are in ' + name}>
      <IconHome width={16} height={16} />
    </button>
  );
}

/** The top bar's three buttons: the scene (the Inputs page), the workspace, and what the main window shows with its panels. */
export function ViewPicker(props: PickerProps) {
  return (
    <div className="ws-top">
      {!IS_SATELLITE && <HomeButton pages={props.pages} page={props.page} onPage={props.onPage} />}
      {!props.hideView && <ViewMenu {...props} />}
      {props.afterView}
      {!props.hideSearch && <GlobalSearch pages={props.pages} onPage={props.onPage} onTab={props.onTab} />}
      {props.afterSearch}
    </div>
  );
}

/** The Panels button, at the right end of a toolbar: a popover with the panels there are on the page showing, each with its left, bottom
    and right buttons (a click on the name opens or closes it). One list in the order of the tabs: drag a row to change that order (the
    ones you use most first); the order is kept with the workspace. */
export function PanelsButton() {
  const entries = useDockStore((s) => s.entries);
  const order = useDockStore((s) => s.order);
  const drag = useRef<string | null>(null);
  const [over, setOver] = useState<{ key: string; after: boolean } | null>(null);
  const rows = useMemo(() => {
    const byId = new Map<string, Row>();
    for (const e of Object.values(entries)) {
      if (!e) continue;
      const PanelIcon = TAB_ICONS[e.id];
      byId.set(e.id, { key: 'panel:' + e.id, label: e.label, icon: PanelIcon ? <PanelIcon width={16} height={16} /> : null, group: PANEL_GROUP[e.id] ?? 'Tools', panel: e.id });
    }
    return panelOrder(order).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }, [entries, order]);
  if (rows.length === 0) return null;

  const drop = (targetId: string, after: boolean) => {
    const from = drag.current;
    drag.current = null;
    setOver(null);
    if (!from || from === targetId) return;
    // The whole order is written down, so the panels not on this page keep their places too.
    const all = panelOrder(order).filter((id) => id !== from);
    const at = all.indexOf(targetId as DockPanelId) + (after ? 1 : 0);
    all.splice(at, 0, from as DockPanelId);
    useDockStore.getState().setOrder(all);
  };
  return (
    <span className="panels-btn">
      <ToolPopover icon={<IconSidePanel width={20} height={20} />} label="Panels" iconOnly={false} width={400}>
        <div className="ws-views">
          <div className="ws-views__heads"><span className="ws-page__sides">Drag to put them in order · Left · Bottom · Right</span></div>
          {rows.map((r) => (
            <div
              key={r.key}
              className={'ws-drag' + (over?.key === r.key ? (over.after ? ' drop-after' : ' drop-before') : '')}
              draggable
              onDragStart={(e) => { drag.current = r.panel!; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', r.key); }}
              onDragOver={(e) => {
                if (!drag.current) return;
                e.preventDefault();
                const b = e.currentTarget.getBoundingClientRect();
                const after = e.clientY > b.top + b.height / 2;
                if (over?.key !== r.key || over.after !== after) setOver({ key: r.key, after });
              }}
              onDrop={(e) => { e.preventDefault(); drop(r.panel!, over?.key === r.key && over.after); }}
              onDragEnd={() => { drag.current = null; setOver(null); }}
            >
              <PickerRow row={r} close={() => {}} backTo3D={() => {}} />
            </div>
          ))}
        </div>
      </ToolPopover>
    </span>
  );
}
