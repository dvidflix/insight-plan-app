import { useState, type ReactNode } from 'react';
import { isTableCfgTab } from '../state/scenarioStore';
import { useScenarioView } from '../scenarios/useScenarioView';
import { ScenarioNotice, ScenarioPanelBody, ScenarioSync, ScenarioTable, ScenarioToolbar } from '../components/scenarios/ScenarioParts';
import { ScenarioRulesEditor } from '../components/scenarios/ScenarioRules';
import { RecipesEditor } from '../components/scenarios/rules/RecipesEditor';
import { ResourcesPanel } from '../components/scenarios/rules/ResourcesScreen';
import { PlanTablesPanel } from '../components/scenarios/rules/PlanTablesScreen';
import { usePersistedState } from '../utils/persistedState';
import { ModelsGanttPanel } from '../components/ModelConfigPanel';
import { ListSetupButton } from '../components/ViewPicker';
import { createPortal } from 'react-dom';
import { useHeaderSlotStore } from '../state/headerSlotStore';
import { useShownGenerateTab } from '../components/scenarios/GenerateTabs';

/** Generate: the whole of programme generation in one view, in tabs you take in order, no panels. 1 Scenario (project, building, start date, Update 4D,
    Save), 2 Order (the pours in the order they are built, with the table's columns, filters, grouping and colours), 3 Recipes (how each kind of
    object is built), 4 Productivity (parameters, rates and crews on one page: what sets the durations), 5 Resources (equipment, cranes and materials, and how many),
    6 Sequence (the steps, in the order the search sets are built, and the limits on what runs at once), 7 Rules (extra activities, manual links, settings,
    the logic between objects). Each scenario is a folder under <project>/scenarios. 4D Sequencing's Scenarios panel works on the same store
    (state/scenarioStore.ts), so the two stay in step. */

const CONFIG_TABS = [['columns', 'Columns'], ['filters', 'Filters'], ['group', 'Group'], ['color', 'Color']] as const;

function OrderTab() {
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
        {(
          <div className="scn-rules__tabs" role="tablist" style={{ padding: 0, border: 0 }}>
            {CONFIG_TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={cfg === id} className={cfg === id ? 'is-active' : ''} onClick={() => setCfg(id)}>{label}</button>)}
          </div>
        )}
      </div>
      )}
      {cfgOpen && isTableCfgTab(cfg) && <div className="gen-order__cfgbody scn-panel"><ScenarioPanelBody tab={cfg} /></div>}
      <div className="gen-order__table"><ScenarioTable /></div>
    </div>
  );
}

/** What sets the durations, on one page: the named parameters the formulas read, the rates, and the crews with their trades. */
function ProductivityTab() {
  return (
    <div className="gen-stack">
      <section><h3 className="gen-h">Parameters</h3><PlanTablesPanel only={['parameters']} /></section>
      <section><h3 className="gen-h">Rates</h3><ResourcesPanel only={['rates']} bare /></section>
      <section><h3 className="gen-h">Crews and trades</h3><ResourcesPanel only={['crews']} bare /></section>
    </div>
  );
}

/** The Generate view. Its tabs are in the main header (components/scenarios/GenerateTabs.tsx), so the page is only the content of the tab. */
export function ScenariosPage({ picker }: { /** The page picker with the search box and the tabs: the page's own header, like Home's. */ picker?: ReactNode }) {
  const tab = useShownGenerateTab();
  // The header (page picker, search, step tabs) runs the full width in the viewer's header slot: the docks start below it.
  const headerSlot = useHeaderSlotStore((h) => h.el);
  const bar = <div className="filterbar schedule-toolbar gen-head"><div className="schedule-toolbar__left">{picker}</div><div className="schedule-toolbar__right"><ListSetupButton always /></div></div>;
  return (
    <div className="scn-page gen-page">
      <ScenarioSync />
      {/* The Gantt as a dock panel here too, so choosing it in the Navigation Bar or the Panels menu docks it in this view. */}
      <ModelsGanttPanel />
      {headerSlot ? createPortal(bar, headerSlot) : bar}
      <main className="gen-main">
        {tab === 'scenario' && <div className="gen-scenario scn-panel scn-panel__body"><ScenarioPanelBody tab="scenario" /></div>}
        {tab === 'order' && <OrderTab />}
        {tab === 'recipes' && <RecipesEditor />}
        {tab === 'productivity' && <ProductivityTab />}
        {tab === 'resources' && <ResourcesPanel only={['equipment', 'cranes', 'materials']} />}
        {tab === 'sequence' && <PlanTablesPanel only={['steps', 'limits']} />}
        {tab === 'rules' && <ScenarioRulesEditor />}
      </main>
    </div>
  );
}
