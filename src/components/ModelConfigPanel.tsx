import { PropertiesGrid } from './PropertiesGrid';
import { BottomDock } from './BottomDock';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePersistedState } from '../utils/persistedState';
import { useSequenceUiStore } from '../state/sequenceUiStore';
import { rerenderTables, type ModelPanelId } from '../viewer/viewerUI';
import { View3DPanel } from './View3DPanel';
import { ModelsPanel } from './sequence/ModelsPanel';
import { IfcTree } from './IfcTree';
import { ClashResultsList } from './ContactsSection';
import { SidePane, type SidePaneTab } from './SidePane';
import { IconCamera, IconChat, IconChecklist, IconCube, IconList, IconPalette, IconSearch, IconSplit, IconTree, IconViewTable } from './icons';
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
import { useOnSplit, useSidePaneStore } from '../state/sidePaneStore';
import { useViewSettingsStore } from '../state/viewSettingsStore';

type TabId = ModelPanelId | 'models' | 'colour' | 'search' | 'datatable' | 'checks' | 'compare';

const TABS: SidePaneTab<TabId>[] = [
  { id: 'tree', label: 'Selection Tree', icon: <IconTree /> },
  { id: 'properties', label: 'Properties', icon: <IconList /> },
  { id: 'search', label: 'Search sets', icon: <IconSearch /> },
  { id: 'datatable', label: 'Data table', icon: <IconViewTable /> },
  { id: 'views', label: 'Views', icon: <IconCamera /> },
  { id: 'models', label: '3D & Related', icon: <IconCube /> },
  { id: 'colour', label: 'Colour', icon: <IconPalette /> },
  { id: 'checks', label: 'Model checks', icon: <IconChecklist /> },
  { id: 'compare', label: 'Compare models', icon: <IconSplit /> },
  { id: 'topics', label: 'Topics', icon: <IconChat /> },
];

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
function LitSection({ panel, label, second, leading, defaultOpen, children }: { panel: HTMLElement; label: string; second?: boolean; leading?: boolean; defaultOpen?: boolean; children: ReactNode }) {
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
    // Sections the panel keeps last (Views: Floor plans, Storeys) stay below.
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
  return createPortal(children, section);
}

/** The Views tab (Models and 4D Sequencing): the viewer's Lit panel (Saved
    views, Floor plans, Storeys) with what saved views keep (Saved view
    attributes) and the page's view settings (`settings`) after Saved views, then the Fly-through and any `extra` sections at
    the end. Only one page shows at a time, so both can host the same panel. */
export function ViewpointsPanel({ element, settings, extra = [] }: { element: HTMLElement; settings: ReactNode; extra?: { label: string; content: ReactNode }[] }) {
  return (
    <BottomDock title="Saved view attributes" storageKey="savedViewAttrs" dock={<SavedViewAttrsPanel />}>
      <LitPanel element={element} />
      <LitSection panel={element} label="View settings" second>{settings}</LitSection>
      <LitSection panel={element} label="Fly-through"><FlythroughPanel /></LitSection>
      {extra.map((x) => (
        <LitSection key={x.label} panel={element} label={x.label}>{x.content}</LitSection>
      ))}
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
      <LitPanel element={panels.tree} />
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
  const [saved, setTab] = usePersistedState<TabId>('models.configTab', 'tree');
  // A remembered tab that no longer exists (View settings and Fly-through
  // are now sections of Views).
  // Related is now part of 3D.
  const tab: TabId = TABS.some((t) => t.id === saved) ? saved : ['view3d', 'flythrough'].includes(saved) ? 'views' : (saved as string) === 'related' ? 'models' : (saved as string) === 'sets' ? 'search' : 'tree';
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

  return (
    <SidePane tabs={TABS} active={tab} onSelect={setTab} bodyClassName="config-panel__body model-config__body">
      {tab === 'models' ? (
        <RelatedTab page="model" />
      ) : tab === 'tree' ? (
        <SelectionTreeTab />
      ) : tab === 'properties' ? (
        <PropertiesTab />
      ) : tab === 'colour' ? (
        <ModelColorPanel />
      ) : tab === 'checks' ? (
        <ModelChecksPanel />
      ) : tab === 'compare' ? (
        <ModelComparePanel />
      ) : tab === 'search' ? (
        <SearchSetsPanel />
      ) : tab === 'datatable' ? (
        <DataTablePanel />
      ) : panels && tab === 'views' ? (
        <ViewpointsPanel key={tab} element={panels.views} settings={<View3DPanel page="model" />} />
      ) : panels ? (
        <LitPanel key={tab} element={panels[tab]} />
      ) : (
        <div className="flt__hint">Starting viewer…</div>
      )}
    </SidePane>
  );
}
