import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useModelsStore } from '../state/modelsStore';
import { useOrderPreview } from '../state/orderPreviewStore';
import { OrderPreviewEffects } from '../components/scenarios/OrderPreview';
import { isTableCfgTab, useScenarioStore } from '../state/scenarioStore';
import { useScenarioView } from '../scenarios/useScenarioView';
import { ScenarioNotice, ScenarioPanelBody, ScenarioSync, ScenarioTable, ScenarioToolbar } from '../components/scenarios/ScenarioParts';
import { ScenarioRulesEditor } from '../components/scenarios/ScenarioRules';
import { RecipesEditor } from '../components/scenarios/rules/RecipesEditor';
import { CrewsAndTrades } from '../components/scenarios/rules/CrewsAndTrades';
import { GroupingLevels } from '../components/scenarios/rules/GroupingLevels';
import { BuildOrdersSection } from '../components/scenarios/rules/BuildOrders';
import { LevelLinksSection } from '../components/scenarios/rules/RulesPage';
import { ParametersResourcesPanel } from '../components/scenarios/rules/ParametersResources';
import { ExtraActivitiesTab, LevelTasksTab, OrderPanel } from '../components/scenarios/rules/SequencePanel';
import { ResourceLimits } from '../components/scenarios/rules/ResourceLimits';
import { LevelsPanel } from '../components/scenarios/rules/LevelsPanel';
import { BareGrid } from '../components/scenarios/rules/RelationalTables';
import { useRuleContext } from '../components/scenarios/rules/RuleParts';
import { usePersistedState } from '../utils/persistedState';
import { ModelsGanttPanel } from '../components/ModelConfigPanel';
import { ListSetupButton } from '../components/ViewPicker';
import { createPortal } from 'react-dom';
import { useHeaderSlotStore } from '../state/headerSlotStore';
import { ADVANCED_TABS, GENERATE_TABS, type GenerateTab, useGenerateTab, useShownAdvancedTab, useShownGenerateTab } from '../components/scenarios/GenerateTabs';

/** Generate: the whole of programme generation in one view, in tabs you take in order, no panels. 1 Scenario (project, building, start date, Update 4D,
    Save), 2 Resources (equipment, cranes and materials, and how many: the one place a count is typed), 3 Recipes (how each kind of object is built),
    4 Order (the pours in the order they are built, with the table's columns, filters, grouping and colours), and Advanced: parameters, rates and crews
    (what sets the durations), Rules (extra activities, manual links, settings, the logic between objects), and Steps & limits (the search sets in the
    order they are built, and the limits on what runs at once). Each scenario is a folder under <project>/scenarios. 4D Sequencing's Scenarios panel works on the same store
    (state/scenarioStore.ts), so the two stay in step. */

const CONFIG_TABS = [['columns', 'Columns'], ['filters', 'Filters'], ['group', 'Group'], ['color', 'Color']] as const;

/** The strip over the 3D half: what the colours mean and how to hide it. The rest of the half lets the mouse through to the viewer. */
function OrderViewBar() {
  const setShow = useOrderPreview((s) => s.setShow);
  const current = useOrderPreview((s) => s.current);
  const setCurrent = useOrderPreview((s) => s.setCurrent);
  const models = useModelsStore((s) => s.models.length);
  return (
    <div className="gen-order__viewbar">
      <span className="scn-dim">{models === 0 ? 'No model is loaded: load one in Models to see the work breakdown here.' : current ? 'Only the chosen work item is coloured.' : 'Each work item has its colour. Click one, or an object, to pick it.'}</span>
      {current && <button type="button" className="btn btn--small" onClick={() => setCurrent(null)} title="Colour every work item again">Show all</button>}
      <button type="button" className="btn btn--small" onClick={() => setShow(false)} title="Hide the 3D view so the list takes the full width. Show 3D brings it back">Hide 3D</button>
    </div>
  );
}

/** The Order: the steps beside a 3D view that shows them by colour, and Generate. */
function OrderTab() {
  const { ready } = useScenarioView();
  const manual = useScenarioStore((s) => s.relations.length);
  const setTab = useGenerateTab((s) => s.setTab);
  const setAdvanced = useGenerateTab((s) => s.setAdvanced);
  const show = useOrderPreview((s) => s.show);
  const viewRef = useRef<HTMLDivElement>(null);
  // Levels and zones sit under the list; the "per level" link opens them.
  const levelsAsked = useGenerateTab((s) => s.advanced === 'levels');
  const [levelsOpen, setLevelsOpen] = useState(false);
  const levelsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => { if (levelsAsked) { setLevelsOpen(true); levelsRef.current?.scrollIntoView({ block: 'nearest' }); } }, [levelsAsked]);
  if (!ready) return null;
  return (
    <div className={`gen-order gen-order--split${show ? ' has-view' : ''}`}>
      <div className="gen-order__list">
        <ScenarioNotice />
        <OrderPanel />
        <GroupingLevels />
        <BuildOrdersSection />
        <details className="gen-order__levels" ref={levelsRef} open={levelsOpen} onToggle={(e) => setLevelsOpen((e.currentTarget as HTMLDetailsElement).open)}>
          <summary title="Which property is the level and the order the levels are built in; which zones are connected and which are not">Levels and zones</summary>
          <LevelsPanel />
        </details>
        {manual > 0 && (
          <div className="scn-dim xl__note">
            Also in this programme: {manual} manual link{manual === 1 ? '' : 's'}, which tie two activities together and are not work items.{' '}
            <button type="button" className="link-btn" onClick={() => setAdvanced('rules')} title="Manual links are kept on the Rules tab">Open them</button>
          </div>
        )}
      </div>
      {show && (
        <div className="gen-order__view" ref={viewRef}>
          <OrderPreviewEffects view={viewRef} />
          <OrderViewBar />
        </div>
      )}
    </div>
  );
}

/** The objects one by one, in the order they are built (Advanced › Objects): the table with its columns, filters, grouping and colours. */
function PoursTab() {
  const { ready } = useScenarioView();
  const [cfg, setCfg] = usePersistedState<(typeof CONFIG_TABS)[number][0]>('generate.orderConfig', 'columns');
  const [cfgOpen, setCfgOpen] = usePersistedState<boolean>('generate.orderConfigOpen', false);
  if (!ready) return null;
  return (
    <div className="gen-order">
      <ScenarioNotice />
      <div className="gen-tools scn-toolbar"><div className="schedule-toolbar__left"><ScenarioToolbar /><button type="button" className="btn" aria-expanded={cfgOpen} onClick={() => setCfgOpen(!cfgOpen)} title="Which columns the table shows, its filters, grouping and colours">Table settings {cfgOpen ? '▲' : '▼'}</button></div></div>
      {cfgOpen && (
        <div className="gen-order__cfg">
          <div className="scn-rules__tabs" role="tablist" style={{ padding: 0, border: 0 }}>
            {CONFIG_TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={cfg === id} className={cfg === id ? 'is-active' : ''} onClick={() => setCfg(id)}>{label}</button>)}
          </div>
        </div>
      )}
      {cfgOpen && isTableCfgTab(cfg) && <div className="gen-order__cfgbody scn-panel"><ScenarioPanelBody tab={cfg} /></div>}
      <div className="gen-order__table"><ScenarioTable /></div>
    </div>
  );
}

/** Labour: one table of the numbers a planner already knows: the crews, their trades, how many people and gangs, and the productivity. */
function LabourTab() {
  return <div className="gen-labour"><CrewsAndTrades /></div>;
}

/** The editors of a header tab: the one editor, or a short row of tabs when the tab holds two or three. */
function PartsTab({ tab }: { tab: GenerateTab }) {
  const { ready } = useScenarioView();
  const part = useShownAdvancedTab();
  const setAdvanced = useGenerateTab((s) => s.setAdvanced);
  const pours = useScenarioStore((s) => s.rows.length);
  const extras = useScenarioStore((s) => s.extras.length);
  const ctx = useRuleContext();
  const count = (id: string) => (id === 'pours' ? ` (${pours.toLocaleString()})` : id === 'extras' ? ` (${extras})` : id === 'levelTasks' ? ` (${ctx.rules.levelTasks.length})` : '');
  const parts = (GENERATE_TABS.find((t) => t.id === tab)?.parts ?? []).filter((id) => ready || !ADVANCED_TABS.find((x) => x.id === id)?.needsScenario);
  return (
    <div className="gen-advanced">
      {parts.length > 1 && (
        <div className="scn-rules__tabs" role="tablist" aria-label="Editors">
          {parts.map((id) => { const t = ADVANCED_TABS.find((x) => x.id === id)!; return (
            <button key={id} type="button" role="tab" aria-selected={part === id} className={part === id ? 'is-active' : ''} title={t.tip} onClick={() => setAdvanced(id)}>{t.label}{count(id)}</button>
          ); })}
        </div>
      )}
      {/* The tables have 12px of space around them; the recipes, the objects and the rules fill the page themselves. */}
      <BareGrid.Provider value>
        {part === 'parameters' && <div className="gen-pad"><ParametersResourcesPanel /></div>}
        {part === 'limits' && <div className="gen-pad"><ResourceLimits /></div>}
      </BareGrid.Provider>
      {part === 'recipes' && <RecipesEditor />}
      {part === 'extras' && <div className="gen-pad"><ExtraActivitiesTab /></div>}
      {part === 'levelTasks' && <div className="gen-pad"><LevelTasksTab /><LevelLinksSection /></div>}
      {part === 'pours' && <PoursTab />}
      {part === 'rules' && <ScenarioRulesEditor />}
    </div>
  );
}

export function ScenariosPage({ picker }: { /** The page picker with the search box and the tabs: the page's own header, like Home's. */ picker?: ReactNode }) {
  const tab = useShownGenerateTab();
  const preview = useOrderPreview((s) => s.show) && tab === 'order';
  // The header (page picker, search, step tabs) runs the full width in the viewer's header slot: the docks start below it.
  const headerSlot = useHeaderSlotStore((h) => h.el);
  const bar = <div className="filterbar schedule-toolbar gen-head"><div className="schedule-toolbar__left">{picker}</div><div className="schedule-toolbar__right"><ListSetupButton always /></div></div>;
  return (
    <div className={`scn-page gen-page${preview ? ' gen-page--preview' : ''}`}>
      <ScenarioSync />
      {/* The Gantt as a dock panel here too, so choosing it in the Navigation Bar or the Panels menu docks it in this view. */}
      <ModelsGanttPanel />
      {headerSlot ? createPortal(bar, headerSlot) : bar}
      <main className="gen-main">
        {tab === 'order' && <OrderTab />}
        {tab === 'scenario' && <div className="gen-scenario scn-panel scn-panel__body"><ScenarioPanelBody tab="scenario" /></div>}
        {tab === 'assumptions' && <LabourTab />}
        {tab !== 'order' && tab !== 'scenario' && tab !== 'assumptions' && <PartsTab tab={tab} />}
      </main>
    </div>
  );
}
