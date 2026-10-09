import { ResizeHandle, useResizableWidth } from './ResizeHandle';
import { PropertiesGrid } from './PropertiesGrid';
import { BottomDock } from './BottomDock';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePersistedState } from '../utils/persistedState';
import { useSequenceUiStore } from '../state/sequenceUiStore';
import { rerenderTables, type ModelPanelId } from '../viewer/viewerUI';
import { ViewpointsHeaderActions, ViewpointsList } from './ViewpointsList';
import { MarkersPanel } from './MarkersPanel';
import { ConstructionPlanesPanel } from './ConstructionPlanesPanel';
import { SectionCutsPanel } from './SectionCutsPanel';
import { ExpandCollapseToggle } from './ExpandCollapseToggle';
import { useViewSettingsGroups } from '../state/viewSettingsGroups';
import { View3DPanel } from './View3DPanel';
import { ModelsPanel } from './sequence/ModelsPanel';
import { IfcTree } from './IfcTree';
import { ModelsList } from './ModelsList';
import { ClashResultsList } from './ContactsSection';
import { SidePane, type SidePaneTab } from './SidePane';
import { IconChevronLeft, IconCamera, IconClose, IconCube, IconList, IconPalette, IconSearch, IconTree, IconViewTable } from './icons';
import { TopicsPanel } from './TopicsPanel';
import { useTopicsStore } from '../state/topicsStore';
import { ModelChecksPanel } from './ModelChecksPanel';
import { ModelComparePanel } from './ModelComparePanel';
import { PropertyEditorPanel } from './PropertyEditorPanel';
import { FlythroughPanel } from './FlythroughPanel';
import { SavedViewAttrsPanel } from './SavedViewAttrsPanel';
import { RelatedPanel } from './RelatedPanel';
import { PropertyVisibilityPanel } from './PropertyVisibilityPanel';
import { ModelColorPanel } from './ModelColorPanel';
import { SearchSetsPanel } from './SearchSetsPanel';
import { DataTablePanel } from './DataTablePanel';
import { useDataTableStore } from '../state/dataTableStore';
import { useOnSplit, useSidePaneStore, useViewpointsToggle } from '../state/sidePaneStore';
import { useAppPrefsStore, useExperimental } from '../state/appPrefsStore';
import { useViewSettingsStore } from '../state/viewSettingsStore';

type TabId = ModelPanelId | 'models' | 'colour' | 'search' | 'datatable';

const TABS: SidePaneTab<TabId>[] = [
  { id: 'models', label: '3D & Related', icon: <IconCube /> },
  { id: 'properties', label: 'Properties', icon: <IconList /> },
  { id: 'tree', label: 'Selection Tree', icon: <IconTree /> },
  { id: 'search', label: 'Search sets', icon: <IconSearch /> },
  { id: 'datatable', label: 'Data table', icon: <IconViewTable /> },
  { id: 'views', label: 'Views', icon: <IconCamera /> },
  { id: 'colour', label: 'Colour', icon: <IconPalette /> },
];

type ToolId = 'checks' | 'compare' | 'topics';
const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'checks', label: 'Model checks' },
  { id: 'compare', label: 'Compare models' },
  { id: 'topics', label: 'Topics' },
];

/** The Models page's tools (Model checks, Compare models, Topics): a wide panel beside the 3D view with its own
    tabs, like 4D Sequencing's Gantt / Tasks / Scenarios; drag its edge to resize, › folds it away. */
export function ModelToolsPanel() {
  const panels = useSequenceUiStore((s) => s.modelPanels);
  const [saved, setTool] = usePersistedState<ToolId>('models.toolsTab', 'checks');
  const [collapsed, setCollapsed] = usePersistedState('models.toolsCollapsed', false);
  const width = useResizableWidth('models.toolsWidth', 560, 300, 900);
  // The Topics tool (BCF) is an experimental feature.
  const bcf = useAppPrefsStore((s) => s.experimental.bcf);
  const tools = useMemo(() => TOOLS.filter((t) => t.id !== 'topics' || bcf), [bcf]);
  const tool: ToolId = tools.some((t) => t.id === saved) ? saved : 'checks';
  // A topic marker clicked in 3D brings the Topics tool up.
  const openRequest = useTopicsStore((st) => st.openRequest);
  const seen = useRef(openRequest);
  useEffect(() => {
    if (openRequest === seen.current) return;
    seen.current = openRequest;
    if (bcf) {
      setTool('topics');
      setCollapsed(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest]);
  if (collapsed) {
    return (
      <button type="button" className="pane-reveal" onClick={() => setCollapsed(false)} title="Show the tools panel" aria-label="Show the tools panel">
        <IconChevronLeft />
      </button>
    );
  }
  return (
    <>
      <ResizeHandle onMouseDown={width.startDrag(true)} />
      <aside className="config-panel seq-panel" style={{ width: width.width, minWidth: 0 }}>
        <div className="filter-sidebar-header seq-righthead">
          <div className="config-tabs seq-righttabs" role="tablist">
            {tools.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tool === t.id} className={`config-tab${tool === t.id ? ' active' : ''}`} onClick={() => setTool(t.id)}>{t.label}</button>
            ))}
          </div>
          <button className="icon-btn pane-hide" type="button" onClick={() => setCollapsed(true)} title="Hide panel" aria-label="Hide panel" style={{ marginLeft: 'auto' }}><IconClose /></button>
        </div>
        <div className="config-panel__body model-config__body" style={{ flex: 1, minHeight: 0 }}>
          {tool === 'checks' ? <ModelChecksPanel /> : tool === 'compare' ? <ModelComparePanel /> : panels ? <div className="tpc-pad"><TopicsPanel /></div> : <div className="flt__hint">Starting viewer…</div>}
        </div>
      </aside>
    </>
  );
}

/** Mounts one of the viewer's Lit panels (built once with the viewer) in
    this tab, and hands it back on unmount so it keeps its state. */
function LitPanel({ element }: { element: HTMLElement }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.append(element);
    rerenderTables(element);
    return () => element.remove();
  }, [element]);
  return <div ref={host} className="model-config__lit viewer-shell" />;
}

/** A real bim-panel-section added to a Lit panel (so it looks and
    collapses like the panel's own sections), with `children` rendered into
    it. Placed after the panel's first section (`second`) or at the end
    (above any sections marked data-trailing);
    starts collapsed and remembers being opened. */
/** `leading` puts the section above the panel's own ones; `defaultOpen`
    opens it until the user collapses it. */
function LitSection({ panel, label, second, leading, defaultOpen, headerAction, children }: { panel: HTMLElement; label: string; second?: boolean; leading?: boolean; defaultOpen?: boolean; headerAction?: ReactNode; children: ReactNode }) {
  const section = useMemo(() => {
    const el = document.createElement('bim-panel-section') as HTMLElement & { label: string; collapsed: boolean };
    el.label = label;
    return el;
  }, [label]);
  useEffect(() => {
    const el = section as HTMLElement & { collapsed: boolean };
    const key = `views.sectionOpen.${label}`;
    let open = !!defaultOpen;
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) open = saved === 'true';
    } catch {
      // storage unavailable: start collapsed
    }
    el.collapsed = !open;
    const first = panel.querySelector('bim-panel-section');
    // Sections the panel keeps last (Views: Storeys) stay below.
    const trailing = panel.querySelector('bim-panel-section[data-trailing]');
    if (leading && first) first.before(el);
    else if (second && first) first.after(el);
    else if (trailing) trailing.before(el);
    else panel.append(el);
    const watch = new MutationObserver(() => {
      try {
        localStorage.setItem(key, String(!el.collapsed));
      } catch {
        // not remembered
      }
    });
    watch.observe(el, { attributes: true, attributeFilter: ['collapsed'] });
    return () => {
      watch.disconnect();
      el.remove();
    };
  }, [panel, section, label, second, leading, defaultOpen]);
  // A button at the right end of the section's header (the library's "header-end" slot).
  const action = useMemo(() => {
    const el = document.createElement('div');
    el.slot = 'header-end';
    el.style.cssText = 'display: flex; align-items: center;';
    // A click on it must not also fold the section.
    el.addEventListener('click', (e) => e.stopPropagation());
    return el;
  }, []);
  useEffect(() => {
    if (!headerAction) return;
    section.append(action);
    return () => action.remove();
  }, [section, action, headerAction]);
  return (
    <>
      {createPortal(children, section)}
      {headerAction ? createPortal(headerAction, action) : null}
    </>
  );
}

/** Collapse / expand every group of View settings, in the section's header. */
function ViewSettingsFoldButton() {
  const open = useViewSettingsGroups((st) => st.open);
  const setAll = useViewSettingsGroups((st) => st.setAll);
  return <ExpandCollapseToggle className="vsp__fold" collapsed={open.length === 0} onCollapse={() => setAll(false)} onExpand={() => setAll(true)} />;
}

/** The Views tab (Models and 4D Sequencing): Viewpoints, with what they keep (Viewpoint
    attributes), and the Fly-through, Decorators, Section cuts and any `extra` sections (the 4D page's Output), and last the page's view settings (`settings`). Only one page shows at a time, so both can host the same panel. */
export function ViewpointsPanel({ element, settings, extra = [] }: { element: HTMLElement; settings: ReactNode; extra?: { label: string; content: ReactNode }[] }) {
  // Section cuts is an experimental feature: no section while it is switched off (Settings › Experimental features).
  const cutsOn = useExperimental('sectionCuts');
  return (
    <BottomDock title="Viewpoint attributes" storageKey="savedViewAttrs" dock={<SavedViewAttrsPanel />}>
      <LitPanel element={element} />
      <LitSection panel={element} label="Viewpoints" leading defaultOpen headerAction={<ViewpointsHeaderActions />}><ViewpointsList /></LitSection>
      <LitSection panel={element} label="Fly-through"><FlythroughPanel /></LitSection>
      <LitSection panel={element} label="Decorators"><div className="disp vsp"><MarkersPanel /><ConstructionPlanesPanel /></div></LitSection>
      {cutsOn && <LitSection panel={element} label="Section cuts"><SectionCutsPanel /></LitSection>}
      {extra.map((x) => (
        <LitSection key={x.label} panel={element} label={x.label}>{x.content}</LitSection>
      ))}
      <LitSection panel={element} label="View settings" headerAction={<ViewSettingsFoldButton />}>{settings}</LitSection>
    </BottomDock>
  );
}

/** Selection Tree, Properties and 3D & Related: in the Models page's side
    pane and in 4D Sequencing's too (the same panels; one page shows at a time). */
export function SelectionTreeTab() {
  const panels = useSequenceUiStore((s) => s.modelPanels);
  if (!panels) return <div className="flt__hint">Starting viewer…</div>;
  return (
    <div className="model-config__tree">
      <ModelsList />
      <IfcTree />
    </div>
  );
}

export function PropertiesTab() {
  const panels = useSequenceUiStore((s) => s.modelPanels);
  if (!panels) return <div className="flt__hint">Starting viewer…</div>;
  return (
    <BottomDock title="Show / hide properties" storageKey="properties" flush dock={<PropertyVisibilityPanel />}>
      <PropertiesGrid />
      <LitPanel element={panels.properties} />
      <LitSection panel={panels.properties} label="Edit properties"><PropertyEditorPanel /></LitSection>
    </BottomDock>
  );
}

/** What touches the selection, clashes & contacts, model placement, and
    the clash results kept at the bottom of the pane. */
export function RelatedTab({ page }: { page: 'model' | 'sequence' }) {
  return (
    <div className="model-config__split">
      <div className="model-config__split-top">
        <RelatedPanel />
        {/* Placement is set once and rarely touched: last, collapsed. */}
        <ModelsPanel page={page} />
      </div>
      <ClashResultsList />
    </div>
  );
}

/** The Models page's tabs in the side pane — model browsing (tree,
    properties, sets, views with the view settings and fly-through,
    topics) and placement. */
export function ModelConfigPanel() {
  const panels = useSequenceUiStore((s) => s.modelPanels);
  const [saved, setTab] = usePersistedState<TabId>('models.configTab', 'models');
  // The Topics tab (BCF) is an experimental feature.
  const tabs = TABS;
  // A remembered tab that no longer exists (View settings and Fly-through
  // are now sections of Views).
  // Related is now part of 3D.
  const tab: TabId = tabs.some((t) => t.id === saved) ? saved : ['view3d', 'flythrough'].includes(saved) ? 'views' : (saved as string) === 'related' ? 'models' : (saved as string) === 'sets' ? 'search' : 'tree';
  // The data table's Configure button brings this pane up on its tab.
  const configRequest = useDataTableStore((s) => s.configRequest);
  useEffect(() => {
    if (!configRequest) return;
    setTab('datatable');
    useSidePaneStore.getState().setOpen(true);
    useSidePaneStore.getState().setSettings(false);
  }, [configRequest, setTab]);
  // Splitting the view brings up Views, to set the two views up.
  const split = useViewSettingsStore((s) => s.pages.model.split);
  useOnSplit(split, () => setTab('views'));
  useViewpointsToggle('model', () => tab === 'views', () => setTab('views'));

  return (
    <>
    <ModelToolsPanel />
    <SidePane tabs={tabs} active={tab} onSelect={setTab} bodyClassName="config-panel__body model-config__body">
      {tab === 'models' ? (
        <RelatedTab page="model" />
      ) : tab === 'tree' ? (
        <SelectionTreeTab />
      ) : tab === 'properties' ? (
        <PropertiesTab />
      ) : tab === 'colour' ? (
        <ModelColorPanel />
      ) : tab === 'search' ? (
        <SearchSetsPanel player />
      ) : tab === 'datatable' ? (
        <DataTablePanel />
      ) : panels && tab === 'views' ? (
        <ViewpointsPanel key={tab} element={panels.views} settings={<View3DPanel page="model" />} />
      ) : (
        <div className="flt__hint">Starting viewer…</div>
      )}
    </SidePane>
    </>
  );
}
