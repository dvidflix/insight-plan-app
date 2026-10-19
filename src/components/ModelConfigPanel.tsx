import { FEATURES } from '../features';
import { PropertiesGrid } from './PropertiesGrid';
import { RecipesDock } from './scenarios/rules/RecipesEditor';
import { BottomDock } from './BottomDock';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSequenceUiStore } from '../state/sequenceUiStore';
import { rerenderTables } from '../viewer/viewerUI';
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
import { ModelImageExport } from './ModelImageExport';
import { TopicsPanel } from './TopicsPanel';
import { useTopicsStore } from '../state/topicsStore';
import { ModelChecksPanel } from './ModelChecksPanel';
import { ModelComparePanel } from './ModelComparePanel';
import { PropertyEditorPanel } from './PropertyEditorPanel';
import { FlythroughPanel } from './FlythroughPanel';
import { RelatedPanel } from './RelatedPanel';
import { PropertyVisibilityPanel } from './PropertyVisibilityPanel';
import { IfcToolsPanel } from './sequence/IfcToolsPanel';
import { ModelColorPanel } from './ModelColorPanel';
import { SearchSetsPanel } from './SearchSetsPanel';
import { useListConfigStore } from '../state/listConfigStore';
import { useDataTableStore } from '../state/dataTableStore';
import { DockPanel } from './Dock';
import { ScenarioTabContent } from './scenarios/ScenarioDock';
import { ScenarioRulesDock } from './scenarios/ScenarioRules';
import { DockGantt } from './sequence/DockGantt';
import { useSequenceSchedule } from '../state/scheduleStore';
import { useDockStore } from '../state/dockStore';
import { useOnSplit, useViewpointsToggle } from '../state/sidePaneStore';
import { useAppPrefsStore, useExperimental } from '../state/appPrefsStore';
import { useViewSettingsStore } from '../state/viewSettingsStore';

/** The Gantt as a panel on the Models page too (4D Sequencing and Programmes have it as well): the same Gantt, here without a
    timeline to follow beyond the date line, so a programme can sit beside the 3D view whichever page it is. */
function ModelsGanttPanel() {
  const model = useSequenceSchedule();
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <DockPanel id="gantt" label="Gantt">
      {model
        ? <DockGantt model={model} selectedId={picked} highlightedIds={NO_IDS} scrollToId={null} onSelect={(a) => setPicked(a.id)} />
        : <div style={{ padding: 12, color: 'var(--text-dim)' }}>Load a programme in Inputs to see it here.</div>}
    </DockPanel>
  );
}
const NO_IDS = new Set<string>();

/** The Models page's tools (Model checks, Compare models, Topics): dock panels beside / under the 3D view, like 4D
    Sequencing's Gantt, Tasks and Scenarios — each can sit left, bottom or right (the Panels menu), and panels on the
    same side are tabs. */
export function ModelToolsPanel() {
  const panels = useSequenceUiStore((s) => s.modelPanels);
  // The Topics tool (BCF) is an experimental feature.
  const bcf = useAppPrefsStore((s) => s.experimental.bcf);
  // Recipes (the library) are shown here too: they do not need a scenario.
  const scenarios = useAppPrefsStore((s) => s.experimental.scenarios);
  // A topic marker clicked in 3D brings the Topics tool up.
  const openRequest = useTopicsStore((st) => st.openRequest);
  const seen = useRef(openRequest);
  useEffect(() => {
    if (openRequest === seen.current) return;
    seen.current = openRequest;
    if (bcf) useDockStore.getState().reveal('topics');
  }, [openRequest, bcf]);
  return (
    <>
      <DockPanel id="checks" label="Model checks"><ModelChecksPanel /></DockPanel>
      <DockPanel id="compare" label="Compare models"><ModelComparePanel /></DockPanel>
      {scenarios && <DockPanel id="recipes" label="Recipes"><RecipesDock /></DockPanel>}
      {scenarios && <DockPanel id="scenarios" label="Sequence"><ScenarioTabContent /></DockPanel>}
      {scenarios && <DockPanel id="rules" label="Rules"><ScenarioRulesDock /></DockPanel>}
      {bcf && <DockPanel id="topics" label="Topics">{panels ? <div className="tpc-pad"><TopicsPanel /></div> : <div className="flt__hint">Starting viewer…</div>}</DockPanel>}
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
    <div className="model-config__split"><div className="model-config__split-top">
      <LitPanel element={element} />
      <LitSection panel={element} label="Fly-through" leading defaultOpen><FlythroughPanel /></LitSection>
      <LitSection panel={element} label="Decorators"><div className="disp vsp"><MarkersPanel /><ConstructionPlanesPanel /></div></LitSection>
      {cutsOn && <LitSection panel={element} label="Section cuts"><SectionCutsPanel /></LitSection>}
      {extra.map((x) => (
        <LitSection key={x.label} panel={element} label={x.label}>{x.content}</LitSection>
      ))}
      <LitSection panel={element} label="View settings" headerAction={<ViewSettingsFoldButton />}>{settings}</LitSection>
    </div></div>
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
      {FEATURES.serverFiles && <LitSection panel={panels.properties} label="Edit properties"><PropertyEditorPanel /></LitSection>}
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
        {FEATURES.serverFiles && <IfcToolsPanel page={page} />}
      </div>
      <ClashResultsList />
    </div>
  );
}

/** A panel's body: scrolls, with the padding the side pane's tabs had. */
function PaneBody({ children }: { children: ReactNode }) {
  return <div className="config-panel__body model-config__body" style={{ flex: 1, minHeight: 0 }}>{children}</div>;
}

/** The 3D view's tools as dock panels (3D & Related, Properties, Selection Tree, Search sets, Views, Data table
    setup), the same in Models and in 4D Sequencing: each sits left, bottom or right like any other panel. `views`
    is the Views panel's content (the page adds its own settings and exports to it). */
export function ModelDockPanels({ page, views, colour }: { page: 'model' | 'sequence'; views?: ReactNode; colour?: boolean }) {
  return (
    <>
      <DockPanel id="related" label="3D"><PaneBody><RelatedTab page={page} /></PaneBody></DockPanel>
      <DockPanel id="tree" label="Tree"><PaneBody><SelectionTreeTab /></PaneBody></DockPanel>
      <DockPanel id="properties" label="Properties"><PaneBody><PropertiesTab /></PaneBody></DockPanel>
      <DockPanel id="search" label="Sets"><PaneBody><SearchSetsPanel player={page === 'model'} /></PaneBody></DockPanel>
      {views !== undefined && <DockPanel id="views" label="Views"><PaneBody>{views}</PaneBody></DockPanel>}
      {colour && <DockPanel id="colour" label="Colour"><PaneBody><ModelColorPanel /></PaneBody></DockPanel>}
    </>
  );
}

/** What the Models page does on its own: the data table's Configure brings its setup up, splitting the view brings up Views. */
function ModelPageReactions() {
  const configRequest = useDataTableStore((s) => s.configRequest);
  useEffect(() => {
    if (configRequest) useListConfigStore.getState().setNOpen(true);
  }, [configRequest]);
  const split = useViewSettingsStore((s) => s.pages.model.split);
  useOnSplit(split);
  useViewpointsToggle('model');
  return null;
}

/** The Models page's panels: model browsing (tree, properties, sets, views with the view settings and fly-through,
    colour) and placement, as dock panels. */
export function ModelConfigPanel({ background = false }: { /** Another view is the main window (the Programmes views): the panels are there to open beside it, without the Models page's own reactions and its Gantt. */ background?: boolean } = {}) {
  const panels = useSequenceUiStore((s) => s.modelPanels);
  return (
    <>
      {!background && <ModelPageReactions />}
      <ModelToolsPanel />
      {!background && <ModelsGanttPanel />}
      <ModelDockPanels
        page="model"
        colour
        views={panels ? <ViewpointsPanel element={panels.views} settings={<View3DPanel page="model" />} extra={[{ label: 'Output', content: <ModelImageExport /> }]} /> : <div className="flt__hint">Starting viewer…</div>}
      />
    </>
  );
}
