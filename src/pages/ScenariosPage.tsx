import { useState, type ReactNode } from 'react';
import { isTableCfgTab, useScenarioStore } from '../state/scenarioStore';
import { useScenarioView } from '../scenarios/useScenarioView';
import { ScenarioNotice, ScenarioPanelBody, ScenarioSync, ScenarioTable, ScenarioToolbar } from '../components/scenarios/ScenarioParts';
import { ScenarioRulesEditor } from '../components/scenarios/ScenarioRules';
import { RecipesEditor } from '../components/scenarios/rules/RecipesEditor';
import { ResourcesPanel } from '../components/scenarios/rules/ResourcesScreen';
import { ExtraActivitiesTab, LevelTasksTab, OrderPanel } from '../components/scenarios/rules/SequencePanel';
import { ResourceLimits } from '../components/scenarios/rules/ResourceLimits';
import { LabourPanel } from '../components/scenarios/rules/LabourPanel';
import { LevelsPanel } from '../components/scenarios/rules/LevelsPanel';
import { PlanTablesPanel } from '../components/scenarios/rules/PlanTablesScreen';
import { BareGrid, CrewsTableCard, RatesTableCard, TradesTableCard } from '../components/scenarios/rules/RelationalTables';
import { useRuleContext } from '../components/scenarios/rules/RuleParts';
import { usePersistedState } from '../utils/persistedState';
import { ModelsGanttPanel } from '../components/ModelConfigPanel';
import { ListSetupButton } from '../components/ViewPicker';
import { createPortal } from 'react-dom';
import { useHeaderSlotStore } from '../state/headerSlotStore';
import { ADVANCED_TABS, useGenerateTab, useShownAdvancedTab, useShownGenerateTab } from '../components/scenarios/GenerateTabs';

/** Generate: the whole of programme generation in one view, in tabs you take in order, no panels. 1 Scenario (project, building, start date, Update 4D,
    Save), 2 Resources (equipment, cranes and materials, and how many: the one place a count is typed), 3 Recipes (how each kind of object is built),
    4 Order (the pours in the order they are built, with the table's columns, filters, grouping and colours), and Advanced: parameters, rates and crews
    (what sets the durations), Rules (extra activities, manual links, settings, the logic between objects), and Steps & limits (the search sets in the
    order they are built, and the limits on what runs at once). Each scenario is a folder under <project>/scenarios. 4D Sequencing's Scenarios panel works on the same store
    (state/scenarioStore.ts), so the two stay in step. */

const CONFIG_TABS = [['columns', 'Columns'], ['filters', 'Filters'], ['group', 'Group'], ['color', 'Color']] as const;

/** The Order: one table of steps, and Generate. */
function OrderTab() {
  const { ready } = useScenarioView();
  const manual = useScenarioStore((s) => s.relations.length);
  const setTab = useGenerateTab((s) => s.setTab);
  const setAdvanced = useGenerateTab((s) => s.setAdvanced);
  if (!ready) return null;
  return (
    <div className="gen-order">
      <ScenarioNotice />
      <OrderPanel />
      {manual > 0 && (
        <div className="scn-dim xl__note">
          Also in this programme: {manual} manual link{manual === 1 ? '' : 's'}, which tie two activities together and are not steps.{' '}
          <button type="button" className="link-btn" onClick={() => { setAdvanced('rules'); setTab('advanced'); }} title="Manual links are kept under Advanced › Rules">Open them</button>
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

/** The optional detail, in one row of tabs, one table under each. */
function AdvancedTab() {
  const part = useShownAdvancedTab();
  const setAdvanced = useGenerateTab((s) => s.setAdvanced);
  const setTab = useGenerateTab((s) => s.setTab);
  const pours = useScenarioStore((s) => s.rows.length);
  const extras = useScenarioStore((s) => s.extras.length);
  const ctx = useRuleContext();
  const count = (id: string) => (id === 'pours' ? ` (${pours.toLocaleString()})` : id === 'extras' ? ` (${extras})` : id === 'levelTasks' ? ` (${ctx.rules.levelTasks.length})` : '');
  return (
    <div className="gen-advanced">
      <div className="scn-rules__tabs" role="tablist" aria-label="Advanced">
        {ADVANCED_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={part === t.id} className={part === t.id ? 'is-active' : ''} title={t.tip} onClick={() => { setTab('advanced'); setAdvanced(t.id); }}>{t.label}{count(t.id)}</button>
        ))}
      </div>
      <BareGrid.Provider value>
        {part === 'parameters' && <PlanTablesPanel only={['parameters']} />}
        {part === 'durations' && <PlanTablesPanel only={['durations']} book={false} />}
        {part === 'rates' && <RatesTableCard ctx={ctx} />}
        {part === 'crews' && <CrewsTableCard ctx={ctx} />}
        {part === 'trades' && <TradesTableCard ctx={ctx} />}
        {part === 'limits' && <ResourceLimits />}
      </BareGrid.Provider>
      {part === 'levels' && <LevelsPanel />}
      {part === 'labour' && <LabourPanel />}
      {part === 'extras' && <ExtraActivitiesTab />}
      {part === 'levelTasks' && <LevelTasksTab />}
      {part === 'pours' && <PoursTab />}
      {part === 'rules' && <ScenarioRulesEditor />}
    </div>
  );
}

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
        {tab === 'resources' && (
          <ResourcesPanel only={['equipment', 'cranes', 'materials']} oneTable />
        )}
        {tab === 'advanced' && <AdvancedTab />}
      </main>
    </div>
  );
}
