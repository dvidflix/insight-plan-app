import { Fragment, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { useAppPrefsStore } from '../state/appPrefsStore';
import { DOCK_DEFAULTS, DOCK_SIDES, SIDE_LABEL, useDockStore, type DockPanelId, type DockSide } from '../state/dockStore';
import { SCHEDULE_TABS, type TabId } from '../pages/SchedulePage';
import { SideIcon, TAB_ICONS } from './Dock';
import { IS_SATELLITE } from '../state/satellite';
import { openSatelliteWindow } from '../state/windowSync';
import { blockedWindows } from '../state/workspaces';
import { WorkspaceMenu } from './WorkspaceBar';
import { IconChecklist, IconChevronDown, IconDashboard, IconEyeOff, IconGantt, IconLineGraph, IconList, IconPencil, IconSchema, IconShortText, IconSplit, IconTagOutline, IconTimeline, IconTree, IconTwoPane, IconViewTable } from './icons';

export interface PageItem {
  id: string;
  label: string;
  icon: ReactNode;
}

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** The icons of the Programmes views in the picker. */
const VIEW_ICONS: Record<TabId, Icon> = {
  gantt: IconGantt, activities: IconViewTable, planner: IconPencil, wbs: IconTree, codes: IconTagOutline, resources: IconLineGraph,
  calendars: IconTimeline, heatmap: IconDashboard, lookahead: IconList, compare: IconTwoPane, concrete: IconTwoPane, checks: IconChecklist,
  reports: IconDashboard, bulkedit: IconPencil, renumber: IconShortText, explorer: IconSchema, network: IconSchema, ppc: IconChecklist,
  montecarlo: IconLineGraph, anonymise: IconEyeOff, whatif: IconSplit,
};

/** Everything is something the main window can show, a panel that sits left, bottom or right, or both (the Gantt). They are
    grouped by what they are about. */
type Group = 'Inputs' | 'Planning' | 'Models' | 'Analysis' | 'Tools';
/** Four columns. The first three belong to a main page each (a big button at the top: Inputs, Planning, Models) with what
    goes with it below; the last holds the rest: analysis and tools. */
const COLUMNS: Group[][] = [['Inputs'], ['Planning'], ['Models'], ['Analysis', 'Tools']];
/** The page a column's big button opens (absent where the window has no pages). */
const GROUP_PAGE: Partial<Record<Group, { page: string; label: string }>> = { Inputs: { page: 'inputs', label: 'Inputs' }, Planning: { page: 'schedule', label: 'Planning' }, Models: { page: 'model', label: 'Models' } };

const VIEW_GROUP: Record<TabId, Group> = {
  gantt: 'Planning', activities: 'Planning', planner: 'Planning', wbs: 'Planning', codes: 'Planning', resources: 'Planning',
  calendars: 'Planning', heatmap: 'Planning', lookahead: 'Planning',
  compare: 'Analysis', concrete: 'Analysis', checks: 'Analysis', reports: 'Analysis', explorer: 'Analysis', network: 'Analysis', ppc: 'Analysis', montecarlo: 'Analysis', whatif: 'Analysis',
  bulkedit: 'Inputs', renumber: 'Inputs', anonymise: 'Inputs',
};

const PANEL_GROUP: Partial<Record<DockPanelId, Group>> = {
  details: 'Planning', links: 'Planning', predecessors: 'Planning', successors: 'Planning', layouts: 'Planning', planning: 'Planning', gantt: 'Planning',
  related: 'Models', tree: 'Models', properties: 'Models', search: 'Models', views: 'Models', viewpoints: 'Models', colour: 'Models', clash: 'Models',
  datatable: 'Models', topics: 'Models', fourD: 'Models', tasks: 'Models', resources: 'Models', scenarios: 'Models', recipes: 'Models', rules: 'Models',
  checks: 'Analysis', compare: 'Analysis',
};

/** The Tools panels in this order (the list settings first). */
const TOOL_ORDER: DockPanelId[] = ['cfgColumns', 'cfgFilters', 'cfgGroup', 'cfgSort', 'cfgColor', 'dictionary', 'generated', 'settings', 'tableSetup', 'scenarioSettings'];

/** Ctrl+Alt+<key> jumps to these pages (App.tsx). */
const PAGE_KEYS: Record<string, string> = { inputs: 'P', model: 'Q', schedule: 'U', sequence: 'W' };

interface Row {
  key: string;
  label: string;
  icon: ReactNode;
  group: Group;
  hint?: string;
  /** The main window can show it: whether it does now, and how to make it. */
  main?: { on: boolean; run: () => void };
  /** It is a panel (the Gantt is both). */
  panel?: DockPanelId;
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
    if (row.main?.on) backTo3D();
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
        {row.hint && <kbd>{row.hint}</kbd>}
      </button>
      <span className="ws-row__btns">
        {DOCK_SIDES.map((s) => (entry
          ? <button key={s} type="button" className={`icon-btn dock__tool${docked && side === s ? ' is-on' : ''}`} onClick={() => onSide(s)} title={`${row.label} in the ${SIDE_LABEL[s].toLowerCase()} pane`} aria-label={`${row.label} in the ${SIDE_LABEL[s].toLowerCase()} pane`} aria-pressed={docked && side === s}><SideIcon side={s} /></button>
          : <span key={s} className="dock__tool dock__tool--none" />))}
      </span>
    </div>
  );
}

/** Like Blender's editor-type button: one menu for everything there is to see. Each row has the same four buttons: show it as the
    main window, or in the left, bottom or right pane. Rows are grouped by what they are about (the programme, the 3D / 4D view,
    analysis, tools). On a Programmes view it sits in that view's toolbar, so a second window can change its view too (it has no
    pages: `pages` is empty there). */
export function ViewPicker({ pages, page, onPage, tab, onTab, named = false }: { /** Shows the name of what is showing beside the icon. */ named?: boolean; pages: PageItem[]; page: string; onPage: (id: string) => void; tab: TabId; onTab: (id: TabId) => void }) {
  const experimental = useAppPrefsStore((s) => s.experimental);
  const entries = useDockStore((s) => s.entries);
  const [menu, setMenu] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setMenu(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [menu]);

  const views = useMemo(() => SCHEDULE_TABS.filter((t) => !t.experimental || experimental[t.experimental]), [experimental]);
  const here = page === 'schedule' ? views.find((v) => v.id === tab)?.label ?? 'Programmes' : pages.find((p) => p.id === page)?.label ?? 'Page';
  const HereIcon = page === 'schedule' ? VIEW_ICONS[tab] ?? IconGantt : null;
  const hereIcon = HereIcon ? <HereIcon width={16} height={16} /> : pages.find((p) => p.id === page)?.icon;

  const rows = useMemo(() => {
    const out: Row[] = [];
    // Inputs, Planning and Models are the big buttons at the top of their columns, not rows.
    for (const p of pages.filter((x) => x.id !== 'schedule' && x.id !== 'inputs' && x.id !== 'model')) {
      out.push({
        key: `page:${p.id}`, label: p.label, icon: p.icon, group: 'Models',
        hint: PAGE_KEYS[p.id] ? `Ctrl Alt ${PAGE_KEYS[p.id]}` : undefined,
        main: { on: p.id === page, run: () => onPage(p.id) },
      });
    }
    for (const v of views) {
      const ViewIcon = VIEW_ICONS[v.id];
      out.push({
        key: `view:${v.id}`, label: v.label, icon: <ViewIcon width={16} height={16} />, group: VIEW_GROUP[v.id] ?? 'Planning',
        hint: v.id === 'gantt' && pages.length > 0 ? `Ctrl Alt ${PAGE_KEYS.schedule}` : undefined,
        main: { on: page === 'schedule' && tab === v.id, run: () => { onTab(v.id); onPage('schedule'); } },
        panel: v.id === 'gantt' ? 'gantt' : undefined,
      });
    }
    for (const e of Object.values(entries)) {
      if (!e || e.id === 'gantt') continue;
      const PanelIcon = TAB_ICONS[e.id];
      out.push({ key: `panel:${e.id}`, label: e.label, icon: PanelIcon ? <PanelIcon width={16} height={16} /> : null, group: PANEL_GROUP[e.id] ?? 'Tools', panel: e.id });
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
        {hereIcon}
        {named && <span className="ws-page__name">{here}</span>}
        <IconChevronDown width={12} height={12} />
      </button>
      {menu && (
        <div className="ws-page__menu" role="menu">
          {COLUMNS.map((groups, i) => (
            <div key={i} className="ws-page__col">
              {groups.map((g) => {
                const list = inGroup(g);
                if (list.length === 0) return null;
                return (
                  <div key={g} className="ws-page__group">
                    {(() => {
                      const gp = GROUP_PAGE[g];
                      const item = gp && pages.find((p) => p.id === gp.page);
                      if (!gp || !item) return <div className="ws-page__head">{g}</div>;
                      const on = page === gp.page;
                      const hint = gp.page === 'inputs' ? `Ctrl Alt ${PAGE_KEYS.inputs}` : gp.page === 'model' ? `Ctrl Alt ${PAGE_KEYS.model}` : undefined;
                      return (
                        <button type="button" className={`ws-page__big${on ? ' is-on' : ''}`} onClick={() => { setMenu(false); onPage(gp.page); }} aria-pressed={on} title={`Go to ${gp.label}`}>
                          {item.icon}<span>{gp.label}</span>{hint && <kbd>{hint}</kbd>}
                        </button>
                      );
                    })()}
                    {list.map((r, n) => (
                      <Fragment key={r.key}>
                        {!r.main && (n === 0 ? false : list[n - 1].main) && <div className="ws-page__sub"><span>Panels</span><span className="ws-page__sides">Left · Bottom · Right</span></div>}
                        <PickerRow row={r} close={() => setMenu(false)} backTo3D={backTo3D} />
                      </Fragment>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
          <WorkspaceMenu onNewWindow={() => openSatelliteWindow(tab)} close={() => setMenu(false)} readOnly={IS_SATELLITE} />
        </div>
      )}
    </div>
  );
}
